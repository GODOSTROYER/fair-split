// The slice's commands that need no PayPal answer, on embedded Postgres and the seeded season: addDeduction
// (MM-4, the database trigger's 409), capture (Content-Digest, the capture id as Idempotency-Key, exact
// duplicates, extraction dispatch in the same transaction), setFlag (ledger, event, HALT), the hold and field
// edge cases (ASK_CHAIR, overrides, VERSION_CONFLICT once money moves), and the season and rate-card reads.
import { randomUUID } from "node:crypto";
import { type ApiError, LedgerPayloads, RateCardRatifiedError } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign, overrideCount } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runHolds } from "../approvals/batch.js";
import { contentDigestOf } from "../lib/digest.js";
import { createTestApp, walkRun } from "../test/index.js";
import { type RunsHarness, resolveAll, startRuns } from "./test/app.js";
import { registerKey } from "./test/world.js";

let h: RunsHarness;
const auth = (token: string) => ({ as: h.t.credentials.bearer(token) });
const holdsOf = async () =>
  (
    await h.t.json<{ holds: { id: string; label: string; state: string; kind: string }[] }>(
      `/v1/runs/${h.world.runSlug}/holds`,
      auth(h.tokens.treasurer),
    )
  ).body.holds;

beforeAll(async () => {
  h = await startRuns();
});
afterAll(async () => h?.close());

describe("addDeduction (MM-4 Bolted)", () => {
  it("is refused by the database trigger with 409 RATE_CARD_RATIFIED citing the card's hash, and the refusal is a recorded act", async () => {
    const r = await h.t.json(`/v1/rate-cards/${h.world.rateCardId}/deductions`, {
      method: "POST",
      body: { label: "Multa (absent GA)", amountText: "₱200" },
      ...auth(h.tokens.treasurer),
    });
    expect(r.status).toBe(409);
    const body = RateCardRatifiedError.parse(r.body);
    expect(body).toMatchObject({
      code: "RATE_CARD_RATIFIED",
      hash: h.world.rateCardSha256,
      rateCard: "BR 2026-04",
      ratifiedOn: getSnapshot().rateCard.canonical.ratifiedOn,
    });
    const refused = await h.t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "rate_card.edit_refused"),
        ),
      );
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused[0]?.payload)).not.toContain("Multa");
    const rules = await h.t.deps.db
      .select()
      .from(schema.rateRules)
      .where(eq(schema.rateRules.rateCardId, h.world.rateCardId));
    expect(rules).toHaveLength(0);
  });

  it("404 for a card outside the workspace; a draft card never takes a typed-in rule (400)", async () => {
    await expect(
      h.t
        .client(h.tokens.treasurer)
        .addDeduction({ params: { id: randomUUID() }, body: { label: "x", amountText: "1" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const draft = await h.t.fixture({ ratifiedAt: false });
    const token = await h.t.credentials.frameToken({
      workspaceId: draft.workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    await expect(
      h.t
        .client(token)
        .addDeduction({ params: { id: draft.rateCardId }, body: { label: "x", amountText: "1" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const rules = await h.t.deps.db
      .select()
      .from(schema.rateRules)
      .where(eq(schema.rateRules.rateCardId, draft.rateCardId));
    expect(rules.map((r) => r.ruleId)).toEqual(["R0"]);
  });

  it("the rate-card read is bolted and canonical; ratifying it again is the same 409", async () => {
    const r = await h.t.json<{
      bolted: boolean;
      sha256: string;
      canonical: unknown;
      ratifiedOn: string;
      ratified: { sha16: string } | null;
    }>(`/v1/rate-cards/${h.world.rateCardId}`, auth(h.tokens.chair));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bolted: true, sha256: h.world.rateCardSha256, ratifiedOn: "2026-03-14" });
    expect(r.body.canonical).toEqual(getSnapshot().rateCard.canonical);
    expect(r.body.ratified?.sha16).toBe(h.world.rateCardSha256.slice(0, 16));
    const again = await h.t.json<ApiError>(`/v1/rate-cards/${h.world.rateCardId}/ratify`, {
      method: "POST",
      body: { role: "CHAIR" },
      ...auth(h.tokens.chair),
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("RATE_CARD_RATIFIED");
  });
});

describe("capture (the clerk outbox)", () => {
  const sha = "c".repeat(64);
  const capture = (
    captureId: string,
    o: { key?: string; digest?: string; body?: Record<string, unknown> } = {},
  ) => {
    const body = {
      captureId,
      sha256: sha,
      mime: "image/jpeg",
      bytes: 482_113,
      station: "PUROK_2",
      capturedAt: "2026-10-28T01:30:00.000Z",
      ...(o.body ?? {}),
    };
    const text = JSON.stringify(body);
    return h.t.json<Record<string, unknown>>("/v1/captures", {
      method: "POST",
      body: text,
      headers: { "idempotency-key": o.key ?? captureId, "content-digest": o.digest ?? contentDigestOf(text) },
      ...auth(h.tokens.clerk),
    });
  };
  const first = randomUUID();

  it("accepts a new photo (201), emits capture.synced and queues its read in the same transaction (I7)", async () => {
    const r = await capture(first);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "accepted", exactDuplicateOf: null });
    const tasks = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(
        and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, "extract")),
      );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.args).toEqual({ documentIds: [r.body.documentId], runId: null });
    const synced = await h.t.deps.db
      .select()
      .from(schema.runEvents)
      .where(
        and(
          eq(schema.runEvents.workspaceId, h.world.workspaceId),
          eq(schema.runEvents.type, "capture.synced"),
        ),
      );
    expect(synced).toHaveLength(1);
  });

  it("a retry with the same key replays the stored answer; once that record is gone it is already_received", async () => {
    const retry = await capture(first);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    await h.t.pg?.owner.db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, first));
    const late = await capture(first);
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ status: "already_received" });
  });

  it("the same bytes under another capture id are an exact duplicate (200), never read twice", async () => {
    const r = await capture(randomUUID());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "exact_duplicate" });
    expect(typeof r.body.exactDuplicateOf).toBe("string");
    const tasks = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(
        and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, "extract")),
      );
    expect(tasks).toHaveLength(1);
  });

  it("refuses a key that is not the capture id, a reused key, a bad digest, a bad body and a member (422, 422, 422, 400, 403)", async () => {
    const id = randomUUID();
    expect((await capture(id, { key: randomUUID() })).body).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 422,
    });
    const reused = await capture(first, { body: { bytes: 1 } });
    expect(reused.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await capture(randomUUID(), { digest: contentDigestOf("other bytes") })).body).toMatchObject({
      code: "CONTENT_DIGEST_MISMATCH",
      status: 422,
    });
    expect((await capture(randomUUID(), { body: { mime: "image/gif" } })).body).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    });
    const text = JSON.stringify({
      captureId: id,
      sha256: sha,
      mime: "image/jpeg",
      bytes: 1,
      station: "BODEGA",
      capturedAt: "2026-10-28T01:30:00.000Z",
    });
    const member = await h.t.json<ApiError>("/v1/captures", {
      method: "POST",
      body: text,
      headers: { "idempotency-key": id, "content-digest": contentDigestOf(text) },
      ...auth(h.tokens.member),
    });
    expect(member.body.code).toBe("FORBIDDEN");
  });
});

describe("holds and fields: the Chair, overrides, and the point of no return", () => {
  it("ASK_CHAIR hands a hold to the Chair (needsChair) and only then may the board resolve it", async () => {
    const h3 = (await holdsOf()).find((x) => x.label === "H3");
    await expect(
      h.t
        .client(h.tokens.chair)
        .resolveHold({ params: { holdId: h3?.id as string }, body: { resolution: "RETURN_AS_CREDIT" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const asked = await h.t.client(h.tokens.treasurer).resolveHold({
      params: { holdId: h3?.id as string },
      body: { resolution: "ASK_CHAIR", reason: "A fine the card does not list" },
    });
    expect(asked).toMatchObject({
      resolution: null,
      recomputed: false,
      needsChair: true,
      hold: { state: "ASKED_CHAIR" },
    });
    await expect(
      h.t.client(h.tokens.treasurer).resolveHold({
        params: { holdId: h3?.id as string },
        body: { resolution: "ASK_CHAIR", reason: "again" },
      }),
    ).rejects.toMatchObject({ code: "HOLD_NOT_OPEN" });
    const decided = await h.t
      .client(h.tokens.chair)
      .resolveHold({ params: { holdId: h3?.id as string }, body: { resolution: "RETURN_AS_CREDIT" } });
    expect(decided).toMatchObject({
      resolution: "RETURN_AS_CREDIT",
      hold: { state: "RESOLVED", resolution: { kind: "RETURN_AS_CREDIT", by: "EC" } },
    });
  });

  it("an override needs the Chair: TWO_DELIVERIES says so (R5)", async () => {
    const h1 = (await holdsOf()).find((x) => x.label === "H1");
    const r = await h.t.client(h.tokens.treasurer).resolveHold({
      params: { holdId: h1?.id as string },
      body: { resolution: "TWO_DELIVERIES", reason: "Two loads that day" },
    });
    expect(r).toMatchObject({ resolution: "TWO_DELIVERIES", needsChair: true, recomputed: true });
    // inv.i6.override-cosign: the recomputation records the override for Proof plate 5 (lines.computed.overrides,
    // domain overrideCount), so a verifier also requires the Chair's key, and the batch view says so
    const computed = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(eq(schema.ledgerEntries.runId, h.world.runId), eq(schema.ledgerEntries.kind, "lines.computed")),
      )
      .orderBy(asc(schema.ledgerEntries.seq));
    const latest = LedgerPayloads["lines.computed"].parse(computed.at(-1)?.payload);
    const holds = await h.t.deps.db
      .select({ kind: schema.holds.kind, resolution: schema.holds.resolution })
      .from(schema.holds)
      .where(eq(schema.holds.runId, h.world.runId));
    expect(latest.overrides).toBeGreaterThanOrEqual(1);
    expect(latest.overrides).toBe(overrideCount(runHolds(holds)));
    const view = await h.t.json<{ chairRequired: boolean; chairReasons: string[] }>(
      `/v1/runs/${h.world.runSlug}/batch`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    expect(view.body.chairReasons).toContain("OVERRIDE");
  });

  it("VERSION_CONFLICT: once the run is posting, no hold or field can change it", async () => {
    const h2 = (await holdsOf()).find((x) => x.label === "H2");
    const owner = h.t.pg?.owner.sql;
    if (!owner) throw new Error("db");
    await walkRun(owner, h.world.runId, "POSTING");
    await expect(
      h.t.client(h.tokens.treasurer).resolveHold({
        params: { holdId: h2?.id as string },
        body: { resolution: "EXCLUDE_LINE", reason: "not this season" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    await expect(
      h.t
        .client(h.tokens.treasurer)
        .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.80" } }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});

describe("season and slip reads (W-TR-01, W-TR-03, W-TR-04)", () => {
  it("the season page: co-op, lot, bolted card, the run and its strip", async () => {
    const r = await h.t.json<{
      season: { label: string; cosignBatchCents: number };
      lot: { lotCode: string };
      rateCard: { bolted: boolean };
      runs: { runSlug: string }[];
      strip: { step: string; done: boolean }[];
      members: number;
    }>("/v1/seasons/2026-A", auth(h.tokens.treasurer));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      season: { label: "2026-A", cosignBatchCents: 30_000 },
      lot: { lotCode: "LB-PH-2026-03" },
      rateCard: { bolted: true },
      members: 64,
    });
    expect(r.body.runs.map((x) => x.runSlug)).toContain(h.world.runSlug);
    expect(r.body.strip.find((s) => s.step === "RATIFIED")?.done).toBe(true);
    const code = await h.t.json("/v1/seasons/2026A", auth(h.tokens.treasurer));
    expect(code.status).toBe(200);
    expect((await h.t.json<ApiError>("/v1/seasons/2025-B", auth(h.tokens.treasurer))).body.code).toBe(
      "NOT_FOUND",
    );
  });

  it("the reading room for photo J holds slip 0462 with both reads; by hand finds it by serial", async () => {
    const room = await h.t.json<{
      slips: {
        serial: string;
        fields: { field: string; readA: { valueText: string } | null; readB: { valueText: string } | null }[];
      }[];
    }>("/v1/seasons/2026-A/slips?photo=J", auth(h.tokens.treasurer));
    expect(room.status).toBe(200);
    expect(room.body.slips).toHaveLength(4);
    const one = await h.t.json<{ slips: { serial: string; fields: { field: string }[] }[] }>(
      "/v1/seasons/2026-A/slips/0462",
      auth(h.tokens.treasurer),
    );
    expect(one.body.slips.map((s) => s.serial)).toEqual(["0462"]);
    expect(one.body.slips[0]?.fields.map((f) => f.field).sort()).toEqual(["gross_kg", "net_kg", "tare_kg"]);
  });
});

// These cases clone a migrated database (CREATE DATABASE can wait on a checkpoint under load), seed the
// season, and in inv.i6.kill recompute four times and sign before exercising the switch. No dispatcher is
// started by startRuns; every operation is already awaited. Match the harness's 120 s setup budget here,
// rather than changing the 30 s default for ordinary command tests.
const SLOW = { timeout: 120_000 };
describe("setFlag: the kill switch", SLOW, () => {
  it("HD6-9: two frame tokens of one judge share ten flag changes per minute", async () => {
    const g = await startRuns({ world: { kind: "showcase" } });
    try {
      const sessionId = randomUUID();
      const tokens = await Promise.all(
        [0, 1].map(() =>
          g.t.credentials.frameToken({
            workspaceId: g.world.workspaceId,
            sessionId,
            role: "treasurer",
            persona: "analyn",
          }),
        ),
      );
      for (let i = 0; i < 10; i++) {
        const token = tokens[i % 2];
        if (!token) throw new Error("frame token");
        await g.t.client(token).setFlag({ body: { flag: "kill_ai_live", on: i % 2 === 0 } });
      }
      const token = tokens[1];
      if (!token) throw new Error("frame token");
      await expect(
        g.t.client(token).setFlag({ body: { flag: "kill_ai_live", on: true } }),
      ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
      const flips = await g.t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.workspaceId, g.world.workspaceId),
            eq(schema.ledgerEntries.kind, "flag.flipped"),
          ),
        );
      expect(flips).toHaveLength(10);
    } finally {
      await g.close();
    }
  });
  it("FORBIDDEN for anyone but the treasurer (or the judge)", async () => {
    for (const token of [h.tokens.clerk, h.tokens.chair, h.tokens.member]) {
      await expect(
        h.t.client(token).setFlag({ body: { flag: "kill_payouts", on: true } }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("inv.i6.kill: kill_payouts at AWAITING_BOARD HALTs the run, voids key 1, writes the ledger and a flag.changed event", async () => {
    const g = await startRuns();
    try {
      await resolveAll(g);
      const db = g.t.pg?.app.db;
      if (!db) throw new Error("db");
      const key = await registerKey(db, g.world.workspaceId, { keyId: "fs-analyn-a1", persona: "analyn" });
      const { payload } = await g.t
        .client(g.tokens.treasurer)
        .approvalPayload({ params: { runSlug: g.world.runSlug }, query: { role: "treasurer" } });
      await g.t.client(g.tokens.treasurer).submitApproval({
        params: { runSlug: g.world.runSlug },
        body: {
          role: "treasurer",
          keyId: "fs-analyn-a1",
          signature: ed25519Sign(key.privateKey, approvalBytes(payload)),
          payload,
        },
      });
      const before = await g.t.json<{ run: { state: string }; approvals: { voidedAt: string | null }[] }>(
        `/v1/runs/${g.world.runSlug}`,
        { as: g.t.credentials.bearer(g.tokens.treasurer) },
      );
      expect(before.body.run.state).toBe("AWAITING_BOARD");
      expect(before.body.approvals).toHaveLength(1);
      expect(before.body.approvals[0]?.voidedAt).toBeNull();
      const r = await g.t.client(g.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
      expect(r.flag).toMatchObject({
        flag: "kill_payouts",
        on: true,
        setBy: "treasurer:analyn",
        forcedByEnv: false,
        workspaceId: g.world.workspaceId,
      });
      const run = await g.t.json<{
        run: { state: string };
        approvals: { voidedAt: string | null }[];
        lines: Record<string, number>;
      }>(`/v1/runs/${g.world.runSlug}`, { as: g.t.credentials.bearer(g.tokens.treasurer) });
      expect(run.body.run.state).toBe("HALTED");
      expect(run.body.approvals).toHaveLength(1);
      expect(run.body.approvals.every((a) => a.voidedAt !== null)).toBe(true);
      const events = await g.t.deps.db
        .select()
        .from(schema.runEvents)
        .where(
          and(
            eq(schema.runEvents.workspaceId, g.world.workspaceId),
            eq(schema.runEvents.type, "flag.changed"),
          ),
        );
      expect(events.map((e) => e.payload)).toEqual([
        { flag: "kill_payouts", on: true, by: "treasurer:analyn" },
      ]);
      const flipped = await g.t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.workspaceId, g.world.workspaceId),
            eq(schema.ledgerEntries.kind, "flag.flipped"),
          ),
        );
      expect(flipped).toHaveLength(1);
      // the same value again changes nothing
      await g.t.client(g.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
      const again = await g.t.deps.db
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.workspaceId, g.world.workspaceId),
            eq(schema.ledgerEntries.kind, "flag.flipped"),
          ),
        );
      expect(again).toHaveLength(1);
    } finally {
      await g.close();
    }
  });

  it("FS_KILL forces a switch on everywhere, whatever the workspace stored (forcedByEnv)", async () => {
    const t = await createTestApp({ db: "postgres", env: { FS_KILL: "payouts" } });
    try {
      const fx = await t.fixture();
      const token = await t.credentials.frameToken({
        workspaceId: fx.workspaceId,
        role: "treasurer",
        persona: "analyn",
      });
      const r = await t.client(token).setFlag({ body: { flag: "kill_payouts", on: false } });
      expect(r.flag).toMatchObject({ on: true, forcedByEnv: true, setBy: "FS_KILL" });
      const list = await t.json<{ flags: { flag: string; on: boolean }[] }>("/v1/flags", {
        as: t.credentials.bearer(token),
      });
      expect(list.body.flags.find((f) => f.flag === "kill_payouts")?.on).toBe(true);
      expect(list.body.flags.find((f) => f.flag === "kill_ai_live")?.on).toBe(false);
    } finally {
      await t.close();
    }
  });
});
