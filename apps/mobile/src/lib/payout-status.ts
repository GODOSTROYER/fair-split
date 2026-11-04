/** Shared payout presentation for all phone roles; never import another feature slice. */
import type { StatementDTO } from "../_shims/api-client";
import type { AmountState, Lang, MemberStatus } from "../_shims/contracts";
import { pendingReview, translate } from "../_shims/i18n";
import { type ItemTrack, STATUS_TONE } from "./item-status";

export function railLabel(rail: string | null | undefined, provenance: string, lang: Lang) {
  const kind =
    provenance === "replay"
      ? "replay"
      : rail === "simulator" ||
          rail === "simulated" ||
          provenance === "simulated_rail" ||
          provenance === "seeded"
        ? "simulated"
        : "unknown";
  return {
    kind,
    chip: translate(
      lang,
      kind === "replay"
        ? "common.payoutReplayChip"
        : kind === "simulated"
          ? "common.payoutSimulatedLabel"
          : "common.payoutUnknown",
    ),
    copy: translate(
      lang,
      kind === "replay"
        ? "common.payoutReplayCopy"
        : kind === "simulated"
          ? "common.payoutSimulatedCopy"
          : "common.payoutUnknown",
    ),
    review: pendingReview(lang),
  };
}

export function statementRail(dto: StatementDTO, lang: Lang, track?: Pick<ItemTrack, "provenance">) {
  if (dto.provenance === "replay" && !dto.item && track?.provenance !== "replay") {
    return {
      kind: "replay-planned",
      chip: translate(lang, "common.payoutPlannedChip"),
      copy: translate(lang, "common.payoutPlannedCopy"),
      review: pendingReview(lang),
    };
  }
  return railLabel(dto.paypalRail, track?.provenance === "replay" ? "replay" : dto.provenance, lang);
}

const PAYPAL_STATUS: ReadonlySet<MemberStatus> = new Set([
  "PAYPAL_PENDING",
  "PAID",
  "UNCLAIMED",
  "RETURNED",
  "REROUTED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "REVERSED",
]);

/** The sole status projection: co-op decisions and cash attestations are never PayPal replay outcomes. */
export function payoutStatus(
  input: {
    status: MemberStatus;
    statusWord: string;
    amountState: AmountState;
    paypal: boolean;
    evidence: readonly (string | null | undefined)[];
  },
  lang: Lang,
) {
  const replayed = input.paypal && PAYPAL_STATUS.has(input.status) && input.evidence.includes("replay");
  return {
    statusWord: replayed
      ? translate(lang, "common.payoutReplayStatus", { status: input.statusWord })
      : input.statusWord,
    tone: replayed ? ("neutral" as const) : STATUS_TONE[input.status],
    amountState:
      replayed && (input.amountState === "landed" || input.amountState === "attested")
        ? ("hollow" as const)
        : input.amountState,
    replayed,
    simulatedLabel: translate(lang, "common.payoutSimulatedLabel"),
  };
}
