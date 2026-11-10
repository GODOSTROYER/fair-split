// Tests that kill mutation-testing survivors (handoff T3) in the policy lattice. `decide` takes the
// maximum over every policy, so a policy that stopped denying is often masked by another that denies the
// same call (invoiceEqualsQuote denies any unknown key, for one). These tests call each policy on its own
// and pin its verdict and its reason, so each layer is checked by itself.
import type { PolicyCtx, ToolCall } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import { minorToDecimal } from "./money.js";
import {
  allowlist,
  budgetCap,
  decide,
  dueWithin30Days,
  formatPath,
  invoiceEqualsQuote,
  invoicerIsBusinessEmail,
  killSwitch,
  MAX_ARG_DEPTH,
  POLICIES,
  phaseGate,
  readInvoiceFields,
  recipientInBrandAllowlist,
  referenceCarriesHash,
  sandboxOnly,
  sendNeedsTreasurer,
} from "./policy.js";
import { quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const BUSINESS = "coop-business@sandbox.example";
const PAYER = "lantern-bay@sandbox.example";
const PAYER_NAME = "Lantern Bay Chocolate Co.";
const INVOICE_ID = "INV2-AB12-CD34-EF56-GH78";
const MEMO = invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode);

type Expected = PolicyCtx["expected"];
const EXPECTED: Expected = {
  quote,
  invoiceNumber: invoiceNumber("2026A-r37"),
  reference: invoiceReference(card.sha256),
  memo: MEMO,
  businessEmail: BUSINESS,
  payer: { email: PAYER, businessName: PAYER_NAME },
  brandAllowlist: [PAYER],
  invoiceId: null,
  invoiceDate: null,
};

function ctx(over: Partial<PolicyCtx> = {}, expected: Partial<Expected> = {}): PolicyCtx {
  return {
    flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
    ppEnv: "sandbox",
    toolkitSandbox: true,
    runState: "QUOTED",
    invoiceExists: false,
    holds: [],
    budget: { spentMicros: 100_000, capMicros: 750_000, iteration: 2, maxIterations: 10 },
    expected: { ...EXPECTED, ...expected },
    today: "2026-10-29",
    ...over,
  };
}
const ruleCtx = (invoiceDate: string, today = "2026-10-29") =>
  ctx({ invoiceExists: true, today }, { invoiceId: INVOICE_ID, invoiceDate });

const CANONICAL = {
  currency_code: "USD",
  invoice_number: "FS-2026A-r37",
  reference: invoiceReference(card.sha256),
  note: MEMO,
  invoicer_email_address: BUSINESS,
  primary_recipients: [{ billing_info: { business_name: PAYER_NAME, email_address: PAYER } }],
  items: quote.items.map((i) => ({
    name: i.name,
    quantity: "1",
    unit_amount: { currency_code: "USD", value: minorToDecimal(i.unitAmountCents) },
    unit_of_measure: "AMOUNT",
  })),
};
const draft = (over: Record<string, unknown> = {}) => ({ ...structuredClone(CANONICAL), ...over });
const call = (name: string, args: unknown = {}): ToolCall => ({ name, args });
const RULE = (date: string, terms: Record<string, unknown> = {}) => ({
  invoice_id: INVOICE_ID,
  rules: [
    {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date, ...terms },
    },
  ],
});
const ALLOW = { verdict: 0, reason: null };
const DENY = (reason: string) => ({ verdict: 2, reason });

describe("paths and drafts", () => {
  it("formatPath prints indices in brackets and quotes keys that are not identifiers", () => {
    expect(formatPath(["items", 0, "name"])).toBe("items[0].name");
    expect(formatPath(["a.b", "é"])).toBe('["a.b"]["\\u00e9"]');
  });

  it.each([null, [], "draft", 7])("readInvoiceFields refuses %j as no invoice body", (args) => {
    expect(readInvoiceFields(args)).toEqual({ ok: false, reason: "The draft is not an invoice body" });
  });

  it("readInvoiceFields reads each flat field by its own name, and only ASCII recipient e-mails", () => {
    const read = readInvoiceFields(
      draft({
        primary_recipients: [
          { billing_info: { email_address: PAYER } },
          { billing_info: { email_address: "nö@sandbox.example" } },
          { billing_info: { email_address: 7 } },
          "not a recipient",
        ],
      }),
    );
    expect(read).toEqual({
      ok: true,
      fields: {
        values: {
          currency_code: "USD",
          invoice_number: "FS-2026A-r37",
          reference: CANONICAL.reference,
          note: MEMO,
          invoicer_email_address: BUSINESS,
        },
        nestedOnly: {},
        recipientEmails: [PAYER],
      },
    });
  });
});

describe("killSwitch and sandboxOnly touch only the tools they name", () => {
  it("kill_ai_live stops every tool; kill_paypal_live only PayPal tools; kill_payouts only the batch request", () => {
    const flags = (f: Partial<PolicyCtx["flags"]>) =>
      ctx({ flags: { killPayouts: false, killPaypalLive: false, killAiLive: false, ...f } });
    expect(killSwitch(call("propose_resolution"), flags({ killAiLive: true }))).toEqual(
      DENY("kill_ai_live is on"),
    );
    expect(killSwitch(call("get_invoice"), flags({ killPaypalLive: true }))).toEqual(
      DENY("kill_paypal_live is on"),
    );
    expect(killSwitch(call("get_payout_item"), flags({ killPaypalLive: true }))).toEqual(
      DENY("kill_paypal_live is on"),
    );
    expect(killSwitch(call("propose_resolution"), flags({ killPaypalLive: true }))).toEqual(ALLOW);
    expect(killSwitch(call("request_payout_batch"), flags({ killPayouts: true }))).toEqual(
      DENY("kill_payouts is on"),
    );
    expect(killSwitch(call("get_payout_item"), flags({ killPayouts: true }))).toEqual(ALLOW);
  });

  it("sandboxOnly lets non-PayPal tools through anywhere, and PayPal tools only in the sandbox", () => {
    const live = ctx({ ppEnv: "live" as never });
    expect(sandboxOnly(call("propose_resolution"), live)).toEqual(ALLOW);
    expect(sandboxOnly(call("get_invoice"), live)).toEqual(DENY("PayPal tools run in the sandbox only"));
    expect(sandboxOnly(call("get_payout_batch"), ctx({ toolkitSandbox: false }))).toEqual(
      DENY("PayPal tools run in the sandbox only"),
    );
    expect(sandboxOnly(call("get_invoice"), ctx())).toEqual(ALLOW);
  });

  it("allowlist names the tool it refuses; budgetCap names which budget is spent", () => {
    expect(allowlist(call("create_payout_batch"), ctx())).toEqual(
      DENY("create_payout_batch is not an agent tool"),
    );
    const budget = (b: Partial<PolicyCtx["budget"]>) =>
      ctx({ budget: { spentMicros: 0, capMicros: 10, iteration: 0, maxIterations: 3, ...b } });
    expect(budgetCap(call("x"), budget({ spentMicros: 10 }))).toEqual(DENY("session budget spent"));
    expect(budgetCap(call("x"), budget({ iteration: 3 }))).toEqual(DENY("iteration limit reached"));
    expect(budgetCap(call("x"), budget({ spentMicros: 9, iteration: 2 }))).toEqual(ALLOW);
  });
});

describe("phaseGate, state by state", () => {
  const at = (runState: PolicyCtx["runState"], over: Partial<PolicyCtx> = {}) => ctx({ runState, ...over });

  it("invoice tools", () => {
    expect(phaseGate(call("get_invoice"), at("QUOTED"))).toEqual(ALLOW);
    expect(phaseGate(call("get_invoice"), at("DRAFT"))).toEqual(DENY("no invoice before QUOTED"));
    expect(phaseGate(call("create_invoice"), at("INVOICED"))).toEqual(DENY("create_invoice only in QUOTED"));
    expect(phaseGate(call("create_invoice"), at("QUOTED", { invoiceExists: true }))).toEqual(
      DENY("the invoice already exists"),
    );
    expect(
      phaseGate(call("create_conditional_rules_for_invoice"), at("FUNDED", { invoiceExists: true })),
    ).toEqual(DENY("the AUTO_CANCEL rule needs the invoice, in QUOTED or INVOICED"));
    expect(phaseGate(call("send_invoice"), at("INVOICED", { invoiceExists: true }))).toEqual(
      DENY("send_invoice needs the invoice, in QUOTED"),
    );
  });

  it("review tools only in IN_REVIEW; a hold must be open; only an open or asked blocking hold blocks", () => {
    const hold = (state: string, gate: string) => ({ holdId: "h1", state, gate }) as never;
    expect(
      phaseGate(
        call("propose_resolution", { hold_id: "h1" }),
        at("COMPUTED", { holds: [hold("OPEN", "RESERVES_LINE")] }),
      ),
    ).toEqual(DENY("propose_resolution only in IN_REVIEW"));
    expect(
      phaseGate(
        call("propose_resolution", null),
        at("IN_REVIEW", { holds: [hold("OPEN", "RESERVES_LINE")] }),
      ),
    ).toEqual(DENY("the hold is not open"));
    expect(
      phaseGate(
        call("propose_resolution", ["h1"]),
        at("IN_REVIEW", { holds: [hold("OPEN", "RESERVES_LINE")] }),
      ),
    ).toEqual(DENY("the hold is not open"));
    expect(phaseGate(call("request_payout_batch"), at("APPROVED"))).toEqual(
      DENY("request_payout_batch only in IN_REVIEW"),
    );
    const batch = (holds: never[]) => phaseGate(call("request_payout_batch"), at("IN_REVIEW", { holds }));
    expect(batch([hold("OPEN", "RESERVES_LINE")])).toEqual(ALLOW);
    expect(batch([hold("RESOLVED", "BLOCKS_APPROVAL")])).toEqual(ALLOW);
    expect(batch([hold("ASKED_CHAIR", "BLOCKS_APPROVAL")])).toEqual(DENY("a hold still blocks approval"));
    expect(batch([hold("OPEN", "BLOCKS_APPROVAL")])).toEqual(DENY("a hold still blocks approval"));
  });

  it.each([
    ["POSTED", ALLOW],
    ["SETTLED", ALLOW],
    ["DENIED", ALLOW],
    ["APPROVED", DENY("payout reads only after the batch is posted")],
    ["HALTED", DENY("payout reads only after the batch is posted")],
  ] as const)("payout reads in %s", (state, verdict) => {
    expect(phaseGate(call("get_payout_batch"), at(state as never))).toEqual(verdict);
    expect(phaseGate(call("get_payout_item"), at(state as never))).toEqual(verdict);
  });

  it("anything else is refused", () => {
    expect(phaseGate(call("cancel_unclaimed_payout_item"), at("POSTED"))).toEqual(
      DENY("no phase allows this tool"),
    );
  });
});

describe("invoiceEqualsQuote, branch by branch", () => {
  it("a leaf may hold anything until the comparison, which names it", () => {
    expect(invoiceEqualsQuote(call("create_invoice", draft({ note: { a: 1 } })), ctx())).toEqual(
      DENY("note differs from the code's invoice"),
    );
  });

  it("a list given as text, or a recipient given as text, is compared, not walked", () => {
    expect(invoiceEqualsQuote(call("create_invoice", draft({ items: "abc" })), ctx())).toEqual(
      DENY("items differs from the code's invoice"),
    );
    expect(invoiceEqualsQuote(call("create_invoice", draft({ items: {} })), ctx())).toEqual(
      DENY("items differs from the code's invoice"),
    );
    expect(invoiceEqualsQuote(call("create_invoice", draft({ primary_recipients: ["x"] })), ctx())).toEqual(
      DENY("primary_recipients[0] differs from the code's invoice"),
    );
  });

  it("a quote code cannot invoice is refused as such", () => {
    const bad = ctx({}, { quote: { ...quote, currency: "EUR" as "USD" } });
    expect(invoiceEqualsQuote(call("create_invoice", draft()), bad)).toEqual(
      DENY("The code's quote cannot be invoiced"),
    );
  });

  it("the rule: not an object, an unknown key, no invoice yet, no date yet, a different date", () => {
    const name = "create_conditional_rules_for_invoice";
    expect(invoiceEqualsQuote(call(name, null), ruleCtx("2026-10-29"))).toEqual(
      DENY("The rule arguments are not an object"),
    );
    expect(invoiceEqualsQuote(call(name, { ...RULE("2026-11-23"), x: 1 }), ruleCtx("2026-10-29"))).toEqual(
      DENY("Not in the canonical rule: x"),
    );
    expect(
      invoiceEqualsQuote(call(name, RULE("2026-11-23")), ctx({}, { invoiceDate: "2026-10-29" })),
    ).toEqual(DENY("There is no invoice to attach the rule to"));
    expect(invoiceEqualsQuote(call(name, RULE("2026-11-23")), ctx({}, { invoiceId: INVOICE_ID }))).toEqual(
      DENY("The invoice's date is not known yet"),
    );
    expect(invoiceEqualsQuote(call(name, RULE("2026-11-24")), ruleCtx("2026-10-29"))).toEqual(
      DENY("rules[0].rule_expiry_terms.condition_rule_end_date differs from the code's rule"),
    );
  });

  it("send: no invoice to send is named", () => {
    expect(
      invoiceEqualsQuote(call("send_invoice", { invoice_id: INVOICE_ID, send_to_recipient: false }), ctx()),
    ).toEqual(DENY("There is no invoice to send"));
  });
});

describe("the e-mail and reference policies", () => {
  it("invoicerIsBusinessEmail: absent, or the co-op's own address not plain ASCII", () => {
    const { invoicer_email_address: _gone, ...noInvoicer } = draft();
    expect(invoicerIsBusinessEmail(call("create_invoice", noInvoicer), ctx())).toEqual(
      DENY("The invoicer is not the co-op's business account"),
    );
    expect(
      invoicerIsBusinessEmail(
        call("create_invoice", draft()),
        ctx({}, { businessEmail: "coöp@sandbox.example" }),
      ),
    ).toEqual(DENY("The co-op's business e-mail is not a plain ASCII e-mail address"));
    expect(
      invoicerIsBusinessEmail(
        call("create_invoice", draft({ invoicer_email_address: "other@sandbox.example" })),
        ctx(),
      ),
    ).toEqual(DENY("The invoicer is not the co-op's business account"));
  });

  it("recipientInBrandAllowlist: only primary_recipients[i].billing_info.email_address, by structure", () => {
    const deny = (path: string) => DENY(`Not a recipient field the draft may set: ${path}`);
    const check = (d: unknown) => recipientInBrandAllowlist(call("create_invoice", d), ctx());
    expect(check(draft())).toEqual(ALLOW);
    expect(check(draft({ contactEmail: "nobody" }))).toEqual(deny("contactEmail"));
    expect(check(draft({ memo2: "a@b.example" }))).toEqual(deny("memo2"));
    expect(
      check(
        draft({
          primary_recipients: [{ billing_info: { email_address: PAYER }, other: { email_address: PAYER } }],
        }),
      ),
    ).toEqual(deny("primary_recipients[0].other.email_address"));
    expect(check(draft({ secondary: [{ billing_info: { email_address: PAYER } }] }))).toEqual(
      deny("secondary[0].billing_info.email_address"),
    );
    expect(check(draft({ primary_recipients: { 0: { billing_info: { email_address: PAYER } } } }))).toEqual(
      deny('primary_recipients["0"].billing_info.email_address'),
    );
    expect(
      check(draft({ primary_recipients: [{ billing_info: { email_address: { deeper: PAYER } } }] })),
    ).toEqual(deny("primary_recipients[0].billing_info.email_address.deeper"));
    expect(check(draft({ primary_recipients: "x" }))).toEqual(
      DENY("primary_recipients must list one recipient with a readable e-mail"),
    );
    expect(check(draft({ primary_recipients: [{ billing_info: { email_address: 7 } }] }))).toEqual(
      DENY("The recipient has no readable e-mail at billing_info.email_address"),
    );
  });

  it("recipientInBrandAllowlist walks to MAX_ARG_DEPTH and no further", () => {
    const nest = (depth: number): unknown => (depth === 1 ? "x" : { k: nest(depth - 1) });
    const check = (depth: number) =>
      recipientInBrandAllowlist(call("create_invoice", draft({ k: nest(depth) })), ctx());
    expect(check(MAX_ARG_DEPTH)).toEqual(ALLOW);
    expect(check(MAX_ARG_DEPTH + 1)).toEqual(DENY("The arguments nest too deeply to check"));
  });

  it("referenceCarriesHash: a reference or a note in the nested form only is named", () => {
    const { note: _n, ...noFlatNote } = draft();
    expect(
      referenceCarriesHash(call("create_invoice", { ...noFlatNote, detail: { note: MEMO } }), ctx()),
    ).toEqual(DENY("Non-canonical draft: note must be the flat field, not detail.note"));
    expect(referenceCarriesHash(call("create_invoice", draft({ reference: "rc:0" })), ctx())).toEqual(
      DENY("The reference must be rc:{rateCardSha16}"),
    );
  });
});

describe("dueWithin30Days", () => {
  const name = "create_conditional_rules_for_invoice";

  it("finds a date or a term anywhere in a draft, however nested", () => {
    for (const [key, path] of [
      ["due_date", "due_date"],
      ["payment_term", "payment_term"],
      ["term_type", "term_type"],
    ] as const) {
      expect(dueWithin30Days(call("create_invoice", draft({ [key]: "x" })), ctx())).toEqual(
        DENY(`The draft may not set dates: ${path}`),
      );
    }
    const nested = draft();
    (nested.items[0] as Record<string, unknown>).date = "2026-11-01";
    expect(dueWithin30Days(call("create_invoice", nested), ctx())).toEqual(
      DENY("The draft may not set dates: items[0].date"),
    );
  });

  it("a rule without its expiry terms is refused, not read", () => {
    const args = { invoice_id: INVOICE_ID, rules: [{ conditional_rule_type: "AUTO_CANCEL" }] };
    expect(dueWithin30Days(call(name, args), ruleCtx("2026-10-29"))).toEqual(
      DENY("There must be exactly one AUTO_CANCEL rule on SPECIFIC_DATE"),
    );
  });

  it("the one allowed date is rules[0].rule_expiry_terms.condition_rule_end_date, by structure", () => {
    const deny = (path: string) => DENY(`The draft may not set dates: ${path}`);
    const ok = "2026-11-23";
    const check = (args: unknown) => dueWithin30Days(call(name, args), ruleCtx("2026-10-29"));
    expect(check(RULE(ok))).toEqual(ALLOW);
    expect(check({ ...RULE(ok), extra: [{ rule_expiry_terms: { condition_rule_end_date: ok } }] })).toEqual(
      deny("extra[0].rule_expiry_terms.condition_rule_end_date"),
    );
    const other = RULE(ok);
    (other.rules[0] as Record<string, unknown>).other = { condition_rule_end_date: ok };
    expect(check(other)).toEqual(deny("rules[0].other.condition_rule_end_date"));
    expect(check(RULE(ok, { end_date: ok }))).toEqual(deny("rules[0].rule_expiry_terms.end_date"));
  });

  it("the date must be after today and at most 30 days out, both edges exact", () => {
    // invoice date + 25 = the AUTO_CANCEL date
    const window = DENY("The AUTO_CANCEL date must be after today and within 30 days");
    expect(dueWithin30Days(call(name, RULE("2026-10-29")), ruleCtx("2026-10-04"))).toEqual(window); // = today
    expect(dueWithin30Days(call(name, RULE("2026-11-28")), ruleCtx("2026-11-03"))).toEqual(ALLOW); // today + 30
    expect(dueWithin30Days(call(name, RULE("2026-11-29")), ruleCtx("2026-11-04"))).toEqual(window); // today + 31
  });

  it("sendNeedsTreasurer names its reason", () => {
    expect(sendNeedsTreasurer(call("send_invoice"), ctx())).toEqual({
      verdict: 1,
      reason: "send_invoice waits for the treasurer",
    });
  });
});

describe("names every path, joined", () => {
  it("lists two stray recipient paths, two stray dates and two unknown rule keys", () => {
    expect(
      recipientInBrandAllowlist(call("create_invoice", draft({ a: "x@y.example", b: "z@y.example" })), ctx()),
    ).toEqual(DENY("Not a recipient field the draft may set: a, b"));
    expect(dueWithin30Days(call("create_invoice", draft({ due_date: "x", term_type: "y" })), ctx())).toEqual(
      DENY("The draft may not set dates: due_date, term_type"),
    );
    const name = "create_conditional_rules_for_invoice";
    expect(
      invoiceEqualsQuote(call(name, { ...RULE("2026-11-23"), x: 1, y: 2 }), ruleCtx("2026-10-29")),
    ).toEqual(DENY("Not in the canonical rule: x, y"));
    const two = RULE("2026-11-23", { start_date: "a", end_date: "b" });
    expect(dueWithin30Days(call(name, two), ruleCtx("2026-10-29"))).toEqual(
      DENY(
        "The draft may not set dates: rules[0].rule_expiry_terms.end_date, rules[0].rule_expiry_terms.start_date",
      ),
    );
  });

  it("an e-mail nested under invoicer_email_address is stray", () => {
    expect(
      recipientInBrandAllowlist(
        call("create_invoice", draft({ invoicer_email_address: { x: "a@b.example" } })),
        ctx(),
      ),
    ).toEqual(DENY("Not a recipient field the draft may set: invoicer_email_address.x"));
  });

  it("the rule is refused when today is not a strict date", () => {
    const name = "create_conditional_rules_for_invoice";
    expect(invoiceEqualsQuote(call(name, RULE("2026-11-23")), ruleCtx("2026-10-29", "2026/10/29"))).toEqual(
      DENY("Today is not a YYYY-MM-DD date"),
    );
  });
});

describe("decide", () => {
  it("reports one result per policy, and the policies that decided", () => {
    const d = decide(
      call("get_invoice"),
      ctx({ flags: { killPayouts: false, killPaypalLive: false, killAiLive: true } }),
    );
    expect(d.results.map((r) => r.policy)).toEqual(Object.keys(POLICIES));
    expect(d).toMatchObject({ verdict: "DENY", rank: 2, decidedBy: ["killSwitch"] });
  });
});
