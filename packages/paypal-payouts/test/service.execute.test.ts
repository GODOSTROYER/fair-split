import { createHash } from "node:crypto";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  type ApprovedRun,
  batchNote,
  DEFAULT_RETRY_DELAYS_MS,
  PayoutsService,
  type PayoutsServiceDeps,
  type PayPalHttp,
  payPalRequestId,
} from "../src/index.js";
import { referenceBatchDigest } from "./support/digest.js";
import {
  approvedRun,
  batchBody,
  created,
  digestFor,
  duplicateBatch,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  PAYOUT_BATCH_ID,
  paypalError,
  RATE_CARD_SHA256,
} from "./support/fixtures.js";
import { FetchPayPalHttp } from "./support/http.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";

useMsw();

function setup(extra: Partial<PayoutsServiceDeps> = {}) {
  const repo = new MemoryPayoutsRepo();
  const sleeps: number[] = [];
  const service = new PayoutsService({
    http: new FetchPayPalHttp(),
    repo,
    batchDigest: referenceBatchDigest,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { service, repo, sleeps };
}

const posts = () => requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/payments/payouts");

describe("PayoutsService.executeApproved: the approved digest is the payout", () => {
  it("writes the rows as SUBMITTED, then POSTs exactly the register §8 batch", async () => {
    const run = await approvedRun();
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = setup();
    const rowsAtPost: boolean[] = [];
    onPost("/v1/payments/payouts", () => {
      rowsAtPost.push(repo.batches.get(HERO_SENDER_BATCH_ID)?.status === "SUBMITTED");
      return paypalJson(created(), 201, "dbg-201");
    });

    const out = await service.executeApproved(run);

    expect(out).toEqual({
      kind: "created",
      senderBatchId: HERO_SENDER_BATCH_ID,
      payoutBatchId: PAYOUT_BATCH_ID,
      batchStatus: "PENDING",
      batchSha256: digest,
      requestId: payPalRequestId(HERO_SENDER_BATCH_ID),
      debugId: "dbg-201",
      attempts: 1,
      verifiedBy: null,
    });
    expect(rowsAtPost).toEqual([true]);
    expect(repo.types()).toEqual(["writeSubmitted", "markPosted"]);

    const [post] = posts();
    expect(HERO_SENDER_BATCH_ID).toBe(`2026A-${RATE_CARD_SHA256.slice(0, 8)}-r37`);
    expect(post?.headers.get("paypal-request-id")).toBe(
      createHash("sha256").update(HERO_SENDER_BATCH_ID).digest("hex"),
    );
    expect(post?.body).toEqual({
      sender_batch_header: {
        sender_batch_id: HERO_SENDER_BATCH_ID,
        recipient_type: "EMAIL",
        note: `Fair Split 2026-A, batch ${digest.slice(0, 8)}`,
      },
      items: [
        {
          receiver: "m002@example.test",
          amount: { currency: "USD", value: "30.27" },
          sender_item_id: "r37-M-002",
          purpose: "GOODS",
        },
        {
          receiver: "m007@example.test",
          amount: { currency: "USD", value: "62.71" },
          sender_item_id: "r37-M-007",
          purpose: "GOODS",
        },
        {
          receiver: "m014@example.test",
          amount: { currency: "USD", value: "64.45" },
          sender_item_id: "r37-M-014",
          purpose: "GOODS",
        },
        {
          receiver: "m018@example.test",
          amount: { currency: "USD", value: "55.63" },
          sender_item_id: "r37-M-018",
          purpose: "GOODS",
        },
        {
          receiver: "m022@example.test",
          amount: { currency: "USD", value: "34.40" },
          sender_item_id: "r37-M-022",
          purpose: "GOODS",
        },
        {
          receiver: "rhea.no-account@example.test",
          amount: { currency: "USD", value: "26.65" },
          sender_item_id: "r37-M-031",
          purpose: "GOODS",
        },
        {
          receiver: "m039@example.test",
          amount: { currency: "USD", value: "38.32" },
          sender_item_id: "r37-M-039",
          purpose: "GOODS",
        },
        {
          receiver: "m060@example.test",
          amount: { currency: "USD", value: "55.96" },
          sender_item_id: "r37-M-060",
          purpose: "GOODS",
        },
      ],
    });
    const submitted = repo.batches.get(HERO_SENDER_BATCH_ID)?.batch;
    expect(submitted).toMatchObject({ kind: "primary", totalCents: 36_839n, batchSha256: digest });
    expect(submitted?.note).toBe(batchNote("2026-A", digest));
  });

  it("retries a 5xx three times with the same ids, at 1 s, 3 s and 9 s", async () => {
    const run = await approvedRun();
    const { service, sleeps } = setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "An internal server error has occurred."), 500),
        () => paypalJson(paypalError("SERVICE_UNAVAILABLE", "Service Unavailable."), 503),
        () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "An internal server error has occurred."), 502),
        () => paypalJson(created(), 201),
      ),
    );

    const out = await service.executeApproved(run);

    expect(out).toMatchObject({ kind: "created", attempts: 4 });
    expect(sleeps).toEqual([...DEFAULT_RETRY_DELAYS_MS]);
    const sent = posts();
    expect(sent).toHaveLength(4);
    expect(new Set(sent.map((r) => r.headers.get("paypal-request-id")))).toEqual(
      new Set([payPalRequestId(HERO_SENDER_BATCH_ID)]),
    );
    expect(new Set(sent.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("leaves the rows SUBMITTED and reports unresolved when every retry fails", async () => {
    const run = await approvedRun();
    const { service, repo } = setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500, "dbg-500"),
    );

    const out = await service.executeApproved(run);

    expect(out).toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 4,
      lastStatus: 500,
      debugId: "dbg-500",
    });
    expect(repo.types()).toEqual(["writeSubmitted"]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("after a timeout retries with the same id and adopts the batch the first attempt created", async () => {
    const run = await approvedRun();
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => HttpResponse.error(),
        () => paypalJson(duplicateBatch(), 400, "dbg-dup"),
      ),
    );
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(HERO_LINES, { digest }), 200, "dbg-get"));

    const out = await service.executeApproved(run);

    expect(out).toMatchObject({
      kind: "adopted",
      payoutBatchId: PAYOUT_BATCH_ID,
      verifiedBy: "items",
      attempts: 2,
      debugId: "dbg-get",
    });
    expect(posts()).toHaveLength(2);
    const get = requests.find((r) => r.method === "GET");
    expect(get?.url.pathname).toBe(`/v1/payments/payouts/${PAYOUT_BATCH_ID}`);
    expect(Object.fromEntries(get?.url.searchParams ?? [])).toEqual({
      page: "1",
      page_size: "1000",
      total_required: "true",
    });
    expect(repo.events.at(-1)).toMatchObject({ type: "markPosted", outcome: "adopted" });
  });

  it("adopts on 'already exists' by the header total while PayPal lists no items yet", async () => {
    const run = await approvedRun();
    const { service } = setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(HERO_LINES, { listItems: false })));
    await expect(service.executeApproved(run)).resolves.toMatchObject({
      kind: "adopted",
      verifiedBy: "header",
    });
  });

  it("refuses to adopt a batch whose items differ from the approved digest (HALT)", async () => {
    const run = await approvedRun();
    const { service, repo } = setup();
    const tampered = HERO_LINES.map((l, i) => (i === 0 ? { ...l, receiver: "attacker@example.test" } : l));
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(tampered)));

    const out = await service.executeApproved(run);

    expect(out).toMatchObject({ kind: "refused", code: "ADOPT_FAILED" });
    expect(repo.types()).toEqual(["writeSubmitted"]);
  });

  it("refuses to adopt a batch filed under another sender_batch_id, or with no link to follow", async () => {
    const run = await approvedRun();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(batchBody(HERO_LINES, { sbid: "2026A-00000000-r37" })),
    );
    await expect(setup().service.executeApproved(run)).resolves.toMatchObject({ code: "ADOPT_FAILED" });

    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(PAYOUT_BATCH_ID, false), 400));
    await expect(setup().service.executeApproved(run)).resolves.toMatchObject({
      code: "ADOPT_FAILED",
      reason: "PayPal says the batch exists but gave no link to it",
    });
  });

  it("treats a synchronous 4xx as a rejection, without retrying (ERRPYO005 INSUFFICIENT_FUNDS)", async () => {
    const run = await approvedRun();
    const { service, repo, sleeps } = setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("INSUFFICIENT_FUNDS", "Sender does not have sufficient funds."), 422, "dbg-422"),
    );

    const out = await service.executeApproved(run);

    expect(out).toEqual({
      kind: "rejected",
      senderBatchId: HERO_SENDER_BATCH_ID,
      status: 422,
      name: "INSUFFICIENT_FUNDS",
      message: "Sender does not have sufficient funds.",
      debugId: "dbg-422",
    });
    expect(posts()).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(repo.types()).toEqual(["writeSubmitted", "markRejected"]);
  });

  it("a 429 opens the circuit: no retry, nothing created", async () => {
    const run = await approvedRun();
    const { service } = setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("RATE_LIMIT_REACHED", "Too many requests."), 429),
    );
    await expect(service.executeApproved(run)).resolves.toMatchObject({
      kind: "refused",
      code: "CIRCUIT_OPEN",
    });
    expect(posts()).toHaveLength(1);
  });

  it("on a 401 invalidates the shared token and retries once", async () => {
    const run = await approvedRun();
    const invalidate = vi.fn();
    const { service } = setup({ auth: { invalidate } });
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson({ name: "AUTHENTICATION_FAILURE", message: "Authentication failed" }, 401),
        () => paypalJson(created(), 201),
      ),
    );
    await expect(service.executeApproved(run)).resolves.toMatchObject({ kind: "created", attempts: 2 });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("also retries when PayPalHttp reports a timeout as a retryable result instead of throwing", async () => {
    const run = await approvedRun();
    const results = [
      {
        ok: false as const,
        status: 0,
        name: "TIMEOUT",
        message: "timed out",
        details: [],
        links: [],
        debugId: null,
        retryable: true,
        ms: 15_000,
      },
      { ok: true as const, status: 201, body: created(), debugId: "dbg-ok", ms: 120 },
    ];
    const request = vi.fn(async () => results.shift());
    const { service, sleeps } = setup({ http: { request } as unknown as PayPalHttp });
    await expect(service.executeApproved(run)).resolves.toMatchObject({
      kind: "created",
      debugId: "dbg-ok",
      attempts: 2,
    });
    expect(sleeps).toEqual([1_000]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("PayoutsService.executeApproved: refusals send nothing", () => {
  const expectNothingSent = (repo: MemoryPayoutsRepo) => {
    expect(requests).toHaveLength(0);
    expect(repo.events).toHaveLength(0);
  };

  it("inv.i4.digest-is-payout: a line edited after signing is refused", async () => {
    const run = await approvedRun();
    const edited: ApprovedRun = {
      ...run,
      lines: run.lines.map((l) => (l.memberNo === "M-014" ? { ...l, amountCents: l.amountCents + 1n } : l)),
    };
    const { service, repo } = setup();
    await expect(service.executeApproved(edited)).resolves.toEqual({
      kind: "refused",
      code: "DIGEST_MISMATCH",
      reason: "The batch changed after it was signed. Nothing was sent.",
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expectNothingSent(repo);
  });

  it("inv.i4.digest-is-payout: the Chair and the treasurer must have signed the same digest", async () => {
    const digest = await digestFor(HERO_LINES);
    const other = await digestFor(HERO_LINES.slice(1));
    const run = await approvedRun(HERO_LINES, [
      { role: "TREASURER", batchSha256: digest },
      { role: "CHAIR", batchSha256: other },
    ]);
    const { service, repo } = setup();
    await expect(service.executeApproved(run)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
    expectNothingSent(repo);
  });

  it("refuses when the kill switch is on (read fresh)", async () => {
    const killSwitch = vi.fn(async () => true);
    const { service, repo } = setup({ killSwitch });
    await expect(service.executeApproved(await approvedRun())).resolves.toMatchObject({
      code: "KILL_SWITCH_ON",
    });
    expect(killSwitch).toHaveBeenCalledTimes(1);
    expectNothingSent(repo);
  });

  it("refuses without the treasurer's approval", async () => {
    const digest = await digestFor(HERO_LINES);
    const run = await approvedRun(HERO_LINES, [{ role: "CHAIR", batchSha256: digest }]);
    const { service, repo } = setup();
    await expect(service.executeApproved(run)).resolves.toMatchObject({ code: "APPROVALS_MISSING" });
    expectNothingSent(repo);
  });

  it.each([
    ["a phone receiver (recipient_type is EMAIL only)", { receiver: "+15555550100" }],
    ["a PHP line", { currency: "PHP" }],
    ["a zero amount", { amountCents: 0n }],
    ["a negative amount", { amountCents: -5n }],
  ])("refuses %s", async (_label, patch) => {
    const lines = HERO_LINES.map((l, i) => (i === 0 ? ({ ...l, ...patch } as typeof l) : l));
    const { service, repo } = setup();
    await expect(service.executeApproved(await approvedRun(lines))).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    expectNothingSent(repo);
  });

  it("refuses a member listed twice and an empty batch", async () => {
    const { service, repo } = setup();
    const twice = [...HERO_LINES, { ...(HERO_LINES[0] as (typeof HERO_LINES)[number]), lineId: "dup" }];
    await expect(service.executeApproved(await approvedRun(twice))).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    const empty = { ...(await approvedRun()), lines: [] };
    await expect(service.executeApproved(empty)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    expectNothingSent(repo);
  });

  it("applies the sandbox guards: batch cap, item cap and known receivers", async () => {
    const run = await approvedRun();
    const capped = setup({ limits: { maxBatchTotalCents: 36_838n } });
    await expect(capped.service.executeApproved(run)).resolves.toMatchObject({ code: "SANDBOX_GUARD" });
    const few = setup({ limits: { maxItems: 7 } });
    await expect(few.service.executeApproved(run)).resolves.toMatchObject({ code: "SANDBOX_GUARD" });
    const known = setup({ limits: { receiverAllowed: (r) => r !== "rhea.no-account@example.test" } });
    await expect(known.service.executeApproved(run)).resolves.toMatchObject({
      code: "SANDBOX_GUARD",
      reason: "r37-M-031: the receiver is not a known sandbox account",
    });
    expect(requests).toHaveLength(0);
  });

  it("passes the guards at exactly the cap", async () => {
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    const { service } = setup({ limits: { maxBatchTotalCents: 36_839n, maxItems: 8 } });
    await expect(service.executeApproved(await approvedRun())).resolves.toMatchObject({ kind: "created" });
  });

  it("refuses a malformed rate-card hash or run number", async () => {
    const run = await approvedRun();
    const { service, repo } = setup();
    await expect(service.executeApproved({ ...run, rateCardSha256: "7f3a91c2" })).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    await expect(service.executeApproved({ ...run, runSeq: 0 })).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    expectNothingSent(repo);
  });
});
