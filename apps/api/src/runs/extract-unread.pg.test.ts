// A reading that cannot finish in this build fails visibly instead of leaving the run at EXTRACTING forever: in a
// seeded workspace, a slip photo with no seed stand-in (a capture of a new photo, or a replay photo whose bytes are not
// the seed's) cannot be read here, since no live reader is built, and computeRun waits for every photo. So the step that
// meets it HALTs the run (an edge of the run machine below POSTING), with the IC-01 `run.state` cause
// NO_SEED_STAND_IN naming the document and `halted_reason` set; nothing is read for that photo, no row, field or
// event is invented, and the reading stops. On embedded Postgres, PayPal answered by msw.

import { createHash, randomUUID } from "node:crypto";
import { RunEvent } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_SEED_STAND_IN } from "./extract.js";
import { type RunsHarness, runQueued, startRuns } from "./test/app.js";
import { paypalScript } from "./test/paypal.js";

const replayPhotos = getSnapshot().photos.filter((p) => p.set === "REPLAY");

async function run(h: RunsHarness) {
  const [r] = await h.t.deps.db
    .select({ state: schema.payRuns.state, haltedReason: schema.payRuns.haltedReason })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return r;
}

async function runStateEvents(h: RunsHarness) {
  const rows = await h.t.deps.db
    .select()
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, h.world.runId), eq(schema.runEvents.type, "run.state")))
    .orderBy(asc(schema.runEvents.id));
  return rows.map((e) => ({ row: e, parsed: e.payload as { from: string; to: string; cause: unknown } }));
}

async function rowsOf(h: RunsHarness, documentIds: string[]) {
  return h.t.deps.db
    .select({ id: schema.slipRows.id })
    .from(schema.slipRows)
    .where(inArray(schema.slipRows.documentId, documentIds));
}

async function queued(h: RunsHarness, name: string) {
  const t = schema.taskOutbox;
  return h.t.deps.db
    .select({ id: t.id, args: t.args })
    .from(t)
    .where(and(eq(t.workspaceId, h.world.workspaceId), eq(t.name, name), eq(t.state, "queued")));
}

function expectHalted(events: Awaited<ReturnType<typeof runStateEvents>>, documentId: string) {
  const halt = events.find((e) => e.parsed.to === "HALTED");
  expect(halt, JSON.stringify(events.map((e) => e.parsed))).toBeDefined();
  expect(halt?.parsed).toMatchObject({
    from: "EXTRACTING",
    to: "HALTED",
    cause: { code: NO_SEED_STAND_IN.code, ref: documentId },
  });
  // a well-formed IC-01 event the console's typed stream accepts, labelled as fs-api's own decision
  const e = halt?.row;
  expect(
    RunEvent.safeParse({
      id: String(e?.id),
      ws: e?.workspaceId,
      runId: e?.runId,
      at: e?.at.toISOString(),
      actor: { kind: e?.actorKind, id: e?.actorId, impersonatedBy: e?.impersonatedBy },
      provenance: e?.provenance,
      type: e?.type,
      payload: e?.payload,
    }).success,
  ).toBe(true);
  expect(e?.provenance).toBe("live");
}

describe("a capture of a new photo into a judge workspace, before Mark paid: the reading halts the run", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let captured = "";
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED", replayRows: false } });
  });
  afterAll(async () => h?.close());

  it("the clerk's capture is stored and its own reading finds nothing to read (no run is reading yet)", async () => {
    const photo = Buffer.from(`a new slip photo ${randomUUID()}`);
    const r = await h.t.client(h.tokens.clerk).capture({
      body: {
        captureId: randomUUID(),
        sha256: createHash("sha256").update(photo).digest("hex"),
        mime: "image/jpeg",
        bytes: photo.length,
        station: "BODEGA",
        capturedAt: new Date().toISOString(),
      },
    });
    expect(r.status).toBe("accepted");
    captured = r.documentId;
    expect(await runQueued(h, "extract")).toBe(1);
    expect((await run(h))?.state).toBe("INVOICED");
    expect(await rowsOf(h, [captured])).toHaveLength(0);
  });

  it("Mark paid queues the season's unread photos; the first step meets the new photo and HALTs the run", async () => {
    const paid = await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    expect(paid).toMatchObject({ runState: "EXTRACTING" });
    expect(await runQueued(h, "extract")).toBe(1);
    expect(await run(h)).toEqual({ state: "HALTED", haltedReason: NO_SEED_STAND_IN.haltedReason });
    expectHalted(await runStateEvents(h), captured);
  });

  it("nothing is read or invented: no rows for the new photo, the stand-ins are not read either, no next step", async () => {
    expect(await rowsOf(h, [captured])).toHaveLength(0);
    const docs = await h.t.deps.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.workspaceId, h.world.workspaceId),
          inArray(
            schema.documents.photoCode,
            replayPhotos.map((p) => p.photoId),
          ),
        ),
      );
    expect(
      await rowsOf(
        h,
        docs.map((d) => d.id),
      ),
    ).toHaveLength(0);
    expect(await queued(h, "extract")).toHaveLength(0);
  });

  it("the funding's computeRun finds the run HALTED and changes nothing; the run never sits at EXTRACTING", async () => {
    await runQueued(h, "computeRun");
    expect((await run(h))?.state).toBe("HALTED");
    const dead = await h.t.deps.db
      .select({ id: schema.taskOutbox.id })
      .from(schema.taskOutbox)
      .where(
        and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.state, "dead")),
      );
    expect(dead).toHaveLength(0);
  });
});

describe("a replay photo whose bytes are not the seed's (a data error): the reading halts the run", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let photoA = "";
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED", replayRows: false } });
    const [doc] = await h.t.deps.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.workspaceId, h.world.workspaceId), eq(schema.documents.photoCode, "A")));
    photoA = doc?.id ?? "";
    await h.t.deps.db
      .update(schema.documents)
      .set({ sha256: "f".repeat(64) })
      .where(eq(schema.documents.id, photoA));
  });
  afterAll(async () => h?.close());

  it("Mark paid, then the first step: HALTED, naming photo A, and photo A is never read", async () => {
    await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    expect(await runQueued(h, "extract")).toBe(1);
    expect((await run(h))?.state).toBe("HALTED");
    expectHalted(await runStateEvents(h), photoA);
    expect(await rowsOf(h, [photoA])).toHaveLength(0);
    expect(await queued(h, "extract")).toHaveLength(0);
  });
});
