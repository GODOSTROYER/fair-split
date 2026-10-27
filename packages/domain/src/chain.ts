// Attribution ledger hash chain (architecture §12, S3.12) with node:crypto, and IC-02
// `verifyChain(proof)`. The browser uses `verifyChainWith` from `@fairsplit/domain/verify`.
import type { KeyObject } from "node:crypto";
import {
  type ChainVerification,
  GENESIS_PREV_HASH,
  type LedgerCheckpoint,
  type LedgerEntry,
  type ProofBundle,
  type ProofTrust,
  type PublishedKeys,
} from "@fairsplit/contracts";
import { sha256Hex } from "./canon.js";
import { checkpointBytes } from "./digest-input.js";
import { ed25519Sign, ed25519Verify } from "./sig.js";
import {
  type LedgerFact,
  ledgerPreimage,
  type ProofCrypto,
  type VerifyOptions,
  verifyChainWith,
  verifyLedgerWith,
} from "./verify-core.js";

export type { LedgerFact, ProofCrypto, VerifyOptions } from "./verify-core.js";

export const nodeProofCrypto: ProofCrypto = {
  sha256Hex: (data: string) => sha256Hex(data),
  verifyEd25519: ed25519Verify,
};

export function entryHash(prevHash: string, seq: number, fact: LedgerFact): string {
  return sha256Hex(ledgerPreimage(prevHash, seq, fact));
}

/** Appends one entry (the single writer per workspace does this under a row lock). */
export function appendLedger(chain: readonly LedgerEntry[], fact: LedgerFact): LedgerEntry {
  const prev = chain.at(-1);
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.entryHash : GENESIS_PREV_HASH;
  return {
    seq,
    kind: fact.kind,
    actorKind: fact.actorKind,
    actorId: fact.actorId,
    impersonatedBy: fact.impersonatedBy,
    payload: fact.payload,
    at: fact.at,
    prevHash,
    entryHash: entryHash(prevHash, seq, fact),
  };
}

export function buildLedger(facts: readonly LedgerFact[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const f of facts) out.push(appendLedger(out, f));
  return out;
}

/** Checks every link: sequence from 1, prev pointer and recomputed hash. */
export function verifyLedger(entries: readonly LedgerEntry[]): { ok: boolean; brokenAtSeq: number | null } {
  return verifyLedgerWith(entries, nodeProofCrypto);
}

/**
 * Signs the ledger's head for one run's Proof with the server's ledger key (the seed signs its
 * sample bundle with a seeded ledger key). Verifiers check it against the pinned public key.
 */
export function signCheckpoint(
  ledger: readonly LedgerEntry[],
  runId: string,
  key: { keyId: string; privateKey: KeyObject },
  at: string,
): LedgerCheckpoint {
  const head = ledger.at(-1);
  if (!head) throw new RangeError("an empty ledger has no checkpoint");
  const unsigned = { v: 1 as const, runId, seq: head.seq, entryHash: head.entryHash, at, keyId: key.keyId };
  return { ...unsigned, signatureHex: ed25519Sign(key.privateKey, checkpointBytes(unsigned)) };
}

/**
 * IC-02 `verifyChain(proof, trust)`: the chain, its signed checkpoint, then the six Proof plates.
 * `trust` (the published officer keys and pinned ledger keys) always comes from outside the bundle.
 */
export function verifyChain(
  proof: ProofBundle,
  trust: ProofTrust | PublishedKeys,
  options: VerifyOptions = {},
): ChainVerification {
  return verifyChainWith(proof, nodeProofCrypto, trust, options);
}
