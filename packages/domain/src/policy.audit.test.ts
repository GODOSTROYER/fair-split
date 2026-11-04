// Security audit T1 (policy lattice): pins that `invoiceEqualsQuote` names every key the canonical invoice does not
// carry, however it is spelled, including keys that are special to JavaScript objects (`__proto__`, `constructor`,
// `toString`) arriving as own keys from JSON.parse, at the top level and under every nested object the canonical
// shape allows; and that the lattice's max never lets a looser policy set beat a stricter one.
import type { PolicyCtx, PolicyName, ToolCall } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import { canonicalInvoiceCall } from "./invoice.js";
import { decide, decideWith, invoiceEqualsQuote, POLICIES } from "./policy.js";
import { quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const PAYER = "lantern-bay@sandbox.example";
const EXPECTED: PolicyCtx["expected"] = {
  quote,
  invoiceNumber: invoiceNumber("2026A-r37"),
  reference: invoiceReference(card.sha256),
  memo: invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode),
  businessEmail: "coop-business@sandbox.example",
  payer: { email: PAYER, businessName: "Lantern Bay Chocolate Co." },
  brandAllowlist: [PAYER],
  invoiceId: null,
  invoiceDate: null,
};
const CTX: PolicyCtx = {
  flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
  ppEnv: "sandbox",
  toolkitSandbox: true,
  runState: "QUOTED",
  invoiceExists: false,
  holds: [],
  budget: { spentMicros: 0, capMicros: 750_000, iteration: 0, maxIterations: 10 },
  expected: EXPECTED,
  today: "2026-10-29",
};

const want = canonicalInvoiceCall("create_invoice", EXPECTED);
if (!want.ok) throw new Error("the fixture quote cannot be invoiced");
const CANONICAL_JSON = JSON.stringify(want.args);
const create = (args: unknown): ToolCall => ({ name: "create_invoice", args });

/** The canonical body with `"key": value` spliced into the object at `at` (as raw JSON, so `__proto__` is an own key). */
function withKey(at: "top" | "item" | "unit_amount" | "recipient" | "billing_info", key: string): unknown {
  const body = JSON.parse(CANONICAL_JSON) as Record<string, unknown>;
  const marker = { __marker__: true };
  const host = {
    top: () => body,
    item: () => (body.items as Record<string, unknown>[])[0],
    unit_amount: () => (body.items as Record<string, Record<string, unknown>>[])[0]?.unit_amount,
    recipient: () => (body.primary_recipients as Record<string, unknown>[])[0],
    billing_info: () =>
      (body.primary_recipients as Record<string, Record<string, unknown>>[])[0]?.billing_info,
  }[at]();
  if (!host) throw new Error(`no ${at} in the canonical body`);
  host.__marker__ = marker;
  const raw = JSON.stringify(body).replace(
    '"__marker__":{"__marker__":true}',
    `${JSON.stringify(key)}:{"x":1}`,
  );
  if (raw.includes("__marker__")) throw new Error("the key was not spliced in");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const placed = at === "top" ? parsed : JSON.stringify(parsed);
  if (at === "top" && !Object.hasOwn(placed as object, key)) throw new Error(`${key} is not an own key`);
  if (at !== "top" && !(placed as string).includes(`${JSON.stringify(key)}:{"x":1}`))
    throw new Error(`${key} is not in the body`);
  return parsed;
}

describe("inv.i1.no-model-numbers: invoiceEqualsQuote names unknown keys however they are spelled", () => {
  it("the canonical body itself is allowed (the fixture is sound)", () => {
    expect(invoiceEqualsQuote(create(JSON.parse(CANONICAL_JSON)), CTX).verdict).toBe(0);
    expect(decide(create(JSON.parse(CANONICAL_JSON)), CTX).verdict).toBe("ALLOW");
  });

  for (const at of ["top", "item", "unit_amount", "recipient", "billing_info"] as const) {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "tax"]) {
      it(`denies an own "${key}" key under ${at}`, () => {
        const args = withKey(at, key);
        const r = invoiceEqualsQuote(create(args), CTX);
        expect(r.verdict, r.reason ?? "").toBe(2);
        expect(decide(create(args), CTX).verdict).toBe("DENY");
      });
    }
  }
});

describe("the lattice only tightens", () => {
  const names = Object.keys(POLICIES) as PolicyName[];
  it("property: a subset of the policies is never stricter than the whole lattice, for any call", () => {
    fc.assert(
      fc.property(
        fc.subarray(names),
        fc.constantFrom(
          create(JSON.parse(CANONICAL_JSON)),
          create(withKey("top", "__proto__")),
          { name: "send_invoice", args: { invoice_id: "INV2-X", send_to_recipient: false } },
          { name: "create_payout_batch", args: {} },
        ),
        (subset, call) => {
          const part = Object.fromEntries(subset.map((n) => [n, POLICIES[n]]));
          expect(decideWith(call, CTX, part).rank).toBeLessThanOrEqual(decide(call, CTX).rank);
        },
      ),
    );
  });
});
