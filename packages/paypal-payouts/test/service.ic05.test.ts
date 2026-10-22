// PayoutsService against WS-PPCORE's real IC-05 PayPalHttp (@fairsplit/paypal-core, on main since
// 23 Oct). That client retries idempotent calls (GETs, and anything carrying a PayPal-Request-Id) on its
// own at 1, 3 and 9 s, reports limiter, circuit, OAuth and local refusals as failures with status 0 and
// `delivery: "not_sent"`, and puts links without a `method`. The service owns the retries of the
// money-moving POSTs, re-reading the kill switch before each, so it must ask the client never to repeat
// them, and it must not mistake "nothing was sent" for a lost response. The scripted results below carry
// the real types; the last block drives the real client itself into each refusal.

import type { LimiterDecision, PayPalLimiter } from "@fairsplit/paypal-core";
import { describe, expect, it } from "vitest";
import {
  type Actor,
  type PayPalFailure,
  type PayPalFailureKind,
  type PayPalHttp,
  type PayPalRequest,
  type PayPalResult,
  type PayPalSuccess,
  payPalRequestId,
} from "../src/index.js";
import {
  created,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  itemBody,
  postingSnapshot,
  RHEA_ITEM_ID,
  RUN_FACTS,
  rheaRow,
} from "./support/fixtures.js";
import { fixedAuth, RealPayPalHttp, TEST_TOKEN } from "./support/http.js";
import { onPost, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { makeService } from "./support/service.js";

useMsw();

const ANALYN: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };

/** A failure exactly as WS-PPCORE's createPayPalHttp returns it (every field, links without method). */
function ic05Failure(
  kind: PayPalFailureKind,
  over: { status?: number; name?: string; delivery?: PayPalFailure["delivery"] } = {},
): PayPalFailure {
  const local =
    kind === "limited" || kind === "circuit_open" || kind === "auth" || kind === "invalid_request";
  return {
    ok: false,
    kind,
    status: over.status ?? 0,
    name:
      over.name ??
      {
        http: "INTERNAL_SERVER_ERROR",
        timeout: "FS_TIMEOUT",
        network: "FS_NETWORK_ERROR",
        limited: "FS_LIMITER_DENIED",
        circuit_open: "FS_CIRCUIT_OPEN",
        auth: "FS_AUTH_FAILED",
        invalid_request: "FS_INVALID_REQUEST",
      }[kind],
    message: `${kind} (test)`,
    details: [{ issue: "TEST", description: "scripted" }],
    links: [
      { href: "https://developer.paypal.com/docs/api/payments.payouts-batch/v1/", rel: "information_link" },
    ],
    debugId: null,
    retryable: kind !== "invalid_request",
    retryAfterMs: kind === "limited" || kind === "circuit_open" ? 40_000 : null,
    delivery: over.delivery ?? (local ? "not_sent" : "unknown"),
    ms: 3,
    attempts: local ? 0 : 1,
    requestId: null,
  };
}

const ok = <T>(body: T, status = 201): PayPalSuccess<T> => ({
  ok: true,
  status,
  body,
  debugId: "dbg-ok",
  ms: 120,
  attempts: 1,
  requestId: null,
});

/** Plays scripted IC-05 results in order and records every request it was given. */
function scripted(...results: PayPalResult<unknown>[]) {
  const calls: PayPalRequest[] = [];
  const http: PayPalHttp = {
    async request<T>(r: PayPalRequest): Promise<PayPalResult<T>> {
      calls.push(r);
      const next = results.shift();
      if (!next) throw new Error(`unscripted ${r.method} ${r.path}`);
      return next as PayPalResult<T>;
    },
  };
  return { http, calls };
}

async function postingService(http: PayPalHttp) {
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
  return { repo, ...makeService(repo, { http }) };
}

describe("PayoutsService on the real IC-05 PayPalHttp: create_payout_batch", () => {
  it("asks PayPalHttp never to repeat the POST itself: the service owns the retries and the kill switch", async () => {
    const { http, calls } = scripted(ok(created()));
    const { service } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({ kind: "created" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v1/payments/payouts",
      requestId: payPalRequestId(HERO_SENDER_BATCH_ID),
      purpose: "payouts.create",
      priority: "live",
      idempotent: false,
    });
  });

  it("a limiter refusal sent nothing: QUEUED at once, rows SUBMITTED, and the next call resumes the same ids", async () => {
    const { http, calls } = scripted(ic05Failure("limited"), ok(created()));
    const { service, repo, sleeps } = await postingService(http);

    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "refused",
      code: "QUEUED",
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");

    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "created",
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expect(new Set(calls.map((c) => c.requestId))).toEqual(new Set([payPalRequestId(HERO_SENDER_BATCH_ID)]));
    expect(repo.types()).toEqual(["writeSubmitted", "markPosted"]);
  });

  it("an open 429 circuit sent nothing: CIRCUIT_OPEN at once, no retry", async () => {
    const { http, calls } = scripted(ic05Failure("circuit_open"));
    const { service, sleeps } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "refused",
      code: "CIRCUIT_OPEN",
    });
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("no OAuth token: unresolved AUTH_FAILED, nothing sent, no retry", async () => {
    const { http } = scripted(ic05Failure("auth"));
    const { service, sleeps } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "AUTH_FAILED",
      attempts: 1,
    });
    expect(sleeps).toEqual([]);
  });

  it("a request PayPalHttp refused locally is not retried: INVALID_BATCH", async () => {
    const { http, calls } = scripted(ic05Failure("invalid_request"));
    const { service, sleeps } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "refused",
      code: "INVALID_BATCH",
    });
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("a timeout may have reached PayPal: retried with the same ids, then created", async () => {
    const { http, calls } = scripted(ic05Failure("timeout"), ok(created()));
    const { service, sleeps } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "created",
      attempts: 2,
    });
    expect(sleeps).toEqual([1_000]);
    expect(calls.map((c) => c.requestId)).toEqual([
      payPalRequestId(HERO_SENDER_BATCH_ID),
      payPalRequestId(HERO_SENDER_BATCH_ID),
    ]);
  });
});

describe("PayoutsService on the real IC-05 PayPalHttp: cancel_unclaimed_payout_item", () => {
  const cancelService = (http: PayPalHttp) => {
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    return { repo, ...makeService(repo, { http }) };
  };

  it("names its calls as paypal_calls does and never lets PayPalHttp repeat the cancel", async () => {
    const { http, calls } = scripted(
      ic05Failure("http", { status: 400, name: "VALIDATION_ERROR", delivery: "received" }),
      ok(itemBody("RETURNED"), 200),
    );
    const { service } = cancelService(http);
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "RETURNED",
    });
    expect(calls.map((c) => [c.method, c.path, c.purpose, c.idempotent])).toEqual([
      ["POST", `/v1/payments/payouts-item/${RHEA_ITEM_ID}/cancel`, "payouts.item.cancel", false],
      ["GET", `/v1/payments/payouts-item/${RHEA_ITEM_ID}`, "payouts.item.get", undefined],
    ]);
  });

  it.each([
    ["a limiter refusal", ic05Failure("limited"), "QUEUED"],
    ["an open circuit", ic05Failure("circuit_open"), "CIRCUIT_OPEN"],
    [
      "a 429",
      ic05Failure("http", { status: 429, name: "RATE_LIMIT_REACHED", delivery: "received" }),
      "CIRCUIT_OPEN",
    ],
  ])(
    "%s on the cancel is refused at once, the intent kept for a later try",
    async (_label, failure, code) => {
      const { http, calls } = scripted(failure);
      const { service, repo, sleeps } = cancelService(http);
      await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
        kind: "REFUSED",
        payoutItemId: RHEA_ITEM_ID,
        code,
      });
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
      expect(repo.items.get(RHEA_ITEM_ID)).toMatchObject({ cancelIntent: "cash", status: "UNCLAIMED" });
    },
  );
});

describe("PayoutsService on the real client itself: each refusal arrives as what it is", () => {
  const refusing = (reason: Extract<LimiterDecision, { ok: false }>["reason"]): PayPalLimiter => ({
    take: async () => ({ ok: false, reason, retryAfterMs: 40_000 }),
  });

  it.each([
    ["a full limiter window", "WINDOW_FULL", "QUEUED"],
    ["the background share", "BACKGROUND_SHARE_FULL", "QUEUED"],
    ["an open 429 circuit", "CIRCUIT_OPEN", "CIRCUIT_OPEN"],
  ] as const)("%s sends nothing: refused %s, rows SUBMITTED for a resume", async (_label, reason, code) => {
    const { service, repo, sleeps } = await postingService(new RealPayPalHttp({ limiter: refusing(reason) }));
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "refused",
      code,
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expect(requests).toHaveLength(0);
    expect(sleeps).toEqual([]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("a token cache that cannot produce a token sends nothing: unresolved AUTH_FAILED", async () => {
    const auth = {
      ...fixedAuth(),
      token: async () => Promise.reject(new Error("PayPal OAuth unreachable")),
    };
    const { service, sleeps } = await postingService(new RealPayPalHttp({ auth }));
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "AUTH_FAILED",
      attempts: 1,
      lastStatus: 0,
    });
    expect(requests).toHaveLength(0);
    expect(sleeps).toEqual([]);
  });

  it("a cancel the limiter refuses keeps the intent and sends nothing", async () => {
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    const { service } = makeService(repo, { http: new RealPayPalHttp({ limiter: refusing("WINDOW_FULL") }) });
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "REFUSED",
      payoutItemId: RHEA_ITEM_ID,
      code: "QUEUED",
    });
    expect(requests).toHaveLength(0);
    expect(repo.items.get(RHEA_ITEM_ID)).toMatchObject({ cancelIntent: "cash", status: "UNCLAIMED" });
  });

  it("a 201 through the real client is posted once with the batch's own request id", async () => {
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201, "dbg-201"));
    const http = new RealPayPalHttp();
    const { service } = await postingService(http);
    await expect(service.executeApproved(RUN_FACTS.runId)).resolves.toMatchObject({
      kind: "created",
      debugId: "dbg-201",
    });
    expect(requests.map((r) => [r.method, r.url.pathname, r.headers.get("paypal-request-id")])).toEqual([
      ["POST", "/v1/payments/payouts", payPalRequestId(HERO_SENDER_BATCH_ID)],
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(http.calls.map((c) => c.idempotent)).toEqual([false]);
  });
});
