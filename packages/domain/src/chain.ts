// Attribution ledger hash chain (architecture §12, S3.12) with node:crypto, and IC-02
// `verifyChain(proof)`. The browser uses `verifyChainWith` from `@fairsplit/domain/verify`.
import {
  type ChainVerification,
  GENESIS_PREV_HASH,
  type LedgerEntry,
  type ProofBundle,
} from "@fairsplit/contracts";
import { sha256Hex } from "./canon.js";
import { ed25519Verify } from "./sig.js";
import {
  type LedgerFact,
  ledgerPreimage,
  type ProofCrypto,
  verifyChainWith,
  verifyLedgerWith,
} from "./verify-core.js";

export type { LedgerFact, ProofCrypto } from "./verify-core.js";

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

/** IC-02 `verifyChain(proof)`: the chain, then the six Proof plates. */
export function verifyChain(proof: ProofBundle): ChainVerification {
  return verifyChainWith(proof, nodeProofCrypto);
}
