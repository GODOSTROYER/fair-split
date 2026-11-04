// More tests that kill mutation-testing survivors (handoff T3) in PayoutsService, with a scripted
// PayPalHttp where the real client never answers that way: a call that throws, a local refusal, a
// failure whose advisory `retryable` is off, a 2xx with no body. Also the re-route checks, the lane every
// call is queued in, adoption across pages, and a re-route resumed under ids another attempt wrote.

import type { PayPalHttp, PayPalRequest, PayPalResult } from "@fairsplit/paypal-core";
import { describe, expect, it, vi } from "vitest";
import {
  type Actor,
  type ApprovedLine,
  PayoutsApiError,
  type PayoutsServiceDeps,
  type RerouteRequest,
  type SupersedingItem,
} from "../src/index.js";
import { CHAIR, TREASURER } from "./support/approvals.js";
import {
  approvalsFor,
  batchBody,
  created,
  duplicateBatch,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  itemBody,
  lineHash,
  NOW,
  PAYOUT_BATCH_ID,
  postingSnapshot,
  RHEA_ITEM_ID,
  RUN_FACTS,
  rerouteBatchId,
  rheaRow,
} from "./support/fixtures.js";
import { onGet, onPost, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { JUDGE_LIMITS, makeService } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;
const ANALYN: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };

type Step = PayPalResult<unknown> | Error;
/** A PayPalHttp that answers from a script (the last answer repeats) and records every request. */
function scripted(...steps: Step[]) {
  const calls: PayPalRequest[] = [];
  const http: PayPalHttp = {
    request: async <T>(req: PayPalRequest) => {
      calls.push(req);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)] as Step;
      if (step instanceof Error) throw step;
      return step as PayPalResult<T>;
    },
  };
  return { http, calls };
}
const ok = (body: unknown, status = 200): PayPalResult<unknown> => ({
  ok: true,
  status,
  body,
  debugId: "dbg-ok",
  ms: 1,
  attempts: 1,
  requestId: null,
});
/** A failure as the client reports it; `over` may set what a test needs, typed loosely. */
const fail = (over: Record<string, unknown>): PayPalResult<unknown> =>
  ({
    ok: false,
    kind: "http",
    status: 500,
    name: "INTERNAL_SERVICE_ERROR",
    message: "x",
    details: [],
    links: [],
    debugId: "dbg-fail",
    retryable: false,
    retryAfterMs: null,
    delivery: "unknown",
    ms: 1,
    attempts: 1,
    ...over,
  }) as unknown as PayPalResult<unknown>;

async function posting(http: PayPalHttp, extra: Partial<PayoutsServiceDeps> = {}) {
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
  return { repo, ...makeService(repo, { http, ...extra }) };
}

describe("posting with a scripted PayPalHttp", () => {
  it.each([
    ["no response (status 0)", 0],
    ["a 408", 408],
    ["a 500", 500],
  ])("retries %s even when the client calls it not retryable", async (_label, status) => {
    const { http, calls } = scripted(fail({ status, retryable: false }), ok(created(), 201));
    const { service } = await posting(http);
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("a call that throws is retried with the same ids", async () => {
    const { http, calls } = scripted(new Error("socket hang up"), ok(created(), 201));
    const { service } = await posting(http);
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 2 });
    expect(calls.map((c) => c.requestId)).toEqual([calls[0]?.requestId, calls[0]?.requestId]);
  });

  it("a 2xx with no body is retried, not read", async () => {
    const { http } = scripted(ok(null, 201), ok(created(), 201));
    const { service } = await posting(http);
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 2 });
  });

  it("records the batch status PayPal gave, or none, on the posted rows", async () => {
    const { http } = scripted(ok(created(), 201));
    const { service, repo } = await posting(http);
    const markPosted = vi.spyOn(repo, "markPosted");
    await service.executeApproved(RUN_ID);
    expect(markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ batchStatus: "PENDING", outcome: "created" }),
    );
  });

  it("the lane: a service queues every call as live unless built for background", async () => {
    const live = scripted(ok(created(), 201));
    await (await posting(live.http)).service.executeApproved(RUN_ID);
    expect(live.calls.map((c) => c.priority)).toEqual(["live"]);
    const background = scripted(ok(created(), 201));
    await (await posting(background.http, { priority: "background" })).service.executeApproved(RUN_ID);
    expect(background.calls.map((c) => c.priority)).toEqual(["background"]);
  });

  it("the adopting GET goes in the service's lane, and a GET body of null is ADOPT_PENDING", async () => {
    const dup = fail({
      status: 400,
      name: "USER_BUSINESS_ERROR",
      message: "Batch with given sender_batch_id already exists",
      links: [
        { href: `https://api.sandbox.paypal.com/v1/payments/payouts/${PAYOUT_BATCH_ID}`, rel: "self" },
      ] as never,
    });
    const { http, calls } = scripted(dup, ok(null));
    const { service } = await posting(http, { priority: "background" });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "ADOPT_PENDING",
    });
    expect(calls.map((c) => [c.method, c.priority])).toEqual([
      ["POST", "background"],
      ["GET", "background"],
    ]);
  });

  it("a run whose stored batch belongs to another run is not posted", async () => {
    const { http, calls } = scripted(ok(created(), 201));
    const { service, repo } = await posting(http);
    const other = await postingSnapshot(HERO_LINES, { runId: "0199f6a0-0000-7000-8000-000000000099" });
    vi.spyOn(repo, "loadPosting").mockResolvedValue(other);
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ code: "INVALID_BATCH" });
    expect(calls).toHaveLength(0);
  });

  it("an amount that is not bigint cents is refused", async () => {
    const asNumber = { ...(HERO_LINES[0] as ApprovedLine), amountCents: 6_445 as unknown as bigint };
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot([asNumber], { approvals: [] })] });
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      code: "INVALID_BATCH",
      reason: "M-014: amount must be positive cents",
    });
  });

  it("names the strict schema's own reason, and a registry fault with its own message", async () => {
    const odd: ApprovedLine = { ...(HERO_LINES[0] as ApprovedLine), receiver: "a..b@example.test" };
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot([odd])] });
    const out = await makeService(repo).service.executeApproved(RUN_ID);
    expect(out).toMatchObject({ code: "INVALID_BATCH", reason: expect.stringMatching(/email/i) });
    const faulty = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    await expect(
      makeService(faulty, { officerKeys: async () => null as never }).service.executeApproved(RUN_ID),
    ).rejects.toThrow("officerKeys must list the registry's rows; a fault must throw");
  });

  it("without an injected clock the service voids with the time of now", async () => {
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    const { service } = makeService(repo, { now: undefined });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "refused" });
    const voided = repo.events.find((e) => e.type === "voidApprovals") as { at: string } | undefined;
    expect(Number.isNaN(Date.parse(voided?.at ?? ""))).toBe(false);
  });
});

describe("adopting a batch PayPal lists across pages", () => {
  it("reads every page until the last one, and only those, before re-hashing", async () => {
    const lines: ApprovedLine[] = Array.from({ length: 1_001 }, (_, i) => {
      const memberNo = `M-${String(i + 1).padStart(4, "0")}`;
      return {
        lineId: `line-${memberNo}`,
        memberNo,
        receiver: `${memberNo.toLowerCase()}@example.test`,
        amountCents: 100n,
        currency: "USD",
      };
    });
    const memberLines = lines.map((l) => ({ memberNo: l.memberNo, lineSha256: lineHash(l.memberNo) }));
    const { linesDigest } = await import("@fairsplit/domain");
    const approvals = await approvalsFor(lines, {
      signers: [TREASURER, CHAIR],
      linesDigest: linesDigest(memberLines),
    });
    const repo = new MemoryPayoutsRepo({
      postings: [await postingSnapshot(lines, { memberLines, approvals })],
    });
    const { service } = makeService(repo, {
      limits: { ...JUDGE_LIMITS, maxItems: 15_000, maxBatchTotalCents: 10_000_000n },
    });
    const all = batchBody(lines) as unknown as { items: unknown[]; total_pages: number };
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet(`/v1/payments/payouts/${PAYOUT_BATCH_ID}`, (req) => {
      const page = Number(req.url.searchParams.get("page"));
      const items = page === 1 ? all.items.slice(0, 1_000) : page === 2 ? all.items.slice(1_000) : [];
      return paypalJson({ ...all, total_pages: 2, items } as never);
    });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "adopted",
      verifiedBy: "items",
    });
    const pages = requests.filter((r) => r.method === "GET").map((r) => r.url.searchParams.get("page"));
    expect(pages).toEqual(["1", "2"]);
  }, 60_000);
});

describe("cancelUnclaimed with a scripted PayPalHttp", () => {
  function cancelling(...steps: Step[]) {
    const { http, calls } = scripted(...steps);
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    return { calls, repo, ...makeService(repo, { http }) };
  }

  it("a call that throws is retried", async () => {
    const { service, calls } = cancelling(new Error("reset"), ok(itemBody("RETURNED")));
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "RETURNED",
    });
    expect(calls).toHaveLength(2);
  });

  it("a local auth refusal is AUTH_FAILED; a request the client will not send is raised", async () => {
    await expect(
      cancelling(fail({ kind: "auth", status: 0 })).service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash"),
    ).resolves.toMatchObject({ kind: "UNRESOLVED", reason: "AUTH_FAILED", attempts: 1 });
    await expect(
      cancelling(fail({ kind: "invalid_request", status: 0 })).service.cancelUnclaimed(
        RHEA_ITEM_ID,
        ANALYN,
        "cash",
      ),
    ).rejects.toThrow(PayoutsApiError);
  });

  it("the cancel and its checking GET go in the lane asked for, else the service's", async () => {
    const refused = fail({ status: 400, name: "ITEM_INCORRECT_STATUS" });
    const a = cancelling(refused, ok(itemBody("SUCCESS")));
    await a.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash", { priority: "background" });
    expect(a.calls.map((c) => c.priority)).toEqual(["background", "background"]);
    const b = cancelling(ok(itemBody("RETURNED")));
    await b.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash");
    expect(b.calls.map((c) => c.priority)).toEqual(["live"]);
  });
});

describe("reroute: the checks before anything is posted", () => {
  const NEW_RECEIVER = "rhea.new-account@example.test";
  const returned = (extra = {}) =>
    rheaRow("RETURNED", { cancelRequestedAt: "2026-11-05T02:05:00.000Z", cancelIntent: "reroute", ...extra });
  const rheaLine: ApprovedLine = {
    lineId: "line-M-031",
    memberNo: "M-031",
    receiver: NEW_RECEIVER,
    amountCents: 2_665n,
    currency: "USD",
  };
  async function request(over: Partial<RerouteRequest> = {}): Promise<RerouteRequest> {
    return {
      supersedesItemId: RHEA_ITEM_ID,
      rerouteNo: 1,
      receiver: NEW_RECEIVER,
      approvals: await approvalsFor([rheaLine], { signers: [TREASURER], rerouteNo: 1 }),
      ...over,
    };
  }
  function routing(rows = [returned()], runs = [RUN_FACTS]) {
    const repo = new MemoryPayoutsRepo({ items: rows, runs });
    return { repo, ...makeService(repo) };
  }

  it("refuses an id that is not a payout item id, and an item the database does not hold", async () => {
    const { service, repo } = routing();
    const find = vi.spyOn(repo, "findItem");
    await expect(service.reroute(await request({ supersedesItemId: "bad id!" }))).resolves.toMatchObject({
      code: "NOT_RETURNED",
      reason: "Not a payout item id",
    });
    expect(find).not.toHaveBeenCalled();
    await expect(service.reroute(await request({ supersedesItemId: "UNKNOWN0001" }))).resolves.toMatchObject({
      code: "NOT_RETURNED",
      reason: "Only a RETURNED item can be re-routed",
    });
  });

  it.each([
    ["a sender_item_id we never wrote", { senderItemId: "payout-31" }],
    ["a sender_item_id of another member", { senderItemId: "r37-M-030" }],
  ])("refuses an item with %s", async (_label, extra) => {
    const { service } = routing([returned(extra)]);
    await expect(service.reroute(await request())).resolves.toMatchObject({
      code: "INVALID_BATCH",
      reason: "The returned item does not carry one of our sender_item_ids",
    });
  });

  it.each([
    ["no run the database knows", []],
    ["a run of another number", [{ ...RUN_FACTS, runSeq: 38 }]],
    ["a run read under another id", [{ ...RUN_FACTS, runId: "0199f6a0-0000-7000-8000-000000000099" }]],
  ])("refuses an item of %s", async (_label, runs) => {
    const { service, repo } = routing([returned()], runs as never);
    if (runs.length > 0) vi.spyOn(repo, "loadRun").mockResolvedValue(runs[0] as never);
    await expect(service.reroute(await request())).resolves.toMatchObject({
      code: "INVALID_BATCH",
      reason: "The returned item does not belong to a known run",
    });
    expect(requests).toHaveLength(0);
  });

  describe("an earlier attempt's rows under this item", () => {
    const sbid = rerouteBatchId("M-031", 1);
    const existing = (over: Partial<SupersedingItem> = {}): SupersedingItem => ({
      senderBatchId: sbid,
      senderItemId: "r37x1-M-031",
      receiver: NEW_RECEIVER,
      amountCents: 2_665n,
      batchState: "SUBMITTED",
      submitted: { at: NOW.toISOString(), batchSha256: "0".repeat(64) },
      ...over,
    });

    it.each([
      ["another sender_batch_id", { senderBatchId: `${HERO_SENDER_BATCH_ID}-x9-M-031` }],
      ["another sender_item_id", { senderItemId: "r37x9-M-031" }],
      ["another amount", { amountCents: 2_664n }],
    ])("are not resumed when they carry %s", async (_label, over) => {
      const { service, repo } = routing();
      vi.spyOn(repo, "findSupersedingItem").mockResolvedValue(existing(over));
      await expect(service.reroute(await request())).resolves.toMatchObject({
        code: "ALREADY_REROUTED",
        reason: "Another re-route of this item is still unresolved",
      });
      expect(requests).toHaveLength(0);
    });

    it("a posted one is named as already re-routed", async () => {
      const { service, repo } = routing();
      vi.spyOn(repo, "findSupersedingItem").mockResolvedValue(existing({ batchState: "POSTED" }));
      await expect(service.reroute(await request())).resolves.toMatchObject({
        code: "ALREADY_REROUTED",
        reason: "This item was already re-routed",
        senderBatchId: sbid,
      });
    });
  });
});
