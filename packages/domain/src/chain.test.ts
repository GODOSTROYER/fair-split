import { readFileSync } from "node:fs";
import { GENESIS_PREV_HASH, type ProofBundle, type SignedApproval } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { APPROVERS, fact, honestProof, KEY_IDS, PROOF_KEYS, T } from "./__fixtures__/proof.js";
import { testCanonical } from "./__fixtures__/world.js";
import { approvalBytes, buildApprovalPayload } from "./approval.js";
import { batchDigest, batchNote, invoiceReference, senderBatchId } from "./batch.js";
import { jcsSha256, sha256Hex } from "./canon.js";
import {
  appendLedger,
  buildLedger,
  entryHash,
  type LedgerFact,
  nodeProofCrypto,
  verifyChain,
  verifyLedger,
} from "./chain.js";
import { hashRateCard } from "./ratecard.js";
import { ed25519FromSeed, ed25519Sign } from "./sig.js";
import { attestedEntries, verifyChainWith } from "./verify-core.js";

const plain = (kind: string, payload: LedgerFact["payload"], at = T("02:00:00")): LedgerFact => ({
  kind,
  actorKind: "engine",
  actorId: "engine v1",
  impersonatedBy: null,
  payload,
  at,
});

describe("ledger hash chain (architecture §12)", () => {
  it("chains entries from a 64-zero genesis", () => {
    const chain = buildLedger([plain("a", { n: 1 }), plain("b", { n: 2 }), plain("c", { n: 3 })]);
    expect(chain[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(chain[1]?.prevHash).toBe(chain[0]?.entryHash);
    expect(chain.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(chain[0]?.entryHash).toBe(entryHash(GENESIS_PREV_HASH, 1, plain("a", { n: 1 })));
    expect(verifyLedger(chain)).toEqual({ ok: true, brokenAtSeq: null });
    expect(appendLedger(chain, plain("d", null)).seq).toBe(4);
  });

  it("detects an edited payload, a removed entry and a reordered chain", () => {
    const chain = buildLedger([plain("a", { n: 1 }), plain("b", { n: 2 }), plain("c", { n: 3 })]);
    const edited = chain.map((e) => (e.seq === 2 ? { ...e, payload: { n: 20 } } : e));
    expect(verifyLedger(edited)).toEqual({ ok: false, brokenAtSeq: 2 });
    expect(verifyLedger([chain[0], chain[2]].filter((e) => e !== undefined))).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
    });
    expect(verifyLedger([...chain].reverse())).toMatchObject({ ok: false });
    expect(verifyLedger([])).toEqual({ ok: true, brokenAtSeq: null });
  });

  it("the browser verifier (`@fairsplit/domain/verify`) imports no node built-ins", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/from\s+["']node:/);
      for (const m of src.matchAll(/from\s+["']\.\/([^"']+)\.js["']/g)) visit(`./${m[1]}.ts`);
    };
    visit("./verify-core.ts");
    expect([...seen].sort()).toEqual(
      ["./digest-input.ts", "./fsm.ts", "./ids.ts", "./jcs.ts", "./verify-core.ts"].sort(),
    );
  });

  it("reads only entries whose payload has the contract's shape", () => {
    const ledger = buildLedger([
      plain("approval.signed", { role: "chair" }),
      fact(
        "payout.cancel",
        { senderItemId: "r1-M-002", payoutItemId: "ITEM-2", afterCancel: "cash" },
        T("02:13:00"),
      ),
    ]);
    expect(attestedEntries(ledger, "approval.signed")).toEqual([]);
    expect(attestedEntries(ledger, "payout.cancel")).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ an attacker's tools
// The attacker edits the bundle and repairs everything the bundle alone can show: hashes are
// recomputed and approvals re-signed with keys the attacker controls. Only the ledger is left alone,
// because rewriting it would break the chain.

const ATTACKER = {
  treasurer: ed25519FromSeed(sha256Hex("attacker treasurer")),
  chair: ed25519FromSeed(sha256Hex("attacker chair")),
};

/** Re-signs every approval over the bundle's current batch with the attacker's keys. */
function resign(p: ProofBundle): SignedApproval[] {
  const total = p.batch.items.reduce((s, i) => s + i.amountCents, 0);
  return p.approvals.map((a) => {
    const payload = buildApprovalPayload({
      runId: p.runId,
      seasonId: a.payload.seasonId,
      rateCardSha256: p.rateCard.sha256,
      batch: { batchSha256: p.batch.batchSha256, itemCount: p.batch.items.length, totalCents: total },
      role: a.role,
      approverId: a.payload.approverId,
      nonce: a.payload.nonce,
      exp: a.payload.exp,
    });
    const key = ATTACKER[a.role];
    return {
      ...a,
      payload,
      publicKeyHex: key.publicKeyHex,
      signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
    };
  });
}

/** Recomputes the batch hash and note from the items, then re-signs. */
function rebatch(p: ProofBundle): ProofBundle {
  const d = batchDigest(
    { runId: p.batch.runId, senderBatchId: p.batch.senderBatchId, rateCardSha256: p.batch.rateCardSha256 },
    p.batch.items.map(({ senderItemId, receiver, amountCents, currency }) => ({
      senderItemId,
      receiver,
      amountCents,
      currency,
    })),
  );
  const next = {
    ...p,
    batch: { ...p.batch, batchSha256: d.batchSha256, note: batchNote("2026-A", d.batchSha256) },
  };
  return { ...next, approvals: resign(next) };
}

/** Re-hashes one line after its money changed. */
function relined(
  l: ProofBundle["lines"][number],
  change: Partial<ProofBundle["lines"][number]["canonical"]>,
) {
  const canonical = { ...l.canonical, ...change };
  return {
    ...l,
    premiumCents: canonical.premiumCents,
    bonusCents: canonical.bonusCents,
    netCents: canonical.netCents,
    canonical,
    lineSha256: jcsSha256(canonical),
  };
}

const ALL_OK = {
  paid: { ok: true, reason: null },
  ratified: { ok: true, reason: null },
  read: { ok: true, reason: null },
  computed: { ok: true, reason: null },
  twoKeys: { ok: true, reason: null },
  payoutItems: { ok: true, reason: null },
};

describe("verifyChain(proof): the chain and the six Proof plates", () => {
  it("verifies an honest proof, with the same result through injected crypto", () => {
    const v = verifyChain(honestProof());
    expect(v.plates).toEqual(ALL_OK);
    expect(v).toMatchObject({ ok: true, chain: { ok: true, brokenAtSeq: null } });
    expect(verifyChainWith(honestProof(), nodeProofCrypto)).toEqual(v);
    let calls = 0;
    const counting = {
      sha256Hex: (s: string) => {
        calls++;
        return nodeProofCrypto.sha256Hex(s);
      },
      verifyEd25519: nodeProofCrypto.verifyEd25519,
    };
    expect(verifyChainWith(honestProof(), counting).ok).toBe(true);
    expect(calls).toBeGreaterThan(5);
  });

  it("an edited ledger breaks the chain", () => {
    const p = honestProof();
    const ledger = p.ledger.map((e) => (e.seq === 2 ? { ...e, at: "2026-10-30T00:00:00.000Z" } : e));
    expect(verifyChain({ ...p, ledger })).toMatchObject({ ok: false, chain: { ok: false, brokenAtSeq: 2 } });
  });

  it("a malformed bundle fails its plate instead of throwing", () => {
    const p = honestProof();
    const broken = { ...p, lines: null } as unknown as ProofBundle;
    expect(verifyChain(broken).plates.computed).toEqual({
      ok: false,
      reason: "The lines could not be read.",
    });
    const nullCanonical = { ...p, lines: [{ ...p.lines[0], canonical: null }] } as unknown as ProofBundle;
    expect(verifyChain(nullCanonical).plates.computed.ok).toBe(false);
  });

  it("plate 1 paid: a status, amount or reference the chain does not attest is refused", () => {
    const p = honestProof();
    expect(verifyChain({ ...p, invoice: { ...p.invoice, dueCents: 100 } }).plates.paid.ok).toBe(false);
    expect(
      verifyChain({ ...p, invoice: { ...p.invoice, reference: "rc:0000000000000000" } }).plates.paid.reason,
    ).toBe("The invoice reference does not carry the card hash.");
    // Claiming a real PayPal payment where the sandbox only marked it paid (I8).
    expect(verifyChain({ ...p, invoice: { ...p.invoice, status: "PAID" } }).plates.paid).toEqual({
      ok: false,
      reason: "No entry in the chain attests this payment.",
    });
    expect(verifyChain({ ...p, invoice: { ...p.invoice, amountCents: 1 } }).plates.paid.reason).toBe(
      "The invoice total is not the pool plus the disbursement line.",
    );
  });

  it("plate 2 ratified: a re-hashed card that no ratification carries is refused", () => {
    const p = honestProof();
    const canonical = testCanonical({
      rules: { ...testCanonical().rules, cbu: { ...testCanonical().rules.cbu, bp: 9_000 } },
    });
    const { sha256 } = hashRateCard(canonical);
    // The attacker carries the new hash everywhere the bundle shows it.
    let forged: ProofBundle = {
      ...p,
      rateCard: { ...p.rateCard, canonical, sha256 },
      invoice: { ...p.invoice, reference: invoiceReference(sha256) },
      lines: p.lines.map((l) => relined(l, { rateCardSha256: sha256 })),
      batch: { ...p.batch, rateCardSha256: sha256, senderBatchId: senderBatchId("2026A", sha256, 1) },
    };
    forged = rebatch(forged);
    const v = verifyChain(forged);
    expect(v.plates.ratified).toEqual({
      ok: false,
      reason: "No ratification in the chain carries this card hash.",
    });
    expect(v.ok).toBe(false);
    expect(
      verifyChain({ ...p, rateCard: { ...p.rateCard, sha256: "0".repeat(64) } }).plates.ratified.ok,
    ).toBe(false);
    expect(verifyChain({ ...p, firstSlipDate: "2026-03-01" }).plates.ratified.reason).toBe(
      "A slip predates the rate card.",
    );
    expect(verifyChain({ ...p, firstSlipDate: "2026-04-03" }).plates.ratified.reason).toBe(
      "The first slip date differs from the chain's.",
    );
  });

  it("plate 3 read: a photo hash is attested only by its own rows.accepted entry", () => {
    const p = honestProof();
    const swapped = p.documents.map((d, i) => (i === 0 ? { ...d, sha256: sha256Hex("another image") } : d));
    expect(verifyChain({ ...p, documents: swapped }).plates.read).toEqual({
      ok: false,
      reason: "A slip photo hash is not in the chain.",
    });
    // A hash that appears elsewhere in the chain (here the batch digest) is not a read photo.
    const smuggled = [...p.documents, { documentId: "doc-x", sha256: p.batch.batchSha256 }];
    expect(verifyChain({ ...p, documents: smuggled }).plates.read.ok).toBe(false);
    expect(verifyChain({ ...p, documents: [] }).plates.read.ok).toBe(false);
  });

  it("plate 4 computed: re-hashed lines that move a cent between members are refused", () => {
    const p = honestProof();
    const lines = p.lines.map((l, i) =>
      i === 0
        ? relined(l, { premiumCents: l.premiumCents + 1, netCents: l.netCents + 1 })
        : i === 2
          ? relined(l, { premiumCents: l.premiumCents - 1, netCents: l.netCents - 1 })
          : l,
    );
    // Every line re-hashes and the pools still sum; only the chain's lines root disagrees.
    expect(verifyChain({ ...p, lines }).plates.computed).toEqual({
      ok: false,
      reason: "The line hashes differ from the computed run.",
    });
    const unhashed = p.lines.map((l, i) => (i === 0 ? { ...l, netCents: l.netCents + 1 } : l));
    expect(verifyChain({ ...p, lines: unhashed }).plates.computed.reason).toBe(
      "A line hash does not recompute.",
    );
    const otherCard = p.lines.map((l, i) => (i === 0 ? relined(l, { rateCardSha256: "1".repeat(64) }) : l));
    expect(verifyChain({ ...p, lines: otherCard }).plates.computed.reason).toBe(
      "A line hash does not recompute.",
    );
    expect(
      verifyChain({ ...p, pools: { ...p.pools, bonusPoolCents: p.pools.bonusPoolCents + 1 } }).plates.computed
        .ok,
    ).toBe(false);
  });

  it("plate 5 two keys: approvals re-signed with keys the chain never registered are refused", () => {
    const p = honestProof();
    expect(verifyChain({ ...p, approvals: resign(p) }).plates.twoKeys).toEqual({
      ok: false,
      reason: "A signature's key differs from the registered key.",
    });
    // Presenting the registered public keys does not help: signatures are checked against them.
    const posing = resign(p).map((a, i) => ({ ...a, publicKeyHex: p.approvals[i]?.publicKeyHex as string }));
    expect(verifyChain({ ...p, approvals: posing }).plates.twoKeys.reason).toBe(
      "The two signatures do not both verify over the same batch hash.",
    );
    expect(verifyChain({ ...p, approvals: p.approvals.slice(0, 1) }).plates.twoKeys.reason).toBe(
      "The Chair's co-signature is missing.",
    );
    const forged = p.approvals.map((a, i) =>
      i === 1 ? { ...a, payload: { ...a.payload, totalCents: 1 } } : a,
    );
    expect(verifyChain({ ...p, approvals: forged }).plates.twoKeys.reason).toBe(
      "A signature is over a different batch.",
    );
    const renamed = p.approvals.map((a) => (a.role === "chair" ? { ...a, keyId: "fs-ernesto-a2" } : a));
    expect(verifyChain({ ...p, approvals: renamed }).plates.twoKeys.reason).toBe(
      "A signature is not recorded in the chain.",
    );
    const sameKey = p.approvals.map((a) => ({ ...a, keyId: KEY_IDS.treasurer }));
    expect(verifyChain({ ...p, approvals: sameKey }).plates.twoKeys.ok).toBe(false);
  });

  it("plate 6 payout items: the reviewer's attack (new receiver, re-hashed batch, re-signed) is refused", () => {
    const p = honestProof();
    const items = p.batch.items.map((i, k) => (k === 0 ? { ...i, receiver: "attacker@evil.example" } : i));
    const forged = rebatch({ ...p, batch: { ...p.batch, items } });
    const v = verifyChain(forged);
    expect(v.ok).toBe(false);
    expect(v.plates.payoutItems).toEqual({
      ok: false,
      reason: "The posted batch differs from the one in the chain.",
    });
    expect(v.plates.twoKeys.ok).toBe(false);
    // Without re-hashing, the batch hash itself gives it away.
    const lazy = verifyChain({ ...p, batch: { ...p.batch, items } });
    expect(lazy.plates.payoutItems).toEqual({
      ok: false,
      reason: "The batch hash doesn't match the signed batch. Proof withheld.",
    });
  });

  it("plate 6 payout items: amounts, IDs, the note and every status must agree with the chain", () => {
    const p = honestProof();
    // An item that pays more than the member's line, with the line re-hashed too: the root catches it.
    const bumped = rebatch({
      ...p,
      batch: {
        ...p.batch,
        items: p.batch.items.map((i, k) => (k === 0 ? { ...i, amountCents: i.amountCents + 100 } : i)),
      },
    });
    expect(verifyChain(bumped).plates.payoutItems.ok).toBe(false);
    expect(
      verifyChain({ ...p, batch: { ...p.batch, note: "Fair Split 2026-A" } }).plates.payoutItems.reason,
    ).toBe("The batch note does not carry the batch digest.");
    const unverified = p.batch.items.map((i) => ({ ...i, eventId: null }));
    expect(verifyChain({ ...p, batch: { ...p.batch, items: unverified } }).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    const upgraded = p.batch.items.map((i) => ({ ...i, status: "SUCCESS" as const }));
    expect(verifyChain({ ...p, batch: { ...p.batch, items: upgraded } }).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    expect(
      verifyChain({ ...p, batch: { ...p.batch, senderBatchId: "2026A-00000000-r1" } }).plates.payoutItems
        .reason,
    ).toBe("The batch ID does not carry this card and run.");
  });

  it("plate 6 payout items: RETURNED needs our cancel first, and dev_mock events prove nothing", () => {
    const p = honestProof();
    const noCancel = { ...p, ledger: buildLedger(p.ledger.filter((e) => e.kind !== "payout.cancel")) };
    expect(verifyChain(noCancel).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    const mocked = buildLedger(
      p.ledger.map((e) =>
        e.kind === "webhook.applied"
          ? { ...e, payload: { ...(e.payload as object), verified: "dev_mock" } }
          : e,
      ),
    );
    expect(verifyChain({ ...p, ledger: mocked }).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
  });

  it("orders the chain: rules before facts, keys and signatures before the POST", () => {
    const p = honestProof();
    const move = (kind: string, to: number) => {
      const entries = [...p.ledger];
      const i = entries.findIndex((e) => e.kind === kind);
      const [e] = entries.splice(i, 1);
      if (e) entries.splice(to, 0, e);
      return buildLedger(entries);
    };
    expect(verifyChain({ ...p, ledger: move("rate_card.ratified", 6) }).plates.ratified.reason).toBe(
      "A slip was accepted before the card was ratified.",
    );
    const late = move("key.registered", p.ledger.length - 1);
    expect(verifyChain({ ...p, ledger: late }).plates.twoKeys.reason).toBe(
      "A signing key is not registered to its signer.",
    );
    const signedLate = buildLedger([
      ...p.ledger.filter((e) => e.kind !== "approval.signed"),
      ...p.ledger.filter((e) => e.kind === "approval.signed"),
    ]);
    expect(verifyChain({ ...p, ledger: signedLate }).plates.payoutItems.reason).toBe(
      "The batch was posted before it was signed.",
    );
  });

  it("the Chair is needed only above the card's thresholds (R5)", () => {
    const p = honestProof();
    const keyRow = (role: "treasurer" | "chair") =>
      fact(
        "key.registered",
        {
          keyId: KEY_IDS[role],
          persona: APPROVERS[role],
          kind: "app",
          publicKeyHex: PROOF_KEYS[role].publicKeyHex,
        },
        "2026-10-01T00:00:00.000Z",
      );
    expect(keyRow("chair").payload).toMatchObject({ keyId: "fs-ernesto-a1" });
    const card = {
      ...p.rateCard.canonical.rules.cosign,
      batchOverCents: 99_999_999,
      lineOverCents: 99_999_999,
    };
    const lenient = { ...p.rateCard.canonical, rules: { ...p.rateCard.canonical.rules, cosign: card } };
    const v = verifyChain({
      ...p,
      rateCard: { ...p.rateCard, canonical: lenient },
      approvals: p.approvals.slice(0, 1),
    });
    // The card no longer re-hashes, so plate 2 fails, but plate 5 accepts the treasurer alone.
    expect(v.plates.twoKeys).toEqual({ ok: true, reason: null });
    expect(v.plates.ratified.ok).toBe(false);
  });
});
