import { createHash } from "node:crypto";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  type ApprovedLine,
  batchNote,
  DEFAULT_RETRY_DELAYS_MS,
  PayoutsService,
  type PayoutsServiceDeps,
  type PayPalHttp,
  type PayPalResult,
  payPalRequestId,
} from "../src/index.js";
import {
  approve,
  CHAIR,
  makeSigner,
  registeredKeyVerifier,
  STRANGER,
  TREASURER,
} from "./support/approvals.js";
import { referenceBatchDigest } from "./support/digest.js";
import {
  approvalsFor,
  batchBody,
  created,
  digestFor,
  duplicateBatch,
  EXP,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  NOW,
  PAYOUT_BATCH_ID,
  paypalError,
  postingSnapshot,
  RATE_CARD_SHA256,
  RUN_FACTS,
} from "./support/fixtures.js";
import { fixedAuth, RealPayPalHttp, TEST_TOKEN } from "./support/http.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { JUDGE_LIMITS, makeService } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;

async function setup(
  snapshot?: Parameters<typeof postingSnapshot>[1] & { lines?: readonly ApprovedLine[] },
  extra: Partial<PayoutsServiceDeps> = {},
) {
  const { lines, ...rest } = snapshot ?? {};
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(lines ?? HERO_LINES, rest)] });
  return { repo, ...makeService(repo, extra) };
}

const posts = () => requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/payments/payouts");

describe("PayoutsService.executeApproved(runId): the approved digest is the payout", () => {
  it("re-reads the run, writes the rows as SUBMITTED, then POSTs exactly the register §8 batch", async () => {
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = await setup();
    const rowsAtPost: boolean[] = [];
    onPost("/v1/payments/payouts", () => {
      rowsAtPost.push(repo.batches.get(HERO_SENDER_BATCH_ID)?.status === "SUBMITTED");
      return paypalJson(created(), 201, "dbg-201");
    });

    const out = await service.executeApproved(RUN_ID);

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
        ["m002@example.test", "30.27", "r37-M-002"],
        ["m007@example.test", "62.71", "r37-M-007"],
        ["m014@example.test", "64.45", "r37-M-014"],
        ["m018@example.test", "55.63", "r37-M-018"],
        ["m022@example.test", "34.40", "r37-M-022"],
        ["rhea.no-account@example.test", "26.65", "r37-M-031"],
        ["m039@example.test", "38.32", "r37-M-039"],
        ["m060@example.test", "55.96", "r37-M-060"],
      ].map(([receiver, value, id]) => ({
        receiver,
        amount: { currency: "USD", value },
        sender_item_id: id,
        purpose: "GOODS",
      })),
    });
    const submitted = repo.batches.get(HERO_SENDER_BATCH_ID)?.batch;
    expect(submitted).toMatchObject({ kind: "primary", totalCents: 36_839n, batchSha256: digest });
    expect(submitted?.note).toBe(batchNote("2026-A", digest));
    expect(submitted?.at).toBe(NOW.toISOString());
  });

  it("retries a 5xx three times with the same ids, at 1 s, 3 s and 9 s", async () => {
    const { service, sleeps } = await setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "An internal server error has occurred."), 500),
        () => paypalJson(paypalError("SERVICE_UNAVAILABLE", "Service Unavailable."), 503),
        () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "An internal server error has occurred."), 502),
        () => paypalJson(created(), 201),
      ),
    );

    const out = await service.executeApproved(RUN_ID);

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
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500, "dbg-500"),
    );

    const out = await service.executeApproved(RUN_ID);

    expect(out).toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 4,
      lastStatus: 500,
      debugId: "dbg-500",
      reason: "RETRIES_EXHAUSTED",
    });
    expect(repo.types()).toEqual(["writeSubmitted"]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("re-reads the kill switch before every retry and stops, rows SUBMITTED, when it turns on", async () => {
    let on = false;
    const killSwitch = vi.fn(async () => on);
    const { service, repo, sleeps } = await setup(undefined, { killSwitch });
    onPost("/v1/payments/payouts", () => {
      on = true; // the treasurer flips kill_payouts while PayPal is failing
      return paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500, "dbg-500");
    });

    const out = await service.executeApproved(RUN_ID);

    expect(out).toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 1,
      lastStatus: 500,
      debugId: "dbg-500",
      reason: "KILL_SWITCH_ON",
    });
    expect(posts()).toHaveLength(1);
    expect(sleeps).toEqual([1_000]);
    expect(killSwitch).toHaveBeenCalledTimes(2);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("resumes an unresolved post with the same ids, checking the approvals as of the write", async () => {
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500));
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "unresolved" });

    // An hour later the approvals have expired, but the rows were written while they were valid.
    const later = makeService(repo, { now: () => new Date(NOW.getTime() + 3_600_000) }).service;
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(HERO_LINES, { digest })));

    await expect(later.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "adopted",
      senderBatchId: HERO_SENDER_BATCH_ID,
      verifiedBy: "items",
    });
    expect(new Set(posts().map((r) => r.headers.get("paypal-request-id"))).size).toBe(1);
    expect(repo.types().filter((t) => t === "writeSubmitted")).toHaveLength(1);
  });

  it("after a timeout retries with the same id and adopts the batch the first attempt created", async () => {
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = await setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => HttpResponse.error(),
        () => paypalJson(duplicateBatch(), 400, "dbg-dup"),
      ),
    );
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(HERO_LINES, { digest }), 200, "dbg-get"));

    const out = await service.executeApproved(RUN_ID);

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

  it("does not adopt on 'already exists' by the header total while PayPal lists no items yet", async () => {
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400, "dbg-dup"));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(batchBody(HERO_LINES, { listItems: false }), 200, "dbg-empty"),
    );

    await expect(service.executeApproved(RUN_ID)).resolves.toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 1,
      lastStatus: 200,
      debugId: "dbg-empty",
      reason: "ADOPT_PENDING",
      payoutBatchId: PAYOUT_BATCH_ID,
    });
    // Not POSTED: the rows stay SUBMITTED for the sweeper's resume, which re-GETs the items.
    expect(repo.types()).toEqual(["writeSubmitted"]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("adopts on a resume once PayPal lists the items and they rebuild the signed digest", async () => {
    const digest = await digestFor(HERO_LINES);
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet(
      "/v1/payments/payouts/:id",
      sequence(
        () => paypalJson(batchBody(HERO_LINES, { digest, listItems: false }), 200, "dbg-empty"),
        () => paypalJson(batchBody(HERO_LINES, { digest }), 200, "dbg-items"),
      ),
    );

    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ reason: "ADOPT_PENDING" });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "adopted",
      payoutBatchId: PAYOUT_BATCH_ID,
      verifiedBy: "items",
      debugId: "dbg-items",
    });
    expect(repo.types()).toEqual(["writeSubmitted", "markPosted"]);
    expect(repo.events.at(-1)).toMatchObject({ type: "markPosted", outcome: "adopted" });
    expect(new Set(posts().map((r) => r.headers.get("paypal-request-id")))).toEqual(
      new Set([payPalRequestId(HERO_SENDER_BATCH_ID)]),
    );
  });

  it("inv.i4.digest-is-payout: a same-total batch another database posted under our id is never adopted", async () => {
    // Dev, CI and the judge share one sandbox business account. A run_seq block collision there gives
    // "already exists" for a batch with our sender_batch_id, our item count and our total, but its
    // own receivers' split: M-014's and M-007's amounts swapped.
    const [m014, m007, ...rest] = HERO_LINES as [ApprovedLine, ApprovedLine, ...ApprovedLine[]];
    const foreign = [
      { ...m014, amountCents: m007.amountCents },
      { ...m007, amountCents: m014.amountCents },
      ...rest,
    ];
    const total = (lines: readonly ApprovedLine[]) => lines.reduce((s, l) => s + l.amountCents, 0n);
    expect(total(foreign)).toBe(total(HERO_LINES));
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet(
      "/v1/payments/payouts/:id",
      sequence(
        () => paypalJson(batchBody(foreign, { listItems: false })),
        () => paypalJson(batchBody(foreign)),
      ),
    );

    // The header matches ours to the cent, yet nothing is adopted while no item is listed...
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "ADOPT_PENDING",
    });
    // ...and once the items are listed they do not rebuild the signed digest: HALT.
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "ADOPT_FAILED",
      reason: "The existing batch differs from the approved digest",
    });
    expect(repo.types()).toEqual(["writeSubmitted"]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("leaves the rows SUBMITTED when the GET of the existing batch goes unanswered", async () => {
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(paypalError("SERVICE_UNAVAILABLE", "Service Unavailable."), 503, "dbg-503"),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "ADOPT_PENDING",
      lastStatus: 503,
      debugId: "dbg-503",
      payoutBatchId: PAYOUT_BATCH_ID,
    });
    // The GET is idempotent: PayPalHttp itself tried it 4 times (1, 3, 9 s); one POST.
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(4);
    expect(posts()).toHaveLength(1);
    expect(repo.types()).toEqual(["writeSubmitted"]);
  });

  it("halts when the linked batch is not there (404): ADOPT_FAILED, nothing adopted", async () => {
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(paypalError("INVALID_RESOURCE_ID", "Requested resource ID was not found."), 404),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "ADOPT_FAILED",
      reason: "GET of the existing batch failed (404 INVALID_RESOURCE_ID)",
    });
    expect(repo.types()).toEqual(["writeSubmitted"]);
  });

  it("refuses to adopt a batch whose items differ from the approved digest (HALT)", async () => {
    const { service, repo } = await setup();
    const tampered = HERO_LINES.map((l, i) => (i === 0 ? { ...l, receiver: "attacker@example.test" } : l));
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () => paypalJson(batchBody(tampered)));

    const out = await service.executeApproved(RUN_ID);

    expect(out).toMatchObject({ kind: "refused", code: "ADOPT_FAILED" });
    expect(repo.types()).toEqual(["writeSubmitted"]);
  });

  it("refuses to adopt a batch filed under another sender_batch_id, or with no link to follow", async () => {
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(batchBody(HERO_LINES, { sbid: "2026A-00000000-r37" })),
    );
    await expect((await setup()).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "ADOPT_FAILED",
    });

    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(PAYOUT_BATCH_ID, false), 400));
    await expect((await setup()).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "ADOPT_FAILED",
      reason: "PayPal says the batch exists but gave no link to it",
    });
  });

  it("treats a synchronous 4xx as a rejection, without retrying (ERRPYO005 INSUFFICIENT_FUNDS)", async () => {
    const { service, repo, sleeps } = await setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("INSUFFICIENT_FUNDS", "Sender does not have sufficient funds."), 422, "dbg-422"),
    );

    const out = await service.executeApproved(RUN_ID);

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
    const { service } = await setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson(paypalError("RATE_LIMIT_REACHED", "Too many requests."), 429),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "CIRCUIT_OPEN",
    });
    expect(posts()).toHaveLength(1);
  });

  it("a 401 is PayPalHttp's: it drops the stale shared token and resends once, one service attempt", async () => {
    const auth = fixedAuth();
    const { service, sleeps } = await setup(undefined, { http: new RealPayPalHttp({ auth }) });
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson({ name: "AUTHENTICATION_FAILURE", message: "Authentication failed" }, 401),
        () => paypalJson(created(), 201),
      ),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 1 });
    expect(auth.invalidated).toEqual([TEST_TOKEN]);
    expect(posts()).toHaveLength(2);
    expect(sleeps).toEqual([]);
  });

  it("a 401 the client could not clear is final: unresolved AUTH_FAILED, rows SUBMITTED, no more POSTs", async () => {
    const auth = fixedAuth();
    const { service, repo } = await setup(undefined, { http: new RealPayPalHttp({ auth }) });
    onPost("/v1/payments/payouts", () =>
      paypalJson({ name: "AUTHENTICATION_FAILURE", message: "Authentication failed" }, 401, "dbg-401"),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 1,
      lastStatus: 401,
      debugId: "dbg-401",
      reason: "AUTH_FAILED",
    });
    expect(posts()).toHaveLength(2); // the client's own resend after dropping the token, nothing more
    expect(auth.invalidated).toEqual([TEST_TOKEN]);
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("also retries when PayPalHttp reports a timeout as a retryable result instead of throwing", async () => {
    const results: PayPalResult<unknown>[] = [
      {
        ok: false,
        kind: "timeout",
        status: 0,
        name: "FS_TIMEOUT",
        message: "no response within 15000 ms",
        details: [],
        links: [],
        debugId: null,
        retryable: false,
        retryAfterMs: null,
        delivery: "unknown",
        ms: 15_000,
        attempts: 1,
        requestId: payPalRequestId(HERO_SENDER_BATCH_ID),
      },
      {
        ok: true,
        status: 201,
        body: created(),
        debugId: "dbg-ok",
        ms: 120,
        attempts: 1,
        requestId: payPalRequestId(HERO_SENDER_BATCH_ID),
      },
    ];
    const request = vi.fn(async () => results.shift());
    const { service, sleeps } = await setup(undefined, { http: { request } as unknown as PayPalHttp });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
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

  it("inv.i4.digest-is-payout: lines the database changed after signing are refused", async () => {
    const signed = await approvalsFor(HERO_LINES);
    const edited = HERO_LINES.map((l) =>
      l.memberNo === "M-014" ? { ...l, amountCents: l.amountCents + 1n } : l,
    );
    const { service, repo } = await setup({ lines: edited, approvals: signed });
    await expect(service.executeApproved(RUN_ID)).resolves.toEqual({
      kind: "refused",
      code: "DIGEST_MISMATCH",
      reason: "The batch changed after it was signed. Nothing was sent.",
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expectNothingSent(repo);
  });

  it("inv.i4.digest-is-payout: the Chair and the treasurer must have signed the same batch", async () => {
    const [treasurer] = await approvalsFor(HERO_LINES, { signers: [TREASURER] });
    const [chair] = await approvalsFor(HERO_LINES.slice(1), { signers: [CHAIR] });
    const { service, repo } = await setup({ approvals: [treasurer, chair].filter((a) => a !== undefined) });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
    expectNothingSent(repo);
  });

  it("inv.i4.digest-is-payout: a resumed post whose stored digest no longer matches its lines is refused", async () => {
    const { service, repo } = await setup({
      submitted: { at: NOW.toISOString(), batchSha256: await digestFor(HERO_LINES.slice(1)) },
    });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
    expectNothingSent(repo);
  });

  it("refuses when the kill switch is on (read fresh), before reading the run", async () => {
    const killSwitch = vi.fn(async () => true);
    const { service, repo } = await setup(undefined, { killSwitch });
    const loadPosting = vi.spyOn(repo, "loadPosting");
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "KILL_SWITCH_ON" });
    expect(killSwitch).toHaveBeenCalledTimes(1);
    expect(loadPosting).not.toHaveBeenCalled();
    expectNothingSent(repo);
  });

  it("refuses a run the database holds no approved batch for", async () => {
    const { service, repo } = await setup();
    await expect(service.executeApproved("0199f6a0-0000-7000-8000-000000000099")).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    expectNothingSent(repo);
  });

  describe("inv.i6.human-gate: who signed is checked against the database's batch", () => {
    it("refuses without the treasurer's approval", async () => {
      const { service, repo } = await setup({
        approvals: await approvalsFor(HERO_LINES, { signers: [CHAIR] }),
      });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "APPROVALS_MISSING",
        reason: "The treasurer's approval is missing",
      });
      expectNothingSent(repo);
    });

    it("refuses a batch over the R5 threshold without the Chair's co-signature", async () => {
      const alone = await approvalsFor(HERO_LINES, { signers: [TREASURER] });
      const { service, repo } = await setup({ approvals: alone });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "APPROVALS_MISSING",
        reason: "The Chair's co-signature is missing (R5: BATCH_OVER_THRESHOLD)",
      });
      expectNothingSent(repo);
    });

    it("posts a batch under every threshold on the treasurer's key alone, but not with an override", async () => {
      const small = HERO_LINES.slice(0, 3); // US$183.12, every line under US$150
      onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
      const alone = await approvalsFor(small, { signers: [TREASURER] });
      await expect(
        (await setup({ lines: small, approvals: alone })).service.executeApproved(RUN_ID),
      ).resolves.toMatchObject({ kind: "created" });

      const overridden = await setup({ lines: small, approvals: alone, overrides: 1 });
      await expect(overridden.service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "APPROVALS_MISSING",
        reason: "The Chair's co-signature is missing (R5: OVERRIDE)",
      });
    });

    it("refuses one person signing as both treasurer and Chair", async () => {
      const sameKey = makeSigner("chair", TREASURER.approverId, "fs-analyn-w2");
      const approvals = await approvalsFor(HERO_LINES, { signers: [TREASURER, sameKey] });
      const verify = registeredKeyVerifier([TREASURER, CHAIR, sameKey]);
      const { service, repo } = await setup({ approvals }, { verifyApprovalSignature: verify });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "APPROVALS_MISSING",
        reason: "The treasurer and the Chair must be two people with two keys",
      });
      expectNothingSent(repo);
    });

    it.each([
      ["already expired", new Date(NOW.getTime() - 1).toISOString()],
      ["expiring more than 30 minutes out", new Date(NOW.getTime() + 31 * 60_000).toISOString()],
    ])("refuses an approval %s", async (_label, exp) => {
      const { service, repo } = await setup({ approvals: await approvalsFor(HERO_LINES, { exp }) });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "DIGEST_MISMATCH",
        reason: "An approval expired before the batch was sent. Nothing was sent.",
      });
      expectNothingSent(repo);
    });

    it("refuses a signature that does not verify against the registered key", async () => {
      const [treasurer, chair] = await approvalsFor(HERO_LINES);
      const forged = { ...(treasurer as NonNullable<typeof treasurer>), signatureHex: "00".repeat(64) };
      const unregistered = (await approvalsFor(HERO_LINES, { signers: [STRANGER] }))[0];
      for (const bad of [forged, unregistered]) {
        const { service, repo } = await setup({ approvals: [bad, chair].filter((a) => a !== undefined) });
        await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
          code: "DIGEST_MISMATCH",
          reason: "An approval's signature does not verify against a registered key. Nothing was sent.",
        });
        expectNothingSent(repo);
      }
    });

    it("refuses two approvals that share a nonce", async () => {
      const digest = await digestFor(HERO_LINES);
      const batch = { ...RUN_FACTS, batchSha256: digest, itemCount: 8, totalCents: 36_839 };
      const approvals = [TREASURER, CHAIR].map((s) =>
        approve(s, batch, { exp: EXP, nonce: "n-0457-reused" }),
      );
      const { service, repo } = await setup({ approvals });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
        code: "DIGEST_MISMATCH",
        reason: "An approval's nonce was already used. Nothing was sent.",
      });
      expectNothingSent(repo);
    });

    it.each([
      ["another run", { runId: "0199f6a0-0000-7000-8000-000000000036" }],
      ["another season", { seasonId: "0199f6a0-0000-7000-8000-00000002025b" }],
      ["another item count", { itemCount: 7 }],
      ["another total", { totalCents: 36_840 }],
    ])("refuses an approval signed for %s", async (_label, payload) => {
      const digest = await digestFor(HERO_LINES);
      const batch = { ...RUN_FACTS, batchSha256: digest, itemCount: 8, totalCents: 36_839 };
      const approvals = [
        approve(TREASURER, batch, { exp: EXP, payload }),
        approve(CHAIR, batch, { exp: EXP }),
      ];
      const { service, repo } = await setup({ approvals });
      await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "DIGEST_MISMATCH" });
      expectNothingSent(repo);
    });
  });

  it.each([
    ["a phone receiver (recipient_type is EMAIL only)", { receiver: "+15555550100" }],
    ["a PHP line", { currency: "PHP" }],
    ["a zero amount", { amountCents: 0n }],
    ["a negative amount", { amountCents: -5n }],
  ])("refuses %s", async (_label, patch) => {
    const lines = HERO_LINES.map((l, i) => (i === 0 ? ({ ...l, ...patch } as typeof l) : l));
    const { service, repo } = await setup({ lines });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    expectNothingSent(repo);
  });

  it("refuses a member listed twice and an empty batch", async () => {
    const twice = [...HERO_LINES, { ...(HERO_LINES[0] as ApprovedLine), lineId: "dup" }];
    const a = await setup({ lines: twice });
    await expect(a.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    const b = await setup({ lines: [], approvals: [] });
    await expect(b.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    expectNothingSent(a.repo);
    expectNothingSent(b.repo);
  });

  it("applies the sandbox guards: batch cap, item cap and known receivers", async () => {
    const capped = await setup(undefined, { limits: { ...JUDGE_LIMITS, maxBatchTotalCents: 36_838n } });
    await expect(capped.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "SANDBOX_GUARD" });
    const few = await setup(undefined, { limits: { ...JUDGE_LIMITS, maxItems: 7 } });
    await expect(few.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "SANDBOX_GUARD" });
    const known = await setup(undefined, {
      limits: { ...JUDGE_LIMITS, receiverAllowed: (r) => r !== "rhea.no-account@example.test" },
    });
    await expect(known.service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "SANDBOX_GUARD",
      reason: "r37-M-031: the receiver is not a known sandbox account",
    });
    expect(requests).toHaveLength(0);
  });

  it("passes the guards at exactly the cap", async () => {
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    const { service } = await setup(undefined, {
      limits: { ...JUDGE_LIMITS, maxBatchTotalCents: 36_839n, maxItems: 8 },
    });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
  });

  it("refuses a malformed rate-card hash or run number from the database", async () => {
    const a = await setup({ rateCardSha256: "7f3a91c2" });
    await expect(a.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    const b = await setup({ runSeq: 0 });
    await expect(b.service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    expectNothingSent(a.repo);
    expectNothingSent(b.repo);
  });
});

describe("PayoutsService wiring: the money guards are required", () => {
  const base = (): PayoutsServiceDeps => ({
    http: new RealPayPalHttp(),
    repo: new MemoryPayoutsRepo(),
    batchDigest: referenceBatchDigest,
    verifyApprovalSignature: registeredKeyVerifier(),
    killSwitch: async () => false,
    limits: JUDGE_LIMITS,
  });

  it.each([
    ["no kill switch", { killSwitch: undefined }],
    ["no signature check", { verifyApprovalSignature: undefined }],
    ["no limits", { limits: undefined }],
    ["no batch cap", { limits: { ...JUDGE_LIMITS, maxBatchTotalCents: undefined } }],
    ["no item cap", { limits: { ...JUDGE_LIMITS, maxItems: undefined } }],
    ["no receiver allowlist", { limits: { ...JUDGE_LIMITS, receiverAllowed: undefined } }],
    ["a batch cap of zero", { limits: { ...JUDGE_LIMITS, maxBatchTotalCents: 0n } }],
  ])("refuses to start with %s", (_label, patch) => {
    expect(() => new PayoutsService({ ...base(), ...(patch as object) } as PayoutsServiceDeps)).toThrow(
      TypeError,
    );
  });
});
