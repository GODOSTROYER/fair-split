// One SSE stream per run, shared by every screen (S3.7): the hub reduces events into the run's query data so
// all surfaces see the same state at once (C-05), and flags history as replay so only live events may start a
// moment (motion is evidence). The session store starts one judge session per press and forgets its token;
// the session's run starts from its own base, never from a showcase read cached under the same slug.

import { ApiClientError } from "@fairsplit/api-client";
import { describe, expect, it } from "vitest";
import { stageNoticeFor } from "../chrome/StageNotice.js";
import { createTestRuntime, createTestWorld } from "../test/world.js";
import type { EventMeta } from "./hub.js";
import { queryKeys, runViewQuery } from "./query.js";
import type { RunView } from "./run-view.js";

describe("stream hub", () => {
  it("reduces a run's events into its query data, and flags history as replay", async () => {
    const { runtime, world } = createTestRuntime(createTestWorld());
    const session = await runtime.session.start();
    world.markPaid(); // history: emitted before anyone subscribed
    const seen: { type: string; meta: EventMeta }[] = [];
    runtime.hub.listen(session.runSlug, (event, meta) => seen.push({ type: event.type, meta }));
    const release = runtime.hub.acquire(session.runSlug);
    await expect
      .poll(() => runtime.client.getQueryData<RunView>(queryKeys.run(session.runSlug))?.state)
      .toBe("IN_REVIEW");
    expect(runtime.hub.status(session.runSlug).kind).toBe("open");
    expect(runtime.client.getQueryData<RunView>(queryKeys.run(session.runSlug))?.origin).toBe("session");
    // History replays without the replay flag only if it is recent; everything here is seconds old, so the
    // skew allowance keeps it live. A frame stamped well before the subscription counts as replay.
    expect(seen.length).toBeGreaterThan(0);
    world.enterByHand();
    world.resolve("H1");
    await expect.poll(() => seen.some((s) => s.type === "hold.resolved" && !s.meta.replay)).toBe(true);
    release();
    expect(runtime.hub.status(session.runSlug).kind).toBe("closed");
  });

  it("marks events stamped before the subscription (beyond the skew allowance) as replay", async () => {
    let now = Date.now() - 60_000;
    const world = createTestWorld({ now: () => new Date(now) });
    const { runtime } = createTestRuntime(world);
    const session = await runtime.session.start();
    world.markPaid();
    now = Date.now();
    const flags: boolean[] = [];
    runtime.hub.listen(session.runSlug, (_event, meta) => flags.push(meta.replay));
    const release = runtime.hub.acquire(session.runSlug);
    await expect.poll(() => flags.length).toBeGreaterThan(5);
    expect(flags.every(Boolean)).toBe(true);
    release();
  });

  it("asks for the run's history from the start when its base has no events (fs-api replays only on Last-Event-ID)", async () => {
    // fs-api streams only new events when no Last-Event-ID is sent (packages/db bus: "omitted: only events
    // committed from now on"), so a session run whose base has no events must subscribe after "0".
    const { runtime, adapter } = createTestRuntime();
    const asked: (string | null | undefined)[] = [];
    const subscribe = adapter.subscribe.bind(adapter);
    (adapter as { subscribe: typeof adapter.subscribe }).subscribe = (scope, handlers, options) => {
      asked.push(options?.lastEventId);
      return subscribe(scope, handlers, options);
    };
    const session = await runtime.session.start();
    const release = runtime.hub.acquire(session.runSlug);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe("0");
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

  it("a session's run never starts from the showcase read cached under its slug", async () => {
    const { runtime } = createTestRuntime();
    // The mock's session reuses the showcase's slug (r37): read the showcase first, as /runs/2026A-r37 would.
    const showcase = await runtime.client.fetchQuery(runViewQuery(runtime, "2026A-r37"));
    expect(showcase.origin).toBe("showcase");
    const session = await runtime.session.start();
    expect(session.runSlug).toBe("2026A-r37");
    const live = await runtime.client.fetchQuery(runViewQuery(runtime, session.runSlug));
    expect(live).toMatchObject({ origin: "session", state: "INVOICED", lastEventId: null });
  });
});

describe("judge session", () => {
  it("starts once for concurrent presses, holds the token in memory, and resets", async () => {
    const { runtime, adapter, world } = createTestRuntime();
    const [a, b] = await Promise.all([runtime.session.start(), runtime.session.start()]);
    expect(a).toBe(b);
    expect(runtime.session.getState().status).toBe("active");
    world.markPaid();
    expect(world.run.state).toBe("IN_REVIEW");
    runtime.client.setQueryData(queryKeys.run(a.runSlug), { stale: true });
    await runtime.session.reset();
    expect(runtime.session.getState()).toEqual({ status: "none", session: null, error: null });
    // Reset returned the world to the first press and dropped the session run's cached view.
    expect(world.run.state).toBe("INVOICED");
    expect(world.events()).toEqual([]);
    expect(runtime.client.getQueryData(queryKeys.run(a.runSlug))).toBeUndefined();
    // The token is gone: a command now needs a fresh session.
    await expect(adapter.call("markPaid", { params: { runSlug: a.runSlug } })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });

  it("a Reset the server refuses keeps the session and says why; one the server already ended counts as done", async () => {
    const { runtime, adapter } = createTestRuntime();
    const original = adapter.pending.resetSession;
    const session = await runtime.session.start();
    const ctx = { command: "resetJudgeSession", rail: null, requestId: null };
    const refusal = new ApiClientError({ code: "FORBIDDEN", status: 403, message: "Not this session." }, ctx);
    (adapter.pending as { resetSession: typeof original }).resetSession = async () => {
      throw refusal;
    };
    await expect(runtime.session.reset()).rejects.toBe(refusal);
    // The server still holds the workspace: nothing pretends it was reset.
    expect(runtime.session.getState()).toEqual({ status: "active", session, error: refusal });
    const notice = stageNoticeFor({
      session: runtime.session.getState(),
      view: undefined,
      autoplay: "off",
      inSession: true,
    });
    expect(notice).toMatchObject({ state: "reset-failed", retry: true });
    expect(notice?.text).toMatch(/^Reset didn't go through/);
    // A 410 (the session already ended on the server) is a reset.
    (adapter.pending as { resetSession: typeof original }).resetSession = async () => {
      throw new ApiClientError({ code: "FRAME_TOKEN_EXPIRED", status: 410, message: "Ended." }, ctx);
    };
    await runtime.session.reset();
    expect(runtime.session.getState()).toEqual({ status: "none", session: null, error: null });
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
