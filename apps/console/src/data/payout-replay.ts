import type { ReplayReason } from "@fairsplit/api-client";
import type { ProofBundle } from "@fairsplit/contracts";
import type { RunView } from "./run-view.js";

/** Payout provenance wins over the invoice/envelope rail, including on public Proof. */
export function payoutReplayed(
  view: RunView | undefined,
  reason: ReplayReason | null = null,
  bundle?: ProofBundle | null,
): boolean {
  return (
    reason !== null ||
    Boolean(view?.events?.some((event) => event.type === "item.updated" && event.provenance === "replay")) ||
    Boolean(bundle?.batch.items.some((item) => item.provenance === "replay")) ||
    Boolean(bundle?.ledger.some((entry) => entry.kind === "payout.item.replayed"))
  );
}

export const PAYOUT_REPLAY_NOTE = "Replayed (labelled): earlier simulated PayPal sandbox run";
export const payoutReplaySummary = (successful: number, total: number): string =>
  `${total} payout statuses replayed (labelled) from an earlier simulated PayPal sandbox run; ${successful} successful in that source run.`;
