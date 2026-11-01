// One SSE stream per run, shared by every screen (S3.7): the hub reduces events into the run's query data so
// all surfaces see the same state at once (C-05), and flags history as replay so only live events may start a
// moment (motion is evidence). The session store starts one judge session per press and forgets its token;
// the session's run starts from its own base, never from a showcase read cached under the same slug.

import { ApiClientError } from "@fairsplit/api-client";
import { getResponse, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { stageNoticeFor } from "../chrome/StageNotice.js";
import { recordRequests } from "../test/requests.js";
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

  it("renews the 2-hour console token before it lapses, and at once on FRAME_TOKEN_EXPIRED (the cookie resumes)", async () => {
    // The world's clock runs 2 hours behind, so the token it mints is already within the renewal window.
    const world = createTestWorld({ now: () => new Date(Date.now() - 2 * 60 * 60_000 + 60_000) });
    const log = recordRequests();
    const { runtime } = createTestRuntime(world, [log.handler]);
    const renewed: number[] = [];
    runtime.session.onRenewed(() => renewed.push(Date.now()));
    const session = await runtime.session.start();
    const renewals = () =>
      log.sent.filter(
        (r) => r.method === "POST" && r.path === `/v1/judge/sessions/${session.sessionId}/renew`,
      );
    await expect.poll(() => renewed.length).toBeGreaterThanOrEqual(1);
    expect(log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions")).toHaveLength(1);
    expect(renewals().length).toBeGreaterThanOrEqual(1);
    expect(renewals()[0]?.authorization).toBeNull();
    runtime.session.reset().catch(() => undefined);
  });

  it("a call answered FRAME_TOKEN_EXPIRED renews the token and reopens the streams", async () => {
    const world = createTestWorld();
    const { runtime, adapter } = createTestRuntime(world);
    const session = await runtime.session.start();
    let renewals = 0;
    runtime.session.onRenewed(() => {
      renewals += 1;
    });
    world.failNext("markPaid", "FRAME_TOKEN_EXPIRED");
    await expect(adapter.call("markPaid", { params: { runSlug: session.runSlug } })).rejects.toMatchObject({
      code: "FRAME_TOKEN_EXPIRED",
    });
    await expect.poll(() => renewals).toBe(1);
    expect(runtime.session.getState()).toMatchObject({
      status: "active",
      session: { sessionId: session.sessionId },
    });
    await runtime.session.reset();
  });

  it("a renewal that lands in another workspace ends the session: nothing moves the stage to a new run", async () => {
    // Defend against a malformed renewal answering another workspace even on the resume-only route.
    const world = createTestWorld();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions/:sid/renew", async ({ request }) => {
      starts += 1;
      const answer = await getResponse([...world.mock.handlers], request.clone());
      if (!answer?.ok) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          ...body,
          workspaceId: "019a0000-0000-7000-8000-00000000beef",
          runId: "019a0000-0000-7000-8000-00000000cafe",
          runSlug: "2026A-r38",
          consoleToken: "fst_another-workspace",
        },
        { status: answer.status, headers: answer.headers },
      );
    });
    const log = recordRequests();
    const { runtime, adapter } = createTestRuntime(world, [log.handler, elsewhere]);
    const session = await runtime.session.start();
    let renewed = 0;
    runtime.session.onRenewed(() => {
      renewed += 1;
    });
    await runtime.session.renew();
    expect(starts).toBe(1);
    const state = runtime.session.getState();
    expect(state.status).toBe("ended");
    expect(state.session).toBeNull();
    expect(renewed).toBe(0);
    // The new workspace's token is never adopted: the console holds no credential for it.
    await adapter.call("proof", { params: { runSlug: session.runSlug } }).catch(() => undefined);
    expect(log.sent.at(-1)).toMatchObject({ path: `/v1/proof/${session.runSlug}`, authorization: null });
    // The stage says the session ended, and the next press starts again from the first view.
    const notice = stageNoticeFor({ session: state, view: undefined, autoplay: "off", inSession: false });
    expect(notice).toMatchObject({ state: "session-ended", retry: false });
    expect(notice?.text).toMatch(/ended/);
    runtime.session.dismissError();
    expect(runtime.session.getState().status).toBe("none");
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [410, "FRAME_TOKEN_EXPIRED"],
    [403, "FORBIDDEN"],
  ] as const)(
    "a renewal refused with %s %s ends the session without creating another",
    async (status, code) => {
      const log = recordRequests();
      const refused = http.post("*/v1/judge/sessions/:sid/renew", () =>
        HttpResponse.json({ code, status, message: "Session ended." }, { status }),
      );
      const { runtime, adapter } = createTestRuntime(createTestWorld(), [log.handler, refused]);
      const session = await runtime.session.start();
      await runtime.session.renew();
      expect(runtime.session.getState()).toEqual({ status: "ended", session: null, error: null });
      expect(log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions")).toHaveLength(1);
      await adapter.call("proof", { params: { runSlug: session.runSlug } });
      expect(log.sent.at(-1)?.authorization).toBeNull();
    },
  );

  it("a transient renewal failure keeps the same session for a later retry", async () => {
    const failed = http.post("*/v1/judge/sessions/:sid/renew", () =>
      HttpResponse.json({ code: "INTERNAL", status: 500, message: "Try again." }, { status: 500 }),
    );
    const { runtime } = createTestRuntime(createTestWorld(), [failed]);
    const session = await runtime.session.start();
    await runtime.session.renew();
    expect(runtime.session.getState()).toMatchObject({ status: "active", session });
    await runtime.session.reset();
  });

  it("a call answered 401 UNAUTHENTICATED on the console's token ends the session: a Reset elsewhere revoked it", async () => {
    // fs-api's Reset revokes the workspace's tokens, and a revoked console token is answered 401 UNAUTHENTICATED,
    // not FRAME_TOKEN_EXPIRED: the session is over, not a token to renew (a renewal would mint a new workspace).
    const world = createTestWorld();
    const log = recordRequests();
    const { runtime, adapter } = createTestRuntime(world, [log.handler]);
    const session = await runtime.session.start();
    let renewed = 0;
    runtime.session.onRenewed(() => {
      renewed += 1;
    });
    const starts = () =>
      log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions").length;
    world.failNext("markPaid", "UNAUTHENTICATED");
    await expect(adapter.call("markPaid", { params: { runSlug: session.runSlug } })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    await expect.poll(() => runtime.session.getState().status).toBe("ended");
    expect(runtime.session.getState().session).toBeNull();
    expect(renewed).toBe(0);
    expect(starts()).toBe(1);
    // The revoked token is dropped: the next call carries none.
    await adapter.call("proof", { params: { runSlug: session.runSlug } }).catch(() => undefined);
    expect(log.sent.at(-1)).toMatchObject({ authorization: null });
    const notice = stageNoticeFor({
      session: runtime.session.getState(),
      view: undefined,
      autoplay: "off",
      inSession: false,
    });
    expect(notice).toMatchObject({ state: "session-ended", retry: false });
  });

  it("a 401 UNAUTHENTICATED on a call that did not carry the console's token leaves the session alone", async () => {
    // A brand link or a wrong /ops password is its own credential, refused for itself.
    const world = createTestWorld();
    const { runtime, adapter } = createTestRuntime(world);
    const session = await runtime.session.start();
    world.failNext("proof", "UNAUTHENTICATED");
    await expect(
      adapter.api.proof({ params: { runSlug: session.runSlug }, token: "fsb_not-a-real-link" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.session.getState()).toMatchObject({
      status: "active",
      session: { sessionId: session.sessionId },
    });
    await runtime.session.reset();
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
