// The console's adapter over @fairsplit/api-client, against api-client's seeded mock of fs-api: over HTTP
// through msw/node (the handlers `vite dev` serves through its service worker) and in memory (component tests,
// and dev where no service worker registers). Every command is the typed client's, the run's SSE stream replays
// from Last-Event-ID and reports the console's StreamStatus, failures are typed, and the pending routes (frame
// tokens, Reset, the rail label) are served. No live API: msw fails anything unhandled.

import { ApiClientError, ContractError, judgeRoutes, NetworkError } from "@fairsplit/api-client";
import type { RunEvent } from "@fairsplit/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockServer } from "../test/msw.js";
import {
  createTestHttpAdapter,
  createTestRuntime,
  createTestWorld,
  seedSnapshot,
  type TestWorld,
} from "../test/world.js";
import type { DataAdapter, StreamStatus } from "./adapter.js";
import { closeReasonOf, createApiAdapter, railFromLabel, reconnectBound } from "./api.js";
import { asRateCardRatified, errorView, isApiClientError, NOT_BUILT_WORDS } from "./errors.js";
import { createMemoryFetch } from "./mock/memory.js";

const snapshot = seedSnapshot();

async function startSession(adapter: DataAdapter) {
  const session = await adapter.call("createJudgeSession", { body: {} });
  adapter.setToken(session.consoleToken);
  return session;
}

describe("adapter over HTTP (msw/node)", () => {
  let world: TestWorld;
  let server: { close(): void };
  let adapter: DataAdapter;

  beforeEach(() => {
    world = createTestWorld();
    server = startMockServer(world);
    adapter = createTestHttpAdapter();
  });

  afterEach(() => {
    server.close();
    world.dispose();
  });

  it("starts a judge session and funds the run, all inside the contract", async () => {
    const session = await startSession(adapter);
    expect(session.runSlug).toBe(snapshot.run.runSlug);
    const paid = await adapter.call("markPaid", { params: { runSlug: session.runSlug } });
    expect(paid).toMatchObject({ invoiceStatus: "MARKED_AS_PAID", runState: "FUNDED" });
    expect(adapter.api.rail).toBe("simulated");
  });

  it("refuses a command without a session with a typed 401", async () => {
    const failure = await adapter.call("markPaid", { params: { runSlug: "2026A-r37" } }).catch((e) => e);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(isApiClientError(failure, "UNAUTHENTICATED")).toBe(true);
    expect(failure).toMatchObject({ status: 401, command: "markPaid" });
    expect(errorView(failure).refs.join(" ")).toMatch(/^Request /);
  });

  it("a request outside its schema is refused at the boundary (400 VALIDATION_FAILED)", async () => {
    await startSession(adapter);
    const failure = await adapter
      .call("enterField", { params: { fieldId: world.fieldId() }, body: { value: "" } } as never)
      .catch((e) => e);
    expect(isApiClientError(failure, "VALIDATION_FAILED")).toBe(true);
  });

  it("MM-4: adding a deduction to the ratified card is a 409 that cites the card's hash", async () => {
    await startSession(adapter);
    const failure = await adapter
      .call("addDeduction", {
        params: { id: snapshot.rateCard.id },
        body: { label: "Multa", amountText: "200" },
      })
      .catch((e) => e);
    expect(failure).toMatchObject({ status: 409, code: "RATE_CARD_RATIFIED" });
    expect(asRateCardRatified(failure)?.hash).toBe(snapshot.rateCard.sha256);
    expect(errorView(failure).title).toMatch(/ratified/);
  });

  it("a hard-to-reach refusal is one line away, and reads in the console's words", async () => {
    const session = await startSession(adapter);
    world.failNext("markPaid", "KILL_SWITCH_ON");
    const failure = await adapter.call("markPaid", { params: { runSlug: session.runSlug } }).catch((e) => e);
    expect(errorView(failure)).toMatchObject({ code: "KILL_SWITCH_ON", paypal: false });
    world.failNext("payCash", "PAYPAL_REJECTED");
    const paypal = await adapter
      .call("payCash", { params: { lineId: world.lineId("M-022") } })
      .catch((e) => e);
    expect(errorView(paypal)).toMatchObject({ code: "PAYPAL_REJECTED", paypal: true });
  });

  it("streams the run's events, replays from Last-Event-ID, and reports the console's stream status", async () => {
    const session = await startSession(adapter);
    world.markPaid();
    const all = world.eventsAfter(null);
    const middle = all[Math.floor(all.length / 2)];
    if (!middle) throw new Error("no events");
    const received: RunEvent[] = [];
    const statuses: StreamStatus["kind"][] = [];
    const stop = adapter.subscribe(
      { kind: "run", runSlug: session.runSlug },
      { onEvent: (e) => received.push(e), onStatus: (s) => statuses.push(s.kind) },
      { lastEventId: middle.id },
    );
    await expect
      .poll(() => received.length, { timeout: 5000 })
      .toBe(all.filter((e) => Number(e.id) > Number(middle.id)).length);
    expect(statuses.slice(0, 2)).toEqual(["connecting", "open"]);
    // A live event arrives on the open stream.
    world.enterByHand();
    world.resolve("H1");
    await expect.poll(() => received.some((e) => e.type === "hold.resolved"), { timeout: 5000 }).toBe(true);
    stop();
    expect(statuses.at(-1)).toBe("closed");
    expect(received.every((e) => Number(e.id) > Number(middle.id))).toBe(true);
  });

  it("stops for good when the credential or the run is refused, instead of hammering the server", async () => {
    const statuses: StreamStatus[] = [];
    adapter.subscribe(
      { kind: "run", runSlug: "2026A-r37" },
      { onEvent: () => undefined, onStatus: (s) => statuses.push(s) },
    );
    await expect.poll(() => statuses.at(-1)).toEqual({ kind: "closed", reason: "expired" });
    await startSession(adapter);
    const missing: StreamStatus[] = [];
    adapter.subscribe(
      { kind: "run", runSlug: "2026A-r99" },
      { onEvent: () => undefined, onStatus: (s) => missing.push(s) },
    );
    await expect.poll(() => missing.at(-1)).toEqual({ kind: "closed", reason: "not-found" });
  });

  it("reads Proof in public, member IDs only (C-23)", async () => {
    const proof = await adapter.call("proof", { params: { runSlug: "2026A-r37" } });
    expect(proof.redacted).toBe(true);
    const json = await adapter.call("proofJson", { params: { runSlug: "2026A-r37" } });
    expect(json.bundle).toEqual(proof.bundle);
  });

  it("mints frame tokens for the three personas, each one the world knows as that person", async () => {
    const session = await startSession(adapter);
    const chair = await adapter.pending.frameToken(session.sessionId, "chair");
    expect(chair).toMatchObject({ persona: "board:ernesto", ws: session.workspaceId });
    expect(chair.exp).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(world.callerOf(chair.token)).toMatchObject({ persona: "ernesto", role: "board" });
    const member = await adapter.pending.frameToken(session.sessionId, "member");
    expect(member.persona).toBe("member:M-014");
    expect(world.callerOf(member.token)).toMatchObject({ role: "member" });
    const refused = await adapter.pending.frameToken("not-a-session", "clerk").catch((e) => e);
    expect(isApiClientError(refused, "FORBIDDEN")).toBe(true);
  });

  it("sends Reset and frame tokens with the judge cookie only: fs-api refuses the console's bearer there (403)", async () => {
    const session = await startSession(adapter);
    // As fs-api's requireOwnSession: a bearer wins over the cookie and is not a judge_session credential.
    for (const path of [
      `/v1/judge/sessions/${session.sessionId}/frames`,
      `/v1/judge/sessions/${session.sessionId}/reset`,
      `/v1/judge/sessions/${session.sessionId}/renew`,
    ]) {
      const withBearer = await adapter.api
        .request({ method: "POST", path, body: { persona: "board:ernesto" }, name: "probe" })
        .catch((e) => e);
      expect(isApiClientError(withBearer, "FORBIDDEN")).toBe(true);
    }
    // The adapter's own calls carry no bearer, so they go through with the console's token set.
    await expect(adapter.pending.frameToken(session.sessionId, "clerk")).resolves.toMatchObject({
      persona: "clerk:jessie",
    });
    await expect(adapter.pending.resetSession(session.sessionId)).resolves.toBeUndefined();
  });

  it("renewal resumes only the cookie's session and preserves the run", async () => {
    const session = await startSession(adapter);
    const routes = judgeRoutes(adapter.api);
    await expect(
      routes.renewJudgeSession({ params: { sid: session.sessionId }, token: null }),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      runId: session.runId,
      runSlug: session.runSlug,
      consoleToken: session.consoleToken,
    });
    await expect(
      routes.renewJudgeSession({ params: { sid: "019a0000-0000-7000-8000-00000000beef" }, token: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("Reset returns the world to the first press and ends the console's credential", async () => {
    const session = await startSession(adapter);
    await adapter.call("markPaid", { params: { runSlug: session.runSlug } });
    await adapter.pending.resetSession(session.sessionId);
    expect(world.run.state).toBe("INVOICED");
    expect(world.events()).toEqual([]);
  });

  it("labels PayPal by the rail the API reports (I8)", async () => {
    await expect(adapter.pending.paypalRail()).resolves.toBe("simulator");
  });
});

describe("adapter in memory (msw handlers, no interception)", () => {
  it("answers like HTTP, and an unsubscribe releases the mock's stream", async () => {
    const { adapter, world } = createTestRuntime();
    const session = await startSession(adapter);
    expect(adapter.source).toBe("mock");
    const received: string[] = [];
    const statuses: StreamStatus["kind"][] = [];
    const stop = adapter.subscribe(
      { kind: "run", runSlug: session.runSlug },
      { onEvent: (e) => received.push(e.type), onStatus: (s) => statuses.push(s.kind) },
    );
    // A twin stream that stays open: every event the world emits reaches it, so it says when they have landed.
    const twin: string[] = [];
    const twinStatuses: StreamStatus["kind"][] = [];
    const stopTwin = adapter.subscribe(
      { kind: "run", runSlug: session.runSlug },
      { onEvent: (e) => twin.push(e.id), onStatus: (s) => twinStatuses.push(s.kind) },
    );
    await expect.poll(() => statuses.includes("open") && twinStatuses.includes("open")).toBe(true);
    await adapter.call("markPaid", { params: { runSlug: session.runSlug } });
    await expect.poll(() => received.includes("run.state")).toBe(true);
    stop();
    const count = received.length;
    const before = world.events().length;
    world.settle(); // the reading plays after the stream closed: nothing more arrives
    const after = world.events().length;
    expect(after).toBeGreaterThan(before);
    // Once the open twin holds every event the reading emitted, a stream still open would hold them too.
    await expect.poll(() => twin.length).toBe(after);
    stopTwin();
    expect(received.length).toBe(count);
    expect(statuses.at(-1)).toBe("closed");
    expect(statuses.filter((s) => s === "closed")).toHaveLength(1);
  });

  it("a request no handler answers fails like a refused connection, never the network", async () => {
    const fetchImpl = createMemoryFetch([]);
    await expect(fetchImpl("/v1/nowhere")).rejects.toThrow(/No mock answers GET \/v1\/nowhere/);
    const adapter = createApiAdapter({
      source: "mock",
      fetch: fetchImpl,
      snapshot: async () => snapshot,
      paypalRail: "sandbox",
    });
    const failure = await adapter.call("proof", { params: { runSlug: "2026A-r37" } }).catch((e) => e);
    expect(failure).toBeInstanceOf(NetworkError);
    expect(errorView(failure).title).toMatch(/connection failed/);
    // No /healthz answer: the build's label stands.
    await expect(adapter.pending.paypalRail()).resolves.toBe("sandbox");
  });

  it("an aborted call ends as aborted, before anything is sent", async () => {
    const { adapter } = createTestRuntime();
    const controller = new AbortController();
    controller.abort();
    const failure = await adapter
      .call("proof", { params: { runSlug: "2026A-r37" } }, { signal: controller.signal })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(NetworkError);
    expect((failure as NetworkError).aborted).toBe(true);
    expect(errorView(failure).title).toMatch(/cancelled/);
  });
});

describe("adapter helpers", () => {
  it("maps the rail label, the reconnect bound and the final close reason", () => {
    expect(railFromLabel("simulated")).toBe("simulator");
    expect(railFromLabel("sandbox")).toBe("sandbox");
    expect([0, 1, 2, 3, 4, 8].map(reconnectBound)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    const ctx = { command: "SSE /v1/runs/2026A-r37/events", rail: null, requestId: null };
    const at = (status: number, code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND") =>
      new ApiClientError({ code, status, message: code }, ctx);
    expect(closeReasonOf(at(401, "UNAUTHENTICATED"))).toBe("expired");
    expect(closeReasonOf(at(403, "FORBIDDEN"))).toBe("unauthorized");
    expect(closeReasonOf(at(404, "NOT_FOUND"))).toBe("not-found");
  });

  it("says a 501 is a step not wired yet, and a contract drift is the server's shape, not the user's fault", () => {
    const notBuilt = new ApiClientError(
      {
        code: "INTERNAL",
        status: 501,
        message: "markPaid is not implemented yet.",
        details: { reason: "NOT_IMPLEMENTED" },
      },
      { command: "markPaid", rail: "simulated", requestId: "req_1" },
    );
    expect(errorView(notBuilt).title).toBe(NOT_BUILT_WORDS);
    const drift = new ContractError(
      "proof",
      200,
      "answered a body that does not match its contract",
      [],
      "req_2",
    );
    expect(errorView(drift)).toMatchObject({
      code: null,
      paypal: false,
      refs: ["Request req_2", "HTTP 200"],
    });
  });

  it("never sends a credential in a URL: the token rides in a header", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const world = createTestWorld();
    const memory = createMemoryFetch(world.mock.handlers);
    const adapter = createApiAdapter({
      source: "mock",
      fetch: async (input, init) => {
        seen.push({ url: input, auth: new Headers(init?.headers).get("authorization") });
        return memory(input, init);
      },
      snapshot: async () => snapshot,
      paypalRail: "simulator",
    });
    const session = await startSession(adapter);
    await adapter.call("markPaid", { params: { runSlug: session.runSlug } });
    const last = seen.at(-1);
    expect(last?.auth).toBe(`Bearer ${session.consoleToken}`);
    expect(seen.every((s) => !s.url.includes(session.consoleToken))).toBe(true);
    vi.restoreAllMocks();
  });
});
