import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimEnv } from "../src/http/app.js";
import type { Simulator } from "../src/simulator.js";
import { DAY_MS } from "../src/util/time.js";
import {
  BUSINESS_EMAIL,
  call,
  canonicalInvoice,
  fakeTime,
  newSim,
  PAYER_EMAIL,
  plusDays,
  ptToday,
  receiver,
  subscribe,
  token,
} from "./helpers.js";

describe("Invoicing v2", () => {
  let sim: Simulator;
  let tok: string;

  beforeEach(async () => {
    // Invoice, due and rule dates are Pacific-time calendar dates: with Date frozen at noon, an expectation
    // computed after a request names the same day the simulator used, even when a run crosses midnight.
    fakeTime();
    sim = await newSim();
    tok = await token(sim);
  });
  afterEach(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
    vi.useRealTimers();
  });

  const create = async (number: string, extra: Record<string, unknown> = {}) => {
    const body = canonicalInvoice(number);
    Object.assign(body.detail as Record<string, unknown>, extra);
    const res = await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body });
    return {
      res,
      id: String(res.json?.href ?? "")
        .split("/")
        .pop() as string,
    };
  };

  it("rejects a duplicate invoice_number with 422 DUPLICATE_INVOICE_NUMBER; deleting the draft frees it", async () => {
    const first = await create("FS-2026A-r40");
    expect(first.res.status).toBe(201);
    const dup = await create("FS-2026A-r40");
    expect(dup.res.status).toBe(422);
    expect(dup.res.json.name).toBe("UNPROCESSABLE_ENTITY");
    expect(dup.res.json.details[0]).toMatchObject({
      field: "/detail/invoice_number",
      issue: "DUPLICATE_INVOICE_NUMBER",
      location: "body",
    });
    expect((await call(sim, "DELETE", `/v2/invoicing/invoices/${first.id}`, { token: tok })).status).toBe(
      204,
    );
    expect((await call(sim, "GET", `/v2/invoicing/invoices/${first.id}`, { token: tok })).status).toBe(404);
    expect((await create("FS-2026A-r40")).res.status).toBe(201);
  });

  it("refuses to delete a sent invoice", async () => {
    const { id } = await create("FS-DEL-SENT");
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    const res = await call(sim, "DELETE", `/v2/invoicing/invoices/${id}`, { token: tok });
    expect(res.status).toBe(422);
  });

  it("finds an invoice by invoice_number (adopt after a timeout) and numbers invoices automatically", async () => {
    await create("FS-SEARCH-1");
    const found = await call(sim, "POST", "/v2/invoicing/search-invoices?total_required=true", {
      token: tok,
      body: { invoice_number: "FS-SEARCH-1" },
    });
    expect(found.status).toBe(200);
    expect(found.json.total_items).toBe(1);
    expect(found.json.items[0].detail.reference).toBe("rc:7f3a91c2b0d4e6f8;run:r37");
    const next = await call(sim, "POST", "/v2/invoicing/generate-next-invoice-number", {
      token: tok,
      body: {},
    });
    expect(next.json.invoice_number).toBe("0001");
    const body = canonicalInvoice("ignored");
    delete (body.detail as Record<string, unknown>).invoice_number;
    const auto = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body,
      headers: { prefer: "return=representation" },
    });
    expect(auto.status).toBe(201);
    expect(auto.json.detail.invoice_number).toBe("0001");
    expect(auto.json.links.map((l: { rel: string }) => l.rel)).toContain("send");
  });

  it("schedules an invoice whose invoice_date is in the future (202, SCHEDULED) and lets it be deleted", async () => {
    const { id } = await create("FS-SCHED", { invoice_date: plusDays(ptToday(sim.clock.now()), 3) });
    const sent = await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, { token: tok, body: {} });
    expect(sent.status).toBe(202);
    expect((await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok })).json.status).toBe(
      "SCHEDULED",
    );
    expect((await call(sim, "DELETE", `/v2/invoicing/invoices/${id}`, { token: tok })).status).toBe(204);
  });

  it("AUTO_CANCEL: an unpaid invoice is AUTO_CANCELLED after the rule date and INVOICING.INVOICE.CANCELLED fires", async () => {
    const rx = await receiver();
    await subscribe(sim, tok, rx.url);
    const { id } = await create("FS-AUTOCANCEL");
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    const date = plusDays(ptToday(sim.clock.now()), 7);
    const rule = await call(sim, "POST", `/v2/invoicing/invoices/${id}/conditional-rules`, {
      token: tok,
      body: {
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date },
          },
        ],
      },
    });
    expect(rule.status).toBe(201);
    sim.clock.advance(8 * DAY_MS);
    tok = await token(sim);
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok });
    expect(got.json.status).toBe("AUTO_CANCELLED");
    await sim.idle();
    expect(rx.deliveries.map((d) => d.json.event_type)).toContain("INVOICING.INVOICE.CANCELLED");
    const pay = await call(sim, "POST", `/v2/invoicing/invoices/${id}/payments`, {
      token: tok,
      body: { method: "CASH" },
    });
    expect(pay.status).toBe(422);
    expect(pay.json.details[0].issue).toBe("CANNOT_PROCESS_PAYMENTS");
    await rx.close();
  });

  it("validates rule semantics: past SPECIFIC_DATE, missing date, issue-date condition for AUTO_CANCEL, duplicates", async () => {
    const { id } = await create("FS-RULES");
    const post = (rules: unknown[]) =>
      call(sim, "POST", `/v2/invoicing/invoices/${id}/conditional-rules`, { token: tok, body: { rules } });
    const past = await post([
      {
        conditional_rule_type: "AUTO_CANCEL",
        rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: "2020-01-01" },
      },
    ]);
    expect(past.status).toBe(400);
    const missing = await post([
      { conditional_rule_type: "AUTO_CANCEL", rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE" } },
    ]);
    expect(missing.json.details[0].issue).toBe("MISSING_REQUIRED_PARAMETER");
    const wrong = await post([
      {
        conditional_rule_type: "AUTO_CANCEL",
        rule_expiry_terms: { rule_expiry_condition: "SEVEN_DAYS_AFTER_ISSUE_DATE" },
      },
    ]);
    expect(wrong.json.details[0].issue).toBe("INVALID_PARAMETER_VALUE");
    const good = {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: { rule_expiry_condition: "SEVEN_DAYS_AFTER_DUE_DATE" },
    };
    expect((await post([good])).status).toBe(201);
    const twice = await post([good]);
    expect(twice.status).toBe(422);
    expect(twice.json.details[0].issue).toBe("CONDITIONAL_RULE_ALREADY_EXISTS");
    const discount = await post([
      {
        conditional_rule_type: "EARLY_PAYMENT_DISCOUNT",
        conditional_rule_value_type: "PERCENT",
        conditional_rule_value: "5",
        rule_expiry_terms: { rule_expiry_condition: "SEVEN_DAYS_AFTER_ISSUE_DATE" },
      },
    ]);
    expect(discount.status).toBe(201);
    expect(discount.json.rules[0].rule_expiry_terms.condition_rule_end_date).toBe(
      plusDays(ptToday(sim.clock.now()), 7),
    );
  });

  it("checks payment amounts and the invoicer", async () => {
    const { id } = await create("FS-PAY");
    const draft = await call(sim, "POST", `/v2/invoicing/invoices/${id}/payments`, {
      token: tok,
      body: { method: "CASH" },
    });
    expect(draft.status).toBe(422);
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, { token: tok, body: {} });
    expect((await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok })).json.status).toBe("SENT");
    const tooMuch = await call(sim, "POST", `/v2/invoicing/invoices/${id}/payments`, {
      token: tok,
      body: { method: "CASH", amount: { currency_code: "USD", value: "5000.00" } },
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.json.details[0].issue).toBe("PAYMENT_AMOUNT_GREATER_THAN_AMOUNT_DUE");
    const partial = await call(sim, "POST", `/v2/invoicing/invoices/${id}/payments`, {
      token: tok,
      body: { method: "CASH", amount: { currency_code: "USD", value: "333.50" } },
    });
    expect(partial.status).toBe(200);
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok });
    expect(got.json.status).toBe("PARTIALLY_PAID");
    expect(got.json.due_amount.value).toBe("4000.00");
    const body = canonicalInvoice("FS-STRANGER");
    (body.invoicer as Record<string, string>).email_address = "someone.else@example.org";
    const stranger = await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body });
    expect(stranger.status).toBe(422);
    expect(stranger.json.details[0].issue).toBe("USER_NOT_FOUND");
  });

  it("computes tax and discounts in cents", async () => {
    const res = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      headers: { prefer: "return=representation" },
      body: {
        detail: { currency_code: "USD", invoice_number: "FS-TAX" },
        items: [
          {
            name: "Mat",
            quantity: "2",
            unit_amount: { currency_code: "USD", value: "50.00" },
            discount: { percent: "5" },
            tax: { name: "Sales Tax", percent: "7.25" },
          },
          { name: "Shirt", quantity: "1.5", unit_amount: { currency_code: "USD", value: "10.00" } },
        ],
      },
    });
    expect(res.status).toBe(201);
    // Mat: 100.00 − 5.00 = 95.00, tax 6.89 (95 × 7.25% = 6.8875 → 6.89); Shirt 15.00. Total 116.89.
    expect(res.json.amount.breakdown.item_total.value).toBe("115.00");
    expect(res.json.amount.breakdown.tax_total.value).toBe("6.89");
    expect(res.json.amount.value).toBe("116.89");
  });

  it("cancels a sent invoice (204) and refuses to cancel a draft", async () => {
    const rx = await receiver();
    await subscribe(sim, tok, rx.url);
    const { id } = await create("FS-CANCEL");
    const draft = await call(sim, "POST", `/v2/invoicing/invoices/${id}/cancel`, { token: tok, body: {} });
    expect(draft.status).toBe(422);
    expect(draft.json.details[0].issue).toBe("CANNOT_CANCEL_DRAFT_INVOICE");
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    expect(
      (await call(sim, "POST", `/v2/invoicing/invoices/${id}/cancel`, { token: tok, body: {} })).status,
    ).toBe(204);
    expect((await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok })).json.status).toBe(
      "CANCELLED",
    );
    await sim.idle();
    expect(rx.deliveries.map((d) => d.json.event_type)).toContain("INVOICING.INVOICE.CANCELLED");
    await rx.close();
  });

  it("pays on the simulator's pay page: PAID, PayPal-type payment, balance credited less PayPal's published fee, T0000 in Transaction Search", async () => {
    const rx = await receiver();
    await subscribe(sim, tok, rx.url);
    const { id } = await create("FS-HOSTED");
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok });
    const payUrl = got.json.detail.metadata.recipient_view_url as string;
    const page = await sim.fetch(new Request(payUrl));
    const html = await page.text();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("x-fairsplit-simulated")).toBe("true");
    expect(html).toContain("Simulated PayPal sandbox");
    expect(html).toContain("4333.50");
    expect(html).not.toMatch(/password/i);
    const paid = await sim.fetch(
      new Request(payUrl, { method: "POST", headers: { accept: "application/json" } }),
    );
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "PAID", simulated: true });
    const after = await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok });
    expect(after.json.status).toBe("PAID");
    expect(after.json.payments.transactions[0]).toMatchObject({ type: "PAYPAL", method: "PAYPAL" });
    // PayPal's published US rate for an invoice paid with PayPal: 3.49% + US$0.49.
    // 4333.50 × 3.49% = 151.239… → 151.24, + 0.49 = 151.73 withheld as the fee.
    const fee = 15_173;
    expect(sim.balance("coop", "USD").available).toBe(10_000_000 + 433_350 - fee);
    expect(sim.balance("lantern-bay", "USD").available).toBe(10_000_000 - 433_350);
    const again = await sim.fetch(
      new Request(payUrl, { method: "POST", headers: { accept: "application/json" } }),
    );
    expect(again.status).toBe(422);
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    const search = await call(
      sim,
      "GET",
      `/v1/reporting/transactions?start_date=${iso(sim.clock.now() - 60_000)}&end_date=${iso(sim.clock.now() + 60_000)}&transaction_type=T0000&fields=all`,
      { token: tok },
    );
    const info = search.json.transaction_details[0].transaction_info;
    expect(info.transaction_amount.value).toBe("4333.50");
    expect(info.fee_amount.value).toBe("-151.73");
    expect(info.invoice_id).toBe("FS-HOSTED");
    expect(search.json.transaction_details[0].payer_info.email_address).toBe(PAYER_EMAIL);
    await sim.idle();
    expect(rx.deliveries.filter((d) => d.json.event_type === "INVOICING.INVOICE.PAID")).toHaveLength(1);
    await rx.close();
  });

  // STATE.md ws/ppsim SECURITY (27 Oct, invoicing.ts payerKey): the public pay page took a `payer` form field
  // and debited any account but the invoicer, with no funds check. PayPal never lets a visitor choose whose
  // account pays; the invoice's billing recipient does.
  describe("the pay page's payer is the invoice's billing recipient, never one the visitor names", () => {
    const usd = (key: string) => sim.balance(key, "USD").available;
    /** Everything a payment could move: the ledger, Transaction Search's rows and every balance. */
    const money = () => ({
      ledger: sim.state.ledger.length,
      transactions: sim.state.transactions.length,
      balances: Object.fromEntries(sim.registry.accounts.map((a) => [a.key, usd(a.key)])),
    });
    const sent = async (invoiceNumber: string, billedTo = PAYER_EMAIL): Promise<string> => {
      const body = canonicalInvoice(invoiceNumber);
      const [first] = body.primary_recipients as { billing_info: { email_address: string } }[];
      if (!first) throw new Error("no recipient");
      first.billing_info.email_address = billedTo;
      const res = await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body });
      expect(res.status).toBe(201);
      const id = String(res.json.href).split("/").pop() as string;
      await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
        token: tok,
        body: { send_to_recipient: false },
      });
      return id;
    };
    /** POSTs the pay page the way a host app's /paypal-sim mount hands it to publicFetch. */
    const publicPay = (id: string, form = "", query = "", asJson = true) =>
      sim.publicFetch(
        new Request(`http://127.0.0.1:4010/sim/invoice/${id}/pay${query}`, {
          method: "POST",
          headers: {
            ...(asJson ? { accept: "application/json" } : {}),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
        }),
      );
    const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
    const statusOf = async (id: string) =>
      (await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok })).json.status as string;

    it("refuses every payer a visitor names (another account, the recipient's own key, the invoicer, unknown) with 422, moving nothing", async () => {
      const id = await sent("FS-PAYER-NAMED");
      const before = money();
      for (const form of [
        "payer=M-007",
        "payer=lantern-bay",
        "payer=coop",
        "payer=no-such-account",
        "payer=",
      ]) {
        const res = await publicPay(id, form);
        expect(res.status, form).toBe(422);
        expect(await errorOf(res), form).toMatch(/payer/);
      }
      expect((await publicPay(id, "", "?payer=M-007")).status).toBe(422);
      const page = await publicPay(id, "payer=M-007", "", false); // the HTML form post
      expect(page.status).toBe(422);
      expect(await page.text()).toContain("Cannot pay");
      expect(money()).toEqual(before);
      expect(await statusOf(id)).toBe("UNPAID");
    });

    it("with no payer named, the billing recipient pays: Lantern Bay is debited and named in Transaction Search", async () => {
      const id = await sent("FS-PAYER-RECIPIENT");
      expect((await publicPay(id)).status).toBe(200);
      expect(await statusOf(id)).toBe("PAID");
      expect(usd("lantern-bay")).toBe(10_000_000 - 433_350);
      expect(usd("coop")).toBe(10_000_000 + 433_350 - 15_173);
      for (const member of ["M-007", "M-014"]) expect(usd(member), member).toBe(0);
      expect(sim.state.transactions.at(-1)).toMatchObject({
        eventCode: "T0000",
        counterpartyKey: "lantern-bay",
        counterpartyEmail: PAYER_EMAIL,
      });
    });

    it("an invoice billed to an address with no simulator account is paid by an external payer: no simulator account is debited", async () => {
      const id = await sent("FS-PAYER-EXTERNAL", "accounts.payable@example.net");
      const before = money();
      expect((await publicPay(id)).status).toBe(200);
      for (const [key, cents] of Object.entries(before.balances))
        if (key !== "coop") expect(usd(key), key).toBe(cents);
      expect(sim.state.transactions.at(-1)).toMatchObject({
        counterpartyKey: null,
        counterpartyEmail: "accounts.payable@example.net",
      });
    });

    it("refuses a billing recipient whose simulated balance is short of the amount due, and one who is the invoicer", async () => {
      const short = await sent("FS-PAYER-SHORT", "consolacion.bacus@example.org"); // M-014 holds US$0.00
      const own = await sent("FS-PAYER-OWN", BUSINESS_EMAIL);
      const before = money();
      const res = await publicPay(short);
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toMatch(/balance/);
      const self = await publicPay(own);
      expect(self.status).toBe(422);
      expect(await errorOf(self)).toMatch(/cannot pay its own invoice/);
      expect(money()).toEqual(before);
      expect(await statusOf(short)).toBe("UNPAID");
    });

    it("a named payer is honoured only through the admin API behind its gate (or in process), never below zero", async () => {
      const id = await sent("FS-PAYER-ADMIN");
      const path = `/sim/admin/invoice/${id}/pay`;
      const admin = (payer: string, env?: SimEnv) =>
        sim.fetch(
          new Request(`http://127.0.0.1:4010${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payer }),
          }),
          env,
        );
      const loopback: SimEnv = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
      const before = money();
      // Not served by the public mount at all; refused by the gate for an unknown or a LAN socket.
      const viaMount = await sim.publicFetch(
        new Request(`http://127.0.0.1:4010${path}`, {
          method: "POST",
          body: JSON.stringify({ payer: "M-007" }),
        }),
      );
      expect(viaMount.status).toBe(404);
      expect((await admin("M-007")).status).toBe(403);
      expect((await admin("M-007", { incoming: { socket: { remoteAddress: "192.168.1.20" } } })).status).toBe(
        403,
      );
      // Past the gate the same rules hold: never the invoicer, never an unknown account, never below zero.
      expect((await admin("coop", loopback)).status).toBe(422);
      expect((await admin("no-such-account", loopback)).status).toBe(422);
      const broke = await admin("M-007", loopback); // US$0.00
      expect(broke.status).toBe(422);
      expect(await errorOf(broke)).toMatch(/balance/);
      expect(() => sim.invoicing.payAs(id, "M-007")).toThrow(/balance/);
      expect(money()).toEqual(before);
      expect(await statusOf(id)).toBe("UNPAID");
      // Funded by a test-only ledger entry, M-007 can pay through the gate; Lantern Bay is untouched.
      sim.post({
        accountKey: "M-007",
        currency: "USD",
        availableCents: 500_000,
        withheldCents: 0,
        kind: "test.fund",
        ref: "test",
      });
      const ok = await admin("M-007", loopback);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ id, status: "PAID", payer: "M-007", simulated: true });
      expect(usd("M-007")).toBe(500_000 - 433_350);
      expect(usd("lantern-bay")).toBe(10_000_000);
      expect(sim.state.transactions.at(-1)).toMatchObject({
        counterpartyKey: "M-007",
        counterpartyEmail: "dionisio.lapinig@example.org",
      });
    });
  });

  it("lists invoices newest first with paging links", async () => {
    for (const n of ["A", "B", "C"]) await create(`FS-LIST-${n}`);
    const page = await call(sim, "GET", "/v2/invoicing/invoices?page=1&page_size=2&total_required=true", {
      token: tok,
    });
    expect(page.json.total_items).toBe(3);
    expect(page.json.items).toHaveLength(2);
    expect(page.json.links.map((l: { rel: string }) => l.rel)).toEqual(["self", "next"]);
    const tooBig = await call(sim, "GET", "/v2/invoicing/invoices?page_size=101", { token: tok });
    expect(tooBig.status).toBe(400);
    expect(tooBig.json.details[0].issue).toBe("INVALID_INTEGER_MAX_VALUE");
  });

  it("keeps each app's business account separate from other accounts' invoices", async () => {
    const { id } = await create("FS-OWN");
    const judge = await token(sim, "fs-judge");
    // Both REST apps sit on the one business account (plan: "Both REST apps sit on the one business account").
    expect((await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: judge })).status).toBe(200);
  });

  it("sends a SCHEDULED invoice on its invoice date", async () => {
    const { id } = await create("FS-SCHED-2", { invoice_date: plusDays(ptToday(sim.clock.now()), 2) });
    expect(
      (await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, { token: tok, body: {} })).status,
    ).toBe(202);
    sim.clock.advance(3 * DAY_MS);
    tok = await token(sim);
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${id}`, { token: tok });
    expect(got.json.status).toBe("SENT");
    expect(got.json.detail.metadata.first_sent_time).toBeDefined();
  });
});
