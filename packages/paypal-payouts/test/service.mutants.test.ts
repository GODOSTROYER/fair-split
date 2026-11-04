// Tests that kill mutation-testing survivors (handoff T3) in the money paths of PayoutsService: which
// failures count as "already exists" and where its link is read from, which answers are retried, the
// checks on a batch PayPal lists before it is adopted (I4), the line threshold of R5 (I6), the inputs
// of the batch and member-line checks, and the cancel paths of an UNCLAIMED item.

import { describe, expect, it } from "vitest";
import {
  type Actor,
  type ApprovedLine,
  isDuplicateBatchError,
  linkedBatchId,
  type PayoutLimits,
  PayoutsApiError,
  PayoutsService,
  type PayPalFailure,
  type RunHold,
} from "../src/index.js";
import { CHAIR, TREASURER } from "./support/approvals.js";
import {
  approvalsFor,
  batchBody,
  created,
  digestFor,
  duplicateBatch,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  itemBody,
  NOW,
  PAYOUT_BATCH_ID,
  paypalError,
  postingSnapshot,
  RHEA_ITEM_ID,
  RUN_FACTS,
  rheaRow,
} from "./support/fixtures.js";
import { RealPayPalHttp } from "./support/http.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { JUDGE_LIMITS, makeService } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;
const BATCH_PATH = `/v1/payments/payouts/${PAYOUT_BATCH_ID}`;
const posts = () => requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/payments/payouts");

async function setup(
  snapshot: Parameters<typeof postingSnapshot>[1] & { lines?: readonly ApprovedLine[] } = {},
  limits: Partial<PayoutLimits> = {},
) {
  const { lines, ...rest } = snapshot;
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(lines ?? HERO_LINES, rest)] });
  return { repo, ...makeService(repo, { limits: { ...JUDGE_LIMITS, ...limits } }) };
}

/** A PayPal failure as PayPalHttp hands it over; `over` may carry shapes PayPal sends but the type omits. */
const failure = (over: Record<string, unknown>): PayPalFailure =>
  ({
    ok: false,
    kind: "http",
    status: 400,
    name: "VALIDATION_ERROR",
    message: "Invalid request",
    debugId: "dbg",
    details: [],
    links: [],
    retryable: false,
    ...over,
  }) as unknown as PayPalFailure;

describe("isDuplicateBatchError: only PayPal's 'already exists' answer is adopted", () => {
  it("a 400 that is not about the sender_batch_id is not a duplicate", () => {
    expect(isDuplicateBatchError(failure({}))).toBe(false);
    expect(
      isDuplicateBatchError(failure({ name: "USER_BUSINESS_ERROR", message: "Insufficient funds" })),
    ).toBe(false);
  });

  it("the same words with any status but 400 are not a duplicate", () => {
    const words = { message: "Batch with given sender_batch_id already exists" };
    expect(isDuplicateBatchError(failure({ ...words }))).toBe(true);
    expect(isDuplicateBatchError(failure({ ...words, status: 422 }))).toBe(false);
  });

  it("reads the field, the issue and the description of each detail", () => {
    const business = { name: "USER_BUSINESS_ERROR", message: "User business error." };
    expect(isDuplicateBatchError(failure({ ...business, details: [{ field: "SENDER_BATCH_ID" }] }))).toBe(
      true,
    );
    expect(isDuplicateBatchError(failure({ details: [{ issue: "sender_batch_id already exists" }] }))).toBe(
      true,
    );
    expect(
      isDuplicateBatchError(failure({ details: [{ description: "Sender_batch_id already exists." }] })),
    ).toBe(true);
    // USER_BUSINESS_ERROR alone, or SENDER_BATCH_ID under another error name, is not enough.
    expect(isDuplicateBatchError(failure({ ...business, details: [{ field: "items" }] }))).toBe(false);
    expect(isDuplicateBatchError(failure({ details: [{ field: "SENDER_BATCH_ID" }] }))).toBe(false);
  });
});

describe("linkedBatchId: the HATEOAS link to the batch PayPal already holds", () => {
  const href = (id: string) => `https://api.sandbox.paypal.com/v1/payments/payouts/${id}`;

  it("reads details[].link as a list or as one link, details[].links, and the top-level links", () => {
    expect(linkedBatchId(failure({ details: [{ link: [{ href: href("AAA1") }] }] }))).toBe("AAA1");
    expect(linkedBatchId(failure({ details: [{ link: { href: href("AAA2") } }] }))).toBe("AAA2");
    expect(linkedBatchId(failure({ details: [{ links: [{ href: href("AAA3") }] }] }))).toBe("AAA3");
    expect(linkedBatchId(failure({ links: [{ href: href("AAA4") }] }))).toBe("AAA4");
  });

  it("skips links that are not a batch URL and keeps looking", () => {
    const out = linkedBatchId(
      failure({
        details: [
          null,
          { link: [{ href: 42 }, { href: "not a url" }, { href: "https://x.test/v1/other/1" }] },
          { link: [{ href: href("GOOD1") }] },
        ],
      }),
    );
    expect(out).toBe("GOOD1");
    expect(
      linkedBatchId(failure({ details: [{ link: [{ href: "https://x.test/v1/other/1" }] }] })),
    ).toBeNull();
    expect(linkedBatchId(failure({}))).toBeNull();
  });
});

describe("posting: which answers are retried with the same ids", () => {
  it.each([408, 500])("a %i is retried with the same PayPal-Request-Id, then created", async (status) => {
    const { service, sleeps } = await setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson(paypalError("INTERNAL_SERVICE_ERROR", "x"), status),
        () => paypalJson(created(), 201),
      ),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 2 });
    expect(sleeps).toEqual([1_000]);
    const ids = posts().map((r) => r.headers.get("paypal-request-id"));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("a 2xx without a readable batch id, or naming another sender_batch_id, is retried, not trusted", async () => {
    const other = created("2026A-00000000-r1");
    const badId = created();
    badId.batch_header.payout_batch_id = "not a batch id!";
    const { service } = await setup();
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson({}, 201),
        () => paypalJson(badId, 201),
        () => paypalJson(other, 201),
        () => paypalJson(created(), 201),
      ),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 4 });
  });

  it("a 201 that echoes no sender_batch_id and no status is accepted, with the status unknown", async () => {
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () =>
      paypalJson({ batch_header: { payout_batch_id: PAYOUT_BATCH_ID } }, 201),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "created",
      payoutBatchId: PAYOUT_BATCH_ID,
      batchStatus: null,
    });
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("POSTED");
  });

  it("posts the items sorted by sender_item_id, whatever order the database lists the lines in", async () => {
    const { service } = await setup({ lines: [...HERO_LINES].reverse() });
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
    const body = posts()[0]?.body as { items: { sender_item_id: string }[] } | undefined;
    const ids = (body?.items ?? []).map((i) => i.sender_item_id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(HERO_LINES.length);
  });
});

describe("adopting 'already exists' (I4): only a batch whose every item rebuilds the digest", () => {
  function listing(edit: (items: Record<string, unknown>[]) => void, status = "PENDING") {
    const body = batchBody(HERO_LINES, { status }) as unknown as { items: Record<string, unknown>[] };
    edit(body.items);
    return body;
  }
  const payoutItem = (items: Record<string, unknown>[], i = 0) =>
    (items[i] as { payout_item: Record<string, unknown> }).payout_item;

  async function adopt(body: unknown, getStatus = 200) {
    const { service, repo } = await setup();
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet(BATCH_PATH, () => paypalJson(body as never, getStatus, "dbg-get"));
    return { out: await service.executeApproved(RUN_ID), repo };
  }

  it.each([
    [
      "an item in another currency",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).amount = {
          currency: "EUR",
          value: (payoutItem(it).amount as { value: string }).value,
        };
      },
    ],
    [
      "an item of zero",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).amount = { currency: "USD", value: "0.00" };
      },
    ],
    [
      "an item over the safe-integer cents",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).amount = { currency: "USD", value: "90071992547409.92" };
      },
    ],
    [
      "an unreadable amount",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).amount = { currency: "USD", value: "lots" };
      },
    ],
    [
      "no sender_item_id",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).sender_item_id = "";
      },
    ],
    [
      "a receiver that is not a string",
      (it: Record<string, unknown>[]) => {
        payoutItem(it).receiver = 7;
      },
    ],
    [
      "an item without payout_item",
      (it: Record<string, unknown>[]) => {
        (it[0] as Record<string, unknown>).payout_item = undefined;
      },
    ],
  ])("refuses a listed batch with %s as unreadable (ADOPT_FAILED)", async (_label, edit) => {
    const { out, repo } = await adopt(listing(edit));
    expect(out).toMatchObject({
      kind: "refused",
      code: "ADOPT_FAILED",
      reason: "The existing batch has an item we cannot read",
    });
    expect(repo.batches.get(HERO_SENDER_BATCH_ID)?.status).toBe("SUBMITTED");
  });

  it("adopts the exact batch, with its status, or with none when PayPal gives none", async () => {
    const plain = await adopt(listing(() => {}, "SUCCESS"));
    expect(plain.out).toMatchObject({ kind: "adopted", batchStatus: "SUCCESS", debugId: "dbg-get" });
    const body = listing(() => {}) as unknown as { batch_header: Record<string, unknown> };
    body.batch_header.batch_status = undefined;
    await expect(adopt(body).then((r) => r.out)).resolves.toMatchObject({
      kind: "adopted",
      batchStatus: null,
    });
  });

  it("a GET answered without a batch header leaves the rows SUBMITTED for a later call (ADOPT_PENDING)", async () => {
    const { out } = await adopt({ items: [] });
    expect(out).toMatchObject({
      kind: "unresolved",
      reason: "ADOPT_PENDING",
      payoutBatchId: PAYOUT_BATCH_ID,
    });
  });

  it("a header without a sender_batch_header is not ours", async () => {
    const body = listing(() => {}) as unknown as { batch_header: Record<string, unknown> };
    body.batch_header.sender_batch_header = undefined;
    await expect(adopt(body).then((r) => r.out)).resolves.toMatchObject({
      code: "ADOPT_FAILED",
      reason: "The linked batch carries another sender_batch_id",
    });
  });

  it("a GET refused with 401 is AUTH_FAILED (not a HALT); another 4xx is ADOPT_FAILED", async () => {
    await expect(
      adopt(paypalError("AUTHENTICATION_FAILURE", "no"), 401).then((r) => r.out),
    ).resolves.toMatchObject({ kind: "unresolved", reason: "AUTH_FAILED" });
    await expect(adopt(paypalError("NOT_AUTHORIZED", "no"), 403).then((r) => r.out)).resolves.toMatchObject({
      kind: "refused",
      code: "ADOPT_FAILED",
    });
  });
});

describe("the checks before any approval is read", () => {
  it("R5's line threshold (I6): one line over US$150 needs the Chair even in a batch under US$300", async () => {
    const big: ApprovedLine = { ...(HERO_LINES[0] as ApprovedLine), amountCents: 15_001n };
    const alone = await approvalsFor([big], { signers: [TREASURER] });
    const { service } = await setup({ lines: [big], approvals: alone });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "APPROVALS_MISSING",
      reason: "The Chair's co-signature is missing.",
    });
    const both = await approvalsFor([big], { signers: [TREASURER, CHAIR] });
    onPost("/v1/payments/payouts", () => paypalJson(created(), 201));
    await expect(
      (await setup({ lines: [big], approvals: both })).service.executeApproved(RUN_ID),
    ).resolves.toMatchObject({ kind: "created" });
  });

  it.each([
    ["no member lines", [], "The run's member lines were not read"],
    ["member lines that are not a list", "nope", "The run's member lines were not read"],
    [
      "a member line without a member number",
      [{ memberNo: "", lineSha256: "a".repeat(64) }],
      "A member line has no member number",
    ],
    [
      "a member number that is not a string",
      [{ memberNo: 14, lineSha256: "a".repeat(64) }],
      "A member line has no member number",
    ],
    [
      "a line hash that is not lowercase hex",
      [{ memberNo: "M-014", lineSha256: "A".repeat(64) }],
      "M-014: the line has no stored lineSha256",
    ],
  ])("refuses %s", async (_label, memberLines, reason) => {
    const { service, repo } = await setup({ memberLines: memberLines as never });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH", reason });
    expect(requests).toHaveLength(0);
    expect(repo.batches.size).toBe(0);
  });

  it.each([
    ["a null hold", null],
    ["a hold that is not an object", "DUPLICATE_SLIP"],
    ["a hold of an unknown kind", { kind: "MYSTERY", resolution: null }],
    ["a hold whose kind is not a string", { kind: 7, resolution: null }],
    ["a resolution without a kind", { kind: "RATE_MISMATCH", resolution: {} }],
  ])("refuses %s as unreadable holds", async (_label, hold) => {
    const { service } = await setup({ holds: [hold as unknown as RunHold] });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "INVALID_BATCH",
      reason: "The run's holds were not read",
    });
  });

  it("an unreadable submission time of a resumed post refuses before any approval check", async () => {
    const { service } = await setup({
      submitted: { at: "not a time", batchSha256: await digestFor(HERO_LINES) },
    });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "INVALID_BATCH",
      reason: "Unreadable submission time",
    });
  });

  it("a receiver the strict batch schema refuses never reaches PayPal", async () => {
    const odd: ApprovedLine = { ...(HERO_LINES[0] as ApprovedLine), receiver: "a..b@example.test" };
    const { service } = await setup({ lines: [odd], approvals: await approvalsFor([odd]) });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "INVALID_BATCH",
    });
    expect(requests).toHaveLength(0);
  });

  it("a registry read that is not a list is a fault, thrown before anything is voided", async () => {
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    const { service } = makeService(repo, { officerKeys: async () => null as never });
    await expect(service.executeApproved(RUN_ID)).rejects.toThrow(TypeError);
    expect(repo.events).toEqual([]);
  });

  it("voids exactly the approvals' own nonces, each once, skipping entries that carry none", async () => {
    const signed = await approvalsFor(HERO_LINES, { exp: new Date(NOW.getTime() - 1).toISOString() });
    const approvals = [...signed, signed[0], { role: "chair" }] as never;
    const { service, repo } = await setup({ approvals });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "refused" });
    const voided = repo.events.find((e) => e.type === "voidApprovals") as { nonces: string[] } | undefined;
    expect(voided?.nonces).toEqual(signed.map((a) => a.payload.nonce));
  });

  it("a negative balance is named with its sign in the refusal", async () => {
    const { service } = await setup({}, { balanceCents: async () => -150n });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "SANDBOX_GUARD",
      reason: expect.stringContaining("(-US$1.50)"),
    });
  });
});

describe("PayoutsService limits are checked when it is built", () => {
  const build = (limits: Partial<PayoutLimits> | undefined) =>
    new PayoutsService({
      http: new RealPayPalHttp(),
      repo: new MemoryPayoutsRepo(),
      officerKeys: async () => [],
      killSwitch: async () => false,
      limits: limits === undefined ? (undefined as never) : { ...JUDGE_LIMITS, ...limits },
    });

  it("accepts the edges and refuses one past them", () => {
    expect(() => build(undefined)).toThrow("PayoutsService needs its sandbox limits");
    expect(() => build({ maxItems: 1 })).not.toThrow();
    expect(() => build({ maxItems: 0 })).toThrow(TypeError);
    expect(() => build({ maxItems: 15_000 })).not.toThrow();
    expect(() => build({ maxItems: 15_001 })).toThrow(TypeError);
    expect(() => build({ maxPostsPer24h: 1 })).not.toThrow();
    expect(() => build({ maxPostsPer24h: 0 })).toThrow(TypeError);
  });
});

describe("cancelUnclaimed: every answer of the cancel call", () => {
  const ANALYN: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };
  const CANCEL = "/v1/payments/payouts-item/:id/cancel";

  function setupCancel(row = rheaRow("UNCLAIMED"), killSwitch: () => Promise<boolean> = async () => false) {
    const repo = new MemoryPayoutsRepo({ items: [row], runs: [RUN_FACTS] });
    return { repo, ...makeService(repo, { killSwitch }) };
  }

  it("refuses an actor without an id, and an id that is not a payout item id, before any call", async () => {
    const { service } = setupCancel();
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, { ...ANALYN, id: "" }, "cash")).resolves.toMatchObject(
      {
        code: "ACTOR_NOT_ALLOWED",
      },
    );
    await expect(service.cancelUnclaimed("bad id!", ANALYN, "cash")).resolves.toMatchObject({
      code: "UNKNOWN_ITEM",
    });
    expect(requests).toHaveLength(0);
  });

  it("an intent once recorded never changes; a first cancel has none to conflict with", async () => {
    const recorded = setupCancel(
      rheaRow("UNCLAIMED", { cancelRequestedAt: NOW.toISOString(), cancelIntent: "cash" }),
    );
    await expect(recorded.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "reroute")).resolves.toMatchObject({
      code: "INTENT_CONFLICT",
    });
    const unrecorded = setupCancel(
      rheaRow("UNCLAIMED", { cancelRequestedAt: NOW.toISOString(), cancelIntent: null }),
    );
    onPost(CANCEL, () => paypalJson(itemBody("RETURNED"), 200));
    await expect(unrecorded.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "reroute")).resolves.toMatchObject({
      kind: "RETURNED",
    });
    // The request was recorded already: it is not recorded twice.
    expect(unrecorded.repo.events.map((e) => e.type)).toEqual(["applyItemStatus"]);
  });

  it("an item already RETURNED after our cancel answers with the recorded intent, without a call", async () => {
    const { service } = setupCancel(
      rheaRow("RETURNED", { cancelRequestedAt: NOW.toISOString(), cancelIntent: null }),
    );
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "RETURNED",
      payoutItemId: RHEA_ITEM_ID,
      intent: "cash",
      debugId: null,
    });
    const returnedWithoutUs = setupCancel(rheaRow("RETURNED"));
    await expect(
      returnedWithoutUs.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash"),
    ).resolves.toMatchObject({
      kind: "NOT_UNCLAIMED",
      status: "RETURNED",
    });
    expect(requests).toHaveLength(0);
  });

  it("a 200 without a status means RETURNED; a 200 with another status is NOT_UNCLAIMED", async () => {
    const a = setupCancel();
    onPost(CANCEL, () => paypalJson({ payout_item_id: RHEA_ITEM_ID }, 200, "dbg-a"));
    await expect(a.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "RETURNED",
      payoutItemId: RHEA_ITEM_ID,
      intent: "cash",
      debugId: "dbg-a",
    });
    const b = setupCancel();
    onPost(CANCEL, () => paypalJson(itemBody("SUCCESS"), 200, "dbg-b"));
    await expect(b.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "NOT_UNCLAIMED",
      payoutItemId: RHEA_ITEM_ID,
      status: "SUCCESS",
      debugId: "dbg-b",
    });
  });

  it("401 is AUTH_FAILED, 404 is UNKNOWN_ITEM, 422 is checked with a GET, 403 is raised", async () => {
    const auth = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("AUTHENTICATION_FAILURE", "no"), 401));
    await expect(auth.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "UNRESOLVED",
      reason: "AUTH_FAILED",
      attempts: 1,
    });
    const missing = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("RESOURCE_NOT_FOUND", "no"), 404));
    await expect(missing.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "REFUSED",
      code: "UNKNOWN_ITEM",
    });
    const unprocessable = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("UNPROCESSABLE_ENTITY", "no"), 422));
    onGet("/v1/payments/payouts-item/:id", () => paypalJson(itemBody("SUCCESS"), 200));
    await expect(unprocessable.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "NOT_UNCLAIMED",
      status: "SUCCESS",
    });
    const forbidden = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("NOT_AUTHORIZED", "no"), 403));
    await expect(forbidden.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).rejects.toThrow(
      PayoutsApiError,
    );
  });

  it("5xx is retried at 1 s, 3 s and 9 s, the kill switch read before each retry, then RETRIES_EXHAUSTED", async () => {
    let reads = 0;
    const { service, sleeps } = setupCancel(rheaRow("UNCLAIMED"), async () => {
      reads += 1;
      return false;
    });
    onPost(CANCEL, () => paypalJson(paypalError("INTERNAL_SERVICE_ERROR", "x"), 503));
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "UNRESOLVED",
      reason: "RETRIES_EXHAUSTED",
      attempts: 4,
      lastStatus: 503,
    });
    expect(sleeps).toEqual([1_000, 3_000, 9_000]);
    expect(reads).toBe(4); // once before the first call, once before each of the three retries
  });

  it("a GET that fails while checking a refused cancel is raised; one without a status records nothing", async () => {
    const failing = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("ITEM_INCORRECT_STATUS", "no"), 400));
    onGet("/v1/payments/payouts-item/:id", () => paypalJson(paypalError("INTERNAL_SERVICE_ERROR", "x"), 403));
    await expect(failing.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).rejects.toThrow(
      PayoutsApiError,
    );
    const blank = setupCancel();
    onPost(CANCEL, () => paypalJson(paypalError("ITEM_INCORRECT_STATUS", "no"), 400));
    onGet("/v1/payments/payouts-item/:id", () => paypalJson({ payout_item_id: RHEA_ITEM_ID }, 200));
    await expect(blank.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "NOT_UNCLAIMED",
      status: null,
    });
    expect(blank.repo.events.map((e) => e.type)).toEqual(["markCancelRequested"]);
  });
});
