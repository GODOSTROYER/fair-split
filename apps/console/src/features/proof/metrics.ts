// Proof's metrics (S1.8, in order): lines explained, premium allocated, paid in three tiers, holds caught and what
// they kept for members, PayPal against cash, and invoice to last confirmation. Every figure is computed in this
// page from the bundle it was served (the same record "Verify in your browser" re-checks), the run's line states
// and the season's seeded hold figures, so nothing here is typed and nothing waits on a metrics route.

import type { HoldKind, ProofBundle, SeasonSnapshot } from "@fairsplit/contracts";
import {
  explainedLines,
  holdsCaught,
  invoiceToLastConfirmationMs,
  type LedgerFacts,
  type LineStates,
  type PaidTiers,
  type PremiumAllocation,
  type ProofItemView,
  paidTiers,
  premiumAllocation,
  type RailSplit,
  railSplit,
} from "./model.js";

export interface HoldFigures {
  readonly caught: number;
  readonly keptCents: number;
  /** What counting the duplicate once gave back to the other members. */
  readonly duplicateCents: number;
  /** Fines no rule allows, returned as credits. */
  readonly creditCents: number;
}

export interface ProofFigures {
  readonly lines: { readonly total: number; readonly explained: number };
  readonly premium: PremiumAllocation;
  readonly tiers: PaidTiers;
  /** Null when nothing the page holds reports the run's holds. */
  readonly holds: HoldFigures | null;
  readonly rails: RailSplit;
  readonly timingMs: number | null;
}

export interface DeriveInput {
  readonly bundle: ProofBundle;
  readonly items: readonly ProofItemView[];
  readonly lineStates: LineStates;
  readonly facts: Pick<LedgerFacts, "fundedAt" | "lastItemEventAt">;
  /** The run's holds when the console knows them (the showcase, or a judge session's own run). */
  readonly holds: readonly { readonly kind: HoldKind }[] | null;
  /** The season's seeded figures, when this is the season's run. */
  readonly seeded: Pick<
    SeasonSnapshot["figures"],
    "redirectedCents" | "redirectedDuplicateCents" | "redirectedCreditCents"
  > | null;
}

export function deriveFigures(input: DeriveInput): ProofFigures {
  const tiers = paidTiers(input.bundle.lines, input.items, input.lineStates);
  const holds: HoldFigures | null =
    input.holds && input.seeded
      ? {
          caught: holdsCaught(input.holds),
          keptCents: input.seeded.redirectedCents,
          duplicateCents: input.seeded.redirectedDuplicateCents,
          creditCents: input.seeded.redirectedCreditCents,
        }
      : null;
  return {
    lines: { total: input.bundle.lines.length, explained: explainedLines(input.bundle.lines) },
    premium: premiumAllocation(input.bundle),
    tiers,
    holds,
    rails: railSplit(tiers),
    timingMs: invoiceToLastConfirmationMs(input.facts),
  };
}

/** PayPal's reported payout fees for the season's run (seeded until reconciliation reports them). */
export interface FeeFigures {
  readonly cents: number;
  readonly payments: number;
}

export function seededFees(
  snapshot: Pick<SeasonSnapshot, "figures" | "run"> | undefined,
  runSlug: string,
): FeeFigures | null {
  if (!snapshot || snapshot.run.runSlug !== runSlug) return null;
  return { cents: snapshot.figures.feesSandboxCents, payments: snapshot.figures.batchItemCount };
}
