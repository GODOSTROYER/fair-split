// One SSE stream per run, shared by every screen (S3.7): the hub reduces events into the run's query data so
// all surfaces see the same state at once (C-05), and flags history as replay so only live events may start a
// moment (motion is evidence). The session store starts one judge session per press and forgets its token.

import { describe, expect, it } from "vitest";
import { createTestRuntime, createTestWorld } from "../test/world.js";
import type { EventMeta } from "./hub.js";
import { queryKeys } from "./query.js";
import type { RunView } from "./run-view.js";

describe("stream hub", () => {
  it("reduces a run's events into its query data, and flags history as replay", async () => {
    const { runtime, world } = createTestRuntime(createTestWorld());
    const session = await runtime.session.start();
    world.markPaid(session.runSlug); // history: emitted before anyone subscribed
    const seen: { type: string; meta: EventMeta }[] = [];
    runtime.hub.listen(session.runSlug, (event, meta) => seen.push({ type: event.type, meta }));
    const release = runtime.hub.acquire(session.runSlug);
    await expect
      .poll(() => runtime.client.getQueryData<RunView>(queryKeys.run(session.runSlug))?.state)
      .toBe("IN_REVIEW");
    expect(runtime.hub.status(session.runSlug).kind).toBe("open");
    // History replays without the replay flag only if it is recent; everything here is seconds old, so the
    // skew allowance keeps it live. A frame stamped well before the subscription counts as replay.
    expect(seen.length).toBeGreaterThan(0);
    const h1 = world.holdIdFor(session.runSlug, "H1");
    if (!h1) throw new Error("no H1");
    world.resolveHold(h1, { resolution: "COUNT_ONCE" });
    await expect.poll(() => seen.some((s) => s.type === "hold.resolved" && !s.meta.replay)).toBe(true);
    release();
    expect(runtime.hub.status(session.runSlug).kind).toBe("closed");
  });

  it("marks events stamped before the subscription (beyond the skew allowance) as replay", async () => {
    let now = Date.now() - 60_000;
    const world = createTestWorld({ now: () => now });
    const { runtime } = createTestRuntime(world);
    const session = await runtime.session.start();
    world.markPaid(session.runSlug);
    now = Date.now();
    const flags: boolean[] = [];
    runtime.hub.listen(session.runSlug, (_event, meta) => flags.push(meta.replay));
    const release = runtime.hub.acquire(session.runSlug);
    await expect.poll(() => flags.length).toBeGreaterThan(5);
    expect(flags.every(Boolean)).toBe(true);
    release();
  });

  it("shares one stream between callers and closes it when the last one leaves", async () => {
    const { runtime } = createTestRuntime();
    const session = await runtime.session.start();
    const a = runtime.hub.acquire(session.runSlug);
    const b = runtime.hub.acquire(session.runSlug);
    await expect.poll(() => runtime.hub.status(session.runSlug).kind).toBe("open");
    a();
    expect(runtime.hub.status(session.runSlug).kind).toBe("open");
    b();
    expect(runtime.hub.status(session.runSlug).kind).toBe("closed");
  });
});

describe("judge session", () => {
  it("starts once for concurrent presses, holds the token in memory, and resets", async () => {
    const { runtime, adapter, world } = createTestRuntime();
    const [a, b] = await Promise.all([runtime.session.start(), runtime.session.start()]);
    expect(a).toBe(b);
    expect(runtime.session.getState().status).toBe("active");
    expect(world.sessionForRun(a.runSlug)).not.toBeNull();
    await runtime.session.reset();
    expect(runtime.session.getState()).toEqual({ status: "none", session: null, error: null });
    expect(world.sessionForRun(a.runSlug)).toBeNull();
    // The token is gone: a command now needs a fresh session.
    await expect(
      adapter.call("markPaid", { params: { runSlug: a.runSlug }, body: {} }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("a failed start can be dismissed and tried again", async () => {
    const { runtime, adapter } = createTestRuntime();
    const original = adapter.call;
    let fail = true;
    (adapter as { call: typeof adapter.call }).call = (async (...args: Parameters<typeof adapter.call>) => {
      if (fail) throw new Error("network down");
      return original(...args);
    }) as typeof adapter.call;
    await expect(runtime.session.start()).rejects.toThrow("network down");
    expect(runtime.session.getState().status).toBe("failed");
    runtime.session.dismissError();
    expect(runtime.session.getState().status).toBe("none");
    fail = false;
    await expect(runtime.session.start()).resolves.toMatchObject({ queuePosition: null });
  });
});
