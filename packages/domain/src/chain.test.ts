import { readFileSync } from "node:fs";
import {
  type ApprovalRole,
  GENESIS_PREV_HASH,
  type LedgerPayload,
  PROOF_STATUS_LABELS,
  type ProofBundle,
  type ProofTrust,
  type PublishedKeys,
  type SignedApproval,
  type SigningKeyKind,
} from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import {
  APPROVERS,
  fact,
  honestProof,
  KEY_IDS,
  LEDGER_KEY,
  PROOF_KEYS,
  PROOF_TRUST,
  T,
  withCheckpoint,
} from "./__fixtures__/proof.js";
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
  signCheckpoint,
  verifyChain,
  verifyLedger,
} from "./chain.js";
import { hashRateCard } from "./ratecard.js";
import { type Ed25519KeyPair, ed25519FromSeed, ed25519Sign } from "./sig.js";
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
      [
        "./digest-input.ts",
        "./fsm.ts",
        "./ids.ts",
        "./jcs.ts",
        "./sample-keys.ts",
        "./verify-core.ts",
      ].sort(),
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

/** Verifies with the published keys passed in from outside the bundle, as the Proof page does. */
const verify = (
  p: ProofBundle,
  trust: ProofTrust | PublishedKeys = PROOF_TRUST,
  options: { demoMode?: boolean } = {},
) => verifyChain(p, trust, options);

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
    const v = verify(honestProof());
    expect(v.plates).toEqual(ALL_OK);
    expect(v).toMatchObject({
      ok: true,
      status: "verified",
      chain: { ok: true, brokenAtSeq: null },
      checkpoint: { ok: true, reason: null, seq: honestProof().ledger.length, keyId: LEDGER_KEY.keyId },
      sampleKeys: [],
    });
    expect(verifyChainWith(honestProof(), nodeProofCrypto, PROOF_TRUST)).toEqual(v);
    let calls = 0;
    const counting = {
      sha256Hex: (s: string) => {
        calls++;
        return nodeProofCrypto.sha256Hex(s);
      },
      verifyEd25519: nodeProofCrypto.verifyEd25519,
    };
    expect(verifyChainWith(honestProof(), counting, PROOF_TRUST).ok).toBe(true);
    expect(calls).toBeGreaterThan(5);
  });

  it("an edited ledger breaks the chain", () => {
    const p = honestProof();
    const ledger = p.ledger.map((e) => (e.seq === 2 ? { ...e, at: "2026-10-30T00:00:00.000Z" } : e));
    expect(verify({ ...p, ledger })).toMatchObject({ ok: false, chain: { ok: false, brokenAtSeq: 2 } });
  });

  it("a malformed bundle fails its plate instead of throwing", () => {
    const p = honestProof();
    const broken = { ...p, lines: null } as unknown as ProofBundle;
    expect(verify(broken).plates.computed).toEqual({
      ok: false,
      reason: "The lines could not be read.",
    });
    const nullCanonical = { ...p, lines: [{ ...p.lines[0], canonical: null }] } as unknown as ProofBundle;
    expect(verify(nullCanonical).plates.computed.ok).toBe(false);
  });

  it("plate 1 paid: a status, amount or reference the chain does not attest is refused", () => {
    const p = honestProof();
    expect(verify({ ...p, invoice: { ...p.invoice, dueCents: 100 } }).plates.paid.ok).toBe(false);
    expect(
      verify({ ...p, invoice: { ...p.invoice, reference: "rc:0000000000000000" } }).plates.paid.reason,
    ).toBe("The invoice reference does not carry the card hash.");
    // Claiming a real PayPal payment where the sandbox only marked it paid (I8).
    expect(verify({ ...p, invoice: { ...p.invoice, status: "PAID" } }).plates.paid).toEqual({
      ok: false,
      reason: "No entry in the chain attests this payment.",
    });
    expect(verify({ ...p, invoice: { ...p.invoice, amountCents: 1 } }).plates.paid.reason).toBe(
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
    const v = verify(forged);
    expect(v.plates.ratified).toEqual({
      ok: false,
      reason: "No ratification in the chain carries this card hash.",
    });
    expect(v.ok).toBe(false);
    expect(verify({ ...p, rateCard: { ...p.rateCard, sha256: "0".repeat(64) } }).plates.ratified.ok).toBe(
      false,
    );
    expect(verify({ ...p, firstSlipDate: "2026-03-01" }).plates.ratified.reason).toBe(
      "A slip predates the rate card.",
    );
    expect(verify({ ...p, firstSlipDate: "2026-04-03" }).plates.ratified.reason).toBe(
      "The first slip date differs from the chain's.",
    );
  });

  it("plate 3 read: a photo hash is attested only by its own rows.accepted entry", () => {
    const p = honestProof();
    const swapped = p.documents.map((d, i) => (i === 0 ? { ...d, sha256: sha256Hex("another image") } : d));
    expect(verify({ ...p, documents: swapped }).plates.read).toEqual({
      ok: false,
      reason: "A slip photo hash is not in the chain.",
    });
    // A hash that appears elsewhere in the chain (here the batch digest) is not a read photo.
    const smuggled = [...p.documents, { documentId: "doc-x", sha256: p.batch.batchSha256 }];
    expect(verify({ ...p, documents: smuggled }).plates.read.ok).toBe(false);
    expect(verify({ ...p, documents: [] }).plates.read.ok).toBe(false);
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
    expect(verify({ ...p, lines }).plates.computed).toEqual({
      ok: false,
      reason: "The line hashes differ from the computed run.",
    });
    const unhashed = p.lines.map((l, i) => (i === 0 ? { ...l, netCents: l.netCents + 1 } : l));
    expect(verify({ ...p, lines: unhashed }).plates.computed.reason).toBe("A line hash does not recompute.");
    const otherCard = p.lines.map((l, i) => (i === 0 ? relined(l, { rateCardSha256: "1".repeat(64) }) : l));
    expect(verify({ ...p, lines: otherCard }).plates.computed.reason).toBe("A line hash does not recompute.");
    expect(
      verify({ ...p, pools: { ...p.pools, bonusPoolCents: p.pools.bonusPoolCents + 1 } }).plates.computed.ok,
    ).toBe(false);
  });

  it("plate 5 two keys: approvals re-signed with keys the chain never registered are refused", () => {
    const p = honestProof();
    expect(verify({ ...p, approvals: resign(p) }).plates.twoKeys).toEqual({
      ok: false,
      reason: "A signature's key differs from the published key.",
    });
    // Presenting the registered public keys does not help: signatures are checked against them.
    const posing = resign(p).map((a, i) => ({ ...a, publicKeyHex: p.approvals[i]?.publicKeyHex as string }));
    expect(verify({ ...p, approvals: posing }).plates.twoKeys.reason).toBe(
      "The two signatures do not both verify over the same batch hash.",
    );
    expect(verify({ ...p, approvals: p.approvals.slice(0, 1) }).plates.twoKeys.reason).toBe(
      "The Chair's co-signature is missing.",
    );
    const forged = p.approvals.map((a, i) =>
      i === 1 ? { ...a, payload: { ...a.payload, totalCents: 1 } } : a,
    );
    expect(verify({ ...p, approvals: forged }).plates.twoKeys.reason).toBe(
      "A signature is over a different batch.",
    );
    const renamed = p.approvals.map((a) => (a.role === "chair" ? { ...a, keyId: "fs-ernesto-a2" } : a));
    expect(verify({ ...p, approvals: renamed }).plates.twoKeys.reason).toBe(
      "A signature is not recorded in the chain.",
    );
    const sameKey = p.approvals.map((a) => ({ ...a, keyId: KEY_IDS.treasurer }));
    expect(verify({ ...p, approvals: sameKey }).plates.twoKeys.ok).toBe(false);
  });

  it("plate 6 payout items: the reviewer's attack (new receiver, re-hashed batch, re-signed) is refused", () => {
    const p = honestProof();
    const items = p.batch.items.map((i, k) => (k === 0 ? { ...i, receiver: "attacker@evil.example" } : i));
    const forged = rebatch({ ...p, batch: { ...p.batch, items } });
    const v = verify(forged);
    expect(v.ok).toBe(false);
    expect(v.plates.payoutItems).toEqual({
      ok: false,
      reason: "The posted batch differs from the one in the chain.",
    });
    expect(v.plates.twoKeys.ok).toBe(false);
    // Without re-hashing, the batch hash itself gives it away.
    const lazy = verify({ ...p, batch: { ...p.batch, items } });
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
    expect(verify(bumped).plates.payoutItems.ok).toBe(false);
    expect(verify({ ...p, batch: { ...p.batch, note: "Fair Split 2026-A" } }).plates.payoutItems.reason).toBe(
      "The batch note does not carry the batch digest.",
    );
    const unverified = p.batch.items.map((i) => ({ ...i, eventId: null }));
    expect(verify({ ...p, batch: { ...p.batch, items: unverified } }).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    const upgraded = p.batch.items.map((i) => ({ ...i, status: "SUCCESS" as const }));
    expect(verify({ ...p, batch: { ...p.batch, items: upgraded } }).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    expect(
      verify({ ...p, batch: { ...p.batch, senderBatchId: "2026A-00000000-r1" } }).plates.payoutItems.reason,
    ).toBe("The batch ID does not carry this card and run.");
  });

  it("plate 6 payout items: RETURNED needs our cancel first, and dev_mock events prove nothing", () => {
    const p = honestProof();
    const noCancel = { ...p, ledger: buildLedger(p.ledger.filter((e) => e.kind !== "payout.cancel")) };
    expect(verify(noCancel).plates.payoutItems.reason).toBe(
      "An item status does not rest on a verified event.",
    );
    const mocked = buildLedger(
      p.ledger.map((e) =>
        e.kind === "webhook.applied"
          ? { ...e, payload: { ...(e.payload as object), verified: "dev_mock" } }
          : e,
      ),
    );
    expect(verify({ ...p, ledger: mocked }).plates.payoutItems.reason).toBe(
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
    expect(verify({ ...p, ledger: move("rate_card.ratified", 6) }).plates.ratified.reason).toBe(
      "A slip was accepted before the card was ratified.",
    );
    const late = move("key.registered", p.ledger.length - 1);
    expect(verify({ ...p, ledger: late }).plates.twoKeys.reason).toBe(
      "A signing key is not registered to its signer.",
    );
    const signedLate = buildLedger([
      ...p.ledger.filter((e) => e.kind !== "approval.signed"),
      ...p.ledger.filter((e) => e.kind === "approval.signed"),
    ]);
    expect(verify({ ...p, ledger: signedLate }).plates.payoutItems.reason).toBe(
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
    const v = verify({
      ...p,
      rateCard: { ...p.rateCard, canonical: lenient },
      approvals: p.approvals.slice(0, 1),
    });
    // The card no longer re-hashes, so plate 2 fails, but plate 5 accepts the treasurer alone.
    expect(v.plates.twoKeys).toEqual({ ok: true, reason: null });
    expect(v.plates.ratified.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ trust comes from outside the bundle

interface Signer {
  keyId: string;
  pair: Ed25519KeyPair;
  kind: SigningKeyKind;
}

/**
 * Re-keys the run: approvals re-signed, the ledger's key registrations and approval records
 * rewritten and re-chained, and the checkpoint re-signed with the fixture's ledger key. Everything
 * inside the bundle is consistent; only the published keys passed in can tell the difference.
 */
function rekey(
  p: ProofBundle,
  signers: Record<ApprovalRole, Signer>,
): { proof: ProofBundle; trust: ProofTrust } {
  const roleOf = (persona: string): ApprovalRole => (persona === APPROVERS.chair ? "chair" : "treasurer");
  const approvals = p.approvals.map((a) => {
    const s = signers[a.role];
    return {
      ...a,
      keyId: s.keyId,
      publicKeyHex: s.pair.publicKeyHex,
      signatureHex: ed25519Sign(s.pair.privateKey, approvalBytes(a.payload)),
    };
  });
  const ledger = buildLedger(
    p.ledger.map((e): LedgerFact => {
      if (e.kind === "key.registered") {
        const role = roleOf((e.payload as LedgerPayload<"key.registered">).persona);
        const s = signers[role];
        return {
          ...e,
          payload: {
            keyId: s.keyId,
            persona: APPROVERS[role],
            kind: s.kind,
            publicKeyHex: s.pair.publicKeyHex,
          },
        };
      }
      if (e.kind === "approval.signed") {
        const pl = e.payload as LedgerPayload<"approval.signed">;
        return { ...e, payload: { ...pl, keyId: signers[pl.role].keyId } };
      }
      return e;
    }),
  );
  const trust: ProofTrust = {
    ...PROOF_TRUST,
    officers: (["treasurer", "chair"] as const).map((role) => ({
      keyId: signers[role].keyId,
      approverId: APPROVERS[role],
      role,
      publicKeyHex: signers[role].pair.publicKeyHex,
      kind: signers[role].kind,
      revokedAt: null,
    })),
  };
  return { proof: withCheckpoint({ ...p, approvals, ledger }), trust };
}

const seededPair = (keyId: string) =>
  ed25519FromSeed(sha256Hex(`fair-split seeded demo key ${keyId} (public, synthetic)`));
type OfficerRow = ProofTrust["officers"][number];
type LedgerRow = ProofTrust["ledger"][number];

describe("inv.i6.proof-trust: plate 5 verifies against the published officer keys, never the bundle's", () => {
  it("keys re-registered in a re-chained ledger and re-signed are refused: only the published keys are trusted", () => {
    const p = honestProof();
    const attacker = rekey(p, {
      treasurer: { keyId: KEY_IDS.treasurer, pair: ATTACKER.treasurer, kind: "app" },
      chair: { keyId: KEY_IDS.chair, pair: ATTACKER.chair, kind: "app" },
    });
    // Everything the bundle can show is consistent: chain, checkpoint, ledger registrations.
    const v = verify(attacker.proof);
    expect(v.chain.ok).toBe(true);
    expect(v.checkpoint.ok).toBe(true);
    expect(v.plates.twoKeys).toEqual({
      ok: false,
      reason: "A signature's key differs from the published key.",
    });
    expect(v).toMatchObject({ ok: false, status: "failed" });
    // The only difference is the trust passed in from outside: had the verifier taken the
    // attacker's keys as published, the same bundle would pass.
    expect(verify(attacker.proof, attacker.trust).plates.twoKeys.ok).toBe(true);
  });

  it("a key missing from the published list, published for another role or approver, or revoked before it signed is refused", () => {
    const p = honestProof();
    const [treasurer, chair] = PROOF_TRUST.officers as [OfficerRow, OfficerRow];
    const withChair = (c: Partial<OfficerRow> | null): ProofTrust => ({
      ...PROOF_TRUST,
      officers: c === null ? [treasurer] : [treasurer, { ...chair, ...c }],
    });
    expect(verify(p, withChair(null)).plates.twoKeys.reason).toBe(
      "A signing key is not among the published officer keys.",
    );
    expect(verify(p, { ...PROOF_TRUST, officers: [treasurer, chair, chair] }).plates.twoKeys.reason).toBe(
      "A signing key is not among the published officer keys.",
    );
    expect(verify(p, withChair({ role: "treasurer" })).plates.twoKeys.reason).toBe(
      "A signing key is not published for its signer and role.",
    );
    expect(verify(p, withChair({ approverId: "board:someone" })).plates.twoKeys.reason).toBe(
      "A signing key is not published for its signer and role.",
    );
    expect(verify(p, withChair({ revokedAt: T("02:00:00") })).plates.twoKeys.reason).toBe(
      "A signing key was revoked before it signed.",
    );
    expect(verify(p, withChair({ revokedAt: T("03:00:00") })).plates.twoKeys.ok).toBe(true);
    expect(verify(p, { officers: [], ledger: PROOF_TRUST.ledger }).ok).toBe(false);
  });

  it("the treasurer and the Chair need distinct published keys, not just distinct key IDs", () => {
    const same = rekey(honestProof(), {
      treasurer: { keyId: KEY_IDS.treasurer, pair: PROOF_KEYS.treasurer, kind: "app" },
      chair: { keyId: KEY_IDS.chair, pair: PROOF_KEYS.treasurer, kind: "app" },
    });
    expect(verify(same.proof, same.trust).plates.twoKeys).toEqual({
      ok: false,
      reason: "Each signature must come from a different person with a different key.",
    });
  });
});

describe("inv.i5.checkpoint: the ledger head is anchored by a signature from a pinned ledger key", () => {
  const rechain = (p: ProofBundle) =>
    buildLedger(p.ledger.map((e) => (e.seq === 2 ? { ...e, at: "2026-10-01T00:00:01.000Z" } : e)));

  it("an edited bundle, re-chained so every hash recomputes, no longer matches its signed checkpoint", () => {
    const p = honestProof();
    const v = verify({ ...p, ledger: rechain(p) });
    expect(v.chain).toEqual({ ok: true, entries: p.ledger.length, brokenAtSeq: null });
    expect(v.plates).toEqual(ALL_OK);
    expect(v.checkpoint).toMatchObject({
      ok: false,
      reason: "The signed checkpoint does not match the ledger's head.",
    });
    expect(v).toMatchObject({ ok: false, status: "failed" });
  });

  it("a checkpoint re-signed by anyone but a pinned ledger key is refused", () => {
    const p = honestProof();
    const rechained = { ...p, ledger: rechain(p) };
    const forger = ed25519FromSeed(sha256Hex("attacker ledger key"));
    // The server's key ID, the attacker's private key.
    const posing = withCheckpoint(rechained, { keyId: LEDGER_KEY.keyId, privateKey: forger.privateKey });
    expect(verify(posing).checkpoint.reason).toBe("The ledger checkpoint's signature does not verify.");
    const unpinned = withCheckpoint(rechained, { keyId: "fs-ledger-k9", privateKey: forger.privateKey });
    expect(verify(unpinned).checkpoint.reason).toBe(
      "The ledger checkpoint is not signed by a pinned ledger key.",
    );
    expect(verify(posing).ok || verify(unpinned).ok).toBe(false);
  });

  it("verification fails without a checkpoint, without a pinned key, or with a revoked one", () => {
    const p = honestProof();
    const { checkpoint: _dropped, ...bare } = p;
    expect(verify(bare as ProofBundle).checkpoint).toMatchObject({
      ok: false,
      reason: "There is no signed ledger checkpoint.",
    });
    expect(verify(bare as ProofBundle)).toMatchObject({ ok: false, status: "failed" });
    expect(verify(p, { ...PROOF_TRUST, ledger: [] }).checkpoint.reason).toBe(
      "The ledger checkpoint is not signed by a pinned ledger key.",
    );
    const revoked = {
      ...PROOF_TRUST,
      ledger: [{ ...(PROOF_TRUST.ledger[0] as LedgerRow), revokedAt: T("02:00:00") }],
    };
    expect(verify(p, revoked).checkpoint.reason).toBe("The ledger key has been revoked.");
    expect(verify(p, { junk: true } as unknown as ProofTrust)).toMatchObject({ ok: false, status: "failed" });
    // The published document itself (/.well-known/fairsplit-keys.json, with its version) is accepted.
    expect(verify(p, { v: 1, ...PROOF_TRUST })).toMatchObject({ ok: true, status: "verified" });
    expect(verify(p, { v: 2, ...PROOF_TRUST } as unknown as ProofTrust).status).toBe("failed");
  });

  it("the checkpoint binds this run and the whole ledger: no other run, no truncation, nothing appended", () => {
    const p = honestProof();
    expect(verify(withCheckpoint(p, LEDGER_KEY, "run-2")).checkpoint.reason).toBe(
      "The checkpoint is for another run.",
    );
    expect(verify({ ...p, ledger: p.ledger.slice(0, -1) }).checkpoint.reason).toBe(
      "The signed checkpoint does not match the ledger's head.",
    );
    const extra = fact(
      "payout.cancel",
      { senderItemId: "r1-M-001", payoutItemId: "ITEM-1", afterCancel: "cash" },
      T("03:00:00"),
    );
    const appended = { ...p, ledger: [...p.ledger, appendLedger(p.ledger, extra)] };
    expect(verify(appended).checkpoint.reason).toBe(
      "The signed checkpoint does not match the ledger's head.",
    );
    expect(verify({ ...p, checkpoint: { ...p.checkpoint, seq: p.checkpoint.seq - 1 } }).checkpoint.ok).toBe(
      false,
    );
    expect(signCheckpoint(p.ledger, p.runId, LEDGER_KEY, T("02:14:00"))).toEqual(p.checkpoint);
  });

  it("a checkpoint signed by a revoked ledger key fails, even when it is dated before the revocation", () => {
    const p = honestProof();
    const head = p.ledger.at(-1) as ProofBundle["ledger"][number];
    const revokedLater: ProofTrust = {
      ...PROOF_TRUST,
      ledger: [{ ...(PROOF_TRUST.ledger[0] as LedgerRow), revokedAt: T("02:30:00") }],
    };
    // Signed at 02:14, revoked at 02:30: the checkpoint's own date is not trusted to say "before".
    expect(verify(p, revokedLater).checkpoint).toMatchObject({
      ok: false,
      reason: "The ledger key has been revoked.",
    });
    expect(verify(p, revokedLater)).toMatchObject({ ok: false, status: "failed" });
    // Backdated as far as it can go (to the head entry's own time), it is still refused.
    const backdated = withCheckpoint(p, LEDGER_KEY, p.runId, head.at);
    expect(verify(backdated, revokedLater).checkpoint.reason).toBe("The ledger key has been revoked.");
    // A revocation dated far in the future still makes the key untrusted now.
    const revokedFuture: ProofTrust = {
      ...PROOF_TRUST,
      ledger: [{ ...(PROOF_TRUST.ledger[0] as LedgerRow), revokedAt: "2099-01-01T00:00:00.000Z" }],
    };
    expect(verify(p, revokedFuture).ok).toBe(false);
    // The PayPal anchors are still returned for the outside cross-check.
    expect(verify(p, revokedLater).anchors.senderBatchId).toBe(p.batch.senderBatchId);
  });

  it("a checkpoint dated before the ledger's head entry is refused", () => {
    const p = honestProof();
    const head = p.ledger.at(-1) as ProofBundle["ledger"][number];
    const older = withCheckpoint(p, LEDGER_KEY, p.runId, new Date(Date.parse(head.at) - 1).toISOString());
    expect(verify(older).checkpoint).toMatchObject({
      ok: false,
      reason: "The checkpoint is older than the ledger's head.",
    });
    expect(verify(older)).toMatchObject({ ok: false, status: "failed" });
    const farBack = withCheckpoint(p, LEDGER_KEY, p.runId, "2026-01-01T00:00:00.000Z");
    expect(verify(farBack).checkpoint.reason).toBe("The checkpoint is older than the ledger's head.");
    // Signed at the head's own time is the earliest valid checkpoint.
    expect(verify(withCheckpoint(p, LEDGER_KEY, p.runId, head.at))).toMatchObject({
      ok: true,
      status: "verified",
    });
  });

  it("a validly signed checkpoint of another head (an earlier seq, or another hash at this seq) is refused", () => {
    const p = honestProof();
    const earlier = withCheckpoint({ ...p, ledger: p.ledger.slice(0, -1) }).checkpoint;
    expect(verify({ ...p, checkpoint: earlier }).checkpoint.reason).toBe(
      "The signed checkpoint does not match the ledger's head.",
    );
    const otherHash = withCheckpoint({ ...p, ledger: rechain(p) }).checkpoint;
    expect(otherHash.seq).toBe(p.checkpoint.seq);
    expect(otherHash.entryHash).not.toBe(p.checkpoint.entryHash);
    expect(verify({ ...p, checkpoint: otherHash }).checkpoint.reason).toBe(
      "The signed checkpoint does not match the ledger's head.",
    );
  });

  it("exposes PayPal's own anchors so anyone can match them against PayPal's records", () => {
    const p = honestProof();
    expect(verify(p).anchors).toEqual({
      invoiceNumber: "FS-2026A-r1",
      invoiceReference: `rc:${p.rateCard.sha256.slice(0, 16)}`,
      senderBatchId: p.batch.senderBatchId,
      batchNote: `Fair Split 2026-A, batch ${p.batch.batchSha256.slice(0, 8)}`,
      batchNoteDigest: p.batch.batchSha256.slice(0, 8),
    });
    expect(verify({ ...p, invoice: null } as unknown as ProofBundle).anchors.invoiceReference).toBeNull();
  });
});

describe("inv.i8.sample-keys: seeded and demo keys never read as Verified", () => {
  const SAMPLE: Record<"seeded" | "web_demo", Record<ApprovalRole, Signer>> = {
    seeded: {
      treasurer: { keyId: "fs-analyn-s1", pair: seededPair("fs-analyn-s1"), kind: "seeded" },
      chair: { keyId: "fs-ernesto-s1", pair: seededPair("fs-ernesto-s1"), kind: "seeded" },
    },
    web_demo: {
      treasurer: {
        keyId: "fs-analyn-w7",
        pair: ed25519FromSeed(sha256Hex("demo treasurer")),
        kind: "web_demo",
      },
      chair: { keyId: "fs-ernesto-w7", pair: ed25519FromSeed(sha256Hex("demo chair")), kind: "web_demo" },
    },
  };

  for (const kind of ["seeded", "web_demo"] as const) {
    it(`${kind} keys fail outside demo mode and read "sample" inside it`, () => {
      const { proof, trust } = rekey(honestProof(), SAMPLE[kind]);
      const strict = verify(proof, trust);
      expect(strict).toMatchObject({ ok: false, status: "failed" });
      expect(strict.plates.twoKeys).toEqual({
        ok: false,
        reason: "A signature uses a sample key, so this Proof can only read as a Sample.",
      });
      const demo = verify(proof, trust, { demoMode: true });
      expect(demo.plates).toEqual(ALL_OK);
      expect(demo).toMatchObject({ ok: false, status: "sample" });
      expect(demo.sampleKeys).toEqual([SAMPLE[kind].treasurer.keyId, SAMPLE[kind].chair.keyId].sort());
    });
  }

  it("a seeded key ID or a ledger registration as seeded makes it a sample, whatever the published kind", () => {
    const asApp = rekey(honestProof(), {
      treasurer: { ...SAMPLE.seeded.treasurer, kind: "app" },
      chair: { ...SAMPLE.seeded.chair, kind: "app" },
    });
    expect(verify(asApp.proof, asApp.trust).status).toBe("failed");
    expect(verify(asApp.proof, asApp.trust, { demoMode: true }).status).toBe("sample");
    const p = honestProof();
    const ledger = buildLedger(
      p.ledger.map((e) =>
        e.kind === "key.registered" ? { ...e, payload: { ...(e.payload as object), kind: "seeded" } } : e,
      ),
    );
    const registeredSeeded = withCheckpoint({ ...p, ledger });
    expect(verify(registeredSeeded).status).toBe("failed");
    expect(verify(registeredSeeded, PROOF_TRUST, { demoMode: true }).status).toBe("sample");
  });

  it("the treasurer's real browser key fs-analyn-w1 verifies; the same w ID published as web_demo is a sample", () => {
    const w1 = { keyId: "fs-analyn-w1", pair: ed25519FromSeed(sha256Hex("treasurer browser key")) };
    const chair = { keyId: KEY_IDS.chair, pair: PROOF_KEYS.chair, kind: "app" as const };
    const real = rekey(honestProof(), { treasurer: { ...w1, kind: "app" }, chair });
    expect(verify(real.proof, real.trust)).toMatchObject({ ok: true, status: "verified", sampleKeys: [] });
    // The trust registry's kind decides: published as web_demo, the same key is a sample even
    // though the bundle's own ledger registers it as app.
    const demoTrust: ProofTrust = {
      ...real.trust,
      officers: real.trust.officers.map((k) => (k.keyId === w1.keyId ? { ...k, kind: "web_demo" } : k)),
    };
    expect(verify(real.proof, demoTrust).status).toBe("failed");
    expect(verify(real.proof, demoTrust, { demoMode: true })).toMatchObject({
      status: "sample",
      sampleKeys: ["fs-analyn-w1"],
    });
  });

  it("a labelled demo ID (fs-{persona}-demo-{6}) never verifies, whatever kind it is published as", () => {
    const demo = {
      keyId: "fs-analyn-demo-a1b2c3",
      pair: ed25519FromSeed(sha256Hex("judge demo key")),
      kind: "app" as const,
    };
    const chair = { keyId: KEY_IDS.chair, pair: PROOF_KEYS.chair, kind: "app" as const };
    const { proof, trust } = rekey(honestProof(), { treasurer: demo, chair });
    expect(verify(proof, trust).ok).toBe(false);
    expect(verify(proof, trust).status).not.toBe("verified");
    expect(verify(proof, trust, { demoMode: true }).status).not.toBe("verified");
  });

  it("a seeded ledger key ID pinned with kind server still makes the checkpoint a sample", () => {
    const seededLedger = { keyId: "fs-ledger-s2", ...seededPair("fs-ledger-s2") };
    const proof = withCheckpoint(honestProof(), seededLedger);
    const trust: ProofTrust = {
      ...PROOF_TRUST,
      ledger: [
        {
          keyId: seededLedger.keyId,
          publicKeyHex: seededLedger.publicKeyHex,
          kind: "server",
          revokedAt: null,
        },
      ],
    };
    expect(verify(proof, trust).status).toBe("failed");
    expect(verify(proof, trust, { demoMode: true })).toMatchObject({
      status: "sample",
      sampleKeys: ["fs-ledger-s2"],
    });
  });

  it("a checkpoint signed by a seeded ledger key is a sample too", () => {
    const seededLedger = { keyId: "fs-ledger-s1", ...seededPair("fs-ledger-s1") };
    const proof = withCheckpoint(honestProof(), seededLedger);
    const trust: ProofTrust = {
      ...PROOF_TRUST,
      ledger: [
        {
          keyId: seededLedger.keyId,
          publicKeyHex: seededLedger.publicKeyHex,
          kind: "seeded",
          revokedAt: null,
        },
      ],
    };
    expect(verify(proof, trust).checkpoint).toMatchObject({
      ok: false,
      reason: "The ledger checkpoint is signed with a sample key, so this Proof can only read as a Sample.",
    });
    expect(verify(proof, trust)).toMatchObject({ ok: false, status: "failed" });
    expect(verify(proof, trust, { demoMode: true })).toMatchObject({
      ok: false,
      status: "sample",
      sampleKeys: ["fs-ledger-s1"],
    });
  });

  it("demo mode never upgrades anything: an honest proof is verified with or without it, a broken one fails", () => {
    expect(verify(honestProof(), PROOF_TRUST, { demoMode: true }).status).toBe("verified");
    const p = honestProof();
    expect(verify({ ...p, approvals: resign(p) }, PROOF_TRUST, { demoMode: true }).status).toBe("failed");
  });

  it('the UI words: "sample" renders as Sample and never as Verified, in every language', () => {
    expect(PROOF_STATUS_LABELS.sample.en).toBe("Sample");
    expect(PROOF_STATUS_LABELS.verified.en).toBe("Verified");
    for (const lang of ["en", "ceb", "fil"] as const) {
      expect(PROOF_STATUS_LABELS.sample[lang]).not.toBe(PROOF_STATUS_LABELS.verified[lang]);
      expect(PROOF_STATUS_LABELS.sample[lang].toLowerCase()).not.toMatch(/verif|napamatud|napatunay/);
    }
  });
});
