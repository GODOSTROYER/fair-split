import { GENESIS_PREV_HASH, type ProofBundle } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { input, member, row, TEST_LOT, testCard } from "./__fixtures__/world.js";
import { approvalBytes, buildApprovalPayload } from "./approval.js";
import { batchDigest, invoiceNumber, invoiceReference } from "./batch.js";
import { sha256Hex } from "./canon.js";
import {
  appendLedger,
  buildLedger,
  entryHash,
  type LedgerFact,
  nodeProofCrypto,
  verifyChain,
  verifyLedger,
} from "./chain.js";
import { computeLines, lineCanonical } from "./engine.js";
import { quoteInvoice } from "./quote.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";
import { verifyChainWith } from "./verify-core.js";

const fact = (kind: string, payload: LedgerFact["payload"], at = "2026-10-29T02:00:00.000Z"): LedgerFact => ({
  kind,
  actorKind: "engine",
  actorId: "engine v1",
  impersonatedBy: null,
  payload,
  at,
});

describe("ledger hash chain (architecture §12)", () => {
  it("chains entries from a 64-zero genesis", () => {
    const chain = buildLedger([fact("a", { n: 1 }), fact("b", { n: 2 }), fact("c", { n: 3 })]);
    expect(chain[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(chain[1]?.prevHash).toBe(chain[0]?.entryHash);
    expect(chain.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(chain[0]?.entryHash).toBe(entryHash(GENESIS_PREV_HASH, 1, fact("a", { n: 1 })));
    expect(verifyLedger(chain)).toEqual({ ok: true, brokenAtSeq: null });
    expect(appendLedger(chain, fact("d", null)).seq).toBe(4);
  });

  it("detects an edited payload, a removed entry and a reordered chain", () => {
    const chain = buildLedger([fact("a", { n: 1 }), fact("b", { n: 2 }), fact("c", { n: 3 })]);
    const edited = chain.map((e) => (e.seq === 2 ? { ...e, payload: { n: 20 } } : e));
    expect(verifyLedger(edited)).toEqual({ ok: false, brokenAtSeq: 2 });
    expect(verifyLedger([chain[0], chain[2]].filter((e) => e !== undefined))).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
    });
    expect(verifyLedger([...chain].reverse())).toMatchObject({ ok: false });
    expect(verifyLedger([])).toEqual({ ok: true, brokenAtSeq: null });
  });
});

function proofFixture(): ProofBundle {
  const card = testCard();
  const members = [member("M-001", { rail: "PAYPAL" }), member("M-002", { rail: "PAYPAL" }), member("M-003")];
  const rows = [row("M-001", 400), row("M-002", 350), row("M-003", 250)];
  const out = computeLines(input(members, rows));
  const runId = "run-1";
  const sbid = `2026A-${card.rc8}-r1`;
  const items = out.lines
    .filter((l) => l.rail === "PAYPAL")
    .map((l) => ({
      senderItemId: `r1-${l.memberNo}`,
      receiver: `${l.memberNo.toLowerCase()}@x.example`,
      amountCents: l.netCents,
      currency: "USD" as const,
    }));
  const digest = batchDigest({ runId, senderBatchId: sbid, rateCardSha256: card.sha256 }, items);
  const approvals = (["treasurer", "chair"] as const).map((role) => {
    const key = ed25519FromSeed(sha256Hex(`k-${role}`));
    const payload = buildApprovalPayload({
      runId,
      seasonId: "season-1",
      rateCardSha256: card.sha256,
      batch: digest,
      role,
      approverId: role,
      nonce: `nonce-${role}-0001`,
      exp: "2026-10-29T02:30:00.000Z",
    });
    return {
      role,
      keyId: role === "treasurer" ? "fs-analyn-a1" : "fs-ernesto-a1",
      publicKeyHex: key.publicKeyHex,
      payload,
      signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
    };
  });
  const docs = rows.map((r) => ({ documentId: r.documentId, sha256: sha256Hex(r.documentId) }));
  const ledger = buildLedger([
    fact("rate_card.ratified", { rateCardSha256: card.sha256 }, "2026-03-14T08:00:00.000Z"),
    ...docs.map((d) => fact("rows.accepted", { sha256: d.sha256 })),
    fact("payout.submitting", { batchSha256: digest.batchSha256 }),
  ]);
  const quote = quoteInvoice(card, TEST_LOT);
  return {
    v: 1,
    runId,
    runSlug: "2026A-r1",
    invoice: {
      invoiceNumber: invoiceNumber("2026A-r1"),
      status: "MARKED_AS_PAID",
      dueCents: 0,
      reference: invoiceReference(card.sha256),
    },
    rateCard: { canonical: card.canonical, sha256: card.sha256, ratifiedAt: card.ratifiedAt },
    firstSlipDate: "2026-04-02",
    documents: docs,
    pools: { premiumPoolCents: quote.premiumPoolCents, bonusPoolCents: quote.bonusPoolCents },
    lines: out.lines.map((l) => {
      const { lineSha256: h, ...rest } = l;
      return {
        memberNo: l.memberNo,
        rail: l.rail,
        premiumCents: l.premiumCents,
        bonusCents: l.bonusCents,
        deductionsCents: l.deductionsCents,
        creditsCents: l.creditsCents,
        netCents: l.netCents,
        canonical: lineCanonical(rest, card.sha256),
        lineSha256: h,
      };
    }),
    approvals,
    batch: {
      runId,
      senderBatchId: sbid,
      rateCardSha256: card.sha256,
      batchSha256: digest.batchSha256,
      items: digest.items.map((i, k) => ({
        ...i,
        payoutItemId: `ITEM${k}`,
        status: "SUCCESS",
        eventId: `WH-${k}`,
      })),
    },
    ledger,
  };
}

describe("verifyChain(proof): the chain and the six Proof plates", () => {
  it("verifies an honest proof", () => {
    const v = verifyChain(proofFixture());
    expect(v.ok).toBe(true);
    expect(Object.values(v.plates).every((p) => p.ok)).toBe(true);
    expect(verifyChainWith(proofFixture(), nodeProofCrypto)).toEqual(v);
  });

  it("withholds the proof when any plate fails", () => {
    const p = proofFixture();
    expect(verifyChain({ ...p, invoice: { ...p.invoice, dueCents: 100 } }).plates.paid.ok).toBe(false);
    expect(
      verifyChain({ ...p, invoice: { ...p.invoice, reference: "rc:0000000000000000" } }).plates.paid.ok,
    ).toBe(false);
    expect(
      verifyChain({ ...p, rateCard: { ...p.rateCard, sha256: "0".repeat(64) } }).plates.ratified.ok,
    ).toBe(false);
    expect(verifyChain({ ...p, firstSlipDate: "2026-03-01" }).plates.ratified.ok).toBe(false);
    expect(
      verifyChain({ ...p, documents: [...p.documents, { documentId: "x", sha256: "f".repeat(64) }] }).plates
        .read.ok,
    ).toBe(false);
    const lines = p.lines.map((l, i) => (i === 0 ? { ...l, netCents: l.netCents + 1 } : l));
    expect(verifyChain({ ...p, lines }).plates.computed.ok).toBe(false);
    expect(
      verifyChain({ ...p, pools: { ...p.pools, bonusPoolCents: p.pools.bonusPoolCents + 1 } }).plates.computed
        .ok,
    ).toBe(false);
    const tamperedItems = p.batch.items.map((i, k) =>
      k === 0 ? { ...i, amountCents: i.amountCents + 1 } : i,
    );
    const bad = verifyChain({ ...p, batch: { ...p.batch, items: tamperedItems } });
    expect(bad.plates.payoutItems).toEqual({
      ok: false,
      reason: "The batch hash doesn't match the signed batch. Proof withheld.",
    });
    expect(bad.ok).toBe(false);
    const unverified = p.batch.items.map((i) => ({ ...i, eventId: null }));
    expect(verifyChain({ ...p, batch: { ...p.batch, items: unverified } }).plates.payoutItems.ok).toBe(false);
    expect(verifyChain({ ...p, approvals: p.approvals.slice(0, 1) }).plates.twoKeys.ok).toBe(false);
    const forged = p.approvals.map((a, i) =>
      i === 1 ? { ...a, payload: { ...a.payload, totalCents: 1 } } : a,
    );
    expect(verifyChain({ ...p, approvals: forged }).plates.twoKeys.ok).toBe(false);
    const ledger = p.ledger.map((e) => (e.seq === 2 ? { ...e, at: "2026-10-30T00:00:00.000Z" } : e));
    expect(verifyChain({ ...p, ledger }).chain).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });

  it("accepts injected crypto (the browser path)", () => {
    let calls = 0;
    const counting = {
      sha256Hex: (s: string) => {
        calls++;
        return nodeProofCrypto.sha256Hex(s);
      },
      verifyEd25519: nodeProofCrypto.verifyEd25519,
    };
    expect(verifyChainWith(proofFixture(), counting).ok).toBe(true);
    expect(calls).toBeGreaterThan(5);
  });
});
