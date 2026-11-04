import {
  MEMBER_LINE_LABELS,
  type MemberLineState,
  type PayoutItemStatus,
  type Provenance,
} from "@fairsplit/contracts";

/** A run's provenance is deliberately absent: only this line's payout evidence can replay its status. */
export interface PayoutStatusEvidence {
  state: MemberLineState;
  itemStatus?: PayoutItemStatus | null;
  itemProvenance?: Provenance | null;
}

/**
 * The replay word in the reader's language. Cebuano and Filipino are machine-translated, pending native review: the
 * statement and print DTOs carry the review chip for every ceb and fil reading. The console reads English.
 */
export const REPLAY_STATUS_WORDS: Readonly<Record<"en" | "ceb" | "fil" | "console", string>> = {
  en: "Replayed (labelled): earlier simulated PayPal sandbox run",
  ceb: "Gi-replay (gilabelan): miaging simulated PayPal sandbox run",
  fil: "Ni-replay (may label): naunang simulated PayPal sandbox run",
  console: "Replayed (labelled): earlier simulated PayPal sandbox run",
};

const NON_PAYPAL = new Set<MemberLineState>([
  "COMPUTED",
  "READY",
  "HELD",
  "EXCLUDED",
  "OFF_RAIL_DUE",
  "OFF_RAIL_PAID",
  "REROUTED",
]);

export function payoutStatusPresentation(
  evidence: PayoutStatusEvidence,
  lang: "en" | "ceb" | "fil" | "console" = "en",
) {
  const paypal = !NON_PAYPAL.has(evidence.state);
  const replayed = paypal && evidence.itemStatus != null && evidence.itemProvenance === "replay";
  const paid = paypal && evidence.state === "PAID";
  const word = MEMBER_LINE_LABELS[evidence.state][lang];
  return {
    statusWord: replayed ? REPLAY_STATUS_WORDS[lang] : paypal ? `${word} (simulated PayPal sandbox)` : word,
    tone: replayed ? ("neutral" as const) : paid ? ("jade" as const) : ("neutral" as const),
    amountState: replayed ? ("unsettled" as const) : paid ? ("landed" as const) : ("unsettled" as const),
    replayed,
    simulatedLabel: paypal ? "Simulated PayPal sandbox" : null,
  };
}
