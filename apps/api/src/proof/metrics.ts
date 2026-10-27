// The Proof page's metrics (S1.8 "Metrics, in this order", plan "Proof and secrets"): aggregates only, never a
// name or a receiver, every figure computed by code from the server's records (I1) with the display string the
// UI prints (UI may not import `domain`, C-22).
//
//   1 Lines explained         lines whose canonical content re-hashes to the stored line hash
//   2 Premium allocated       Σ line premium against the quoted premium pool (R0: premium is never deducted)
//   3 Paid, three tiers       PayPal-verified (SUCCESS resting on a verified event) · cash attested (a receipt on
//                             file) · due (everything payable that is neither)
//   4 Holds caught, kept      duplicate, yield, no-rule, rate and injection holds; credits returned plus what a
//                             duplicate counted once gave back to the other members
//   5 PayPal against cash     members paid through PayPal vs in cash, and PayPal's share of the value
//   6 Timing                  first invoice record to the last verified item event, from the chain
import {
  type HoldKind,
  LedgerPayloads,
  type MemberLineState,
  PayRunState,
  Provenance,
  RunSlug,
} from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { format } from "@fairsplit/domain";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ProofFacts } from "./bundle.js";
import { ProofProgress, progressOf } from "./stream.js";

const Count = z.int().nonnegative();
const Money = z.strictObject({ cents: z.int(), display: z.string() });
const Tier = z.strictObject({ members: Count, cents: z.int(), display: z.string() });

export const ProofMetrics = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  provenance: Provenance,
  lines: z.strictObject({ total: Count, explained: Count, display: z.string() }),
  premium: z.strictObject({
    pool: Money,
    allocated: Money,
    /** Basis points of the pool allocated to members (10000 = 100%). */
    allocatedBp: Count,
    deductedFromPremiumCents: z.literal(0),
    display: z.string(),
  }),
  paid: z.strictObject({
    paypalVerified: Tier,
    cashAttested: Tier.extend({ ofMembers: Count }),
    due: Tier,
    /** Lines held or excluded: reserved, carried over, never redistributed. */
    reserved: Tier,
  }),
  holds: z.strictObject({
    caught: Count,
    byKind: z.record(z.string(), Count),
    keptForMembers: Money,
    display: z.string(),
  }),
  rails: z.strictObject({
    paypalMembers: Count,
    cashMembers: Count,
    paypalValueBp: Count,
    display: z.string(),
  }),
  timing: z.strictObject({
    invoiceToLastConfirmationMs: z.int().nonnegative().nullable(),
    display: z.string().nullable(),
  }),
  /** The starting picture the public stream (`/v1/proof/:runSlug/events`) moves forward. */
  progress: ProofProgress,
});
export type ProofMetrics = z.infer<typeof ProofMetrics>;

/** Holds that catch a problem in the paper (the by-hand field and the dial are checks, not catches). */
const CAUGHT_KINDS: readonly HoldKind[] = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
];

const RESERVED_STATES: readonly MemberLineState[] = ["HELD", "EXCLUDED", "COMPUTED"];

function bp(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 10_000) / whole);
}

export async function proofMetrics(db: DbOrTx, facts: ProofFacts): Promise<ProofMetrics> {
  const { run, lines, items } = facts;
  const ws = run.workspaceId;
  const pool = facts.premiumPoolCents;
  const allocated = lines.reduce((s, l) => s + l.premiumCents, 0);
  const explained = lines.filter((l) => l.explained).length;

  // 3 · paid in three tiers
  const verified = items.filter((i) => i.status === "SUCCESS" && i.eventId !== null);
  const verifiedLines = new Set(verified.map((i) => i.lineId));
  const lineIds = lines.map((l) => l.lineId);
  const receipts =
    lineIds.length === 0
      ? []
      : await db
          .select({ lineId: schema.cashReceipts.lineId, amountCents: schema.cashReceipts.amountCents })
          .from(schema.cashReceipts)
          .where(and(eq(schema.cashReceipts.workspaceId, ws), inArray(schema.cashReceipts.lineId, lineIds)));
  const attested = new Map(receipts.map((r) => [r.lineId, Number(r.amountCents)]));
  const cashLines = lines.filter((l) => !verifiedLines.has(l.lineId) && attested.has(l.lineId));
  const reserved = lines.filter((l) => RESERVED_STATES.includes(l.state as MemberLineState));
  const due = lines.filter(
    (l) =>
      !verifiedLines.has(l.lineId) &&
      !attested.has(l.lineId) &&
      !RESERVED_STATES.includes(l.state as MemberLineState),
  );
  const sum = (xs: readonly { netCents: number }[]) => xs.reduce((s, x) => s + x.netCents, 0);
  const verifiedCents = verified.reduce((s, i) => s + i.amountCents, 0);
  const cashCents = [...attested.entries()]
    .filter(([lineId]) => !verifiedLines.has(lineId))
    .reduce((s, [, c]) => s + c, 0);
  const cashOf = lines.filter(
    (l) => !verifiedLines.has(l.lineId) && !RESERVED_STATES.includes(l.state as MemberLineState),
  ).length;

  // 4 · holds caught and what they kept for members
  const holds = await db
    .select({
      kind: schema.holds.kind,
      state: schema.holds.state,
      engineParams: schema.holds.engineParams,
      resolution: schema.holds.resolution,
    })
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.runId, run.id)));
  const byKind: Record<string, number> = {};
  let caught = 0;
  let duplicateGain = 0;
  for (const h of holds) {
    if (!CAUGHT_KINDS.includes(h.kind as HoldKind)) continue;
    caught++;
    byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
    const resolution = asRecord(h.resolution);
    const kind = typeof resolution?.kind === "string" ? resolution.kind : resolution?.resolution;
    if (h.kind === "DUPLICATE_SLIP" && h.state === "RESOLVED" && kind === "COUNT_ONCE") {
      // what counting the slip twice would have paid its holder (the engine's `movedCents`)
      const moved = Number(asRecord(h.engineParams)?.movedCents ?? 0);
      if (Number.isSafeInteger(moved) && moved > 0) duplicateGain += moved;
    }
  }
  const credits = lines.reduce((s, l) => s + l.creditsCents, 0);
  const kept = duplicateGain + credits;

  // 5 · PayPal against cash (how members were actually paid, or are due to be)
  const netAll = sum(lines.filter((l) => !RESERVED_STATES.includes(l.state as MemberLineState)));
  const paypalMembers = verified.length;
  const cashMembers = Math.max(0, cashOf);

  // 6 · timing, from the chain: the invoice record to the last verified item event
  const timing = timingOf(facts);

  return {
    runSlug: run.runSlug,
    runState: run.state,
    provenance: facts.provenance,
    lines: { total: lines.length, explained, display: `${explained} of ${lines.length}` },
    premium: {
      pool: { cents: pool, display: format.money(pool) },
      allocated: { cents: allocated, display: format.money(allocated) },
      allocatedBp: bp(allocated, pool),
      deductedFromPremiumCents: 0,
      display: `${format.money(allocated)}, ${format.percentBp(bp(allocated, pool), 0)}, no deductions (R0)`,
    },
    paid: {
      paypalVerified: {
        members: verified.length,
        cents: verifiedCents,
        display: `${verified.length} members, ${format.money(verifiedCents)}`,
      },
      cashAttested: {
        members: cashLines.length,
        cents: cashCents,
        ofMembers: cashOf,
        display: `${cashLines.length} of ${cashOf}, ${format.money(cashCents)}`,
      },
      due: {
        members: due.length,
        cents: sum(due),
        display: `${due.length} members, ${format.money(sum(due))}`,
      },
      reserved: {
        members: reserved.length,
        cents: sum(reserved),
        display: `${reserved.length} members, ${format.money(sum(reserved))}`,
      },
    },
    holds: {
      caught,
      byKind,
      keptForMembers: { cents: kept, display: format.money(kept) },
      display: `Holds caught: ${caught}. Kept for members: ${format.money(kept)}`,
    },
    rails: {
      paypalMembers,
      cashMembers,
      paypalValueBp: bp(verifiedCents, netAll),
      display: `${paypalMembers} of ${lines.length} members on PayPal, ${format.percentBp(bp(verifiedCents, netAll), 1)} of value`,
    },
    timing,
    progress: progressOf(
      run.runSlug,
      run.state,
      items.map((i) => i.status),
    ),
  };
}

function timingOf(facts: Pick<ProofFacts, "ledger" | "run">) {
  const ledger = facts.ledger;
  let start: number | null = null;
  let end: number | null = null;
  for (const e of ledger) {
    if (e.kind === "invoice.funded") {
      const p = LedgerPayloads["invoice.funded"].safeParse(e.payload);
      if (p.success && p.data.runId === facts.run.id && start === null) start = Date.parse(e.at);
    } else if (e.kind === "webhook.applied") {
      const p = LedgerPayloads["webhook.applied"].safeParse(e.payload);
      if (
        p.success &&
        p.data.resource === "payout_item" &&
        p.data.senderItemId.startsWith(`r${facts.run.runSeq}-`)
      ) {
        end = Date.parse(e.at);
      }
    }
  }
  if (start === null || end === null || end < start)
    return { invoiceToLastConfirmationMs: null, display: null };
  const ms = end - start;
  return { invoiceToLastConfirmationMs: ms, display: format.elapsedWords(ms) };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
