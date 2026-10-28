// The send-time oracle for Judge Mode's live posts (S3.9, C-21, plan "Limits"; round 3), on embedded Postgres on the
// sandbox rail with PayPal answered by msw. A fake clock drives nine judge runs through about three simulated days
// with stalls of every length (a 429 pace and the 6-minute circuit, kill_payouts held for minutes, a day and more,
// an outage only the hourly catch-up ends, refused credentials retried within a lane lease, a full clock hour, a full
// C-21), alongside other judges' fresh posts (each a slot taken and posted at once) and a co-op's own batches that
// fill C-21. The PayPal mock records when every POST reaches it; the quotas are then checked against those SEND
// times, never against when a slot was taken:
//   - every rolling 24 h window of send times holds at most the daily cap (40) judge posts,
//   - every clock hour at most the hourly cap (3),
//   - and C-21: every rolling 24 h window at most 40 live batches (judge runs' and the co-op's).
// A post counts in a window once, however many of its POSTs land there (a paced POST and its resume are one batch).
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JUDGE_QUOTA,
  recordBalanceReading,
  recordJudgeCode,
  reserveLivePost,
  settleLivePost,
} from "../judge/quota.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { seedWorld } from "../runs/test/world.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { postsInLast24h } from "./payouts.js";
import { resumeStalledPosts } from "./resume.js";

const POSTS = `${PAYPAL_SANDBOX}/v1/payments/payouts`;
const T0 = Date.parse("2026-10-28T02:00:00.000Z"); // the harness clock's start
const H = 3_600_000;
const MIN = 60_000;
const END = T0 + 78 * H;
const DAY = 24 * H;

interface Send {
  at: number;
  /** One post: a run's sender_batch_id, a filler's run id, a co-op batch's id. */
  id: string;
  kind: "run" | "filler" | "coop";
  status: number;
}

interface World {
  name: string;
  h: RunsHarness;
  /** The first POST: paced (429), refused credentials (401 twice) or answered. */
  first: "pace" | "auth" | "ok";
  /** kill_payouts on and off (after the write), relative to T0. */
  hold?: [number, number];
  /** Every post row dies after the write, and only the catch-up at this time (relative to T0) resumes it. */
  outageUntil?: number;
  outage: boolean;
}

const script = paypalScript();
let base: RunsHarness;
const sends: Send[] = [];
const worlds = new Map<string, World>();
let coop: { workspaceId: string; runId: string };
let invoices = 0;
let fillerAttempts = 0;

// ---------------------------------------------------------------- the event loop (a fake clock, in order)

interface Ev {
  at: number;
  seq: number;
  what: string;
  go(): Promise<void>;
}
const queue: Ev[] = [];
let seq = 0;
const at = (ms: number, what: string, go: () => Promise<void>) => {
  queue.push({ at: ms, seq: seq++, what, go });
};
const pending = new Map<string, number>(); // world → its next scheduled post run

async function drain(until: number) {
  for (;;) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const ev = queue[0];
    if (!ev || ev.at > until) return;
    queue.shift();
    if (ev.at > base.t.clock.nowMs()) base.t.clock.set(new Date(ev.at));
    await ev.go();
  }
}

// ---------------------------------------------------------------- the actors

async function world(): Promise<RunsHarness> {
  const db = base.t.pg?.app.db;
  if (!db) throw new Error("db");
  const w = await seedWorld(db, {
    invoice: {
      paypalInvoiceId: `INV2-TEST-ORACLE-${String(++invoices).padStart(4, "0")}`,
      status: "SENT",
      sent: true,
    },
  });
  const tk = (role: "treasurer" | "board" | "clerk" | "member" | "brand", persona: string) =>
    base.t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona });
  const h: RunsHarness = {
    ...base,
    world: w,
    tokens: {
      treasurer: await tk("treasurer", "analyn"),
      chair: await tk("board", "ernesto"),
      clerk: await tk("clerk", "jessie"),
      member: await tk("member", "celing"),
      brand: await tk("brand", "dana"),
    },
  };
  return h;
}

/** PayPal answers the next POST with `res` (recorded: it reached PayPal). */
function answerNextPost(res: () => Response, status: number) {
  base.paypal?.use(
    http.post(
      POSTS,
      async ({ request }) => {
        const body = (await request.json()) as PostedBatch;
        sends.push({
          at: base.t.clock.nowMs(),
          id: body.sender_batch_header.sender_batch_id,
          kind: "run",
          status,
        });
        return res();
      },
      { once: true },
    ),
  );
}

async function setKill(w: World, on: boolean) {
  await base.t.pg?.owner.db
    .insert(schema.systemFlags)
    .values({
      workspaceId: w.h.world.workspaceId,
      flag: "kill_payouts",
      on,
      setBy: "oracle",
      setAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.systemFlags.workspaceId, schema.systemFlags.flag],
      set: { on, setBy: "oracle" },
    });
}

async function queuedPosts(w: World) {
  return base.t.deps.db
    .select({ id: schema.taskOutbox.id, runAfter: schema.taskOutbox.runAfter })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, w.h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

/** Schedules the world's next post run when its waiting row is due (its wait, in the fake clock's time). */
async function reschedule(w: World) {
  if (w.outage) return;
  const rows = await queuedPosts(w);
  if (rows.length === 0) return;
  const wait = Math.max(1_000, Math.min(...rows.map((r) => r.runAfter.getTime())) - Date.now());
  const due = base.t.clock.nowMs() + wait;
  const known = pending.get(w.name);
  if (known !== undefined && known <= due) return;
  pending.set(w.name, due);
  at(due, `${w.name} post`, () => runPost(w, due));
}

async function runPost(w: World, due?: number) {
  if (due !== undefined && pending.get(w.name) !== due) return; // superseded by an earlier run
  pending.delete(w.name);
  if (w.outage) return;
  await base.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, w.h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
  await runQueued(w.h, "postPayoutBatch");
  await reschedule(w);
}

function plan(o: {
  name: string;
  start: number;
  first: World["first"];
  hold?: [number, number];
  outageUntil?: number;
}) {
  at(T0 + o.start, `${o.name} signs`, async () => {
    const w: World = {
      name: o.name,
      h: await world(),
      first: o.first,
      ...(o.hold ? { hold: o.hold } : {}),
      ...(o.outageUntil ? { outageUntil: o.outageUntil } : {}),
      outage: false,
    };
    worlds.set(o.name, w);
    await resolveAll(w.h);
    await signBoth(w.h);
    if (o.first === "pace") answerNextPost(() => paypalError(429, "RATE_LIMIT_REACHED"), 429);
    if (o.first === "auth") {
      answerNextPost(() => paypalError(401, "AUTHENTICATION_FAILURE"), 401);
      answerNextPost(() => paypalError(401, "AUTHENTICATION_FAILURE"), 401);
    }
    await runPost(w);
    if (o.hold) {
      const [on, off] = o.hold;
      at(T0 + on, `${o.name} kill_payouts on`, () => setKill(w, true));
      at(T0 + off, `${o.name} kill_payouts off`, async () => {
        await setKill(w, false);
        await runPost(w);
      });
    }
    if (o.outageUntil) {
      // an outage outlasts every attempt: the post rows die; only the catch-up brings the post back
      w.outage = true;
      pending.delete(w.name);
      await base.t.pg?.owner.db
        .update(schema.taskOutbox)
        .set({ state: "dead" })
        .where(
          and(
            eq(schema.taskOutbox.workspaceId, w.h.world.workspaceId),
            eq(schema.taskOutbox.name, "postPayoutBatch"),
          ),
        );
      at(T0 + o.outageUntil, `${o.name} outage over`, async () => {
        w.outage = false;
      });
    }
  });
}

/** Another judge's fresh post: a slot under the quota lock, posted at once (or a labelled replay: nothing sent). */
function filler(rel: number) {
  at(T0 + rel, "filler", async () => {
    fillerAttempts++;
    const runId = randomUUID();
    const sessionId = randomUUID();
    const now = base.t.clock.now();
    await recordJudgeCode(base.t.deps.db, { sessionId, at: now });
    const r = await reserveLivePost(base.t.deps, {
      workspaceId: base.world.workspaceId,
      sessionId,
      runId,
      amountCents: 100,
    });
    if (!r.reservation) return;
    sends.push({ at: now.getTime(), id: `filler:${runId}`, kind: "filler", status: 201 });
    await settleLivePost(base.t.deps, { reservationId: r.reservation.id, outcome: "posted" });
  });
}

/** The co-op's own workspace posts while C-21 has room (each a live batch, written and posted at once). */
function coopFill(rel: number) {
  at(T0 + rel, "co-op fill", async () => {
    const owner = base.t.pg?.owner.db;
    if (!owner) throw new Error("db");
    const now = base.t.clock.now();
    while ((await postsInLast24h(base.t.deps, now)) < JUDGE_QUOTA.dailyMax) {
      const [row] = await owner
        .insert(schema.payoutBatches)
        .values({
          workspaceId: coop.workspaceId,
          runId: coop.runId,
          senderBatchId: `2026A-coop-${randomUUID()}`,
          requestId: "a".repeat(64),
          batchSha256: "b".repeat(64),
          kind: "primary",
          status: "SUCCESS",
          itemCount: 8,
          totalCents: 36_839n,
          currency: "USD",
          provenance: "live",
          submittedAt: now,
        })
        .returning({ id: schema.payoutBatches.id });
      sends.push({ at: now.getTime(), id: `coop:${row?.id}`, kind: "coop", status: 201 });
    }
  });
}

// ---------------------------------------------------------------- the checks

/** The most distinct posts any window [a, a + span) of send times holds (it peaks at a window opening on a send). */
function busiest(points: Send[], span: number): { n: number; from: number } {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  let best = { n: 0, from: 0 };
  for (const p of sorted) {
    const ids = new Set(sorted.filter((q) => q.at >= p.at && q.at < p.at + span).map((q) => q.id));
    if (ids.size > best.n) best = { n: ids.size, from: p.at };
  }
  return best;
}

function busiestHour(points: Send[]): { n: number; hour: number } {
  const byHour = new Map<number, Set<string>>();
  for (const p of points) {
    const hour = Math.floor(p.at / H) * H;
    const ids = byHour.get(hour) ?? new Set<string>();
    ids.add(p.id);
    byHour.set(hour, ids);
  }
  let best = { n: 0, hour: 0 };
  for (const [hour, ids] of byHour) if (ids.size > best.n) best = { n: ids.size, hour };
  return best;
}

const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  base = await startRuns({ paypal: script.handlers });
  // every POST the script answers (201) is recorded with the fake clock's time, then falls through to it
  base.paypal?.use(
    http.post(POSTS, async ({ request }) => {
      const body = (await request.clone().json()) as PostedBatch;
      sends.push({
        at: base.t.clock.nowMs(),
        id: body.sender_batch_header.sender_batch_id,
        kind: "run",
        status: 201,
      });
    }),
  );
  const c = await base.t.fixture({ kind: "real", withRun: true });
  coop = { workspaceId: c.workspaceId, runId: c.runId as string };

  // the runs and their stalls (times from T0 = 02:00Z)
  plan({ name: "W1", start: 10 * MIN, first: "pace" }); // the 6-minute circuit
  plan({ name: "W2", start: 30 * MIN, first: "pace", hold: [31 * MIN, 22 * H + 20 * MIN] }); // a switch held 22 h
  plan({ name: "W3", start: 2 * H, first: "ok" });
  plan({ name: "W4", start: 3 * H, first: "auth" }); // retried within a lane lease, on its held slot
  plan({ name: "W5", start: 5 * H, first: "pace", outageUntil: 29 * H }); // an outage the catch-up ends a day on
  // a short switch, off in a clock hour already full
  plan({ name: "W6", start: 21 * H + 50 * MIN, first: "pace", hold: [21 * H + 51 * MIN, 22 * H + 25 * MIN] });
  // a switch held 26 h; off while the co-op's batches fill C-21 (its own write is out of that window)
  plan({ name: "W7", start: 26 * H, first: "pace", hold: [26 * H + MIN, 52 * H] });
  plan({ name: "W8", start: 51 * H, first: "ok" }); // a fresh post while C-21 is full
  plan({ name: "W9", start: 75 * H, first: "pace" }); // once the co-op's batches left the window

  // other judges' fresh posts: one an hour on the first day, three in the hour W2 and W6 come back in, then two an
  // hour (the day fills), a lull while the co-op fills C-21, one an hour, then none (W9 finds room)
  for (let hr = 1; hr < 60; hr++) {
    if (hr >= 40 && hr <= 50) continue;
    if (hr === 22) {
      for (const m of [0, 5, 10]) filler(hr * H + m * MIN);
      continue;
    }
    filler(hr * H);
    if (hr >= 23 && hr < 40) filler(hr * H + 30 * MIN);
  }
  // the co-op's own workspace fills C-21 at T0+50h30m
  coopFill(50 * H + 30 * MIN);
  // the nightly reconciliation reads the balance (a sandbox reading counts for 26 h)
  for (const d of [23, 47, 71]) {
    at(T0 + d * H, "reading", () =>
      recordBalanceReading(base.t.deps.db, {
        rail: "sandbox",
        availableCents: 100_000_000,
        asOf: base.t.clock.now(),
        source: "searchBalances",
      }),
    );
  }
  // the hourly cron's catch-up for every post that stopped (rows dead, a press out of attempts)
  for (let hr = 1; hr < 78; hr++) {
    at(T0 + hr * H + 59 * MIN, "catch-up", async () => {
      for (const w of worlds.values()) {
        if (w.outage) continue;
        if ((await resumeStalledPosts(base.t.deps, { workspaceId: w.h.world.workspaceId })) > 0)
          await runPost(w);
      }
    });
  }
  await drain(END);
}, 600_000);
afterAll(async () => base?.close());

describe("inv.quota.send-time: the caps hold over when POSTs reach PayPal, not when their slots were taken", () => {
  it("the runs went through their stalls: most posted live, some long after their rows were written", async () => {
    const runs = sends.filter((s) => s.kind === "run");
    if (process.env.ORACLE_DEBUG) {
      // ORACLE_DEBUG=<file>: the timeline of every run's POSTs (hours from T0) for a person to read
      const rel = (ms: number) => `${((ms - T0) / H).toFixed(2)}h`;
      const lines = runs.map((s) => `run ${s.id.slice(-14)} ${rel(s.at)} ${s.status}`);
      lines.push(`fillers ${sends.filter((s) => s.kind === "filler").length} of ${fillerAttempts}`);
      lines.push(`coop ${sends.filter((s) => s.kind === "coop").length}`);
      (await import("node:fs")).writeFileSync(process.env.ORACLE_DEBUG, lines.join("\n"));
    }
    const sbid = async (name: string) => {
      const w = worlds.get(name);
      if (!w) throw new Error(name);
      const [b] = await base.t.deps.db
        .select({ sbid: schema.payoutBatches.senderBatchId })
        .from(schema.payoutBatches)
        .where(
          and(eq(schema.payoutBatches.runId, w.h.world.runId), eq(schema.payoutBatches.kind, "primary")),
        );
      return b?.sbid ?? `none:${name}`;
    };
    const live = async (name: string) => {
      const id = await sbid(name);
      return runs.filter((s) => s.id === id && s.status === 201).map((s) => s.at - T0);
    };
    const first = async (name: string) => {
      const id = await sbid(name);
      return Math.min(...runs.filter((s) => s.id === id).map((s) => s.at - T0));
    };
    expect(new Set(runs.filter((s) => s.status === 201).map((s) => s.id)).size).toBeGreaterThanOrEqual(6);
    // W2's switch went off in a full clock hour: it waited for the next one
    const w2 = await live("W2");
    expect(w2).toHaveLength(1);
    expect(w2[0]).toBeGreaterThanOrEqual(23 * H);
    expect(w2[0]).toBeLessThan(24 * H);
    // W4's refused credentials: the retry posted within a lane lease, under its held slot
    const w4 = await live("W4");
    expect(w4).toHaveLength(1);
    expect((w4[0] as number) - (await first("W4"))).toBeLessThan(JUDGE_QUOTA.restampAfterMs);
    // W5 after its outage, a day after its write
    expect((await live("W5"))[0]).toBeGreaterThanOrEqual(29 * H);
    // W7 waited while C-21 was full: it went out once W5's batch (the one judge batch in that window) left it
    const w5 = (await live("W5"))[0] as number;
    const w7 = await live("W7");
    expect(w7).toHaveLength(1);
    expect(w7[0]).toBeGreaterThanOrEqual(w5 + DAY);
    // W8's fresh post while C-21 was full reached no one; W9 posted after the co-op's batches left the window
    expect(await live("W8")).toEqual([]);
    expect((await live("W9"))[0]).toBeGreaterThanOrEqual(75 * H);
    // and the judge quotas bound some of the time: other judges' posts were turned away (labelled replays)
    expect(sends.filter((s) => s.kind === "filler").length).toBeLessThan(fillerAttempts);
  });

  it("every rolling 24 h of send times holds at most 40 judge posts", () => {
    const judge = sends.filter((s) => s.kind !== "coop");
    const peak = busiest(judge, DAY);
    expect({ n: peak.n, from: iso(peak.from) }).toEqual({
      n: Math.min(peak.n, JUDGE_QUOTA.dailyMax),
      from: iso(peak.from),
    });
  });

  it("every clock hour of send times holds at most 3 judge posts", () => {
    const judge = sends.filter((s) => s.kind !== "coop");
    const peak = busiestHour(judge);
    expect({ n: peak.n, hour: iso(peak.hour) }).toEqual({
      n: Math.min(peak.n, JUDGE_QUOTA.hourlyMax),
      hour: iso(peak.hour),
    });
  });

  it("C-21: every rolling 24 h of send times holds at most 40 live batches (judge runs and the co-op)", () => {
    const batches = sends.filter((s) => s.kind !== "filler");
    const peak = busiest(batches, DAY);
    expect({ n: peak.n, from: iso(peak.from) }).toEqual({
      n: Math.min(peak.n, JUDGE_QUOTA.dailyMax),
      from: iso(peak.from),
    });
  });
});
