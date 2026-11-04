import type { TaskContext } from "@fairsplit/outbox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../lib/context.js";
import { MAX_ATTEMPT_ROWS } from "../runs/now.js";
import { runTasks } from "../runs/tasks.js";

const mocks = vi.hoisted(() => ({ rail: vi.fn(), defer: vi.fn(), attempts: vi.fn() }));
vi.mock("./rail.js", async (original) => ({ ...(await original<object>()), railForStep: mocks.rail }));
vi.mock("../runs/now.js", async (original) => ({
  ...(await original<object>()),
  attemptsOf: mocks.attempts,
  deferTask: mocks.defer,
}));

describe("HD6-8 lane retries preserve a head reservation", () => {
  beforeEach(() => {
    mocks.attempts.mockResolvedValue(7);
    mocks.rail.mockResolvedValue({ kind: "queued", position: 2, etaMs: 80_000, retryAfterMs: 30_000 });
    mocks.defer.mockResolvedValue({ id: "next", runAfter: new Date(Date.now() + 30_000) });
  });
  it("attempt seven re-asks within 30 seconds instead of exponential PayPal backoff", async () => {
    const task = runTasks({ db: {} } as AppDeps).postPayoutBatch;
    if (!task) throw new Error("post task");
    await task({ runId: "11111111-1111-4111-8111-111111111111", senderBatchId: "fs-test-batch" }, {
      outboxId: "attempt7",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      name: "postPayoutBatch",
    } as TaskContext);
    expect(mocks.defer.mock.calls.at(-1)?.[3]).toBe(30_000);
  });
  it("a full 50-deep lane needs fewer than the attempt-row ceiling at 30 second re-asks", () => {
    expect(1 + Math.ceil((50 * 40_000) / 30_000)).toBeLessThan(MAX_ATTEMPT_ROWS);
  });
  it.each(["kill_switch", "simulator_not_running", "lane_full"])(
    "a written post waiting for %s keeps exponential backoff",
    async (waitingFor) => {
      mocks.rail.mockResolvedValue({ kind: "queued", position: null, waitingFor, retryAfterMs: 60_000 });
      const task = runTasks({ db: {} } as AppDeps).postPayoutBatch;
      if (!task) throw new Error("post task");
      await task({ runId: "11111111-1111-4111-8111-111111111111", senderBatchId: "fs-test-batch" }, {
        outboxId: "attempt7",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        name: "postPayoutBatch",
      } as TaskContext);
      expect(mocks.defer.mock.calls.at(-1)?.[3]).toBe(900_000);
    },
  );
  it("a written post's hourly-cap wait never exceeds MAX_DEFER_MS", async () => {
    mocks.rail.mockResolvedValue({
      kind: "queued",
      position: null,
      waitingFor: "hourly_cap",
      retryAfterMs: 61 * 60_000,
    });
    const task = runTasks({ db: {} } as AppDeps).postPayoutBatch;
    if (!task) throw new Error("post task");
    await task({ runId: "11111111-1111-4111-8111-111111111111", senderBatchId: "fs-test-batch" }, {
      outboxId: "attempt7",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      name: "postPayoutBatch",
    } as TaskContext);
    expect(mocks.defer.mock.calls.at(-1)?.[3]).toBe(900_000);
  });
});
