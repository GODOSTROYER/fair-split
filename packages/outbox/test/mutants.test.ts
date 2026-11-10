// Tests that kill mutation-testing survivors (handoff T3) in the outbox's I7 core: the dedupe key and
// argument limits of enqueue (exact edges), what a second enqueue under the same key returns, the
// default backoff, the events and outcomes of runTask, and the routing table.
import { toJsonValue } from "@fairsplit/db";
import { fixtureWorkspace, openTestDb, type TestDb } from "@fairsplit/db/testing";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_ARGS_BYTES } from "../src/enqueue.js";
import {
  defaultBackoffMs,
  defaultRoute,
  enqueue,
  REMOTE_TASKS,
  type RunnerEvent,
  replayFromDatabase,
  runTask,
  TASK_NAMES,
} from "../src/index.js";
import { jsonbBytes } from "../src/jsonb-size.js";
import { enqueued, key, rowOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 5 });
});
afterAll(async () => {
  await t?.close();
});

describe("enqueue limits, exactly", () => {
  const put = (dedupeKey: string, args: Record<string, unknown> = { runId: "r" }) =>
    t.app.db.transaction((tx) => enqueue(tx, "computeRun", args, dedupeKey));

  it("a dedupe key of 1 to 200 characters is taken; empty or 201 is refused", async () => {
    await expect(put("")).rejects.toThrow("enqueue: dedupeKey must be 1–200 characters");
    await expect(put(`${key("k")}`.padEnd(201, "x"))).rejects.toThrow(TypeError);
    await expect(put(`${key("k")}`.padEnd(200, "x"))).resolves.toMatchObject({ inserted: true });
  });

  it("arguments of exactly 8 KB of jsonb text pass; one byte more is refused before INSERT", async () => {
    const at = (n: number) => ({ runId: "x".repeat(n - jsonbBytes({ runId: "" })) });
    expect(jsonbBytes(at(MAX_ARGS_BYTES))).toBe(MAX_ARGS_BYTES);
    await expect(put(key("k"), at(MAX_ARGS_BYTES - 1))).resolves.toMatchObject({ inserted: true });
    await expect(put(key("k"), at(MAX_ARGS_BYTES))).resolves.toMatchObject({ inserted: true });
    await expect(put(key("k"), at(MAX_ARGS_BYTES + 1))).rejects.toThrow(
      new RangeError(`enqueue: computeRun args exceed ${MAX_ARGS_BYTES} bytes; pass ids, not payloads`),
    );
  });

  it("includes all separator spaces in nested arguments and UTF-8 bytes at the boundary", async () => {
    const base = { runId: "é🙂", extra: [{ a: 1e21, b: -1.234e-7 }], padding: "" };
    const at = (n: number) => ({ ...base, padding: "x".repeat(n - jsonbBytes(base)) });
    await expect(put(key("k"), at(MAX_ARGS_BYTES))).resolves.toMatchObject({ inserted: true });
    await expect(put(key("k"), at(MAX_ARGS_BYTES + 1))).rejects.toThrow(RangeError);
  });

  it("matches PostgreSQL's own jsonb text size for nested values and numeric exponent edges", async () => {
    const values = [
      ...fc.sample(fc.jsonValue(), { seed: 617, numRuns: 100 }),
      { min: Number.MIN_VALUE, max: Number.MAX_VALUE, tiny: -1.234e-7, large: 1.2345678901234568e21 },
    ];
    for (const value of values) {
      // JSONB refuses NUL and unpaired UTF-16 surrogates before the size check; neither is a valid task arg.
      const text = JSON.stringify(value);
      if (/\\u0000|\\u[dD][89a-fA-F][0-9a-fA-F]{2}/.test(text)) continue;
      const [row] = await t.owner.sql<{ bytes: number }[]>`
        select octet_length(${text}::jsonb::text) as bytes`;
      expect(jsonbBytes(toJsonValue(value))).toBe(row?.bytes);
    }
  });

  it("a second enqueue under the same key returns the first row's id, not inserted", async () => {
    const k = key("dup");
    const first = await put(k);
    const second = await put(k, { runId: "other" });
    expect(second).toEqual({ id: first.id, inserted: false });
    expect((await rowOf(t.app.db, first.id)).args).toEqual({ runId: "r" });
  });
});

describe("defaultBackoffMs", () => {
  it("doubles from 1 s and stops at 5 minutes", () => {
    expect([0, 1, 2, 3, 9, 10].map(defaultBackoffMs)).toEqual([1_000, 1_000, 2_000, 4_000, 256_000, 300_000]);
  });
});

describe("runTask outcomes and events", () => {
  const run = async (handler: () => Promise<void>, maxAttempts = 3) => {
    const events: RunnerEvent[] = [];
    const id = await enqueued(t.app.db, "reconcile", { kind: "hot" }, { maxAttempts });
    const out = await runTask(
      { db: t.app.db, handlers: { reconcile: handler }, workerId: "w", onEvent: (e) => events.push(e) },
      id,
      "inline",
    );
    return { id, out, events };
  };

  it("done: claimed then done, with the attempt", async () => {
    const { id, out, events } = await run(async () => {});
    expect(out).toEqual({ outcome: "done", id });
    expect(events.map((e) => [e.type, e.attempt ?? null])).toEqual([
      ["claimed", 1],
      ["done", 1],
    ]);
  });

  it("retry and dead name the error; a thrown non-Error is kept as text", async () => {
    const retry = await run(async () => {
      throw new Error("PayPal 503");
    });
    expect(retry.events.map((e) => e.type)).toEqual(["claimed", "retry"]);
    expect(retry.events[1]).toMatchObject({ error: "Error: PayPal 503", attempt: 1 });
    const dead = await run(async () => {
      throw "plain text";
    }, 1);
    expect(dead.out).toEqual({ outcome: "dead", id: dead.id, error: "plain text" });
    expect(dead.events.map((e) => e.type)).toEqual(["claimed", "dead"]);
  });

  it("a task no one can claim is skipped with its state, and an unknown id with none", async () => {
    const events: RunnerEvent[] = [];
    const done = await run(async () => {});
    const again = await runTask(
      { db: t.app.db, handlers: {}, workerId: "w", onEvent: (e) => events.push(e) },
      done.id,
      "inline",
    );
    expect(again).toEqual({ outcome: "skipped", id: done.id, state: "done" });
    expect(events).toEqual([{ type: "skipped", id: done.id, executor: "inline" }]);
    const unknown = "00000000-0000-7000-8000-000000000000";
    await expect(runTask({ db: t.app.db, handlers: {}, workerId: "w" }, unknown, "inline")).resolves.toEqual({
      outcome: "skipped",
      id: unknown,
      state: null,
    });
  });

  it("a handler that completes inside its own transaction is done, once", async () => {
    const events: RunnerEvent[] = [];
    const id = await enqueued(t.app.db, "reconcile", { kind: "hot" });
    const out = await runTask(
      {
        db: t.app.db,
        handlers: { reconcile: async (_args, ctx) => t.app.db.transaction((tx) => ctx.complete(tx)) },
        workerId: "w",
        onEvent: (e) => events.push(e),
      },
      id,
      "inline",
    );
    expect(out).toEqual({ outcome: "done", id });
    expect((await rowOf(t.app.db, id)).state).toBe("done");
    expect(events.map((e) => e.type)).toEqual(["claimed", "done"]);
  });
});

describe("routing", () => {
  it("only the three remote tasks leave, only when configured remote and live", () => {
    for (const name of TASK_NAMES) {
      const remote = REMOTE_TASKS.has(name);
      expect(defaultRoute(name, { configured: "workflow", workspaceId: null, replay: false })).toBe(
        remote ? "workflow" : "inline",
      );
      expect(defaultRoute(name, { configured: "workflow", workspaceId: null, replay: true })).toBe("inline");
      expect(defaultRoute(name, { configured: "inline", workspaceId: null, replay: false })).toBe("inline");
    }
  });

  it("a system task (no workspace) replays only when FS_KILL kills AI everywhere; a live workspace does not", async () => {
    const live = await fixtureWorkspace(t.app.db, {});
    const q = (workspaceId: string | null, env: Record<string, string | undefined> = {}) =>
      replayFromDatabase(t.app.db, { env })({ id: "x", name: "extract", workspaceId });
    await expect(q(null)).resolves.toBe(false);
    await expect(q(null, { FS_KILL: "kill_ai_live" })).resolves.toBe(true);
    await expect(q(live.workspaceId)).resolves.toBe(false);
  });
});
