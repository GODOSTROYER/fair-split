import { createDb, repos, schema as s, workspaceScope } from "@fairsplit/db";
import { fixtureWorkspace, openTestDb, type TestDb } from "@fairsplit/db/testing";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueue, MAX_ARGS_BYTES } from "../src/enqueue.js";
import { key, rowOf, sleep, until } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 10 });
});
afterAll(async () => {
  await t?.close();
});

describe("inv.i7.outbox: the task is enqueued in the transaction that requires it", () => {
  it("commits with the state change and notifies fs_outbox only after commit", async () => {
    const ws = await fixtureWorkspace(t.app.db, { withRun: true });
    const listener = postgres(t.url, { max: 1, onnotice: () => {} });
    const heard: string[] = [];
    await listener.listen("fs_outbox", (p) => heard.push(p));
    try {
      let taskId = "";
      const r = repos(
        workspaceScope({
          workspaceId: ws.workspaceId,
          actor: { kind: "engine", id: "engine" },
          via: "system",
        }),
      );
      await t.app.db.transaction(async (tx) => {
        const moved = await r.runs.transition(tx, {
          id: ws.runId ?? "",
          from: "DRAFT",
          to: "QUOTED",
          cause: "quote",
          provenance: "live",
        });
        expect(moved.ok).toBe(true);
        taskId = (
          await enqueue(tx, "ensureInvoice", { runId: ws.runId ?? "" }, `inv:${ws.runId}`, {
            workspaceId: ws.workspaceId,
          })
        ).id;
        await sleep(150);
        expect(heard).toHaveLength(0);
      });
      await until(() => heard.length === 1);
      expect(heard[0]).toBe(taskId);
      const row = await rowOf(t.app.db, taskId);
      expect(row).toMatchObject({ state: "queued", name: "ensureInvoice", workspaceId: ws.workspaceId });
    } finally {
      await listener.end({ timeout: 5 });
    }
  });

  it("a rolled-back state change leaves no task behind", async () => {
    const k = key("rollback");
    await t.app.db
      .transaction(async (tx) => {
        await enqueue(tx, "computeRun", { runId: "x" }, k);
        tx.rollback();
      })
      .catch(() => {});
    const rows = await t.app.db.select().from(s.taskOutbox).where(eq(s.taskOutbox.dedupeKey, k));
    expect(rows).toHaveLength(0);
  });

  it("refuses to enqueue outside a transaction", async () => {
    await expect(enqueue(t.app.db as never, "computeRun", {}, key())).rejects.toThrow(/I7/);
  });

  it("accepts a transaction from another copy of drizzle-orm (entity kind, not instanceof)", async () => {
    const kind = Symbol.for("drizzle:entityKind");
    // a transaction class from a "different" drizzle-orm: the same entity kind, another constructor
    class ForeignPgTransaction {
      static readonly [kind]: string = "PgTransaction";
      constructor(
        readonly insert: unknown,
        readonly select: unknown,
      ) {}
    }
    const k = key("foreign");
    await t.app.db.transaction(async (tx) => {
      // an instance of it driving the same connection
      const foreign = new ForeignPgTransaction(tx.insert.bind(tx), tx.select.bind(tx));
      const res = await enqueue(foreign as never, "computeRun", { runId: "r" }, k);
      expect(res.inserted).toBe(true);
    });
    const rows = await t.app.db.select().from(s.taskOutbox).where(eq(s.taskOutbox.dedupeKey, k));
    expect(rows).toHaveLength(1);
  });
});

describe("inv.i7.dedupe: one row per dedupe key", () => {
  it("the same key twice yields one row; the second call reports inserted: false with the same id", async () => {
    const k = key("fund");
    const a = await t.app.db.transaction((tx) => enqueue(tx, "ensureInvoice", { invoiceId: "INV2-1" }, k));
    const b = await t.app.db.transaction((tx) => enqueue(tx, "ensureInvoice", { invoiceId: "INV2-1" }, k));
    expect(a.inserted).toBe(true);
    expect(b).toEqual({ id: a.id, inserted: false });
    const c = await t.app.db.transaction(async (tx) => {
      await enqueue(tx, "ensureInvoice", {}, `${k}:same-tx`);
      return enqueue(tx, "ensureInvoice", {}, `${k}:same-tx`);
    });
    expect(c.inserted).toBe(false);
  });

  it("concurrent enqueues of one key from many connections still yield exactly one row", async () => {
    const k = key("webhook");
    const pools = Array.from({ length: 5 }, () => createDb(t.url, { role: "fs_app", max: 1 }));
    try {
      const results = await Promise.all(
        pools.map((p) => p.db.transaction((tx) => enqueue(tx, "processWebhook", { webhookEventId: "w" }, k))),
      );
      expect(results.filter((r) => r.inserted)).toHaveLength(1);
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
  });
});

describe("arguments are ids", () => {
  it("rejects unknown task names and oversized arguments", async () => {
    await expect(
      t.app.db.transaction((tx) => enqueue(tx, "mineBitcoin" as never, {}, key())),
    ).rejects.toThrow(/unknown task/);
    const big = { blob: "x".repeat(MAX_ARGS_BYTES) };
    await expect(t.app.db.transaction((tx) => enqueue(tx, "explain", big, key()))).rejects.toThrow(
      /ids, not payloads/,
    );
  });

  it("normalises arguments to JSON (bigint → decimal string) and honours delays", async () => {
    const id = await t.app.db.transaction(
      async (tx) =>
        (await enqueue(tx, "settleBatch", { batchId: "b", cents: 36_839n }, key(), { delayMs: 90_000 })).id,
    );
    const row = await rowOf(t.app.db, id);
    expect(row.args).toEqual({ batchId: "b", cents: "36839" });
    const [d] = await t.app.db
      .select({ s: sql<number>`extract(epoch from (${s.taskOutbox.runAfter} - now()))::int` })
      .from(s.taskOutbox)
      .where(eq(s.taskOutbox.id, id));
    expect(d?.s).toBeGreaterThan(80);
    expect(d?.s).toBeLessThanOrEqual(90);
  });
});
