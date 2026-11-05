// The last round of tests for mutation-testing survivors (handoff T3) in PayoutsService: the edges of
// reading a listed batch before adopting it (I4), which pages are fetched, what a failure in the middle of
// retries leaves in the outcome, the default sleep, and malformed rows the database could hand over.

import type { PayPalHttp, PayPalRequest, PayPalResult } from "@fairsplit/paypal-core";
import { describe, expect, it, vi } from "vitest";
import { createPayoutBatch } from "../src/functions.js";
import { type Actor, type ApprovedLine, linkedBatchId, type PayPalFailure } from "../src/index.js";
import { CHAIR, TREASURER } from "./support/approvals.js";
import {
  approvalsFor,
  batchBody,
  created,
  duplicateBatch,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  lineHash,
  PAYOUT_BATCH_ID,
  paypalError,
  postingSnapshot,
  RHEA_ITEM_ID,
  RUN_FACTS,
  rheaRow,
} from "./support/fixtures.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { JUDGE_LIMITS, makeService } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;
const ANALYN: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };
const BATCH_PATH = `/v1/payments/payouts/${PAYOUT_BATCH_ID}`;

async function adopt(body: unknown) {
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
  const { service } = makeService(repo);
  const markPosted = vi.spyOn(repo, "markPosted");
  onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
  onGet(BATCH_PATH, () => paypalJson(body as never, 200, "dbg-get"));
  return { out: await service.executeApproved(RUN_ID), markPosted };
}
const listed = () =>
  batchBody(HERO_LINES) as unknown as { items: Record<string, unknown>[] } & Record<string, unknown>;
const cannotRead = { code: "ADOPT_FAILED", reason: "The existing batch has an item we cannot read" };
const differs = { code: "ADOPT_FAILED", reason: "The existing batch differs from the approved digest" };

describe("reading a listed batch before adopting it", () => {
  it("an amount of exactly the largest safe cents is read (and then does not match); one more is not", async () => {
    const at = listed();
    (at.items[0] as { payout_item: { amount: unknown } }).payout_item.amount = {
      currency: "USD",
      value: "90071992547409.91",
    };
    await expect(adopt(at).then((r) => r.out)).resolves.toMatchObject(differs);
  });

  it("a null item, or an item without sender_item_id, cannot be read", async () => {
    const withNull = listed();
    withNull.items[0] = null as never;
    await expect(adopt(withNull).then((r) => r.out)).resolves.toMatchObject(cannotRead);
    const noId = listed();
    delete (noId.items[0] as { payout_item: Record<string, unknown> }).payout_item.sender_item_id;
    await expect(adopt(noId).then((r) => r.out)).resolves.toMatchObject(cannotRead);
  });

  it("a listing that repeats an item is not ours", async () => {
    const twice = listed();
    twice.items.push(structuredClone(twice.items[0]) as Record<string, unknown>);
    await expect(adopt(twice).then((r) => r.out)).resolves.toMatchObject(differs);
  });

  it("a page without an items list lists nothing yet (ADOPT_PENDING)", async () => {
    const noItems = listed();
    delete (noItems as Record<string, unknown>).items;
    await expect(adopt(noItems).then((r) => r.out)).resolves.toMatchObject({
      kind: "unresolved",
      reason: "ADOPT_PENDING",
    });
  });

  it("records the adopted batch's status on the rows", async () => {
    const { out, markPosted } = await adopt(batchBody(HERO_LINES, { status: "SUCCESS" }));
    expect(out).toMatchObject({ kind: "adopted" });
    expect(markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ batchStatus: "SUCCESS", outcome: "adopted" }),
    );
  });
});

describe("which pages are fetched", () => {
  async function adoptMany(count: number, totalPages: number) {
    const lines: ApprovedLine[] = Array.from({ length: count }, (_, i) => {
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
    const all = batchBody(lines) as unknown as { items: unknown[] };
    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet(BATCH_PATH, (req) => {
      const page = Number(req.url.searchParams.get("page"));
      return paypalJson({
        ...all,
        total_pages: totalPages,
        items: all.items.slice((page - 1) * 1_000, page * 1_000),
      } as never);
    });
    const out = await service.executeApproved(RUN_ID);
    return {
      out,
      pages: requests.filter((r) => r.method === "GET").map((r) => r.url.searchParams.get("page")),
    };
  }

  it("one full page that is the last page: no second GET", async () => {
    const { out, pages } = await adoptMany(1_000, 1);
    expect(out).toMatchObject({ kind: "adopted" });
    expect(pages).toEqual(["1"]);
  }, 60_000);

  it("a short page ends the listing even when PayPal counts more pages", async () => {
    const { out, pages } = await adoptMany(1_001, 3);
    expect(out).toMatchObject({ kind: "adopted" });
    expect(pages).toEqual(["1", "2"]);
  }, 60_000);
});

describe("retries and their outcome", () => {
  function scripted(...steps: (PayPalResult<unknown> | Error)[]) {
    const calls: PayPalRequest[] = [];
    const http: PayPalHttp = {
      request: async <T>(req: PayPalRequest) => {
        calls.push(req);
        const step = steps[Math.min(calls.length - 1, steps.length - 1)];
        if (step instanceof Error) throw step;
        return step as PayPalResult<T>;
      },
    };
    return { http, calls };
  }
  const failed = (status: number) =>
    ({
      ok: false,
      kind: "http",
      status,
      name: "INTERNAL_SERVICE_ERROR",
      message: "x",
      details: [],
      links: [],
      debugId: "dbg-500",
      retryable: true,
      retryAfterMs: null,
      delivery: "unknown",
      ms: 1,
      attempts: 1,
    }) as unknown as PayPalResult<unknown>;

  it("a POST that throws after a 500 leaves no status or debug id in the unresolved outcome", async () => {
    const { http } = scripted(failed(500), new Error("reset"));
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    await expect(makeService(repo, { http }).service.executeApproved(RUN_ID)).resolves.toEqual({
      kind: "unresolved",
      senderBatchId: HERO_SENDER_BATCH_ID,
      attempts: 4,
      lastStatus: null,
      debugId: null,
      reason: "RETRIES_EXHAUSTED",
    });
  });

  it("a cancel that throws after a 503 leaves no status in the unresolved outcome", async () => {
    const { http } = scripted(failed(503), new Error("reset"));
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    await expect(
      makeService(repo, { http }).service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash"),
    ).resolves.toEqual({
      kind: "UNRESOLVED",
      payoutItemId: RHEA_ITEM_ID,
      attempts: 4,
      lastStatus: null,
      reason: "RETRIES_EXHAUSTED",
    });
  });

  it("a 200 cancel or a checking GET without a body is still read", async () => {
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    const ok = {
      ok: true,
      status: 200,
      body: null,
      debugId: "d",
      ms: 1,
      attempts: 1,
      requestId: null,
    } as PayPalResult<unknown>;
    await expect(
      makeService(repo, { http: scripted(ok).http }).service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash"),
    ).resolves.toMatchObject({ kind: "RETURNED" });
    const again = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    const refused = {
      ...(failed(400) as object),
      name: "ITEM_INCORRECT_STATUS",
      retryable: false,
    } as PayPalResult<unknown>;
    await expect(
      makeService(again, { http: scripted(refused, ok).http }).service.cancelUnclaimed(
        RHEA_ITEM_ID,
        ANALYN,
        "cash",
      ),
    ).resolves.toMatchObject({ kind: "NOT_UNCLAIMED", status: null });
  });

  it("without an injected sleep, the service really waits and then retries", async () => {
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    const { service } = makeService(repo, { sleep: undefined, retryDelaysMs: [1] });
    onPost(
      "/v1/payments/payouts",
      sequence(
        () => paypalJson(paypalError("INTERNAL_SERVICE_ERROR", "x"), 500),
        () => paypalJson(created(), 201),
      ),
    );
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created", attempts: 2 });
  }, 10_000);
});

describe("malformed inputs and exact outcomes", () => {
  it("a refusal that is not an approval check carries no `check` field", async () => {
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    await expect(
      makeService(repo, { killSwitch: async () => true }).service.executeApproved(RUN_ID),
    ).resolves.toEqual({
      kind: "refused",
      code: "KILL_SWITCH_ON",
      reason: "Payouts are paused by the co-op",
      senderBatchId: null,
    });
  });

  it("a null member line, a null approval, and an actor id that is not a string", async () => {
    const repo = new MemoryPayoutsRepo({
      postings: [await postingSnapshot(HERO_LINES, { memberLines: [null] as never })],
    });
    await expect(makeService(repo).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      reason: "A member line has no member number",
    });
    const approvals = [...(await approvalsFor(HERO_LINES)), null] as never;
    const nulled = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES, { approvals })] });
    await expect(makeService(nulled).service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
    });
    const items = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    const odd = { ...ANALYN, id: 7 as unknown as string };
    await expect(
      makeService(items).service.cancelUnclaimed(RHEA_ITEM_ID, odd, "cash"),
    ).resolves.toMatchObject({
      code: "ACTOR_NOT_ALLOWED",
    });
  });

  it("an item id that is not one is refused without reading the database", async () => {
    const repo = new MemoryPayoutsRepo({ items: [rheaRow("UNCLAIMED")], runs: [RUN_FACTS] });
    const find = vi.spyOn(repo, "findItem");
    await expect(makeService(repo).service.cancelUnclaimed("bad id!", ANALYN, "cash")).resolves.toMatchObject(
      {
        code: "UNKNOWN_ITEM",
      },
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("a re-route of a run whose season code is not one is refused, not thrown", async () => {
    const row = rheaRow("RETURNED", {
      cancelRequestedAt: "2026-11-05T02:05:00.000Z",
      cancelIntent: "reroute",
    });
    const repo = new MemoryPayoutsRepo({ items: [row], runs: [{ ...RUN_FACTS, seasonCode: "2026A" }] });
    const line: ApprovedLine = { ...(HERO_LINES[7] as ApprovedLine), receiver: "rhea.new@example.test" };
    const out = await makeService(repo).service.reroute({
      supersedesItemId: RHEA_ITEM_ID,
      rerouteNo: 1,
      receiver: line.receiver,
      approvals: await approvalsFor([line], { signers: [TREASURER], rerouteNo: 1 }),
    });
    expect(out).toMatchObject({
      code: "INVALID_BATCH",
      reason: 'Season code must look like 2026-A: "2026A"',
    });
  });

  it("linkedBatchId skips a null link", () => {
    const failure = {
      details: [],
      links: [null, { href: `https://api.sandbox.paypal.com/v1/payments/payouts/${PAYOUT_BATCH_ID}` }],
    } as unknown as PayPalFailure;
    expect(linkedBatchId(failure)).toBe(PAYOUT_BATCH_ID);
  });

  it("create refuses a batch where only some items name a recipient_type", async () => {
    const http = { request: async () => ({ ok: true }) } as unknown as PayPalHttp;
    await expect(
      createPayoutBatch(
        http,
        {},
        {
          sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37" },
          items: [
            {
              receiver: "a@example.test",
              amount: { currency: "USD", value: "1.00" },
              recipient_type: "EMAIL",
            },
            { receiver: "b@example.test", amount: { currency: "USD", value: "1.00" } },
          ],
        },
      ),
    ).rejects.toThrow("recipient_type must be set on sender_batch_header or on every item.");
  });
});
