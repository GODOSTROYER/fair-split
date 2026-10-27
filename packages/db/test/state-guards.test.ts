/**
 * inv.i5.no-direct-state-write (review major, repos/scoped.ts). The generic scoped `update` could write `state`,
 * `version`, `status`, `status_rank`, `cancel_requested_at` and `voided_at` directly, bypassing the optimistic,
 * policy-checked transitions: after DRAFT→QUOTED, `runs.update(id, {state: "DRAFT"})` succeeded, and so did a jump
 * to CLOSED. Now three layers refuse it:
 *   1. the patch types omit those columns (a compile error),
 *   2. `update` refuses them at runtime (GuardedColumnError, nothing written),
 *   3. the database refuses any state change that is not an edge of its machine or that does not count `version`
 *      up by exactly one (FS409 ILLEGAL_TRANSITION / VERSION_MISMATCH), for every role.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HOLD_STATES,
  type HoldState,
  LINE_STATES,
  type LineState,
  RUN_STATES,
  type RunState,
} from "../src/_shims/contracts.js";
import { asDbError } from "../src/errors.js";
import { DEFAULT_POLICY, GuardedColumnError, repos } from "../src/repos/index.js";
import {
  approvals,
  holds,
  ledgerEntries,
  memberLines,
  payoutBatches,
  payoutItems,
  payRuns,
} from "../src/schema/index.js";
import { type FixtureWorkspace, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught, dbError, scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
});
afterAll(async () => {
  await t?.close();
});

const DIGEST = { batchSha256: "a".repeat(64) };
const senderBatchId = () => `2026A-guard-${randomUUID()}`;

async function newRun(runState?: RunState) {
  const ws = await fixtureWorkspace(t.app.db, { withRun: true, ...(runState ? { runState } : {}) });
  return { ws, runId: ws.runId ?? "", r: repos(scopeOf(ws.workspaceId)) };
}

/** A run inserted straight into `state` (inserts may place a run anywhere; updates must follow the machine). */
async function runAt(ws: FixtureWorkspace, state: RunState): Promise<string> {
  const [run] = await t.owner.db
    .insert(payRuns)
    .values({
      workspaceId: ws.workspaceId,
      seasonId: ws.seasonId,
      rateCardId: ws.rateCardId,
      seasonCode: "2026A",
      currency: "USD",
      rateCardSha256: ws.rateCardSha256,
      state,
      ...DIGEST,
      senderBatchId: senderBatchId(),
      provenance: "seeded",
    })
    .returning({ id: payRuns.id });
  return run?.id ?? "";
}

async function lineAt(ws: FixtureWorkspace, runId: string, memberId: string, state: LineState) {
  const [line] = await t.owner.db
    .insert(memberLines)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      memberId,
      state,
      rail: "ON",
      currency: "USD",
      verifiedG: 1000n,
      grade1G: 0n,
      premiumCents: 100n,
      bonusCents: 0n,
      deductionsCents: 0n,
      creditsCents: 0n,
      netCents: 100n,
      deductions: [],
      provenance: "seeded",
    })
    .returning({ id: memberLines.id });
  return line?.id ?? "";
}

async function holdAt(ws: FixtureWorkspace, runId: string, state: HoldState) {
  const [hold] = await t.owner.db
    .insert(holds)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      code: "H1",
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      state,
      raisedBy: "engine",
      provenance: "seeded",
    })
    .returning({ id: holds.id });
  return hold?.id ?? "";
}

async function stateOf(runId: string) {
  const [row] = await t.owner.db
    .select({ state: payRuns.state, version: payRuns.version })
    .from(payRuns)
    .where(eq(payRuns.id, runId));
  return row;
}

describe("inv.i5.no-direct-state-write: the generic patch cannot touch state", () => {
  it("runs.update refuses state and version at runtime, writes nothing, and the type forbids them", async () => {
    const { runId, r } = await newRun();
    const q = await r.runs.transition(t.app.db, {
      id: runId,
      from: "DRAFT",
      to: "QUOTED",
      cause: "quote",
      provenance: "live",
    });
    expect(q.ok).toBe(true);
    const attempts: Array<() => Promise<unknown>> = [
      // @ts-expect-error state is written only by transition()
      () => r.runs.update(t.app.db, runId, { state: "DRAFT" }),
      // @ts-expect-error a jump is no better
      () => r.runs.update(t.app.db, runId, { state: "CLOSED" }),
      // @ts-expect-error version counts transitions, so it is the transition's too
      () => r.runs.update(t.app.db, runId, { version: 0 }),
    ];
    for (const attempt of attempts) {
      const e = await caught(attempt);
      expect(e).toBeInstanceOf(GuardedColumnError);
      expect((e as GuardedColumnError).message).toMatch(/runs\.transition/);
    }
    expect(await stateOf(runId)).toEqual({ state: "QUOTED", version: 1 });
    // every other column stays patchable
    expect((await r.runs.update(t.app.db, runId, { haltedReason: "note" }))?.haltedReason).toBe("note");
    // undefined is "not set", as in Drizzle
    expect(
      await r.runs.update(t.app.db, runId, { haltedReason: "n2", state: undefined } as never),
    ).toMatchObject({
      state: "QUOTED",
      haltedReason: "n2",
    });
  });

  it("lines, holds, payout items and approvals guard their lifecycle columns the same way", async () => {
    const { ws, runId, r } = await newRun();
    const lineId = await lineAt(ws, runId, ws.memberIds[0] ?? "", "COMPUTED");
    const holdId = await holdAt(ws, runId, "OPEN");
    const refused: Array<() => Promise<unknown>> = [
      // @ts-expect-error line state moves only through lines.transition()
      () => r.lines.update(t.app.db, lineId, { state: "PAID" }),
      // @ts-expect-error hold state moves only through holdStates.transition()
      () => r.holds.update(t.app.db, holdId, { state: "RESOLVED" }),
      // @ts-expect-error who resolved a hold is recorded by the transition
      () => r.holds.update(t.app.db, holdId, { resolvedBy: "treasurer:analyn" }),
      // @ts-expect-error item status climbs only through items.applyStatus()
      () => r.items.update(t.app.db, lineId, { status: "SUCCESS", statusRank: 60 }),
      // @ts-expect-error our own cancel is items.requestCancel()
      () => r.items.update(t.app.db, lineId, { cancelRequestedAt: new Date() }),
      // @ts-expect-error approvals are voided only by approvals.void()
      () => r.approvals.update(t.app.db, lineId, { voidedAt: new Date() }),
      // @ts-expect-error a signed approval never changes
      () => r.approvals.update(t.app.db, lineId, { signature: "forged" }),
    ];
    for (const fn of refused) expect(await caught(fn)).toBeInstanceOf(GuardedColumnError);
    const [line] = await t.owner.db.select().from(memberLines).where(eq(memberLines.id, lineId));
    expect(line?.state).toBe("COMPUTED");
    const [hold] = await t.owner.db.select().from(holds).where(eq(holds.id, holdId));
    expect(hold).toMatchObject({ state: "OPEN", resolvedBy: null });
  });
});

describe("inv.i5.no-direct-state-write: the database refuses what the machine refuses", () => {
  it("a backward or skipping run write is refused for every role (ILLEGAL_TRANSITION)", async () => {
    const { runId, r } = await newRun();
    await r.runs.transition(t.app.db, {
      id: runId,
      from: "DRAFT",
      to: "QUOTED",
      cause: "q",
      provenance: "live",
    });
    // the review's proof, through raw Drizzle as the app: back to DRAFT …
    const back = await dbError(() =>
      t.app.db
        .update(payRuns)
        .set({ state: "DRAFT", version: sql`${payRuns.version} + 1` })
        .where(eq(payRuns.id, runId)),
    );
    expect(back.code).toBe("ILLEGAL_TRANSITION");
    expect(back.subject).toBe("pay_runs:QUOTED->DRAFT");
    expect(back.httpStatus).toBe(409);
    // … or a jump to CLOSED, even by the owner with every column the check wants
    const jump = await dbError(() =>
      t.owner.db
        .update(payRuns)
        .set({
          state: "CLOSED",
          version: sql`${payRuns.version} + 1`,
          ...DIGEST,
          senderBatchId: senderBatchId(),
        })
        .where(eq(payRuns.id, runId)),
    );
    expect(jump.code).toBe("ILLEGAL_TRANSITION");
    expect(await stateOf(runId)).toEqual({ state: "QUOTED", version: 1 });
  });

  it("a state change must count version up by exactly one (VERSION_MISMATCH)", async () => {
    const { runId } = await newRun();
    const set = (patch: Record<string, unknown>) => () =>
      t.app.db.update(payRuns).set(patch).where(eq(payRuns.id, runId));
    expect((await dbError(set({ state: "QUOTED" }))).code).toBe("VERSION_MISMATCH");
    expect((await dbError(set({ state: "QUOTED", version: sql`${payRuns.version} + 2` }))).code).toBe(
      "VERSION_MISMATCH",
    );
    expect((await dbError(set({ version: sql`${payRuns.version} - 1` }))).code).toBe("VERSION_MISMATCH");
    // the guard is the machine, not a ban on SQL: a legal edge that counts its version is accepted
    await set({ state: "QUOTED", version: sql`${payRuns.version} + 1` })();
    expect(await stateOf(runId)).toEqual({ state: "QUOTED", version: 1 });
  });

  it("member lines and holds have the same backstop", async () => {
    const { ws, runId } = await newRun();
    const lineId = await lineAt(ws, runId, ws.memberIds[0] ?? "", "COMPUTED");
    const line = await dbError(() =>
      t.app.db
        .update(memberLines)
        .set({ state: "PAID", version: sql`${memberLines.version} + 1` })
        .where(eq(memberLines.id, lineId)),
    );
    expect(line).toMatchObject({ code: "ILLEGAL_TRANSITION", subject: "member_lines:COMPUTED->PAID" });
    const holdId = await holdAt(ws, runId, "RESOLVED");
    const hold = await dbError(() =>
      t.owner.db
        .update(holds)
        .set({ state: "OPEN", version: sql`${holds.version} + 1` })
        .where(eq(holds.id, holdId)),
    );
    expect(hold).toMatchObject({ code: "ILLEGAL_TRANSITION", subject: "holds:RESOLVED->OPEN" });
  });

  it("the database's edge table is exactly the transition policy", async () => {
    const rows = await t.owner.sql<{ machine: string; from_state: string; to_state: string }[]>`
      select machine, from_state, to_state from fs_private.state_edges`;
    const inDb = (m: string) =>
      rows
        .filter((r) => r.machine === m)
        .map((r) => `${r.from_state}->${r.to_state}`)
        .sort();
    const allowed = <S extends string>(states: readonly S[], can: (a: S, b: S) => boolean) =>
      states.flatMap((a) => states.filter((b) => a !== b && can(a, b)).map((b) => `${a}->${b}`)).sort();
    expect(inDb("run")).toEqual(allowed(RUN_STATES, DEFAULT_POLICY.run));
    expect(inDb("line")).toEqual(allowed(LINE_STATES, DEFAULT_POLICY.line));
    expect(inDb("hold")).toEqual(allowed(HOLD_STATES, DEFAULT_POLICY.hold));
    expect(rows.every((r) => ["run", "line", "hold"].includes(r.machine))).toBe(true);
  });

  it("property: a raw run or line write succeeds exactly when the policy allows the edge", async () => {
    const ws = await fixtureWorkspace(t.app.db, { members: 1 });
    const memberId = ws.memberIds[0] ?? "";
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...RUN_STATES),
        fc.constantFrom(...RUN_STATES),
        fc.constantFrom(...LINE_STATES),
        fc.constantFrom(...LINE_STATES),
        async (runFrom, runTo, lineFrom, lineTo) => {
          const runId = await runAt(ws, runFrom);
          const run = await t.app.db
            .update(payRuns)
            .set({ state: runTo, version: sql`${payRuns.version} + 1` })
            .where(eq(payRuns.id, runId))
            .then(
              () => true,
              (e) => (asDbError(e)?.code === "ILLEGAL_TRANSITION" ? false : Promise.reject(e)),
            );
          if (run !== (runFrom === runTo || DEFAULT_POLICY.run(runFrom, runTo))) return false;
          const lineId = await lineAt(ws, await runAt(ws, "IN_REVIEW"), memberId, lineFrom);
          const line = await t.app.db
            .update(memberLines)
            .set({ state: lineTo, version: sql`${memberLines.version} + 1` })
            .where(eq(memberLines.id, lineId))
            .then(
              () => true,
              (e) => (asDbError(e)?.code === "ILLEGAL_TRANSITION" ? false : Promise.reject(e)),
            );
          return line === (lineFrom === lineTo || DEFAULT_POLICY.line(lineFrom, lineTo));
        },
      ),
      { numRuns: 60 },
    );
  });
});

async function newItem() {
  const { ws, runId, r } = await newRun();
  const lineId = await lineAt(ws, runId, ws.memberIds[0] ?? "", "SUBMITTED");
  const [batch] = await t.app.db
    .insert(payoutBatches)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      senderBatchId: senderBatchId(),
      requestId: "e".repeat(64),
      batchSha256: "f".repeat(64),
      kind: "primary",
      itemCount: 1,
      totalCents: 100n,
      currency: "USD",
      provenance: "live",
    })
    .returning();
  const [item] = await t.app.db
    .insert(payoutItems)
    .values({
      workspaceId: ws.workspaceId,
      batchId: batch?.id ?? "",
      lineId,
      senderItemId: `r${runId.slice(-8)}-M-001`,
      receiver: "member@example.test",
      amountCents: 100n,
      currency: "USD",
      provenance: "live",
    })
    .returning();
  return { ws, r, runId, lineId, itemId: item?.id ?? "" };
}

describe("payout items: our own cancel is written once, and only on an UNCLAIMED item", () => {
  it("the database refuses a cancel stamp on an item that is not UNCLAIMED, and any later change to it", async () => {
    const { r, itemId } = await newItem();
    await r.items.applyStatus(t.app.db, { id: itemId, status: "PENDING", provenance: "live" });
    const early = await dbError(() =>
      t.app.db.update(payoutItems).set({ cancelRequestedAt: new Date() }).where(eq(payoutItems.id, itemId)),
    );
    expect(early).toMatchObject({ code: "FROZEN_COLUMN", subject: "payout_items.cancel_requested_at" });
    // the RETURNED guard could otherwise be satisfied by a forged stamp: still refused
    await r.items.applyStatus(t.app.db, { id: itemId, status: "UNCLAIMED", provenance: "live" });
    expect((await r.items.requestCancel(t.app.db, { id: itemId, intent: "cash" })).ok).toBe(true);
    expect((await r.items.requestCancel(t.app.db, { id: itemId, intent: "cash" })).ok).toBe(true); // idempotent
    for (const v of [null, new Date(Date.now() - 86_400_000)]) {
      const e = await dbError(() =>
        t.owner.db.update(payoutItems).set({ cancelRequestedAt: v }).where(eq(payoutItems.id, itemId)),
      );
      expect(e.code).toBe("FROZEN_COLUMN");
    }
    expect(
      (await r.items.applyStatus(t.app.db, { id: itemId, status: "RETURNED", provenance: "live" })).applied,
    ).toBe(true);
  });
});

describe("approvals: signed once, voided at most once", () => {
  async function signed(ws: FixtureWorkspace, runId: string, role: "treasurer" | "board") {
    const [a] = await t.app.db
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
        batchSha256: "b".repeat(64),
        nonce: randomUUID(),
        exp: new Date(Date.now() + 30 * 60_000),
        provenance: "live",
      })
      .returning({ id: approvals.id });
    return a?.id ?? "";
  }

  it("a signed approval never changes, whoever writes it (FROZEN_COLUMN)", async () => {
    const { ws, runId } = await newRun("TREASURER_APPROVED");
    const id = await signed(ws, runId, "treasurer");
    for (const patch of [{ signature: "Zm9yZ2Vk" }, { batchSha256: "c".repeat(64) }, { exp: new Date() }]) {
      const e = await dbError(() => t.owner.db.update(approvals).set(patch).where(eq(approvals.id, id)));
      expect(e).toMatchObject({ code: "FROZEN_COLUMN", subject: "approvals" });
    }
  });

  it("approvals.void voids every live approval of the run once, records it in the ledger, and frees the slot", async () => {
    const { ws, runId, r } = await newRun("AWAITING_BOARD");
    const ids = [await signed(ws, runId, "treasurer"), await signed(ws, runId, "board")];
    const res = await r.approvals.void(t.app.db, { runId, reason: "LINE_EDITED" });
    expect(res.voided.map((a) => a.id).sort()).toEqual([...ids].sort());
    expect(res.voided.every((a) => a.voidedAt instanceof Date && a.voidReason === "LINE_EDITED")).toBe(true);
    const ledger = await t.app.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.workspaceId, ws.workspaceId), eq(ledgerEntries.kind, "approval.voided")));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.payload).toMatchObject({ runId, reason: "LINE_EDITED" });
    const payload = (ledger[0]?.payload ?? {}) as { approvalIds?: string[] };
    expect([...(payload.approvalIds ?? [])].sort()).toEqual([...ids].sort());
    // nothing left to void: no second ledger entry
    expect((await r.approvals.void(t.app.db, { runId, reason: "LINE_EDITED" })).voided).toHaveLength(0);
    // un-voiding, or re-dating the void, is refused
    for (const patch of [{ voidedAt: null }, { voidedAt: new Date(0) }, { voidReason: "OTHER" }]) {
      const e = await dbError(() =>
        t.owner.db
          .update(approvals)
          .set(patch)
          .where(eq(approvals.id, ids[0] ?? "")),
      );
      expect(e.code).toBe("FROZEN_COLUMN");
    }
    // the live-signature slot is free again for a fresh key-1 signature
    await signed(ws, runId, "treasurer");
  });

  it("a void reason is a code, never free text (the ledger keeps no prose)", async () => {
    const { runId, r } = await newRun("TREASURER_APPROVED");
    expect(
      await caught(() => r.approvals.void(t.app.db, { runId, reason: "Analyn changed Merlyn's line" })),
    ).toBeInstanceOf(TypeError);
  });
});
