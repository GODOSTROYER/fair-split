import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestRuntime, createTestWorld } from "../test/world.js";
import { SessionStore } from "./session.js";

const TAB_KEY = "fs.judge.tab";

describe("judge tab resume", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores only the session id and run slug and clears them on Reset", async () => {
    const { adapter } = createTestRuntime();
    const store = new SessionStore(adapter, undefined, sessionStorage);
    const session = await store.start();
    expect(JSON.parse(sessionStorage.getItem(TAB_KEY) ?? "null")).toEqual({
      sessionId: session.sessionId,
      runSlug: session.runSlug,
    });
    expect(Object.keys(JSON.parse(sessionStorage.getItem(TAB_KEY) ?? "{}"))).toEqual([
      "sessionId",
      "runSlug",
    ]);
    await store.reset();
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
  });

  it("boots by renewing with the cookie, without starting a new session", async () => {
    const { adapter } = createTestRuntime();
    const initial = new SessionStore(adapter, undefined, sessionStorage);
    const session = await initial.start();
    const request = vi.spyOn(adapter.api, "request");
    const call = vi.spyOn(adapter, "call");
    const resumed = new SessionStore(adapter, undefined, sessionStorage);
    expect(resumed.getState().status).toBe("resuming");
    await expect.poll(() => resumed.getState().status).toBe("active");
    expect(resumed.getState().session).toMatchObject({
      sessionId: session.sessionId,
      runId: session.runId,
      runSlug: session.runSlug,
    });
    expect(call).not.toHaveBeenCalledWith("createJudgeSession", expect.anything());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1/judge/sessions/:sid/renew",
        params: { sid: session.sessionId },
        token: null,
      }),
    );
    await resumed.reset();
  });

  it.each([401, 403, 404, 410])("clears the saved visit after a %s refusal", async (status) => {
    const { adapter } = createTestRuntime(createTestWorld(), [
      http.post("*/v1/judge/sessions/:sid/renew", () =>
        HttpResponse.json(
          {
            status,
            code: status === 403 ? "FORBIDDEN" : "UNAUTHENTICATED",
            message: "Visit ended",
            requestId: "resume-refused",
          },
          { status },
        ),
      ),
    ]);
    sessionStorage.setItem(
      TAB_KEY,
      JSON.stringify({ sessionId: "019a0000-0000-7000-8000-00000000beef", runSlug: "2026A-r99" }),
    );
    const store = new SessionStore(adapter, undefined, sessionStorage);
    await expect.poll(() => store.getState().status).toBe("ended");
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
  });

  it("a blocked storage provider cannot break boot or start", async () => {
    const { adapter } = createTestRuntime();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new SessionStore(adapter, undefined, blocked);
    expect(store.getState().status).toBe("none");
    await expect(store.start()).resolves.toHaveProperty("runSlug");
    await expect(store.reset()).resolves.toBeUndefined();
  });

  it("Reset during cookie resume cannot restore the visit afterwards", async () => {
    const { adapter } = createTestRuntime();
    const created = await adapter.call("createJudgeSession", { body: {} });
    sessionStorage.setItem(
      TAB_KEY,
      JSON.stringify({ sessionId: created.sessionId, runSlug: created.runSlug }),
    );
    let release!: (value: typeof created) => void;
    const answer = new Promise<typeof created>((resolve) => {
      release = resolve;
    });
    vi.spyOn(adapter.api, "request").mockReturnValueOnce(answer as never);
    const store = new SessionStore(adapter, undefined, sessionStorage);
    expect(store.getState().status).toBe("resuming");
    await store.reset();
    release(created);
    await answer;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().status).toBe("none");
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
  });
});
