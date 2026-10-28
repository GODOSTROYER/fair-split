// C-21's 40 live batches a day and the US$10,000 floor guard the one shared sandbox business account, so a post's
// spend check and the write it allows are one step across every workspace and process (money/payouts.ts
// `spendLock`), on embedded Postgres with PayPal answered by msw. Two workspaces post at once: while the first
// holds its check-and-write, the second's check waits for it, so its count includes the first's batch.
import { schema, systemScope } from "@fairsplit/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, resolveAll, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { seedWorld } from "../runs/test/world.js";
import { payoutsServiceFor, postsInLast24h } from "./payouts.js";

const script = paypalScript();
let a: RunsHarness;
let b: RunsHarness;

async function another(base: RunsHarness): Promise<RunsHarness> {
  const db = base.t.pg?.app.db;
  if (!db) throw new Error("db");
  const w = await seedWorld(db, {
    kind: "showcase",
    invoice: { paypalInvoiceId: "INV2-TEST-SPEND-0002", status: "SENT", sent: true },
  });
  const tk = (role: "treasurer" | "board" | "clerk" | "member" | "brand", persona: string) =>
    base.t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona });
  return {
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
}

beforeAll(async () => {
  a = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
  b = await another(a);
  for (const h of [a, b]) {
    await resolveAll(h);
    await signBoth(h);
  }
});
afterAll(async () => a?.close());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("inv.i6.spend-lock: the daily cap and the floor are checked and written as one step across workspaces", () => {
  it("a second workspace's post waits for the first's check-and-write, and counts its batch", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    let firstWriting = false;
    const first = await payoutsServiceFor(a.t.deps, systemScope(a.world.workspaceId, ACTORS.outbox), {
      repo: (base) => ({
        ...base,
        async writeSubmitted(batch) {
          firstWriting = true;
          await gate;
          return base.writeSubmitted(batch);
        },
      }),
    });
    let seenBySecond: number | null = null;
    const second = await payoutsServiceFor(b.t.deps, systemScope(b.world.workspaceId, ACTORS.outbox), {
      repo: (base) => ({
        ...base,
        async writeSubmitted(batch) {
          // what the second post's guard counted, read under the same lock, just before its own write
          seenBySecond = await postsInLast24h(b.t.deps, b.t.clock.now());
          return base.writeSubmitted(batch);
        },
      }),
    });

    const pa = first.executeApproved(a.world.runId);
    while (!firstWriting) await sleep(10);
    let secondDone = false;
    const pb = second.executeApproved(b.world.runId).then((o) => {
      secondDone = true;
      return o;
    });
    await sleep(300);
    // the first holds the check-and-write: the second has not even passed its guard
    expect(secondDone).toBe(false);
    expect(seenBySecond).toBeNull();
    open();
    expect(await pa).toMatchObject({ kind: "created" });
    expect(await pb).toMatchObject({ kind: "created" });
    // the second's count already held the first's batch
    expect(seenBySecond).toBe(1);
    const batches = await a.t.deps.db.select({ id: schema.payoutBatches.id }).from(schema.payoutBatches);
    expect(batches).toHaveLength(2);
    expect(script.posted).toHaveLength(2);
  });

  it("the lock is free again once both posts are written: no connection keeps it", async () => {
    // nobody holds it: a try-lock from another session succeeds (and is released at once)
    const owner = a.t.pg?.owner.sql;
    if (!owner) throw new Error("db");
    const [lock] = await owner<{ ok: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended('fs:payout-spend', 0)) as ok`;
    expect(lock?.ok).toBe(true);
    await owner`select pg_advisory_unlock(hashtextextended('fs:payout-spend', 0))`;
  });
});
