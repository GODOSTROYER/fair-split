// A workspace's attribution ledger as the Proof publishes it (S3.12): the whole hash chain from seq 1 (the
// verifier re-links it from the genesis hash), checked here with the same code the browser runs, and anchored by
// a checkpoint this server signs over the head. The server never signs a checkpoint over a chain that does not
// verify: a broken chain is withheld, never laundered.
import {
  type Json,
  type LedgerCheckpoint,
  type LedgerEntry,
  LedgerEntry as LedgerEntrySchema,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { signCheckpoint, verifyLedger } from "@fairsplit/domain";
import { asc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { problem } from "../lib/problem.js";
import type { LedgerSigningKey } from "./keys.js";

/** Refuse to publish (and so to sign) more than this many entries in one bundle. */
export const MAX_PROOF_LEDGER_ENTRIES = 20_000;

type Row = typeof schema.ledgerEntries.$inferSelect;

export function toContractEntry(row: Row): LedgerEntry {
  return {
    seq: Number(row.seq),
    kind: row.kind,
    actorKind: row.actorKind,
    actorId: row.actorId,
    impersonatedBy: row.impersonatedBy ?? null,
    payload: row.payload as Json,
    at: row.at.toISOString(),
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  };
}

/** Every entry of the workspace's chain, in seq order, in the contract's shape. */
export async function readWorkspaceLedger(
  db: DbOrTx,
  workspaceId: string,
  log?: Pick<Logger, "warn">,
): Promise<LedgerEntry[]> {
  const [head] = await db
    .select({ seq: schema.ledgerHeads.seq })
    .from(schema.ledgerHeads)
    .where(eq(schema.ledgerHeads.workspaceId, workspaceId))
    .limit(1);
  if ((head?.seq ?? 0) > MAX_PROOF_LEDGER_ENTRIES) {
    log?.warn({ workspaceId, seq: head?.seq }, "Proof ledger exceeds publication limit");
    throw problem.rateLimited(60_000, "This workspace's ledger is too long to publish in one Proof bundle.");
  }
  const rows = await db
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.workspaceId, workspaceId))
    .orderBy(asc(schema.ledgerEntries.seq))
    .limit(MAX_PROOF_LEDGER_ENTRIES + 1);
  if (rows.length > MAX_PROOF_LEDGER_ENTRIES) {
    log?.warn({ workspaceId }, "Proof ledger exceeds publication limit");
    throw problem.rateLimited(60_000, "This workspace's ledger is too long to publish in one Proof bundle.");
  }
  return rows.map(toContractEntry);
}

export interface LedgerCheck {
  ok: boolean;
  entries: number;
  brokenAtSeq: number | null;
  head: { seq: number; entryHash: string; at: string } | null;
}

/** Re-links and re-hashes the chain exactly as the browser verifier does. */
export function checkLedger(entries: readonly LedgerEntry[]): LedgerCheck {
  const v = verifyLedger(entries);
  const head = entries.at(-1);
  return {
    ok: v.ok,
    entries: entries.length,
    brokenAtSeq: v.brokenAtSeq,
    head: head ? { seq: head.seq, entryHash: head.entryHash, at: head.at } : null,
  };
}

/**
 * Signs the head of `ledger` for one run's Proof. The checkpoint's `at` is the serving instant, but never earlier
 * than the head's own `at` (seeded chains are dated on the film's timeline, which can be ahead of the clock), so
 * "the checkpoint is no older than the head" holds by construction.
 */
export function signProofCheckpoint(
  ledger: readonly LedgerEntry[],
  runId: string,
  key: LedgerSigningKey,
  now: Date,
): LedgerCheckpoint {
  const check = checkLedger(ledger);
  if (!check.ok || !check.head) {
    throw problem.internal(
      check.head
        ? `The ledger does not verify at entry ${check.brokenAtSeq}; Proof withheld.`
        : "The ledger is empty; there is nothing to prove yet.",
    );
  }
  const headMs = Date.parse(check.head.at);
  const at = new Date(Math.max(now.getTime(), headMs)).toISOString();
  return signCheckpoint(ledger, runId, { keyId: key.keyId, privateKey: key.privateKey }, at);
}

/** Parses an entry list from untrusted JSON (verify-proof tooling and tests). */
export function parseLedger(value: unknown): LedgerEntry[] {
  return LedgerEntrySchema.array().parse(value);
}
