import {
  AGENT_TOOL_NAMES,
  POLICY_NAMES,
  type PolicyCtx,
  type PolicyName,
  type ToolCall,
} from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import { minorToDecimal } from "./money.js";
import { decide, decideWith, POLICIES, readInvoiceDraft, scheduleDates } from "./policy.js";
import { quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const BUSINESS = "coop-business@sandbox.example";
const PAYER = "lantern-bay@sandbox.example";

function ctx(over: Partial<PolicyCtx> = {}): PolicyCtx {
  return {
    flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
    ppEnv: "sandbox",
    toolkitSandbox: true,
    runState: "QUOTED",
    invoiceExists: false,
    holds: [],
    budget: { spentMicros: 100_000, capMicros: 750_000, iteration: 2, maxIterations: 10 },
    expected: {
      quote,
      invoiceNumber: invoiceNumber("2026A-r37"),
      reference: invoiceReference(card.sha256),
      memo: invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode),
      businessEmail: BUSINESS,
      brandAllowlist: [PAYER],
    },
    today: "2026-10-29",
    ...over,
  };
}

function draft(over: Record<string, unknown> = {}) {
  return {
    detail: {
      currency_code: "USD",
      invoice_number: "FS-2026A-r37",
      reference: invoiceReference(card.sha256),
      note: `${invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode)}. Thank you.`,
      invoice_date: "2026-10-29",
      payment_term: { term_type: "NET_15", due_date: "2026-11-13" },
    },
    invoicer: { email_address: BUSINESS },
    primary_recipients: [{ billing_info: { email_address: PAYER } }],
    items: quote.items.map((i) => ({
      name: `${i.name} (free text)`,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: minorToDecimal(i.unitAmountCents) },
      unit_of_measure: "AMOUNT",
    })),
    ...over,
  };
}

const call = (name: string, args: unknown = {}): ToolCall => ({ name, args });

describe("policy lattice: decide(call, ctx) = max verdict (register §9)", () => {
  it("allows the code-matching invoice draft in QUOTED", () => {
    expect(decide(call("create_invoice", draft()), ctx())).toMatchObject({
      verdict: "ALLOW",
      rank: 0,
      decidedBy: [],
    });
  });

  it("DENY · invoiceEqualsQuote when the agent's items differ from the quote (the on-camera beat)", () => {
    const bad = draft();
    (bad.items[1] as { unit_amount: { value: string } }).unit_amount.value = "1386.01";
    const d = decide(call("create_invoice", bad), ctx());
    expect(d.verdict).toBe("DENY");
    expect(d.decidedBy).toEqual(["invoiceEqualsQuote"]);
  });

  it("checks invoicer, recipients, reference, memo and dates", () => {
    expect(
      decide(call("create_invoice", draft({ invoicer: { email_address: "x@evil.example" } })), ctx())
        .decidedBy,
    ).toEqual(["invoicerIsBusinessEmail"]);
    expect(
      decide(
        call(
          "create_invoice",
          draft({ primary_recipients: [{ billing_info: { email_address: "x@evil.example" } }] }),
        ),
        ctx(),
      ).decidedBy,
    ).toEqual(["recipientInBrandAllowlist"]);
    const noHash = draft();
    noHash.detail.reference = "rc:0000000000000000";
    expect(decide(call("create_invoice", noHash), ctx()).decidedBy).toEqual(["referenceCarriesHash"]);
    const late = draft();
    late.detail.payment_term.due_date = "2026-12-15";
    expect(decide(call("create_invoice", late), ctx()).decidedBy).toEqual(["dueWithin30Days"]);
    expect(
      decide(
        call("create_conditional_rules_for_invoice", {
          invoice_id: "INV2",
          rules: [{ action: "AUTO_CANCEL", date: "2026-11-23" }],
        }),
        ctx({ invoiceExists: true }),
      ).verdict,
    ).toBe("ALLOW");
    expect(
      decide(
        call("create_conditional_rules_for_invoice", {
          invoice_id: "INV2",
          rules: [{ action: "AUTO_CANCEL" }],
        }),
        ctx({ invoiceExists: true }),
      ).decidedBy,
    ).toEqual(["dueWithin30Days"]);
  });

  it("send_invoice waits for the treasurer (REQUIRE_APPROVAL)", () => {
    const d = decide(
      call("send_invoice", { invoice_id: "INV2", send_to_recipient: false }),
      ctx({ invoiceExists: true }),
    );
    expect(d).toMatchObject({ verdict: "REQUIRE_APPROVAL", rank: 1, decidedBy: ["sendNeedsTreasurer"] });
  });

  it("phase gate: reads anywhere; writes only in their phase", () => {
    expect(decide(call("get_hold", { hold_id: "H1" }), ctx({ runState: "DRAFT" })).verdict).toBe("ALLOW");
    expect(decide(call("get_invoice"), ctx({ runState: "DRAFT" })).verdict).toBe("DENY");
    expect(decide(call("get_invoice"), ctx({ runState: "FUNDED" })).verdict).toBe("ALLOW");
    expect(decide(call("create_invoice", draft()), ctx({ runState: "INVOICED" })).decidedBy).toContain(
      "phaseGate",
    );
    expect(decide(call("create_invoice", draft()), ctx({ invoiceExists: true })).decidedBy).toContain(
      "phaseGate",
    );
    const holds = [
      { holdId: "H1", state: "OPEN" as const, gate: "BLOCKS_APPROVAL" as const },
      { holdId: "H3", state: "RESOLVED" as const, gate: "RESERVES_LINE" as const },
    ];
    expect(
      decide(call("propose_resolution", { hold_id: "H1" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("ALLOW");
    expect(
      decide(call("propose_resolution", { hold_id: "H3" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("DENY");
    expect(
      decide(call("request_payout_batch", { run_id: "r" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("DENY");
    expect(
      decide(call("request_payout_batch", { run_id: "r" }), ctx({ runState: "IN_REVIEW", holds: [] }))
        .verdict,
    ).toBe("ALLOW");
    expect(decide(call("get_payout_item", { id: "x" }), ctx({ runState: "APPROVED" })).verdict).toBe("DENY");
    expect(decide(call("get_payout_item", { id: "x" }), ctx({ runState: "SETTLING" })).verdict).toBe("ALLOW");
  });

  it("kill switches, sandbox-only, allowlist and budget", () => {
    expect(
      decide(
        call("get_hold"),
        ctx({ flags: { killPayouts: false, killPaypalLive: false, killAiLive: true } }),
      ).decidedBy,
    ).toContain("killSwitch");
    expect(
      decide(
        call("create_invoice", draft()),
        ctx({ flags: { killPayouts: false, killPaypalLive: true, killAiLive: false } }),
      ).verdict,
    ).toBe("DENY");
    expect(
      decide(
        call("request_payout_batch"),
        ctx({
          runState: "IN_REVIEW",
          flags: { killPayouts: true, killPaypalLive: false, killAiLive: false },
        }),
      ).decidedBy,
    ).toContain("killSwitch");
    expect(decide(call("create_invoice", draft()), ctx({ ppEnv: "live" })).decidedBy).toContain(
      "sandboxOnly",
    );
    expect(decide(call("create_payout_batch", {}), ctx()).decidedBy).toContain("allowlist");
    expect(decide(call("cancel_unclaimed_payout_item", {}), ctx()).verdict).toBe("DENY");
    expect(
      decide(
        call("get_hold"),
        ctx({ budget: { spentMicros: 750_000, capMicros: 750_000, iteration: 1, maxIterations: 10 } }),
      ).decidedBy,
    ).toContain("budgetCap");
    expect(
      decide(
        call("get_hold"),
        ctx({ budget: { spentMicros: 0, capMicros: 750_000, iteration: 10, maxIterations: 10 } }),
      ).verdict,
    ).toBe("DENY");
  });

  it("no tool reaches a money-moving endpoint", () => {
    const moneyMoving = [
      "create_payout_batch",
      "cancel_unclaimed_payout_item",
      "record_payment_for_invoice",
      "search_invoicing",
    ];
    for (const name of moneyMoving) {
      for (const runState of ["IN_REVIEW", "APPROVED", "POSTED"] as const) {
        expect(decide(call(name, {}), ctx({ runState })).verdict).toBe("DENY");
      }
    }
    expect(AGENT_TOOL_NAMES).toHaveLength(17);
    expect(AGENT_TOOL_NAMES).not.toContain("create_payout_batch");
  });

  it("30 hostile argument sets all end in DENY", () => {
    const hostile: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const wrongAmount = draft();
      (wrongAmount.items[i % 3] as { unit_amount: { value: string } }).unit_amount.value = `${1 + i}.00`;
      hostile.push(wrongAmount);
      hostile.push(
        draft({ primary_recipients: [{ billing_info: { email_address: `attacker${i}@evil.example` } }] }),
      );
      const ref = draft();
      ref.detail.reference = `rc:${String(i).repeat(16)}`;
      hostile.push(ref);
    }
    expect(hostile).toHaveLength(30);
    for (const args of hostile) expect(decide(call("create_invoice", args), ctx()).verdict).toBe("DENY");
  });

  it("property: adding a policy can only make the verdict stricter", () => {
    const names = [...AGENT_TOOL_NAMES, "create_payout_batch", "unknown_tool"];
    const states = ["DRAFT", "QUOTED", "INVOICED", "IN_REVIEW", "APPROVED", "POSTED", "SETTLED"] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...names),
        fc.constantFrom(...states),
        fc.boolean(),
        fc.boolean(),
        fc.shuffledSubarray([...POLICY_NAMES]),
        fc.constantFrom(...POLICY_NAMES),
        (name, runState, killAi, invoiceExists, subset, extra) => {
          const c = ctx({
            runState,
            invoiceExists,
            flags: { killPayouts: false, killPaypalLive: false, killAiLive: killAi },
          });
          const pick = (ns: PolicyName[]) => Object.fromEntries(ns.map((n) => [n, POLICIES[n]]));
          const smaller = decideWith(call(name, draft()), c, pick(subset));
          const larger = decideWith(call(name, draft()), c, pick([...new Set([...subset, extra])]));
          expect(larger.rank).toBeGreaterThanOrEqual(smaller.rank);
          expect(decide(call(name, draft()), c).rank).toBeGreaterThanOrEqual(larger.rank);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("invoice draft reader", () => {
  it("reads nested and flattened shapes", () => {
    const v = readInvoiceDraft(draft());
    expect(v).toMatchObject({
      currencyCode: "USD",
      invoiceNumber: "FS-2026A-r37",
      invoicerEmail: BUSINESS,
      dueDate: "2026-11-13",
    });
    expect(v.items.map((i) => i.unitAmountCents)).toEqual(quote.items.map((i) => i.unitAmountCents));
    expect(readInvoiceDraft({ invoice_number: "X", invoicer_email_address: "a@b.example" })).toMatchObject({
      invoiceNumber: "X",
      invoicerEmail: "a@b.example",
      recipientEmails: [],
      items: [],
    });
    expect(readInvoiceDraft(null).items).toEqual([]);
    expect(
      scheduleDates({
        a: { due_date: "2026-11-13" },
        invoice_date: "2026-10-29",
        list: [{ date: "2026-11-23T00:00:00Z" }],
      }),
    ).toEqual(["2026-11-13", "2026-11-23"]);
  });
});
