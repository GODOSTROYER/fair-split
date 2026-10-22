// The Proof verifier with injectable crypto (exported as `@fairsplit/domain/verify`). Pure: no
// node built-ins, so the Proof page can run it in the browser with its own sha256 and Ed25519.
// entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))
// with a genesis prev_hash of 64 zeros; then the six Proof plates (S3.12).
import {
  type ChainVerification,
  GENESIS_PREV_HASH,
  type Json,
  type LedgerEntry,
  type PlateResult,
  type ProofBundle,
} from "@fairsplit/contracts";
import { approvalBytes, batchCanonical, invoiceReference } from "./digest-input.js";
import { jcs } from "./jcs.js";

/** Synchronous hashing and signature primitives (node:crypto on the server, noble in a browser). */
export interface ProofCrypto {
  sha256Hex(data: string): string;
  verifyEd25519(publicKeyHex: string, message: Uint8Array, signatureHex: string): boolean;
}

export interface LedgerFact {
  kind: string;
  actorKind: LedgerEntry["actorKind"];
  actorId: string;
  impersonatedBy: string | null;
  payload: Json;
  at: string;
}

/** The string hashed for one ledger entry: prev_hash ‖ JCS(fields). */
export function ledgerPreimage(prevHash: string, seq: number, fact: LedgerFact): string {
  return (
    prevHash +
    jcs({
      seq,
      kind: fact.kind,
      actorKind: fact.actorKind,
      actorId: fact.actorId,
      impersonatedBy: fact.impersonatedBy,
      payload: fact.payload,
      at: fact.at,
    })
  );
}

export function verifyLedgerWith(
  entries: readonly LedgerEntry[],
  c: Pick<ProofCrypto, "sha256Hex">,
): { ok: boolean; brokenAtSeq: number | null } {
  let prevHash = GENESIS_PREV_HASH;
  let expectedSeq = 1;
  for (const e of entries) {
    const recomputed = c.sha256Hex(ledgerPreimage(e.prevHash, e.seq, e));
    if (e.seq !== expectedSeq || e.prevHash !== prevHash || recomputed !== e.entryHash) {
      return { ok: false, brokenAtSeq: e.seq };
    }
    prevHash = e.entryHash;
    expectedSeq += 1;
  }
  return { ok: true, brokenAtSeq: null };
}

function plate(ok: boolean, reason: string): PlateResult {
  return ok ? { ok: true, reason: null } : { ok: false, reason };
}

function containsString(v: Json, needle: string): boolean {
  if (typeof v === "string") return v === needle;
  if (Array.isArray(v)) return v.some((x) => containsString(x, needle));
  if (v !== null && typeof v === "object") return Object.values(v).some((x) => containsString(x, needle));
  return false;
}

function num(v: Json | undefined): number {
  return typeof v === "number" ? v : Number.NaN;
}

/** Verifies the ledger chain, then the six Proof plates. */
export function verifyChainWith(proof: ProofBundle, c: ProofCrypto): ChainVerification {
  const chain = verifyLedgerWith(proof.ledger, c);

  // 1 Paid: PAID or MARKED_AS_PAID, 0.00 due, and reference = rc:{sha16}
  const paid = plate(
    (proof.invoice.status === "PAID" || proof.invoice.status === "MARKED_AS_PAID") &&
      proof.invoice.dueCents === 0 &&
      proof.invoice.reference === invoiceReference(proof.rateCard.sha256),
    "The invoice is not paid in full, or its reference does not carry the card hash.",
  );

  // 2 Ratified: the card re-hashes to the published value and was ratified before the first slip
  const ratified = plate(
    c.sha256Hex(jcs(proof.rateCard.canonical)) === proof.rateCard.sha256 &&
      proof.rateCard.ratifiedAt.slice(0, 10) <= proof.firstSlipDate,
    "The rate card does not re-hash to the published value, or a slip predates it.",
  );

  // 3 Read: every slip document hash is in the chain
  const missing = proof.documents.filter(
    (d) => !proof.ledger.some((e) => containsString(e.payload, d.sha256)),
  );
  const read = plate(
    proof.documents.length > 0 && missing.length === 0,
    "A slip photo hash is not in the chain.",
  );

  // 4 Computed: line hashes recompute and the lines are conserved against the pools
  let linesOk = proof.lines.length > 0;
  let premium = 0;
  let bonus = 0;
  for (const l of proof.lines) {
    const canon = (l.canonical ?? {}) as Record<string, Json>;
    if (
      c.sha256Hex(jcs(l.canonical)) !== l.lineSha256 ||
      num(canon.premiumCents) !== l.premiumCents ||
      num(canon.bonusCents) !== l.bonusCents ||
      num(canon.netCents) !== l.netCents ||
      l.premiumCents + l.bonusCents - l.deductionsCents + l.creditsCents !== l.netCents
    ) {
      linesOk = false;
    }
    premium += l.premiumCents;
    bonus += l.bonusCents;
  }
  const computed = plate(
    linesOk && premium === proof.pools.premiumPoolCents && bonus === proof.pools.bonusPoolCents,
    "A line hash does not recompute, or the lines do not sum to the pools.",
  );

  // 5 Two keys: both signatures verify over the same batchSha256
  const roles = new Set(proof.approvals.map((a) => a.role));
  const sigsOk = proof.approvals.every(
    (a) =>
      a.role === a.payload.role &&
      a.payload.runId === proof.runId &&
      a.payload.batchSha256 === proof.batch.batchSha256 &&
      a.payload.rateCardSha256 === proof.rateCard.sha256 &&
      c.verifyEd25519(a.publicKeyHex, approvalBytes(a.payload), a.signatureHex),
  );
  const twoKeys = plate(
    roles.has("treasurer") && roles.has("chair") && sigsOk,
    "The two signatures do not both verify over the same batch hash.",
  );

  // 6 Payout items: the items recompute to that hash, and every status rests on a verified event
  let itemsHashOk = false;
  try {
    const canon = batchCanonical(
      {
        runId: proof.batch.runId,
        senderBatchId: proof.batch.senderBatchId,
        rateCardSha256: proof.batch.rateCardSha256,
      },
      proof.batch.items.map((i) => ({
        senderItemId: i.senderItemId,
        receiver: i.receiver,
        amountCents: i.amountCents,
        currency: i.currency,
      })),
    );
    itemsHashOk = c.sha256Hex(canon.jcs) === proof.batch.batchSha256;
  } catch {
    itemsHashOk = false;
  }
  const eventsOk = proof.batch.items.every(
    (i) => i.status === "SUBMITTED" || i.status === "PENDING" || (i.eventId !== null && i.eventId.length > 0),
  );
  const payoutItems = plate(
    itemsHashOk &&
      eventsOk &&
      proof.batch.rateCardSha256 === proof.rateCard.sha256 &&
      proof.batch.runId === proof.runId,
    "The batch hash doesn't match the signed batch. Proof withheld.",
  );

  const plates = { paid, ratified, read, computed, twoKeys, payoutItems };
  return {
    ok: chain.ok && Object.values(plates).every((p) => p.ok),
    chain: { ok: chain.ok, entries: proof.ledger.length, brokenAtSeq: chain.brokenAtSeq },
    plates,
  };
}
