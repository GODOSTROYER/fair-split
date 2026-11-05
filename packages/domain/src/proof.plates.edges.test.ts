// Tests that kill mutation-testing survivors (handoff T3) in the Proof verifier. Its checks are layered
// (a bundle field is compared with the chain, and again with what the signatures cover), so a tampered
// field checked only for `ok: false` lets any one layer go missing. Each case below changes one bundle
// field, without re-chaining, and pins exactly which plates fail and why: the first check that should
// catch it names it.
import type { ProofBundle } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { honestProof, PROOF_TRUST } from "./__fixtures__/proof.js";
import { verifyChain } from "./chain.js";

type P = ProofBundle;
const failures = (p: P) =>
  Object.entries(verifyChain(p, PROOF_TRUST).plates)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k}: ${v.reason}`);
const line0 = (p: P, over: Record<string, unknown>) =>
  ({ ...p, lines: p.lines.map((l, i) => (i === 0 ? { ...l, ...over } : l)) }) as P;
const item0 = (p: P, over: Record<string, unknown>) =>
  ({
    ...p,
    batch: { ...p.batch, items: p.batch.items.map((it, i) => (i === 0 ? { ...it, ...over } : it)) },
  }) as P;
const appr0 = (p: P, over: Record<string, unknown>) =>
  ({ ...p, approvals: p.approvals.map((a, i) => (i === 0 ? { ...a, ...over } : a)) }) as P;

const NOT_COMPUTED = "computed: A line hash does not recompute.";
const ITEM_AMOUNT = "payoutItems: An item amount differs from the member's computed line.";
const BATCH_HASH = "payoutItems: The batch hash doesn't match the signed batch. Proof withheld.";
const OTHER_BATCH = "twoKeys: A signature is over a different batch.";
const NOT_VERIFIED_EVENT = "payoutItems: An item status does not rest on a verified event.";

const CASES: [string, (p: P) => P, string[]][] = [
  [
    "the invoice number",
    (p) => ({ ...p, invoice: { ...p.invoice, invoiceNumber: "FS-2026A-r9" } }),
    ["paid: The invoice number is not this run's."],
  ],
  [
    "the amount due",
    (p) => ({ ...p, invoice: { ...p.invoice, dueCents: 100 } }),
    ["paid: The invoice is not paid in full."],
  ],
  [
    "the invoice status",
    (p) => ({ ...p, invoice: { ...p.invoice, status: "SENT" as never } }),
    ["paid: The invoice is not paid in full."],
  ],
  [
    "MARKED_AS_PAID read as PAID",
    (p) => ({ ...p, invoice: { ...p.invoice, status: "PAID" } }),
    ["paid: No entry in the chain attests this payment."],
  ],
  [
    "the ratification time",
    (p) => ({ ...p, rateCard: { ...p.rateCard, ratifiedAt: "2026-03-15T08:00:00.000Z" } }),
    ["ratified: No ratification in the chain carries this card hash."],
  ],
  [
    "a later first slip",
    (p) => ({ ...p, firstSlipDate: "2026-04-03" }),
    ["ratified: The first slip date differs from the chain's."],
  ],
  [
    "a first slip before the card",
    (p) => ({ ...p, firstSlipDate: "2026-03-01" }),
    ["ratified: A slip predates the rate card."],
  ],
  [
    "a photo listed twice",
    (p) => ({ ...p, documents: [...p.documents, p.documents[0] as P["documents"][number]] }),
    ["read: A slip photo is listed twice."],
  ],
  [
    "no photos",
    (p) => ({ ...p, documents: [] }),
    ["ratified: The first slip date differs from the chain's.", "read: There are no slip photos."],
  ],
  [
    "no lines",
    (p) => ({ ...p, lines: [] }),
    ["computed: There are no lines.", "twoKeys: A signature does not cover these lines.", ITEM_AMOUNT],
  ],
  [
    "a line twice",
    (p) => ({ ...p, lines: [...p.lines, p.lines[0] as P["lines"][number]] }),
    ["computed: A member has two lines.", "twoKeys: A signature does not cover these lines."],
  ],
  [
    "a line's rail",
    (p) => line0(p, { rail: p.lines[0]?.rail === "PAYPAL" ? "CASH" : "PAYPAL" }),
    [NOT_COMPUTED, ITEM_AMOUNT],
  ],
  [
    "a line's premium",
    (p) => line0(p, { premiumCents: (p.lines[0]?.premiumCents ?? 0) + 1 }),
    [NOT_COMPUTED],
  ],
  ["a line's bonus", (p) => line0(p, { bonusCents: (p.lines[0]?.bonusCents ?? 0) + 1 }), [NOT_COMPUTED]],
  [
    "a line's net",
    (p) => line0(p, { netCents: (p.lines[0]?.netCents ?? 0) + 1 }),
    [NOT_COMPUTED, ITEM_AMOUNT],
  ],
  [
    "a line's deductions",
    (p) => line0(p, { deductionsCents: (p.lines[0]?.deductionsCents ?? 0) + 1 }),
    [NOT_COMPUTED],
  ],
  [
    "a line's credits",
    (p) => line0(p, { creditsCents: (p.lines[0]?.creditsCents ?? 0) + 1 }),
    [NOT_COMPUTED],
  ],
  [
    "a line's member",
    (p) => line0(p, { memberNo: "M-999" }),
    [NOT_COMPUTED, "twoKeys: A signature does not cover these lines.", ITEM_AMOUNT],
  ],
  [
    "the premium pool",
    (p) => ({ ...p, pools: { ...p.pools, premiumPoolCents: p.pools.premiumPoolCents + 1 } }),
    [
      "paid: The invoice total is not the pool plus the disbursement line.",
      "computed: The lines do not sum to the pools.",
    ],
  ],
  [
    "the bonus pool",
    (p) => ({ ...p, pools: { ...p.pools, bonusPoolCents: p.pools.bonusPoolCents + 1 } }),
    [
      "paid: The invoice total is not the pool plus the disbursement line.",
      "computed: The lines do not sum to the pools.",
    ],
  ],
  [
    "an item's amount",
    (p) => item0(p, { amountCents: (p.batch.items[0]?.amountCents ?? 0) + 1 }),
    [OTHER_BATCH, BATCH_HASH],
  ],
  ["an item's receiver", (p) => item0(p, { receiver: "x@example.test" }), [BATCH_HASH]],
  ["an item's sender_item_id", (p) => item0(p, { senderItemId: "r1-M-099" }), [BATCH_HASH]],
  ["an item's PayPal id", (p) => item0(p, { payoutItemId: "OTHER" }), [NOT_VERIFIED_EVENT]],
  ["an item's status", (p) => item0(p, { status: "PENDING" }), [NOT_VERIFIED_EVENT]],
  ["an item's event", (p) => item0(p, { eventId: "WH-OTHER" }), [NOT_VERIFIED_EVENT]],
  [
    "the batch note",
    (p) => ({ ...p, batch: { ...p.batch, note: "Fair Split 2026-A, batch 00000000" } }),
    ["payoutItems: The batch note does not carry the batch digest."],
  ],
  [
    "the sender_batch_id",
    (p) => ({ ...p, batch: { ...p.batch, senderBatchId: "2026A-00000000-r1" } }),
    ["payoutItems: The batch ID does not carry this card and run."],
  ],
  [
    "the batch hash",
    (p) => ({ ...p, batch: { ...p.batch, batchSha256: "0".repeat(64) } }),
    [OTHER_BATCH, BATCH_HASH],
  ],
  [
    "no items",
    (p) => ({ ...p, batch: { ...p.batch, items: [] } }),
    [OTHER_BATCH, "payoutItems: The batch has no items."],
  ],
  [
    "an approval's role",
    (p) => appr0(p, { role: p.approvals[0]?.role === "treasurer" ? "chair" : "treasurer" }),
    [
      "twoKeys: The treasurer's signature is missing.",
      "payoutItems: The batch was posted before it was signed.",
    ],
  ],
  [
    "an approval's key ID",
    (p) => appr0(p, { keyId: "fs-analyn-w9" }),
    [
      "twoKeys: A signature is not recorded in the chain.",
      "payoutItems: The batch was posted before it was signed.",
    ],
  ],
  [
    "an approval's public key",
    (p) => appr0(p, { publicKeyHex: "ab".repeat(32) }),
    ["twoKeys: A signature's key differs from the published key."],
  ],
  [
    "one approval twice",
    (p) => ({ ...p, approvals: [p.approvals[0], p.approvals[0]] as P["approvals"] }),
    ["twoKeys: The Chair's co-signature is missing."],
  ],
  [
    "the run slug",
    (p) => ({ ...p, runSlug: "2026A-r2" }),
    [
      "paid: The invoice number is not this run's.",
      "payoutItems: The batch ID does not carry this card and run.",
    ],
  ],
];

describe("Proof plates: one tampered bundle field, the exact failures", () => {
  it("the honest bundle passes every plate", () => {
    expect(failures(honestProof())).toEqual([]);
  });

  it.each(CASES)("%s", (_label, tamper, expected) => {
    expect(failures(tamper(honestProof()))).toEqual(expected);
  });
});
