/**
 * The persistence half of WS-PPMONEY's `PayoutsRepository` port (paypal-payouts README, "Downstream", WS-DATA IC-04):
 * the compare-and-sets that keep a stale executor from voiding approvals signed after its read, or from posting
 * under approvals a check has voided since. The port itself is
 * WS-API's adapter, which calls these inside its own transactions.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunState } from "../src/_shims/contracts.js";
import type { DbOrTx, Tx } from "../src/client.js";
import { type Repos, repos } from "../src/repos/index.js";
import { approvals, ledgerEntries, payRuns, runEvents } from "../src/schema/index.js";
import { type FixtureWorkspace, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught, scopeOf, sleep } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
});
afterAll(async () => {
  await t?.close();
});

const DIGEST = "b".repeat(64);

async function approvedRun(members = 2) {
  const ws = await fixtureWorkspace(t.app.db, { withRun: true, runState: "APPROVED", members });
  return { ws, runId: ws.runId ?? "", r: repos(scopeOf(ws.workspaceId)) };
}

/** Another run of the same workspace, inserted straight into `state`. */
async function anotherRun(ws: FixtureWorkspace, state: RunState = "APPROVED"): Promise<string> {
  const [run] = await t.owner.db
    .insert(payRuns)
    .values({
      workspaceId: ws.workspaceId,
      seasonId: ws.seasonId,
      rateCardId: ws.rateCardId,
      seasonCode: "2026A",
      currency: "USD",
      rateCardSha256: ws.rateCardSha256,
      provenance: "seeded",
      state,
    })
    .returning({ id: payRuns.id });
  return run?.id ?? "";
}

interface Signed {
  id: string;
  nonce: string;
}

async function sign(
  ws: FixtureWorkspace,
  runId: string,
  role: "treasurer" | "board",
  batchSha256 = DIGEST,
  db: DbOrTx = t.app.db,
): Promise<Signed> {
  const nonce = randomUUID();
  const [a] = await db
    .insert(approvals)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      role,
      decision: "SIGNED",
      approverId: role === "treasurer" ? "treasurer:analyn" : "board:ernesto",
      keyId: role === "treasurer" ? "fs-analyn-w1" : "fs-ernesto-a1",
      payloadJcs: '{"v":1}',
      signature: "c2lnbmF0dXJl",
      batchSha256,
      nonce,
      exp: new Date(Date.now() + 30 * 60_000),
      provenance: "live",
    })
    .returning({ id: approvals.id });
  return { id: a?.id ?? "", nonce };
}

async function runRow(runId: string) {
  const [row] = await t.owner.db.select().from(payRuns).where(eq(payRuns.id, runId));
  return row;
}

async function liveNonces(runId: string): Promise<string[]> {
  const rows = await t.owner.db
    .select({ nonce: approvals.nonce })
    .from(approvals)
    .where(and(eq(approvals.runId, runId), isNull(approvals.voidedAt)));
  return rows.map((a) => a.nonce ?? "").sort();
}

async function voidEntries(workspaceId: string) {
  return t.owner.db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.workspaceId, workspaceId), eq(ledgerEntries.kind, "approval.voided")));
}

/** Both officers signed again: IN_REVIEW → TREASURER_APPROVED → APPROVED. */
async function reapprove(r: Repos, runId: string): Promise<void> {
  for (const [from, to] of [
    ["IN_REVIEW", "TREASURER_APPROVED"],
    ["TREASURER_APPROVED", "APPROVED"],
  ] as const) {
    expect(
      (await r.runs.transition(t.app.db, { id: runId, from, to, cause: "signed", provenance: "live" })).ok,
    ).toBe(true);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function backendPid(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  return row?.pid ?? 0;
}

/**
 * Runs `write` in a transaction that takes no workspace lock and stays open, its row locks held, until `commit()`:
 * a writer that skips the lock order, caught between its write and its commit. `pid` is its backend.
 */
async function holdOpen(
  write: (tx: Tx) => Promise<unknown>,
): Promise<{ pid: number; commit: () => Promise<void> }> {
  const gate = deferred<void>();
  const written = deferred<number>();
  const done = t.app.db.transaction(async (tx) => {
    const pid = await backendPid(tx);
    await write(tx);
    written.resolve(pid);
    await gate.promise;
  });
  done.catch((e: unknown) => written.reject(e));
  const pid = await written.promise;
  return {
    pid,
    commit: async () => {
      gate.resolve();
      await done;
    },
  };
}

/**
 * Holds `write` open (holdOpen), starts `call` in a transaction of its own (the port's adapter calls these inside
 * its transactions), and commits the write only once the server shows `call`'s backend blocked on a lock the write
 * holds (`pg_blocking_pids`), or `call` has finished without waiting. Never a timer: a call whose pooled connection
 * is still opening when a sleep ends would only run after the commit, and pass whether or not it locks anything.
 * `waited` says which happened.
 */
async function behindHeldWrite<R>(
  write: (tx: Tx) => Promise<unknown>,
  call: (tx: Tx) => Promise<R>,
): Promise<{ waited: boolean; result: R }> {
  const held = await holdOpen(write);
  const callPid = deferred<number>();
  let settled = false;
  const result = t.app.db.transaction(async (tx) => {
    callPid.resolve(await backendPid(tx));
    return call(tx);
  });
  result.then(
    () => {
      settled = true;
    },
    (e: unknown) => {
      settled = true;
      callPid.reject(e);
    },
  );
  let waited = false;
  try {
    const waiter = await callPid.promise;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await t.owner.sql<{ blocked: boolean }[]>`
        select ${held.pid}::int = any(pg_blocking_pids(${waiter}::int)) as blocked`;
      if (row?.blocked) {
        waited = true;
        break;
      }
      if (settled) break;
      if (Date.now() > deadline) {
        throw new Error(`backend ${waiter} neither waited for backend ${held.pid} nor finished`);
      }
      await sleep(10);
    }
  } finally {
    await held.commit();
  }
  return { waited, result: await result };
}

const posting = (runId: string, nonces: readonly string[], batchSha256 = DIGEST) => ({
  id: runId,
  approvalNonces: nonces,
  batchSha256,
  senderBatchId: `2026A-cas-${randomUUID()}`,
  cause: "post",
  provenance: "live" as const,
});

const checkedVoid = (runId: string, nonces: readonly string[], at?: Date) => ({
  runId,
  nonces,
  reason: "DIGEST_MISMATCH",
  provenance: "live" as const,
  ...(at ? { at } : {}),
});

describe("inv.i6.void-cas: approvals.voidChecked voids the approvals a check named, only while they are the run's live set", () => {
  it("voids them and sends the run back to IN_REVIEW in one transaction, with one ledger entry", async () => {
    const { ws, runId, r } = await approvedRun();
    const [t1, b1] = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")];
    const before = await runRow(runId);
    const at = new Date(Date.now() - 5_000);
    const res = await r.approvals.voidChecked(t.app.db, checkedVoid(runId, [t1.nonce, b1.nonce], at));
    if (!res.ok) throw new Error(`expected the void to apply, got ${res.reason}`);
    expect(res.voided.map((a) => a.id).sort()).toEqual([t1.id, b1.id].sort());
    for (const a of res.voided) {
      expect(a.voidedAt?.getTime()).toBe(at.getTime());
      expect(a.voidReason).toBe("DIGEST_MISMATCH");
    }
    expect(res.row).toMatchObject({ state: "IN_REVIEW", version: (before?.version ?? 0) + 1 });
    expect(res.event?.type).toBe("run.state");
    expect(await liveNonces(runId)).toEqual([]);
    const entries = await voidEntries(ws.workspaceId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toMatchObject({
      runId,
      reason: "DIGEST_MISMATCH",
      approvalIds: [t1.id, b1.id].sort(),
    });
    const events = await t.owner.db.select().from(runEvents).where(eq(runEvents.runId, runId));
    expect(events.map((e) => e.payload)).toContainEqual(
      expect.objectContaining({ from: "APPROVED", to: "IN_REVIEW", cause: "DIGEST_MISMATCH" }),
    );
  });

  it("writes nothing while a live approval is one the check never read (signed after its read)", async () => {
    const { ws, runId, r } = await approvedRun();
    const read = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
    // meanwhile another executor's check voids that set, a line is edited and both keys sign again
    expect((await r.approvals.voidChecked(t.app.db, checkedVoid(runId, read))).ok).toBe(true);
    const fresh = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
    await reapprove(r, runId);
    const before = await runRow(runId);
    // the stale executor voids what it read: nothing changes
    expect(await r.approvals.voidChecked(t.app.db, checkedVoid(runId, read))).toEqual({
      ok: false,
      reason: "UNNAMED_APPROVAL",
      current: "APPROVED",
    });
    // naming only part of the live set changes nothing either
    expect(await r.approvals.voidChecked(t.app.db, checkedVoid(runId, [fresh[0] ?? ""]))).toMatchObject({
      ok: false,
      reason: "UNNAMED_APPROVAL",
    });
    expect(await liveNonces(runId)).toEqual([...fresh].sort());
    expect(await runRow(runId)).toEqual(before);
    expect(await voidEntries(ws.workspaceId)).toHaveLength(1);
  });

  it("writes nothing once the run has left APPROVED, or for a run outside the scope", async () => {
    const { ws, runId, r } = await approvedRun();
    const nonces = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
    // another executor wrote its rows under these approvals: the run is POSTING
    expect((await r.runs.beginPosting(t.app.db, posting(runId, nonces))).ok).toBe(true);
    expect(await r.approvals.voidChecked(t.app.db, checkedVoid(runId, nonces))).toEqual({
      ok: false,
      reason: "STALE",
      current: "POSTING",
    });
    expect(await liveNonces(runId)).toEqual([...nonces].sort());
    expect(await voidEntries(ws.workspaceId)).toHaveLength(0);
    expect(await r.approvals.voidChecked(t.app.db, checkedVoid(randomUUID(), nonces))).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
    const other = await approvedRun();
    const theirs = await sign(other.ws, other.runId, "treasurer");
    expect(await r.approvals.voidChecked(t.app.db, checkedVoid(other.runId, [theirs.nonce]))).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(await liveNonces(other.runId)).toEqual([theirs.nonce]);
  });

  it("never voids an approval outside the run's live set, even when the call names it", async () => {
    const { ws, runId, r } = await approvedRun();
    const mine = await sign(ws, runId, "treasurer");
    const otherRun = await anotherRun(ws);
    const theirs = await sign(ws, otherRun, "treasurer");
    const res = await r.approvals.voidChecked(t.app.db, checkedVoid(runId, [mine.nonce, theirs.nonce]));
    if (!res.ok) throw new Error(`expected the void to apply, got ${res.reason}`);
    expect(res.voided.map((a) => a.id)).toEqual([mine.id]);
    expect(await liveNonces(otherRun)).toEqual([theirs.nonce]);
  });

  it("waits for an approval still being inserted for the run (no workspace lock), then counts it", async () => {
    const { ws, runId, r } = await approvedRun();
    const t1 = await sign(ws, runId, "treasurer");
    // the insert's foreign key holds a key-share lock on the run row until it commits: the void's run-row lock
    // waits for it, so the void reads the approvals only once the new one is there to count
    const { waited, result } = await behindHeldWrite(
      (tx) => sign(ws, runId, "board", DIGEST, tx),
      (tx) => r.approvals.voidChecked(tx, checkedVoid(runId, [t1.nonce])),
    );
    expect(waited).toBe(true);
    expect(result).toEqual({ ok: false, reason: "UNNAMED_APPROVAL", current: "APPROVED" });
    expect(await liveNonces(runId)).toHaveLength(2);
    expect((await runRow(runId))?.state).toBe("APPROVED");
    expect(await voidEntries(ws.workspaceId)).toHaveLength(0);
  });

  it("waits for a void still in flight on a live approval (no workspace lock), then voids only the rest", async () => {
    const { ws, runId, r } = await approvedRun();
    const [t1, b1] = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")];
    const lineEdited = new Date(Date.now() - 60_000);
    // the other void holds b1's row: the void's lock on the live approvals waits for it, then finds b1 voided
    const { waited, result } = await behindHeldWrite(
      (tx) =>
        tx
          .update(approvals)
          .set({ voidedAt: lineEdited, voidReason: "LINE_EDITED" })
          .where(eq(approvals.id, b1.id)),
      (tx) => r.approvals.voidChecked(tx, checkedVoid(runId, [t1.nonce, b1.nonce])),
    );
    expect(waited).toBe(true);
    if (!result.ok) throw new Error(`expected the void to apply, got ${result.reason}`);
    expect(result.voided.map((a) => a.id)).toEqual([t1.id]);
    expect(result.row.state).toBe("IN_REVIEW");
    const [b] = await t.owner.db.select().from(approvals).where(eq(approvals.id, b1.id));
    expect(b).toMatchObject({ voidedAt: lineEdited, voidReason: "LINE_EDITED" });
    expect(await liveNonces(runId)).toEqual([]);
    const entries = await voidEntries(ws.workspaceId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toMatchObject({ runId, approvalIds: [t1.id], reason: "DIGEST_MISMATCH" });
  });

  it("a void reason is a code, never free text", async () => {
    const { ws, runId, r } = await approvedRun();
    const a = await sign(ws, runId, "treasurer");
    const e = await caught(() =>
      r.approvals.voidChecked(t.app.db, { ...checkedVoid(runId, [a.nonce]), reason: "the digest changed" }),
    );
    expect(e).toBeInstanceOf(TypeError);
    expect(await liveNonces(runId)).toEqual([a.nonce]);
  });
});

describe("inv.i6.posting-cas: runs.beginPosting moves APPROVED → POSTING only under the approvals the post was checked under", () => {
  it("moves the run with its digest and sender_batch_id while every named approval is live and signed that digest", async () => {
    const { ws, runId, r } = await approvedRun();
    const nonces = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
    const p = posting(runId, nonces);
    const res = await r.runs.beginPosting(t.app.db, p);
    if (!res.ok) throw new Error(`expected the post to start, got ${res.reason}`);
    expect(res.row).toMatchObject({ state: "POSTING", batchSha256: DIGEST, senderBatchId: p.senderBatchId });
    expect(res.event?.payload).toMatchObject({ from: "APPROVED", to: "POSTING", cause: "post" });
    expect(await liveNonces(runId)).toEqual([...nonces].sort());
  });

  it("refuses a stale executor: its approvals were voided, and both keys signed again since its read", async () => {
    const { ws, runId, r } = await approvedRun();
    const read = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
    expect((await r.approvals.voidChecked(t.app.db, checkedVoid(runId, read))).ok).toBe(true);
    await sign(ws, runId, "treasurer");
    await sign(ws, runId, "board");
    await reapprove(r, runId);
    const before = await runRow(runId);
    expect(await r.runs.beginPosting(t.app.db, posting(runId, read))).toEqual({
      ok: false,
      reason: "APPROVALS_STALE",
      current: "APPROVED",
    });
    expect(await runRow(runId)).toEqual(before);
  });

  it("refuses an empty set, an unknown nonce, another run's approval and approvals that signed another digest", async () => {
    const { ws, runId, r } = await approvedRun();
    const t1 = await sign(ws, runId, "treasurer");
    const theirs = await sign(ws, await anotherRun(ws), "board");
    const before = await runRow(runId);
    for (const p of [
      posting(runId, []),
      posting(runId, [t1.nonce, randomUUID()]),
      posting(runId, [t1.nonce, theirs.nonce]),
      posting(runId, [t1.nonce], "e".repeat(64)),
    ]) {
      expect(await r.runs.beginPosting(t.app.db, p), JSON.stringify(p.approvalNonces)).toEqual({
        ok: false,
        reason: "APPROVALS_STALE",
        current: "APPROVED",
      });
    }
    expect(await runRow(runId)).toEqual(before);
    // the same nonce named twice is still one live approval
    expect((await r.runs.beginPosting(t.app.db, posting(runId, [t1.nonce, t1.nonce]))).ok).toBe(true);
  });

  it("refuses a run that is not APPROVED, and one outside the scope", async () => {
    const { ws, r } = await approvedRun();
    const inReview = await anotherRun(ws, "IN_REVIEW");
    const a = await sign(ws, inReview, "treasurer");
    expect(await r.runs.beginPosting(t.app.db, posting(inReview, [a.nonce]))).toEqual({
      ok: false,
      reason: "STALE",
      current: "IN_REVIEW",
    });
    expect(await r.runs.beginPosting(t.app.db, posting(randomUUID(), [a.nonce]))).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
    const other = await approvedRun();
    const theirs = await sign(other.ws, other.runId, "treasurer");
    expect(await r.runs.beginPosting(t.app.db, posting(other.runId, [theirs.nonce]))).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect((await runRow(other.runId))?.state).toBe("APPROVED");
  });

  it("waits for a void still in flight on a named approval (no workspace lock), then refuses", async () => {
    const { ws, runId, r } = await approvedRun();
    const [t1, b1] = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")];
    // the void holds b1's row: the post's share lock on the approvals it names waits for it, then finds b1 voided
    const { waited, result } = await behindHeldWrite(
      (tx) =>
        tx
          .update(approvals)
          .set({ voidedAt: new Date(), voidReason: "LINE_EDITED" })
          .where(eq(approvals.id, b1.id)),
      (tx) => r.runs.beginPosting(tx, posting(runId, [t1.nonce, b1.nonce])),
    );
    expect(waited).toBe(true);
    expect(result).toEqual({ ok: false, reason: "APPROVALS_STALE", current: "APPROVED" });
    expect((await runRow(runId))?.state).toBe("APPROVED");
  });

  it("of a void and a post racing on one approval set, exactly one wins and the rows agree with it", async () => {
    for (let i = 0; i < 4; i++) {
      const { ws, runId, r } = await approvedRun();
      const nonces = [await sign(ws, runId, "treasurer"), await sign(ws, runId, "board")].map((a) => a.nonce);
      const [voided, posted] = await Promise.all([
        r.approvals.voidChecked(t.app.db, checkedVoid(runId, nonces)),
        r.runs.beginPosting(t.app.db, posting(runId, nonces)),
      ]);
      expect([voided.ok, posted.ok].filter(Boolean)).toHaveLength(1);
      const run = await runRow(runId);
      if (posted.ok) {
        expect(run?.state).toBe("POSTING");
        expect(await liveNonces(runId)).toEqual([...nonces].sort());
      } else {
        expect(run?.state).toBe("IN_REVIEW");
        expect(await liveNonces(runId)).toEqual([]);
      }
    }
  });
});
