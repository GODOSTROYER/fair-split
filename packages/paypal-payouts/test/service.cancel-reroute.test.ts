import { describe, expect, it, vi } from "vitest";
import { PayoutsService, type PayoutsServiceDeps, payPalRequestId, senderBatchId } from "../src/index.js";
import { referenceBatchDigest } from "./support/digest.js";
import {
  created,
  digestFor,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  itemBody,
  paypalError,
  RHEA_ITEM_ID,
  RUN_BASE,
  rheaRow,
} from "./support/fixtures.js";
import { FetchPayPalHttp } from "./support/http.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";

useMsw();

function setup(rows = [rheaRow("UNCLAIMED")], extra: Partial<PayoutsServiceDeps> = {}) {
  const repo = new MemoryPayoutsRepo(rows);
  const service = new PayoutsService({
    http: new FetchPayPalHttp(),
    repo,
    batchDigest: referenceBatchDigest,
    sleep: async () => {},
    now: () => new Date("2026-11-05T02:20:00.000Z"),
    ...extra,
  });
  return { service, repo };
}

const CANCEL_PATH = `/v1/payments/payouts-item/${RHEA_ITEM_ID}/cancel`;

describe("PayoutsService.cancelUnclaimed: Rhea's parked item (C-07)", () => {
  it("records the cancel intent first, then cancels; RETURNED", async () => {
    const { service, repo } = setup();
    const intentFirst: boolean[] = [];
    onPost("/v1/payments/payouts-item/:id/cancel", () => {
      intentFirst.push(repo.items.get(RHEA_ITEM_ID)?.cancelRequestedAt !== null);
      return paypalJson(itemBody("RETURNED"), 200, "dbg-cancel");
    });

    const out = await service.cancelUnclaimed(RHEA_ITEM_ID, { intent: "cash", by: "persona:analyn" });

    expect(out).toEqual({
      kind: "RETURNED",
      payoutItemId: RHEA_ITEM_ID,
      intent: "cash",
      debugId: "dbg-cancel",
    });
    expect(intentFirst).toEqual([true]);
    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([`POST ${CANCEL_PATH}`]);
    expect(requests[0]?.body).toEqual({});
    expect(requests[0]?.headers.get("paypal-request-id")).toBeNull();
    expect(repo.events).toEqual([
      { type: "markCancelRequested", payoutItemId: RHEA_ITEM_ID, intent: "cash" },
      {
        type: "applyItemStatus",
        payoutItemId: RHEA_ITEM_ID,
        transactionStatus: "RETURNED",
        source: "cancel",
      },
    ]);
  });

  it("checks a 400 ('Only items in Unclaimed status can be cancelled.') with a fresh GET", async () => {
    const { service, repo } = setup();
    onPost("/v1/payments/payouts-item/:id/cancel", () =>
      paypalJson(
        paypalError("ITEM_INCORRECT_STATUS", "Only items in Unclaimed status can be cancelled."),
        400,
      ),
    );
    onGet("/v1/payments/payouts-item/:id", () => paypalJson(itemBody("SUCCESS"), 200, "dbg-get"));

    const out = await service.cancelUnclaimed(RHEA_ITEM_ID);

    expect(out).toEqual({
      kind: "NOT_UNCLAIMED",
      payoutItemId: RHEA_ITEM_ID,
      status: "SUCCESS",
      debugId: "dbg-get",
    });
    expect(repo.events.at(-1)).toEqual({
      type: "applyItemStatus",
      payoutItemId: RHEA_ITEM_ID,
      transactionStatus: "SUCCESS",
      source: "get",
    });
  });

  it("treats a 400 after our own earlier cancel went through as RETURNED", async () => {
    const { service } = setup();
    onPost("/v1/payments/payouts-item/:id/cancel", () =>
      paypalJson(
        paypalError("ITEM_INCORRECT_STATUS", "Only items in Unclaimed status can be cancelled."),
        400,
      ),
    );
    onGet("/v1/payments/payouts-item/:id", () => paypalJson(itemBody("RETURNED")));
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, { intent: "reroute" })).resolves.toMatchObject({
      kind: "RETURNED",
      intent: "reroute",
    });
  });

  it("surfaces PayPal's refusal when the item is still UNCLAIMED after a 400", async () => {
    const { service } = setup();
    onPost("/v1/payments/payouts-item/:id/cancel", () =>
      paypalJson(paypalError("VALIDATION_ERROR", "Invalid request - see details", "dbg-400"), 400, "dbg-400"),
    );
    onGet("/v1/payments/payouts-item/:id", () => paypalJson(itemBody("UNCLAIMED")));
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID)).rejects.toMatchObject({
      name: "PayoutsApiError",
      status: 400,
      paypalName: "VALIDATION_ERROR",
      debugId: "dbg-400",
    });
  });

  it("retries a 5xx on the cancel", async () => {
    const { service } = setup();
    onPost(
      "/v1/payments/payouts-item/:id/cancel",
      sequence(
        () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500),
        () => paypalJson(itemBody("RETURNED")),
      ),
    );
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID)).resolves.toMatchObject({ kind: "RETURNED" });
    expect(requests).toHaveLength(2);
  });

  it("does not call PayPal for an item that is not UNCLAIMED, and is idempotent once RETURNED", async () => {
    const claimed = setup([rheaRow("SUCCESS")]);
    await expect(claimed.service.cancelUnclaimed(RHEA_ITEM_ID)).resolves.toEqual({
      kind: "NOT_UNCLAIMED",
      payoutItemId: RHEA_ITEM_ID,
      status: "SUCCESS",
      debugId: null,
    });
    const returned = setup([
      rheaRow("RETURNED", { cancelRequestedAt: "2026-11-05T02:19:00.000Z", cancelIntent: "cash" }),
    ]);
    await expect(returned.service.cancelUnclaimed(RHEA_ITEM_ID)).resolves.toMatchObject({
      kind: "RETURNED",
      intent: "cash",
    });
    expect(requests).toHaveLength(0);
  });

  it("refuses unknown items and malformed ids without calling PayPal", async () => {
    const { service } = setup([]);
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID)).resolves.toMatchObject({
      kind: "REFUSED",
      code: "UNKNOWN_ITEM",
    });
    await expect(service.cancelUnclaimed("8AELMXH8UB2P8/../../x")).resolves.toMatchObject({
      code: "UNKNOWN_ITEM",
    });
    expect(requests).toHaveLength(0);
  });

  it("is refused while the kill switch is on", async () => {
    const { service, repo } = setup(undefined, { killSwitch: async () => true });
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID)).resolves.toMatchObject({ code: "KILL_SWITCH_ON" });
    expect(repo.events).toHaveLength(0);
  });
});

describe("PayoutsService.reroute: a one-item batch -x{n}", () => {
  const rheaLine = (receiver = "rhea.new-account@example.test") => ({
    lineId: "line-M-031",
    memberNo: "M-031",
    receiver,
    amountCents: 2_665n,
    currency: "USD" as const,
  });

  async function request(overrides: Record<string, unknown> = {}) {
    const line = rheaLine();
    const digest = await digestFor([line], 1);
    return {
      ...RUN_BASE,
      rerouteNo: 1,
      supersedesItemId: RHEA_ITEM_ID,
      line,
      approvals: [{ role: "TREASURER" as const, batchSha256: digest }],
      ...overrides,
    };
  }

  it("posts `{senderBatchId}-x1` with item `r37x1-M-031`, superseding the RETURNED item", async () => {
    const { service, repo } = setup([
      rheaRow("RETURNED", { cancelRequestedAt: "x", cancelIntent: "reroute" }),
    ]);
    const sbid = senderBatchId({ ...RUN_BASE, rerouteNo: 1 });
    onPost("/v1/payments/payouts", () => paypalJson(created(sbid), 201));

    const out = await service.reroute(await request());

    expect(sbid).toBe(`${HERO_SENDER_BATCH_ID}-x1`);
    expect(out).toMatchObject({ kind: "created", senderBatchId: sbid, requestId: payPalRequestId(sbid) });
    expect(requests[0]?.body).toMatchObject({
      sender_batch_header: { sender_batch_id: sbid, recipient_type: "EMAIL" },
      items: [
        {
          receiver: "rhea.new-account@example.test",
          amount: { currency: "USD", value: "26.65" },
          sender_item_id: "r37x1-M-031",
          purpose: "GOODS",
        },
      ],
    });
    const submitted = repo.batches.get(sbid)?.batch;
    expect(submitted).toMatchObject({
      kind: "reroute",
      items: [{ supersedesItemId: RHEA_ITEM_ID, senderItemId: "r37x1-M-031" }],
    });
  });

  it("only re-routes a RETURNED item", async () => {
    const { service } = setup([rheaRow("UNCLAIMED")]);
    await expect(service.reroute(await request())).resolves.toMatchObject({
      kind: "refused",
      code: "NOT_RETURNED",
    });
    expect(requests).toHaveLength(0);
  });

  it("pays exactly the returned amount, to the same member", async () => {
    const returned = [rheaRow("RETURNED", { cancelRequestedAt: "x" })];
    const more = setup(returned);
    await expect(
      more.service.reroute(await request({ line: { ...rheaLine(), amountCents: 2_666n } })),
    ).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    const other = setup(returned);
    await expect(
      other.service.reroute(await request({ line: { ...rheaLine(), memberNo: "M-014" } })),
    ).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    expect(requests).toHaveLength(0);
  });

  it("inv.i4.digest-is-payout: the one-item signature must cover the new receiver", async () => {
    const { service, repo } = setup([rheaRow("RETURNED", { cancelRequestedAt: "x" })]);
    const signedForOld = await digestFor([rheaLine("rhea.old@example.test")], 1);
    const out = await service.reroute(
      await request({ approvals: [{ role: "TREASURER", batchSha256: signedForOld }] }),
    );
    expect(out).toMatchObject({ kind: "refused", code: "DIGEST_MISMATCH" });
    expect(repo.batches.size).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("refuses a re-route number below 1 and a kill switch", async () => {
    const rows = [rheaRow("RETURNED", { cancelRequestedAt: "x" })];
    await expect(setup(rows).service.reroute(await request({ rerouteNo: 0 }))).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    const killSwitch = vi.fn(async () => true);
    await expect(setup(rows, { killSwitch }).service.reroute(await request())).resolves.toMatchObject({
      code: "KILL_SWITCH_ON",
    });
  });

  it("ignores HERO_LINES order: digests are over items sorted by sender_item_id", async () => {
    const reversed = [...HERO_LINES].reverse();
    expect(await digestFor(reversed)).toBe(await digestFor(HERO_LINES));
  });
});
