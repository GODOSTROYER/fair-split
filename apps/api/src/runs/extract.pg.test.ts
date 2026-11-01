// The reading on a world whose replay photos (A–L) are unread, as in a judge clone (judge/world.ts writes only
// the earlier photos' rows): "Mark paid" queues `extract`, which replays the seed's own reading of the 48 slips
// as a labelled stand-in (never a Claude recording), one photo per step, paced to land within Judge Mode's 20 s;
// then computeRun opens the review with the seed's holds. On embedded Postgres, PayPal answered by msw. Also: a
// second delivery of a step changes nothing, a restart mid-reading resumes where it stopped, and the tasks this
// build has no worker for complete with a labelled outcome instead of dying.
import { RunEvent, TASK_NAMES, type TaskName } from "@fairsplit/contracts";
import { schema, verifyChain } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wireOutbox } from "../db.js";
import { READING_PACE, readingProvenance, SEED_STAND_IN } from "./extract.js";
import { type RunsHarness, readSlips, resolveAll, runQueued, signBoth, startRuns } from "./test/app.js";
import { paypalScript } from "./test/paypal.js";
import { NOT_BUILT } from "./unbuilt.js";

const snapshot = getSnapshot();
const figures = snapshot.figures;
const replaySlips = snapshot.slips.filter((s) => s.replaySet);
const replayPhotos = snapshot.photos.filter((p) => p.set === "REPLAY");
const PHOTO_ORDER = replayPhotos.map((p) => p.photoId);

async function outboxRows(h: RunsHarness, name: TaskName) {
  const t = schema.taskOutbox;
  return h.t.deps.db
    .select()
    .from(t)
    .where(and(eq(t.workspaceId, h.world.workspaceId), eq(t.name, name)))
    .orderBy(asc(t.createdAt));
}

async function runState(h: RunsHarness): Promise<string> {
  const [run] = await h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return run?.state ?? "missing";
}

async function events(h: RunsHarness, types: readonly string[]) {
  return h.t.deps.db
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.workspaceId, h.world.workspaceId), inArray(schema.runEvents.type, types)))
    .orderBy(asc(schema.runEvents.id));
}

async function replayDocIds(h: RunsHarness): Promise<Map<string, string>> {
  const docs = await h.t.deps.db
    .select({ id: schema.documents.id, photo: schema.documents.photoCode })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.workspaceId, h.world.workspaceId),
        inArray(schema.documents.photoCode, PHOTO_ORDER),
      ),
    );
  return new Map(docs.map((d) => [d.photo as string, d.id]));
}

/** Row counts of everything a reading step writes (a second delivery must change none of them). */
async function footprint(h: RunsHarness) {
  const count = async (table: string) => {
    const rows = (await h.t.deps.db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${h.world.workspaceId}`,
    )) as unknown as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  };
  return {
    rows: await count("slip_rows"),
    fields: await count("slip_fields"),
    marks: await count("deduction_marks"),
    anomalies: await count("slip_anomalies"),
    events: await count("run_events"),
    ledger: await count("ledger_entries"),
    outbox: await count("task_outbox"),
  };
}

function asRunEvent(e: typeof schema.runEvents.$inferSelect) {
  return RunEvent.safeParse({
    id: String(e.id),
    ws: e.workspaceId,
    runId: e.runId,
    at: e.at.toISOString(),
    actor: { kind: e.actorKind, id: e.actorId, impersonatedBy: e.impersonatedBy },
    provenance: e.provenance,
    type: e.type,
    payload: e.payload,
  });
}

describe("the reading on a world with no pre-seeded replay rows (a judge clone's), to the review", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({
      paypal: script.handlers,
      world: { runState: "INVOICED", replayRows: false },
    });
  });
  afterAll(async () => h?.close());

  it("the 12 replay photos start unread; the earlier photos' rows are there", async () => {
    const docs = await replayDocIds(h);
    expect(docs.size).toBe(12);
    const read = await h.t.deps.db
      .select({ id: schema.slipRows.id })
      .from(schema.slipRows)
      .where(inArray(schema.slipRows.documentId, [...docs.values()]));
    expect(read).toHaveLength(0);
    const all = await h.t.deps.db
      .select({ id: schema.slipRows.id })
      .from(schema.slipRows)
      .where(eq(schema.slipRows.workspaceId, h.world.workspaceId));
    expect(all).toHaveLength(snapshot.slips.length - replaySlips.length);
  });

  it("Mark paid funds the run and queues the reading of the 12 photos as one task row (I7)", async () => {
    const r = await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    expect(r).toMatchObject({ runState: "EXTRACTING", invoiceStatus: "MARKED_AS_PAID" });
    const extract = await outboxRows(h, "extract");
    expect(extract).toHaveLength(1);
    expect(extract[0]?.state).toBe("queued");
    expect(extract[0]?.dedupeKey.length).toBeLessThanOrEqual(200);
    const args = extract[0]?.args as { documentIds: string[]; runId: string };
    expect(args.runId).toBe(h.world.runId);
    expect(new Set(args.documentIds)).toEqual(new Set((await replayDocIds(h)).values()));
  });

  it("the funding's computeRun finds the photos unread and leaves the run reading", async () => {
    expect(await runQueued(h, "computeRun")).toBe(1);
    expect(await runState(h)).toBe("EXTRACTING");
  });

  it("one photo per step, A to L; each step is due one pace after the last, so the 12 land within 20 s", async () => {
    const t = schema.taskOutbox;
    /** Per step: when it was due as queued, and when it ran (made due early, as time passing would). */
    const due: { queued: number; ran: number }[] = [];
    const docs = await replayDocIds(h);
    for (let k = 0; k < 12; k++) {
      const [row] = await h.t.deps.db
        .select()
        .from(t)
        .where(and(eq(t.workspaceId, h.world.workspaceId), eq(t.name, "extract"), eq(t.state, "queued")));
      expect(row, `step ${k}`).toBeDefined();
      if (!row) return;
      const [ran] = await h.t.deps.db
        .update(t)
        .set({ runAfter: sql`now()` })
        .where(eq(t.id, row.id))
        .returning({ runAfter: t.runAfter });
      due.push({ queued: row.runAfter.getTime(), ran: ran?.runAfter.getTime() ?? 0 });
      expect((await h.t.deps.outbox?.runTask(row.id))?.outcome).toBe("done");
      const photo = PHOTO_ORDER[k] as string;
      const rows = await h.t.deps.db
        .select({ serial: schema.slipRows.serial })
        .from(schema.slipRows)
        .where(eq(schema.slipRows.documentId, docs.get(photo) as string));
      expect(rows.map((r) => r.serial).sort(), photo).toEqual(
        replaySlips
          .filter((s) => s.photoId === photo)
          .map((s) => s.serial)
          .sort(),
      );
    }
    expect(await outboxRows(h, "extract")).toHaveLength(12);
    expect((await outboxRows(h, "extract")).every((r) => r.state === "done")).toBe(true);
    // the schedule: each step is queued one pace after the time its predecessor was due, so nothing waits in a
    // request or an executor slot and a late step (the dispatcher polls each second) does not push the rest back:
    // the twelfth photo is due 11 paces after the first, inside S1.7's 12 s and Judge Mode's 20 s
    for (let k = 1; k < due.length; k++) {
      const gap = (due[k]?.queued as number) - (due[k - 1]?.ran as number);
      expect(gap, `step ${k}`).toBeGreaterThanOrEqual(READING_PACE.photoGapMs);
      expect(gap, `step ${k}`).toBeLessThan(READING_PACE.photoGapMs + 5_000);
    }
    expect(11 * READING_PACE.photoGapMs).toBeLessThanOrEqual(12_000);
  });

  it("the rows are the seed's own: every figure, the pink 0457, 0458's marks, M-053's slips, 0462 by hand", async () => {
    const rows = await h.t.deps.db
      .select({ row: schema.slipRows, memberNo: schema.members.memberNo, photo: schema.documents.photoCode })
      .from(schema.slipRows)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.slipRows.documentId))
      .leftJoin(schema.members, eq(schema.members.id, schema.slipRows.memberId))
      .where(
        and(
          eq(schema.slipRows.workspaceId, h.world.workspaceId),
          inArray(schema.documents.photoCode, PHOTO_ORDER),
        ),
      );
    expect(rows).toHaveLength(replaySlips.length);
    for (const s of replaySlips) {
      const found = rows.filter((r) => r.row.serial === s.serial && r.row.copyColor === s.copy);
      expect(found, `${s.serial} ${s.copy}`).toHaveLength(1);
      const r = found[0] as (typeof rows)[number];
      const byHand = s.serial === "0462";
      expect({
        photo: r.photo,
        memberNo: r.memberNo,
        slipDate: r.row.slipDate,
        grade: r.row.grade,
        tareG: Number(r.row.tareG),
        grossG: r.row.grossG === null ? null : Number(r.row.grossG),
        netG: r.row.netG === null ? null : Number(r.row.netG),
        state: r.row.state,
        provenance: r.row.provenance,
      }).toEqual({
        photo: s.photoId,
        memberNo: s.memberNo,
        slipDate: s.slipDate,
        grade: s.grade,
        tareG: s.tareG,
        grossG: byHand ? null : s.grossG,
        netG: byHand ? null : s.netG,
        state: byHand ? "NEEDS_HUMAN" : "AUTO_ACCEPTED",
        provenance: "seeded",
      });
    }
    // H1: slip 0457 twice, the white original in B and the office's pink copy in D
    expect(
      rows
        .filter((r) => r.row.serial === "0457")
        .map((r) => [r.photo, r.row.copyColor])
        .sort(),
    ).toEqual([
      ["B", "WHITE_ORIGINAL"],
      ["D", "PINK_DUPLICATE"],
    ]);
    // H2: Merlyn Ponce's (M-053) replay slips carry the seed's kilos
    const m053 = replaySlips.filter((s) => s.memberNo === "M-053");
    expect(rows.filter((r) => r.memberNo === "M-053")).toHaveLength(m053.length);
    // H3: slip 0458's box 13, verbatim, with the seed's rules and written amounts (₱200 matches no rule)
    const id0458 = rows.find((r) => r.row.serial === "0458")?.row.id as string;
    const marks = await h.t.deps.db
      .select()
      .from(schema.deductionMarks)
      .where(eq(schema.deductionMarks.slipRowId, id0458));
    expect(
      marks.map((m) => [m.textVerbatim, m.ruleId, m.writtenCents === null ? null : Number(m.writtenCents)]),
    ).toEqual(
      replaySlips.find((s) => s.serial === "0458")?.marks.map((m) => [m.text, m.ruleId, m.writtenCentavos]),
    );
    expect(marks.map((m) => m.ruleId)).toContain("NO_MATCH");
    // slip 0449's margin note is quarantined, never a field
    const anomalies = await h.t.deps.db
      .select()
      .from(schema.slipAnomalies)
      .where(eq(schema.slipAnomalies.workspaceId, h.world.workspaceId));
    expect(anomalies.map((a) => [a.kind, a.quarantinedText])).toEqual([
      ["INSTRUCTION_LIKE_TEXT", replaySlips.find((s) => s.marginNote !== null)?.marginNote],
    ]);
    // slip 0462: the stained gross and net agree on nothing a person need not check (0.40), the rest agreed
    const row0462 = rows.find((r) => r.row.serial === "0462")?.row.id as string;
    const fields = await h.t.deps.db
      .select()
      .from(schema.slipFields)
      .where(eq(schema.slipFields.slipRowId, row0462));
    const f = (name: string) => fields.find((x) => x.field === name);
    expect(f("gross_kg")).toMatchObject({
      agreement: 0.4,
      finalValue: null,
      decidedBy: null,
      readA: { valueText: "6?.80", legibility: "SMUDGED" },
    });
    expect(f("net_kg")).toMatchObject({ agreement: 0.4, finalValue: null, decidedBy: null });
    expect(f("tare_kg")).toMatchObject({ agreement: 0.97, finalValue: "0.30", decidedBy: "agreement" });
  });

  it("events: 48 extract.row with their extract.field, IC-01 RunEvents, labelled seeded and attributed to the seed", async () => {
    const all = await events(h, ["extract.row", "extract.field", "extract.quarantined"]);
    for (const e of all) expect(asRunEvent(e).success, `${e.type} ${JSON.stringify(e.payload)}`).toBe(true);
    expect(all.every((e) => e.provenance === SEED_STAND_IN.provenance)).toBe(true);
    expect(all.every((e) => e.actorKind === "system" && e.actorId === SEED_STAND_IN.actor.id)).toBe(true);
    expect(all.every((e) => e.runId === h.world.runId)).toBe(true);
    const rows = all.filter((e) => e.type === "extract.row");
    expect(rows).toHaveLength(48);
    expect(all.filter((e) => e.type === "extract.field")).toHaveLength(48 * 13 * 2);
    expect(all.filter((e) => e.type === "extract.quarantined")).toHaveLength(1);
    const p0462 = rows.find((e) => (e.payload as { serial: string }).serial === "0462")?.payload as {
      fields: Record<
        string,
        { value: string | null; score: number; decidedBy: string | null; display: string }
      >;
      memberNo: string;
    };
    expect(p0462.memberNo).toBe("M-060");
    expect(p0462.fields.gross_kg).toEqual({ value: null, score: 0.4, decidedBy: null, display: "6?.80" });
    expect(p0462.fields.net_kg).toEqual({ value: null, score: 0.4, decidedBy: null, display: "6?.50" });
    expect(p0462.fields.tare_kg).toEqual({
      value: "0.30",
      score: 0.97,
      decidedBy: "agreement",
      display: "0.30",
    });
    expect(SEED_STAND_IN.label).toBe("Seed stand-in, not a Claude recording");
    expect(await readingProvenance(h.t.deps.db, h.world.workspaceId, h.world.runId)).toBe("seeded");
  });

  it("Proof plate 3: each replay photo's rows are accepted in the chain, with its hash; the chain verifies", async () => {
    const accepted = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "rows.accepted"),
        ),
      )
      .orderBy(asc(schema.ledgerEntries.seq));
    const docs = await replayDocIds(h);
    expect(accepted.map((e) => (e.payload as { photoId: string }).photoId)).toEqual(PHOTO_ORDER);
    for (const photo of replayPhotos) {
      expect(
        accepted.find((e) => (e.payload as { photoId: string }).photoId === photo.photoId)?.payload,
      ).toEqual({
        documentId: docs.get(photo.photoId),
        photoId: photo.photoId,
        sha256: photo.manifestSha256,
        serials: photo.slips.map((s) => s.serial),
        slipDates: photo.slips.map(
          (s) => replaySlips.find((x) => x.photoId === photo.photoId && x.serial === s.serial)?.slipDate,
        ),
        provenance: "seeded",
      });
    }
    expect((await verifyChain(h.t.deps.db, h.world.workspaceId)).ok).toBe(true);
  });

  it("a second delivery of a step (the last one too) changes nothing", async () => {
    const t = schema.taskOutbox;
    const steps = await outboxRows(h, "extract");
    const before = await footprint(h);
    for (const step of [steps[3], steps.at(-1)]) {
      if (!step) throw new Error("no step");
      await h.t.deps.db
        .update(t)
        .set({ state: "queued", runAfter: sql`now()`, finishedAt: null })
        .where(eq(t.id, step.id));
      expect((await h.t.deps.outbox?.runTask(step.id))?.outcome).toBe("done");
    }
    expect(await footprint(h)).toEqual(before);
  });

  it("computeRun is queued once by the reading and opens the review: 4 open, 3 blocking, 0462 waits by hand", async () => {
    const compute = await outboxRows(h, "computeRun");
    expect(compute).toHaveLength(2); // the funding's (done, nothing to compute then) and the reading's
    expect(compute.filter((r) => r.dedupeKey === `compute:${h.world.runId}:read`)).toHaveLength(1);
    expect(await runQueued(h, "computeRun")).toBe(1);
    const run = await h.t.json<{ run: { state: string }; holds: { open: number; blocking: number } }>(
      `/v1/runs/${h.world.runSlug}`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.holds).toMatchObject({ open: 4, blocking: 3 });
    const holds = await h.t.json<{ holds: { label: string; kind: string; state: string }[] }>(
      `/v1/runs/${h.world.runSlug}/holds`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    const open = holds.body.holds.filter((x) => x.state === "OPEN").map((x) => x.kind);
    expect(open.sort()).toEqual(["DUPLICATE_SLIP", "IMPLAUSIBLE_YIELD", "LOW_CONFIDENCE", "NO_RULE"].sort());
    const slips = await h.t.json<{
      slips: {
        serial: string;
        state: string;
        fields: { field: string; displayMerge: string; score: number }[];
      }[];
    }>(`/v1/seasons/${h.world.runSlug.split("-r")[0]}/slips/0462`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    });
    const slip = slips.body.slips[0];
    expect(slip?.state).toBe("NEEDS_HUMAN");
    expect(slip?.fields.find((x) => x.field === "gross_kg")).toMatchObject({
      displayMerge: "6?.80",
      score: 0.4,
    });
  });

  it("the stand-in's rows pay exactly the seed's batch: 0462 by hand, H1–H3 resolved, both keys, the POST", async () => {
    await readSlips(h); // nothing left to read; learns slip 0462's field ids
    expect(h.world.fields0462.gross).not.toBe("");
    await resolveAll(h);
    await signBoth(h);
    await runQueued(h, "postPayoutBatch");
    const sent = script.posted.at(-1);
    expect(sent?.items).toHaveLength(figures.batchItemCount);
    const total = (sent?.items ?? []).reduce((s, i) => s + Math.round(Number(i.amount.value) * 100), 0);
    expect(total).toBe(figures.batchTotalCents);
    expect((await verifyChain(h.t.deps.db, h.world.workspaceId)).ok).toBe(true);
  });

  it("no outbox row died; the tasks this build has no worker for complete with a labelled outcome", async () => {
    const handlers = h.t.app.registry.taskHandlers(h.t.deps);
    for (const name of TASK_NAMES) expect(handlers[name], name).toBeTypeOf("function");
    const ws = h.world.workspaceId;
    const unbuilt = {
      readRateCard: { documentId: (await replayDocIds(h)).get("A") as string },
      warmCaches: { slot: "2026-10-31T20" },
      reconcile: { mode: "nightly", windowStart: "2026-10-31T00:00:00.000Z" },
      pushNotify: { kind: "cosign", targetId: h.world.runId, eventId: "1" },
    } as const;
    const ids = await h.t.deps.db.transaction(async (tx) => {
      const out: string[] = [];
      for (const [name, args] of Object.entries(unbuilt)) {
        out.push((await enqueue(tx, name as TaskName, args, `test:${name}:${ws}`, { workspaceId: ws })).id);
      }
      return out;
    });
    for (const id of ids) expect((await h.t.deps.outbox?.runTask(id))?.outcome).toBe("done");
    for (const name of Object.keys(unbuilt))
      expect(NOT_BUILT[name as keyof typeof NOT_BUILT]).toMatch(/not built in this build/);
    const dead = await h.t.deps.db
      .select({ name: schema.taskOutbox.name })
      .from(schema.taskOutbox)
      .where(and(eq(schema.taskOutbox.workspaceId, ws), eq(schema.taskOutbox.state, "dead")));
    expect(dead).toEqual([]);
  });
});

describe("a judge session's own clone (judge/world.ts) reads its photos and opens the review", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    // the sandbox balance under the floor: every PayPal step of the session replays, labelled
    h = await startRuns({ paypal: script.handlers, balanceCents: 500_000 });
  });
  afterAll(async () => h?.close());

  it("first press → Claude's (placeholder) invoice turn → Mark paid → the reading → IN_REVIEW, 4 open / 3 blocking", async () => {
    const r = await h.t.json<{ workspaceId: string; runId: string; runSlug: string; consoleToken: string }>(
      "/v1/judge/sessions",
      { method: "POST", body: {}, headers: { "cf-connecting-ip": "198.18.7.2" } },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { workspaceId: ws, runId, runSlug, consoleToken } = r.body;
    const t = schema.taskOutbox;
    const queued = (name: TaskName) =>
      h.t.deps.db
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.workspaceId, ws), eq(t.name, name), eq(t.state, "queued")))
        .orderBy(asc(t.runAfter));
    for (const row of await queued("agentTurn")) await h.t.deps.outbox?.runTask(row.id);
    const paid = await h.t.client(consoleToken).markPaid({ params: { runSlug } });
    expect(paid).toMatchObject({ runState: "EXTRACTING" });
    for (const row of await queued("computeRun")) await h.t.deps.outbox?.runTask(row.id);
    let steps = 0;
    for (let rows = await queued("extract"); rows.length > 0 && steps < 20; rows = await queued("extract")) {
      const id = rows[0]?.id as string;
      await h.t.deps.db.update(t).set({ runAfter: sql`now()` }).where(eq(t.id, id));
      await h.t.deps.outbox?.runTask(id);
      steps++;
    }
    expect(steps).toBe(12);
    for (const row of await queued("computeRun")) await h.t.deps.outbox?.runTask(row.id);
    const view = await h.t.json<{ run: { state: string }; holds: { open: number; blocking: number } }>(
      `/v1/runs/${runSlug}`,
      { as: h.t.credentials.bearer(consoleToken) },
    );
    expect(view.body.run.state).toBe("IN_REVIEW");
    expect(view.body.holds).toMatchObject({ open: 4, blocking: 3 });
    expect(await readingProvenance(h.t.deps.db, ws, runId)).toBe("seeded");
    expect(script.calls).toEqual([]);

    // Proof plate 3 on the clone: every photo with accepted rows has its hash in a `rows.accepted` entry
    const accepted = await h.t.deps.db
      .selectDistinct({ id: schema.documents.id, sha256: schema.documents.sha256 })
      .from(schema.documents)
      .innerJoin(schema.slipRows, eq(schema.slipRows.documentId, schema.documents.id))
      .where(
        and(
          eq(schema.documents.workspaceId, ws),
          inArray(schema.slipRows.state, ["AUTO_ACCEPTED", "CONFIRMED"]),
        ),
      );
    expect(accepted).toHaveLength(snapshot.photos.length);
    const entries = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(and(eq(schema.ledgerEntries.workspaceId, ws), eq(schema.ledgerEntries.kind, "rows.accepted")));
    for (const d of accepted) {
      expect(
        entries.some(
          (e) =>
            (e.payload as { documentId: string }).documentId === d.id &&
            (e.payload as { sha256: string }).sha256 === d.sha256,
        ),
        d.id,
      ).toBe(true);
    }
    expect((await verifyChain(h.t.deps.db, ws)).ok).toBe(true);
    const dead = await h.t.deps.db
      .select({ name: t.name })
      .from(t)
      .where(and(eq(t.workspaceId, ws), eq(t.state, "dead")));
    expect(dead).toEqual([]);
  });
});

describe("a restart mid-reading resumes where it stopped (fresh handlers, the real dispatcher)", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED", replayRows: false } });
  });
  afterAll(async () => h?.close());

  it("three photos read, the process gone; a new one finishes the reading in pace and opens the review", async () => {
    await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    await runQueued(h, "computeRun");
    expect(await readSlips(h, { maxSteps: 3 })).toBe(3);
    const pg = h.t.pg;
    if (!pg) throw new Error("postgres");
    // the old process's in-memory state is gone: a new outbox with new handlers and its own dispatcher
    const wiring = wireOutbox({
      env: h.t.deps.env,
      data: { database: pg.app },
      listenUrl: pg.url,
      handlers: h.t.app.registry.taskHandlers(h.t.deps),
      logger: h.t.deps.logger,
    });
    const started = Date.now();
    await wiring.start();
    try {
      while ((await runState(h)) !== "IN_REVIEW" && Date.now() - started < 25_000) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      await wiring.stop();
    }
    const took = Date.now() - started;
    expect(await runState(h)).toBe("IN_REVIEW");
    // nine photos left, one pace apart: well inside Judge Mode's 20 s
    expect(took).toBeLessThan(20_000);
    expect(took).toBeGreaterThanOrEqual(7 * READING_PACE.photoGapMs);
    const rows = await events(h, ["extract.row"]);
    expect(rows).toHaveLength(48);
    expect(
      new Set(
        rows.map((e) => `${(e.payload as { docId: string }).docId}:${(e.payload as { row: number }).row}`),
      ).size,
    ).toBe(48);
    const read = await h.t.deps.db
      .select({ id: schema.slipRows.id })
      .from(schema.slipRows)
      .where(eq(schema.slipRows.workspaceId, h.world.workspaceId));
    expect(read).toHaveLength(snapshot.slips.length);
    const t = schema.taskOutbox;
    const states = await h.t.deps.db
      .select({ name: t.name, state: t.state })
      .from(t)
      .where(and(eq(t.workspaceId, h.world.workspaceId), like(t.name, "%")));
    expect(states.filter((s) => s.state === "dead")).toEqual([]);
    expect(states.filter((s) => s.name === "extract")).toHaveLength(12);
    expect(states.filter((s) => s.name === "computeRun")).toHaveLength(2);
    const run = await h.t.json<{ holds: { open: number; blocking: number } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    });
    expect(run.body.holds).toMatchObject({ open: 4, blocking: 3 });
  });
});
