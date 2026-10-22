import { describe, expect, it, vi } from "vitest";
import {
  type Actor,
  type CancelIntent,
  type PayoutsServiceDeps,
  payPalRequestId,
  type RerouteRequest,
  senderBatchId,
} from "../src/index.js";
import { TREASURER } from "./support/approvals.js";
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
  paypalError,
  RHEA_ITEM_ID,
  RUN_BASE,
  RUN_FACTS,
  rheaRow,
} from "./support/fixtures.js";
import { onGet, onPost, paypalJson, requests, sequence, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { JUDGE_LIMITS, makeService } from "./support/service.js";

useMsw();

const ANALYN: Actor = { kind: "human", id: "treasurer:analyn", impersonatedBy: null };
const SWEEPER: Actor = { kind: "system", id: "task:judgeReset", impersonatedBy: null };

function setup(rows = [rheaRow("UNCLAIMED")], extra: Partial<PayoutsServiceDeps> = {}) {
  const repo = new MemoryPayoutsRepo({ items: rows, runs: [RUN_FACTS] });
  return { repo, ...makeService(repo, extra) };
}

const CANCEL_PATH = `/v1/payments/payouts-item/${RHEA_ITEM_ID}/cancel`;

describe("PayoutsService.cancelUnclaimed(payoutItemId, by, then): Rhea's parked item (C-07)", () => {
  it("records the intent and the actor first, then cancels; RETURNED", async () => {
    const { service, repo } = setup();
    const intentFirst: boolean[] = [];
    onPost("/v1/payments/payouts-item/:id/cancel", () => {
      intentFirst.push(repo.items.get(RHEA_ITEM_ID)?.cancelRequestedAt !== null);
      return paypalJson(itemBody("RETURNED"), 200, "dbg-cancel");
    });

    const out = await service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash");

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
      {
        type: "markCancelRequested",
        payoutItemId: RHEA_ITEM_ID,
        intent: "cash",
        by: "human:treasurer:analyn",
      },
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

    const out = await service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash");

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
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "reroute")).resolves.toMatchObject({
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
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).rejects.toMatchObject({
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
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, SWEEPER, "cash")).resolves.toMatchObject({
      kind: "RETURNED",
    });
    expect(requests).toHaveLength(2);
  });

  it("re-reads the kill switch before every retry of the cancel", async () => {
    let on = false;
    const { service, repo } = setup(undefined, { killSwitch: async () => on });
    onPost("/v1/payments/payouts-item/:id/cancel", () => {
      on = true;
      return paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 503);
    });
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "UNRESOLVED",
      payoutItemId: RHEA_ITEM_ID,
      attempts: 1,
      lastStatus: 503,
      reason: "KILL_SWITCH_ON",
    });
    expect(requests).toHaveLength(1);
    expect(repo.items.get(RHEA_ITEM_ID)).toMatchObject({ status: "UNCLAIMED", cancelIntent: "cash" });
  });

  it("does not call PayPal for an item that is not UNCLAIMED, and is idempotent once RETURNED", async () => {
    const claimed = setup([rheaRow("SUCCESS")]);
    await expect(claimed.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toEqual({
      kind: "NOT_UNCLAIMED",
      payoutItemId: RHEA_ITEM_ID,
      status: "SUCCESS",
      debugId: null,
    });
    const returned = setup([
      rheaRow("RETURNED", { cancelRequestedAt: "2026-11-05T02:19:00.000Z", cancelIntent: "cash" }),
    ]);
    await expect(returned.service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "RETURNED",
      intent: "cash",
    });
    expect(requests).toHaveLength(0);
  });

  it("never changes an intent once recorded: a cash cancel cannot become a re-route", async () => {
    const { service, repo } = setup([
      rheaRow("UNCLAIMED", { cancelRequestedAt: "2026-11-05T02:19:00.000Z", cancelIntent: "cash" }),
    ]);
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "reroute")).resolves.toEqual({
      kind: "REFUSED",
      payoutItemId: RHEA_ITEM_ID,
      code: "INTENT_CONFLICT",
    });
    expect(requests).toHaveLength(0);
    expect(repo.events).toHaveLength(0);
  });

  it.each<[string, Actor]>([
    ["the agent", { kind: "agent", id: "agent:ai-7", impersonatedBy: null }],
    ["the engine", { kind: "engine", id: "engine", impersonatedBy: null }],
    ["an actor with no id", { kind: "human", id: "", impersonatedBy: null }],
  ])("refuses a cancel by %s", async (_label, by) => {
    const { service, repo } = setup();
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, by, "cash")).resolves.toMatchObject({
      kind: "REFUSED",
      code: "ACTOR_NOT_ALLOWED",
    });
    expect(requests).toHaveLength(0);
    expect(repo.events).toHaveLength(0);
  });

  it("requires an intent", async () => {
    const { service } = setup();
    await expect(
      service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, undefined as unknown as CancelIntent),
    ).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(0);
  });

  it("refuses unknown items and malformed ids without calling PayPal", async () => {
    const { service } = setup([]);
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      kind: "REFUSED",
      code: "UNKNOWN_ITEM",
    });
    await expect(service.cancelUnclaimed("8AELMXH8UB2P8/../../x", ANALYN, "cash")).resolves.toMatchObject({
      code: "UNKNOWN_ITEM",
    });
    expect(requests).toHaveLength(0);
  });

  it("is refused while the kill switch is on", async () => {
    const { service, repo } = setup(undefined, { killSwitch: async () => true });
    await expect(service.cancelUnclaimed(RHEA_ITEM_ID, ANALYN, "cash")).resolves.toMatchObject({
      code: "KILL_SWITCH_ON",
    });
    expect(repo.events).toHaveLength(0);
  });
});

describe("PayoutsService.reroute: a one-item batch -x{n}, at most once per returned item", () => {
  const NEW_RECEIVER = "rhea.new-account@example.test";
  const rheaLine = (receiver = NEW_RECEIVER, amountCents = 2_665n) => ({
    lineId: "line-M-031",
    memberNo: "M-031",
    receiver,
    amountCents,
    currency: "USD" as const,
  });
  const returnedForReroute = (extra = {}) =>
    rheaRow("RETURNED", { cancelRequestedAt: "2026-11-05T02:05:00.000Z", cancelIntent: "reroute", ...extra });

  async function request(overrides: Partial<RerouteRequest> = {}, rerouteNo = 1): Promise<RerouteRequest> {
    return {
      supersedesItemId: RHEA_ITEM_ID,
      rerouteNo,
      receiver: NEW_RECEIVER,
      approvals:
        overrides.approvals ?? (await approvalsFor([rheaLine()], { signers: [TREASURER], rerouteNo })),
      ...overrides,
    };
  }

  it("posts `{senderBatchId}-x1` with item `r37x1-M-031`, the returned amount, superseding the item", async () => {
    const { service, repo } = setup([returnedForReroute()]);
    const sbid = senderBatchId({ ...RUN_BASE, rerouteNo: 1 });
    onPost("/v1/payments/payouts", () => paypalJson(created(sbid), 201));

    const out = await service.reroute(await request());

    expect(sbid).toBe(`${HERO_SENDER_BATCH_ID}-x1`);
    expect(out).toMatchObject({ kind: "created", senderBatchId: sbid, requestId: payPalRequestId(sbid) });
    expect(requests[0]?.body).toMatchObject({
      sender_batch_header: { sender_batch_id: sbid, recipient_type: "EMAIL" },
      items: [
        {
          receiver: NEW_RECEIVER,
          amount: { currency: "USD", value: "26.65" },
          sender_item_id: "r37x1-M-031",
          purpose: "GOODS",
        },
      ],
    });
    expect(repo.batches.get(sbid)?.batch).toMatchObject({
      kind: "reroute",
      items: [{ supersedesItemId: RHEA_ITEM_ID, senderItemId: "r37x1-M-031", amountCents: 2_665n }],
    });
  });

  it.each([
    ["at the daily cap", { postsInLast24h: async () => JUDGE_LIMITS.maxPostsPer24h }, "DAILY_CAP"],
    [
      "a cent under the balance floor",
      { balanceCents: async () => JUDGE_LIMITS.minBalanceCents + 2_665n - 1n },
      "SANDBOX_GUARD",
    ],
  ] as const)(
    "a re-route is a new live batch: refused %s, nothing written or sent",
    async (_label, patch, code) => {
      const { service, repo } = setup([returnedForReroute()], { limits: { ...JUDGE_LIMITS, ...patch } });
      await expect(service.reroute(await request())).resolves.toMatchObject({ kind: "refused", code });
      expect(repo.events).toHaveLength(0);
      expect(requests).toHaveLength(0);
    },
  );

  it("only re-routes a RETURNED item", async () => {
    const { service } = setup([rheaRow("UNCLAIMED")]);
    await expect(service.reroute(await request())).resolves.toMatchObject({
      kind: "refused",
      code: "NOT_RETURNED",
    });
    expect(requests).toHaveLength(0);
  });

  it("inv.i3.conservation: an item cancelled for cash (paid at the bodega) is never re-routed", async () => {
    const { service, repo } = setup([returnedForReroute({ cancelIntent: "cash" })]);
    await expect(service.reroute(await request())).resolves.toMatchObject({
      kind: "refused",
      code: "NOT_FOR_REROUTE",
      reason: "This item was cancelled to be paid in cash",
    });
    expect(requests).toHaveLength(0);
    expect(repo.events).toHaveLength(0);
  });

  it("refuses a RETURNED that did not follow our own cancel (register §7)", async () => {
    const { service } = setup([rheaRow("RETURNED", { cancelIntent: "reroute" })]);
    await expect(service.reroute(await request())).resolves.toMatchObject({ code: "NOT_FOR_REROUTE" });
    expect(requests).toHaveLength(0);
  });

  it("inv.i3.conservation: a second re-route of the same item is refused, whatever its number", async () => {
    const { service, repo } = setup([returnedForReroute()]);
    onPost("/v1/payments/payouts", () =>
      paypalJson(created(senderBatchId({ ...RUN_BASE, rerouteNo: 1 })), 201),
    );
    await expect(service.reroute(await request())).resolves.toMatchObject({ kind: "created" });

    await expect(service.reroute(await request())).resolves.toMatchObject({
      kind: "refused",
      code: "ALREADY_REROUTED",
    });
    await expect(service.reroute(await request({}, 2))).resolves.toMatchObject({
      kind: "refused",
      code: "INVALID_BATCH",
      reason: "This item's re-route is x1, not x2",
    });
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(repo.types()).toEqual(["writeSubmitted", "markPosted"]);
  });

  it("a retry after an unresolved re-route resumes the same ids, so PayPal holds one batch", async () => {
    const sbid = senderBatchId({ ...RUN_BASE, rerouteNo: 1 });
    const digest = await digestFor([rheaLine()], 1);
    const { service, repo } = setup([returnedForReroute()]);
    onPost("/v1/payments/payouts", () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500));
    await expect(service.reroute(await request())).resolves.toMatchObject({ kind: "unresolved" });

    onPost("/v1/payments/payouts", () => paypalJson(duplicateBatch(), 400));
    onGet("/v1/payments/payouts/:id", () =>
      paypalJson(batchBody([rheaLine()], { sbid, rerouteNo: 1, digest })),
    );
    const later = makeService(repo, { now: () => new Date(NOW.getTime() + 3_600_000) }).service;
    await expect(later.reroute(await request())).resolves.toMatchObject({
      kind: "adopted",
      senderBatchId: sbid,
    });
    const ids = new Set(
      requests.filter((r) => r.method === "POST").map((r) => r.headers.get("paypal-request-id")),
    );
    expect(ids).toEqual(new Set([payPalRequestId(sbid)]));
    expect(repo.types().filter((t) => t === "writeSubmitted")).toHaveLength(1);
  });

  it("refuses to re-route to another receiver while an earlier re-route is unresolved", async () => {
    const { service, repo } = setup([returnedForReroute()]);
    onPost("/v1/payments/payouts", () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "boom"), 500));
    await expect(service.reroute(await request())).resolves.toMatchObject({ kind: "unresolved" });
    const posted = requests.length;

    const other = "rhea.other-account@example.test";
    const elsewhere = await request({
      receiver: other,
      approvals: await approvalsFor([rheaLine(other)], { signers: [TREASURER], rerouteNo: 1 }),
    });
    await expect(service.reroute(elsewhere)).resolves.toMatchObject({
      code: "ALREADY_REROUTED",
      reason: "Another re-route of this item is still unresolved",
    });
    expect(requests).toHaveLength(posted);
    expect(repo.types().filter((t) => t === "writeSubmitted")).toHaveLength(1);
  });

  it("re-routes a re-routed item that came back too as x2, superseding the x1 item", async () => {
    const x1 = returnedForReroute({ payoutItemId: "X1ITEMM031AB12", senderItemId: "r37x1-M-031" });
    const { service } = setup([x1]);
    const sbid = senderBatchId({ ...RUN_BASE, rerouteNo: 2 });
    onPost("/v1/payments/payouts", () => paypalJson(created(sbid), 201));
    await expect(
      service.reroute(
        await request(
          {
            supersedesItemId: "X1ITEMM031AB12",
            approvals: await approvalsFor([rheaLine()], { signers: [TREASURER], rerouteNo: 2 }),
          },
          2,
        ),
      ),
    ).resolves.toMatchObject({ kind: "created", senderBatchId: `${HERO_SENDER_BATCH_ID}-x2` });
    expect(requests[0]?.body).toMatchObject({ items: [{ sender_item_id: "r37x2-M-031" }] });
  });

  it("inv.i4.digest-is-payout: the one-item signature must cover the new receiver and the stored amount", async () => {
    const { service, repo } = setup([returnedForReroute()]);
    const signedForOld = await approvalsFor([rheaLine("rhea.old@example.test")], {
      signers: [TREASURER],
      rerouteNo: 1,
    });
    await expect(service.reroute(await request({ approvals: signedForOld }))).resolves.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    const signedForMore = await approvalsFor([rheaLine(NEW_RECEIVER, 2_666n)], {
      signers: [TREASURER],
      rerouteNo: 1,
    });
    await expect(service.reroute(await request({ approvals: signedForMore }))).resolves.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    expect(repo.batches.size).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("inv.i6.human-gate: a re-route needs the treasurer's fresh signature", async () => {
    const { service } = setup([returnedForReroute()]);
    await expect(service.reroute(await request({ approvals: [] }))).resolves.toMatchObject({
      code: "APPROVALS_MISSING",
    });
    expect(requests).toHaveLength(0);
  });

  it("refuses a re-route number below 1, and a kill switch", async () => {
    const rows = [returnedForReroute()];
    await expect(setup(rows).service.reroute(await request({ approvals: [] }, 0))).resolves.toMatchObject({
      code: "INVALID_BATCH",
    });
    const killSwitch = vi.fn(async () => true);
    await expect(setup(rows, { killSwitch }).service.reroute(await request())).resolves.toMatchObject({
      code: "KILL_SWITCH_ON",
    });
    expect(requests).toHaveLength(0);
  });

  it("ignores HERO_LINES order: digests are over items sorted by sender_item_id", async () => {
    const reversed = [...HERO_LINES].reverse();
    expect(await digestFor(reversed)).toBe(await digestFor(HERO_LINES));
  });
});
