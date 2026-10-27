import { and, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ITEM_STATUS_RANK,
  ITEM_STATUS_TO_LINE_STATE,
  type ItemStatus,
  RUN_STATES,
  type RunState,
} from "../src/_shims/contracts.js";
import { canTransitionRun } from "../src/_shims/domain.js";
import { createDb } from "../src/client.js";
import { repos } from "../src/repos/index.js";
import { memberLines, payoutBatches, payoutItems, payRuns, runEvents } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
afterAll(async () => {
  await t?.close();
});

async function newRun() {
  const ws = await fixtureWorkspace(t.app.db, { withRun: true });
  return { ws, runId: ws.runId ?? "", r: repos(scopeOf(ws.workspaceId)) };
}

describe("inv.i5.forward-only: optimistic UPDATE … WHERE state = $expected", () => {
  it("moves the run, bumps the version and appends run.state in the same transaction", async () => {
    const { runId, r } = await newRun();
    const res = await r.runs.transition(t.app.db, {
      id: runId,
      from: "DRAFT",
      to: "QUOTED",
      cause: "envelope quote",
      provenance: "live",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.state).toBe("QUOTED");
    expect(res.row.version).toBe(1);
    expect(res.event?.type).toBe("run.state");
    expect(res.event?.payload).toMatchObject({ id: runId, from: "DRAFT", to: "QUOTED" });
  });

  it("a stale expected state changes nothing and reports the current state", async () => {
    const { runId, r } = await newRun();
    const res = await r.runs.transition(t.app.db, {
      id: runId,
      from: "QUOTED",
      to: "INVOICED",
      cause: "x",
      provenance: "live",
    });
    expect(res).toEqual({ ok: false, reason: "STALE", current: "DRAFT" });
    const [row] = await t.app.db.select().from(payRuns).where(eq(payRuns.id, runId));
    expect(row?.version).toBe(0);
  });

  it("an edge outside the state machine is refused before any write", async () => {
    const { runId, r } = await newRun();
    const res = await r.runs.transition(t.app.db, {
      id: runId,
      from: "DRAFT",
      to: "POSTED",
      cause: "skip",
      provenance: "live",
    });
    expect(res).toEqual({ ok: false, reason: "ILLEGAL", current: "DRAFT" });
  });

  it("a rolled-back transaction leaves neither the state change nor its event", async () => {
    const { ws, runId, r } = await newRun();
    await t.app.db
      .transaction(async (tx) => {
        const res = await r.runs.transition(tx, {
          id: runId,
          from: "DRAFT",
          to: "QUOTED",
          cause: "x",
          provenance: "live",
        });
        expect(res.ok).toBe(true);
        tx.rollback();
      })
      .catch(() => {});
    const [row] = await t.app.db.select().from(payRuns).where(eq(payRuns.id, runId));
    expect(row?.state).toBe("DRAFT");
    const evs = await t.app.db.select().from(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId));
    expect(evs).toHaveLength(0);
  });

  it("of N concurrent writers moving the same edge, exactly one wins", async () => {
    const { runId, r } = await newRun();
    const pools = Array.from({ length: 6 }, () => createDb(t.url, { role: "fs_app", max: 1 }));
    try {
      const results = await Promise.all(
        pools.map((p) =>
          r.runs.transition(p.db, {
            id: runId,
            from: "DRAFT",
            to: "QUOTED",
            cause: "race",
            provenance: "live",
          }),
        ),
      );
      expect(results.filter((x) => x.ok)).toHaveLength(1);
      expect(
        results.filter((x) => !x.ok).every((x) => !x.ok && x.reason === "STALE" && x.current === "QUOTED"),
      ).toBe(true);
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
  });

  it("property: every persisted run change is a legal edge, and version counts them", async () => {
    const { runId, r } = await newRun();
    let state: RunState = "DRAFT";
    let version = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...RUN_STATES), { minLength: 1, maxLength: 25 }),
        async (targets) => {
          for (const to of targets) {
            const res = await r.runs.transition(t.app.db, {
              id: runId,
              from: state,
              to,
              cause: "prop",
              provenance: "live",
            });
            if (res.ok) {
              if (!canTransitionRun(state, to)) return false;
              state = to;
              version++;
              if (res.row.version !== version) return false;
            } else if (res.reason !== "ILLEGAL") return false;
          }
          const [row] = await t.app.db.select().from(payRuns).where(eq(payRuns.id, runId));
          return row?.state === state && row.version === version;
        },
      ),
      { numRuns: 15 },
    );
  });

  it("lines follow the register's line machine and emit line.state with the line id", async () => {
    const { ws, runId, r } = await newRun();
    const [line] = await t.app.db
      .insert(memberLines)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        memberId: ws.memberIds[0] ?? "",
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
      .returning();
    const id = line?.id ?? "";
    const steps: [string, string][] = [
      ["COMPUTED", "HELD"],
      ["HELD", "READY"],
      ["READY", "LOCKED"],
      ["LOCKED", "SUBMITTED"],
      ["SUBMITTED", "PAYPAL_PENDING"],
      ["PAYPAL_PENDING", "UNCLAIMED"],
      ["UNCLAIMED", "RETURNED"],
      ["RETURNED", "OFF_RAIL_DUE"],
      ["OFF_RAIL_DUE", "OFF_RAIL_PAID"],
    ];
    for (const [from, to] of steps) {
      const res = await r.lines.transition(t.app.db, {
        id,
        from: from as never,
        to: to as never,
        cause: "walk",
        provenance: "live",
      });
      expect(res.ok, `${from}→${to}`).toBe(true);
      if (res.ok) expect(res.event?.lineId).toBe(id);
    }
    const back = await r.lines.transition(t.app.db, {
      id,
      from: "OFF_RAIL_PAID",
      to: "READY",
      cause: "x",
      provenance: "live",
    });
    expect(back.ok).toBe(false);
  });

  it("a scope only ever reaches its own workspace's rows", async () => {
    const a = await newRun();
    const b = await newRun();
    expect(await b.r.runs.get(t.app.db, a.runId)).toBeNull();
    expect(await b.r.runs.update(t.app.db, a.runId, { haltedReason: "nope" })).toBeNull();
    const res = await b.r.runs.transition(t.app.db, {
      id: a.runId,
      from: "DRAFT",
      to: "QUOTED",
      cause: "cross",
      provenance: "live",
    });
    expect(res).toEqual({ ok: false, reason: "NOT_FOUND", current: null });
    // inserts take the workspace from the scope, whatever the caller passes
    const m = await b.r.members.insert(t.app.db, {
      coopId: b.ws.coopId,
      memberNo: "M-900",
      displayName: "Scoped",
      lang: "ceb",
      provenance: "seeded",
      ...({ workspaceId: a.ws.workspaceId } as object),
    } as never);
    expect(m.workspaceId).toBe(b.ws.workspaceId);
  });
});

async function newItem() {
  const { ws, runId, r } = await newRun();
  const [line] = await t.app.db
    .insert(memberLines)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      memberId: ws.memberIds[0] ?? "",
      state: "SUBMITTED",
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
    .returning();
  const [batch] = await t.app.db
    .insert(payoutBatches)
    .values({
      workspaceId: ws.workspaceId,
      runId,
      senderBatchId: `2026A-test-r${runId}`,
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
      lineId: line?.id ?? "",
      senderItemId: `r-${runId.slice(-12)}-M-001`,
      receiver: "member@example.test",
      amountCents: 100n,
      currency: "USD",
      provenance: "live",
    })
    .returning();
  return {
    ws,
    r,
    runId,
    batchId: batch?.id ?? "",
    lineId: line?.id ?? "",
    itemId: item?.id ?? "",
    senderItemId: item?.senderItemId ?? "",
  };
}

describe("inv.i5.item-ranks: payout item statuses only climb (register §7)", () => {
  it("property: any arrival order of webhook statuses settles on the highest rank", async () => {
    const climbable = (Object.keys(ITEM_STATUS_RANK) as ItemStatus[]).filter((s) => s !== "RETURNED");
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(climbable, { minLength: 1 }), async (arrivals) => {
        const { r, itemId } = await newItem();
        for (const status of arrivals)
          await r.items.applyStatus(t.app.db, { id: itemId, status, provenance: "live" });
        const [row] = await t.app.db.select().from(payoutItems).where(eq(payoutItems.id, itemId));
        const top = Math.max(...arrivals.map((s) => ITEM_STATUS_RANK[s]));
        return row?.statusRank === top;
      }),
      { numRuns: 12 },
    );
  });

  it("a late lower status is a no-op that reports NOT_HIGHER", async () => {
    const { r, senderItemId } = await newItem();
    expect(
      (await r.items.applyStatus(t.app.db, { senderItemId, status: "SUCCESS", provenance: "live" })).applied,
    ).toBe(true);
    const late = await r.items.applyStatus(t.app.db, { senderItemId, status: "PENDING", provenance: "live" });
    expect(late).toEqual({ applied: false, reason: "NOT_HIGHER", current: "SUCCESS" });
  });

  it("RETURNED is accepted only after our own cancel of an UNCLAIMED item", async () => {
    const { r, itemId } = await newItem();
    await r.items.applyStatus(t.app.db, { id: itemId, status: "UNCLAIMED", provenance: "live" });
    const early = await r.items.applyStatus(t.app.db, { id: itemId, status: "RETURNED", provenance: "live" });
    expect(early).toEqual({ applied: false, reason: "RETURN_WITHOUT_CANCEL", current: "UNCLAIMED" });
    const cancel = await r.items.requestCancel(t.app.db, { id: itemId, intent: "cash" });
    expect(cancel.ok).toBe(true);
    const ret = await r.items.applyStatus(t.app.db, { id: itemId, status: "RETURNED", provenance: "live" });
    expect(ret.applied).toBe(true);
    if (ret.applied) {
      expect(ret.event.type).toBe("item.updated");
      expect(ret.event.payload).toMatchObject({ from: "UNCLAIMED", to: "RETURNED", rank: 40 });
    }
  });

  it("the database refuses a direct status regression, whoever writes it", async () => {
    const { itemId } = await newItem();
    await t.owner.db
      .update(payoutItems)
      .set({ status: "SUCCESS", statusRank: 60 })
      .where(eq(payoutItems.id, itemId));
    const e = await dbError(() =>
      t.owner.db
        .update(payoutItems)
        .set({ status: "PENDING", statusRank: 10 })
        .where(eq(payoutItems.id, itemId)),
    );
    expect(e.code).toBe("ITEM_STATUS_REGRESSION");
  });

  it("the database refuses RETURNED without our cancel, whoever writes it", async () => {
    const { itemId } = await newItem();
    await t.owner.db
      .update(payoutItems)
      .set({ status: "UNCLAIMED", statusRank: 30 })
      .where(eq(payoutItems.id, itemId));
    const e = await dbError(() =>
      t.owner.db
        .update(payoutItems)
        .set({ status: "RETURNED", statusRank: 40 })
        .where(and(eq(payoutItems.id, itemId), sql`cancel_requested_at is null`)),
    );
    expect(e.code).toBe("RETURN_WITHOUT_CANCEL");
  });
});

async function lineState(lineId: string) {
  const [l] = await t.app.db.select().from(memberLines).where(eq(memberLines.id, lineId));
  return l?.state;
}

describe("lines.followItem: a webhook that beats our 201 (S3.5, early webhooks join on our keys)", () => {
  it("SUCCESS before the 201 walks the line SUBMITTED → PAYPAL_PENDING → PAID at once; the late 201 changes nothing", async () => {
    const { r, lineId, itemId } = await newItem();
    // the webhook's transaction: the item climbs, and its line follows in the same commit
    const followed = await t.app.db.transaction(async (tx) => {
      const applied = await r.items.applyStatus(tx, { id: itemId, status: "SUCCESS", provenance: "live" });
      expect(applied.applied).toBe(true);
      return r.lines.followItem(tx, { itemId, provenance: "live", cause: { webhookEventId: "WH-early" } });
    });
    expect(followed).toMatchObject({ ok: true, from: "SUBMITTED", to: "PAID" });
    if (!followed.ok) return;
    expect(followed.events.map((e) => [e.payload.from, e.payload.to])).toEqual([
      ["SUBMITTED", "PAYPAL_PENDING"],
      ["PAYPAL_PENDING", "PAID"],
    ]);
    expect(followed.events[0]?.payload.cause).toMatchObject({ implied: true, itemStatus: "SUCCESS" });
    expect(followed.events[1]?.payload.cause).toMatchObject({
      webhookEventId: "WH-early",
      itemStatus: "SUCCESS",
    });
    // the 201 handler arrives late: its edge is stale, and following PENDING is a no-op
    const late = await r.lines.transition(t.app.db, {
      id: lineId,
      from: "SUBMITTED",
      to: "PAYPAL_PENDING",
      cause: "201",
      provenance: "live",
    });
    expect(late).toEqual({ ok: false, reason: "STALE", current: "PAID" });
    const again = await r.lines.followItem(t.app.db, { itemId, provenance: "live" });
    expect(again).toMatchObject({ ok: true, from: "PAID", to: "PAID", events: [] });
    expect(await lineState(lineId)).toBe("PAID");
  });

  it("UNCLAIMED before the 201 parks the line; our cancel and RETURNED then move it on to cash", async () => {
    const { r, lineId, itemId } = await newItem();
    await r.items.applyStatus(t.app.db, { id: itemId, status: "UNCLAIMED", provenance: "live" });
    expect(await r.lines.followItem(t.app.db, { itemId, provenance: "live" })).toMatchObject({
      ok: true,
      to: "UNCLAIMED",
    });
    await r.items.requestCancel(t.app.db, { id: itemId, intent: "cash" });
    await r.items.applyStatus(t.app.db, { id: itemId, status: "RETURNED", provenance: "live" });
    expect(await r.lines.followItem(t.app.db, { itemId, provenance: "live" })).toMatchObject({
      ok: true,
      from: "UNCLAIMED",
      to: "RETURNED",
    });
    const cash = await r.lines.transition(t.app.db, {
      id: lineId,
      from: "RETURNED",
      to: "OFF_RAIL_DUE",
      cause: "cash",
      provenance: "live",
    });
    expect(cash.ok).toBe(true);
    // a second RETURNED notice is a no-op for a line that has moved on to cash
    expect(await r.lines.followItem(t.app.db, { itemId, provenance: "live" })).toMatchObject({
      ok: true,
      events: [],
    });
    expect(await lineState(lineId)).toBe("OFF_RAIL_DUE");
  });

  it("property: whatever order item statuses arrive in, the line ends where its item's highest status says", async () => {
    const climbable = (Object.keys(ITEM_STATUS_RANK) as ItemStatus[]).filter((s) => s !== "RETURNED");
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(climbable, { minLength: 1 }), async (arrivals) => {
        const { r, lineId, itemId } = await newItem();
        for (const status of arrivals) {
          await t.app.db.transaction(async (tx) => {
            await r.items.applyStatus(tx, { id: itemId, status, provenance: "live" });
            const f = await r.lines.followItem(tx, { itemId, provenance: "live" });
            if (!f.ok) throw new Error(`followItem refused: ${f.reason}`);
          });
        }
        const top = arrivals.reduce((a, b) => (ITEM_STATUS_RANK[b] > ITEM_STATUS_RANK[a] ? b : a));
        return (await lineState(lineId)) === ITEM_STATUS_TO_LINE_STATE[top];
      }),
      { numRuns: 15 },
    );
  });

  it("refuses an item a re-route has superseded, a line that never reached PayPal, and an unknown item", async () => {
    const { ws, r, runId, batchId, lineId, itemId } = await newItem();
    // a re-route item replaced this one, so its late notices no longer move the line
    await t.app.db.insert(payoutItems).values({
      workspaceId: ws.workspaceId,
      batchId,
      lineId,
      senderItemId: `r-${runId.slice(-12)}x1-M-001`,
      receiver: "member@example.test",
      amountCents: 100n,
      currency: "USD",
      supersedesItemId: itemId,
      provenance: "live",
    });
    await r.items.applyStatus(t.app.db, { id: itemId, status: "SUCCESS", provenance: "live" });
    expect(await r.lines.followItem(t.app.db, { itemId, provenance: "live" })).toEqual({
      ok: false,
      reason: "SUPERSEDED",
      current: "SUBMITTED",
    });
    expect(await lineState(lineId)).toBe("SUBMITTED");
    // a line still READY has no item on PayPal's rail to follow (rows are written at LOCKED → SUBMITTED)
    const ready = await newRun();
    const [l] = await t.app.db
      .insert(memberLines)
      .values({
        workspaceId: ready.ws.workspaceId,
        runId: ready.runId,
        memberId: ready.ws.memberIds[0] ?? "",
        state: "READY",
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
      .returning();
    const [b] = await t.app.db
      .insert(payoutBatches)
      .values({
        workspaceId: ready.ws.workspaceId,
        runId: ready.runId,
        senderBatchId: `2026A-ready-r${ready.runId}`,
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
        workspaceId: ready.ws.workspaceId,
        batchId: b?.id ?? "",
        lineId: l?.id ?? "",
        senderItemId: `r-${ready.runId.slice(-12)}-M-009`,
        receiver: "member@example.test",
        amountCents: 100n,
        currency: "USD",
        provenance: "live",
      })
      .returning();
    await ready.r.items.applyStatus(t.app.db, { id: item?.id ?? "", status: "SUCCESS", provenance: "live" });
    expect(await ready.r.lines.followItem(t.app.db, { itemId: item?.id ?? "", provenance: "live" })).toEqual({
      ok: false,
      reason: "ILLEGAL",
      current: "READY",
    });
    // another workspace's item is not found from this scope
    expect(await ready.r.lines.followItem(t.app.db, { itemId, provenance: "live" })).toEqual({
      ok: false,
      reason: "NOT_FOUND",
      current: null,
    });
  });
});
