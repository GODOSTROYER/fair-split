import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Simulator } from "../src/simulator.js";
import { DAY_MS } from "../src/util/time.js";
import { batchBody, call, fakeTime, MEMBER_PAYOUTS, newSim, receiver, subscribe, token } from "./helpers.js";

describe("Payouts v1", () => {
  let sim: Simulator;
  let tok: string;

  beforeEach(async () => {
    sim = await newSim();
    tok = await token(sim);
  });
  afterEach(async () => {
    vi.useRealTimers();
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    call(sim, "POST", "/v1/payments/payouts", { token: tok, body, headers });

  it("rejects a duplicate sender_batch_id with USER_BUSINESS_ERROR and a HATEOAS link to the original", async () => {
    const first = await post(batchBody("2026A-dup-r1"));
    expect(first.status).toBe(201);
    const original = first.json.batch_header.payout_batch_id as string;
    const dup = await post(batchBody("2026A-dup-r1"));
    expect(dup.status).toBe(400);
    expect(dup.json.name).toBe("USER_BUSINESS_ERROR");
    expect(dup.json.debug_id).toMatch(/^sim-[0-9a-f]{12}$/);
    const detail = dup.json.details[0];
    expect(detail.issue).toBe("Batch with given sender_batch_id already exists");
    const href = detail.link[0].href as string;
    expect(href).toBe(`https://api-m.sandbox.paypal.com/v1/payments/payouts/${original}`);
    // Adopt: follow the link and read the original batch.
    const adopted = await call(sim, "GET", new URL(href).pathname, { token: tok });
    expect(adopted.status).toBe(200);
    expect(adopted.json.batch_header.payout_batch_id).toBe(original);
    expect(adopted.json.batch_header.sender_batch_header.sender_batch_id).toBe("2026A-dup-r1");
  });

  it("allows a sender_batch_id again after the 30-day window", async () => {
    expect((await post(batchBody("2026A-window-r1"))).status).toBe(201);
    await sim.idle();
    sim.clock.advance(31 * DAY_MS);
    expect((await post(batchBody("2026A-window-r1"))).status).toBe(401); // the 9-hour token expired too
    tok = await token(sim);
    expect((await post(batchBody("2026A-window-r1"))).status).toBe(201);
  });

  it("honours PayPal-Request-Id: an identical retry replays the original 201 without a second batch", async () => {
    const body = batchBody("2026A-idem-r1");
    const a = await post(body, { "paypal-request-id": "idem-1" });
    const b = await post(body, { "paypal-request-id": "idem-1" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("paypal-idempotent-replay")).toBe("true");
    expect(b.json.batch_header.payout_batch_id).toBe(a.json.batch_header.payout_batch_id);
    expect(Object.keys(sim.state.batches)).toHaveLength(1);
  });

  it("does not replay a reused PayPal-Request-Id with a different body (as observed in the sandbox, PR #107)", async () => {
    const a = await post(batchBody("2026A-idem-r2"), { "paypal-request-id": "idem-2" });
    const b = await post(batchBody("2026A-idem-r3"), { "paypal-request-id": "idem-2" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.batch_header.payout_batch_id).not.toBe(a.json.batch_header.payout_batch_id);
  });

  it("ERRPYO002 rejects the whole POST synchronously (SENDER_EMAIL_UNCONFIRMED)", async () => {
    const body = batchBody("2026A-errpyo002", [
      { memberNo: "M-014", email: "consolacion.bacus@example.org", value: "1.00" },
    ]);
    const [first] = body.items as { note: string }[];
    if (first) first.note = "ERRPYO002";
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(res.json.name).toBe("SENDER_EMAIL_UNCONFIRMED");
    expect(res.json.message).toBe("Authorization error occurred");
    expect(Object.keys(sim.state.batches)).toHaveLength(0);
  });

  it("ERRPYO005 rejects the whole POST synchronously (INSUFFICIENT_FUNDS), nothing is held", async () => {
    const before = sim.balance("coop", "USD");
    const body = batchBody("2026A-errpyo005", [
      { memberNo: "M-031", email: "payouts-simulator-receiver@paypal.com", value: "1.00" },
    ]);
    const [first] = body.items as { note: string }[];
    if (first) first.note = "ERRPYO005";
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(res.json.name).toBe("INSUFFICIENT_FUNDS");
    expect(sim.balance("coop", "USD")).toEqual(before);
    expect(Object.keys(sim.state.batches)).toHaveLength(0);
  });

  it("rejects real insufficient funds with the same INSUFFICIENT_FUNDS shape", async () => {
    const res = await post(
      batchBody("2026A-too-much", [
        { memberNo: "M-014", email: "consolacion.bacus@example.org", value: "100000.00" },
      ]),
    );
    expect(res.status).toBe(422);
    expect(res.json.name).toBe("INSUFFICIENT_FUNDS");
  });

  it("rejects recipient_type PHONE as the sandbox does", async () => {
    const body = batchBody("2026A-phone");
    (body.sender_batch_header as { recipient_type: string }).recipient_type = "PHONE";
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.json.name).toBe("VALIDATION_ERROR");
    expect(res.json.details[0].issue).toContain("PHONE");
  });

  it("supports the cancel test values and 404s for unknown items", async () => {
    const c = await call(sim, "POST", "/v1/payments/payouts-item/ERRPYO004/cancel", { token: tok });
    expect(c.status).toBe(400);
    expect(c.json.name).toBe("BATCH_NOT_COMPLETED");
    const missing = await call(sim, "GET", "/v1/payments/payouts-item/NOPE0000NOPE0", { token: tok });
    expect(missing.status).toBe(404);
    expect(missing.json.name).toBe("INVALID_RESOURCE_ID");
    const batch = await call(sim, "GET", "/v1/payments/payouts/NOPE0000NOPE0", { token: tok });
    expect(batch.status).toBe(404);
  });

  it("pages batch items and can return only the batch header", async () => {
    const created = await post(batchBody("2026A-paging"));
    const id = created.json.batch_header.payout_batch_id as string;
    await sim.idle();
    const page1 = await call(
      sim,
      "GET",
      `/v1/payments/payouts/${id}?page_size=3&page=1&total_required=true`,
      { token: tok },
    );
    expect(page1.json.items).toHaveLength(3);
    expect(page1.json.total_pages).toBe(3);
    expect(page1.json.links.map((l: { rel: string }) => l.rel)).toEqual(["self", "next"]);
    const header = await call(sim, "GET", `/v1/payments/payouts/${id}?fields=batch_header`, { token: tok });
    expect(header.json.items).toBeUndefined();
    expect(header.json.batch_header.batch_status).toBe("SUCCESS");
  });

  it("returns an UNCLAIMED item automatically after 30 days (PAYMENT.PAYOUTS-ITEM.RETURNED)", async () => {
    const rx = await receiver();
    await subscribe(sim, tok, rx.url);
    const created = await post(
      batchBody("2026A-unclaimed", [MEMBER_PAYOUTS[7] as (typeof MEMBER_PAYOUTS)[number]]),
    );
    expect(created.status).toBe(201);
    await sim.idle();
    const item = Object.values(sim.state.items)[0];
    expect(item?.status).toBe("UNCLAIMED");
    sim.clock.advance(29 * DAY_MS);
    sim.sweep();
    expect(item?.status).toBe("UNCLAIMED");
    sim.clock.advance(2 * DAY_MS);
    sim.sweep();
    await sim.idle();
    expect(item?.status).toBe("RETURNED");
    expect(rx.deliveries.map((d) => d.json.event_type)).toContain("PAYMENT.PAYOUTS-ITEM.RETURNED");
    expect(sim.balance("coop", "USD").available).toBe(10_000_000);
    await rx.close();
  });

  it("can deny the next batch (PAYMENT.PAYOUTSBATCH.DENIED) and releases the hold", async () => {
    const rx = await receiver();
    await subscribe(sim, tok, rx.url);
    sim.state.denyNextBatch = true;
    const created = await post(batchBody("2026A-denied"));
    expect(created.status).toBe(201);
    await sim.idle();
    const id = created.json.batch_header.payout_batch_id as string;
    const got = await call(sim, "GET", `/v1/payments/payouts/${id}`, { token: tok });
    expect(got.json.batch_header.batch_status).toBe("DENIED");
    expect(rx.deliveries.map((d) => d.json.event_type)).toEqual(["PAYMENT.PAYOUTSBATCH.DENIED"]);
    expect(sim.balance("coop", "USD")).toEqual({ available: 10_000_000, withheld: 0 });
    await rx.close();
  });

  it("holds funds while PENDING (available down, withheld up) and settles them on processing", async () => {
    // Real-time processing (speed 1) on fake timers: the batch stays PENDING for exactly its 30 s, however
    // slow the machine, and then runs to the end when the test moves the clock.
    fakeTime({ timers: true });
    const slow = await newSim({ speed: 1, timing: { batchProcessingS: 30, itemS: 1, batchCompleteS: 1 } });
    try {
      const t = await token(slow);
      const res = await call(slow, "POST", "/v1/payments/payouts", {
        token: t,
        body: batchBody("2026A-hold"),
      });
      expect(res.status).toBe(201);
      const path = `/v1/payments/payouts/${res.json.batch_header.payout_batch_id}`;
      const usd = async () =>
        (await call(slow, "GET", "/v1/reporting/balances", { token: t })).json.balances[0] as Record<
          string,
          { value: string }
        >;
      const pending = await usd();
      expect(pending.available_balance?.value).toBe("99629.61");
      expect(pending.withheld_balance?.value).toBe("370.39");
      expect(pending.total_balance?.value).toBe("100000.00");
      const batch = await call(slow, "GET", path, { token: t });
      expect(batch.json.batch_header.batch_status).toBe("PENDING");
      expect(batch.json.items[0].transaction_status).toBe("PENDING");
      expect(batch.json.items[0].payout_item_fee).toBeUndefined();

      const status = async () => (await call(slow, "GET", path, { token: t })).json.batch_header.batch_status;
      await vi.advanceTimersByTimeAsync(29_999);
      expect(await status()).toBe("PENDING");
      await vi.advanceTimersByTimeAsync(1);
      expect(await status()).toBe("PROCESSING");
      await vi.advanceTimersByTimeAsync(8 * 1_000 + 1_000); // eight items a second apart, then completion
      expect(await status()).toBe("SUCCESS");
      // Settled: the hold has left the balance (US$368.39 sent plus US$2.00 in fees), nothing is withheld.
      const settled = await usd();
      expect(settled.available_balance?.value).toBe("99629.61");
      expect(settled.withheld_balance?.value).toBe("0.00");
      expect(settled.total_balance?.value).toBe("99629.61");
    } finally {
      await slow.close();
    }
  });

  it("uses PAYPAL_ID receivers and fails a payout to the sender itself", async () => {
    const memberPayer = sim.accountByKey("M-007")?.payer_id as string;
    const res = await post({
      sender_batch_header: { sender_batch_id: "2026A-paypalid", recipient_type: "PAYPAL_ID" },
      items: [
        { receiver: memberPayer, amount: { currency: "USD", value: "5.00" }, sender_item_id: "a" },
        {
          receiver: "bulawanon.coop@example.org",
          recipient_type: "EMAIL",
          amount: { currency: "USD", value: "5.00" },
          sender_item_id: "b",
        },
      ],
    });
    expect(res.status).toBe(201);
    await sim.idle();
    const items = Object.values(sim.state.items);
    expect(items.find((i) => i.item.sender_item_id === "a")?.status).toBe("SUCCESS");
    const self = items.find((i) => i.item.sender_item_id === "b");
    expect(self?.status).toBe("FAILED");
    expect(self?.errors?.name).toBe("SELF_PAY_NOT_ALLOWED");
    expect(sim.balance("coop", "USD")).toEqual({ available: 10_000_000 - 500 - 25, withheld: 0 });
  });

  it("serialises concurrent requests with the same PayPal-Request-Id (one batch, both 201)", async () => {
    const body = batchBody("2026A-concurrent");
    const [a, b] = await Promise.all([
      post(body, { "paypal-request-id": "same-id" }),
      post(body, { "paypal-request-id": "same-id" }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.batch_header.payout_batch_id).toBe(a.json.batch_header.payout_batch_id);
    expect(Object.keys(sim.state.batches)).toHaveLength(1);
  });
});
