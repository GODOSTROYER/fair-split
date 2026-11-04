import type { StatementDTO } from "../../_shims/api-client";
import type {
  AmountState,
  ItemStatus,
  ItemUpdatedPayload,
  Lang,
  MemberStatus,
  RunEvent,
} from "../../_shims/contracts";
import { pendingReview } from "../../_shims/i18n";
import {
  confirmedPayment,
  type ItemEffect,
  type ItemTrack,
  reduceItemEvent,
  STATUS_TONE,
} from "../../lib/item-status";
import { t } from "./messages";

const COPY = {
  simulated: {
    ceb: "Kini nga bayad pinaagi sa simulated PayPal sandbox. Walay tinuod nga kuwarta nga molihok.",
    fil: "Ang bayad na ito ay sa simulated PayPal sandbox. Walang totoong perang gagalaw.",
    en: "This payment uses the simulated PayPal sandbox. No real money moves.",
  },
  replay: {
    ceb: "Gi-replay nga bayad sa simulated PayPal sandbox.",
    fil: "Ni-replay na bayad sa simulated PayPal sandbox.",
    en: "Replayed payment from the simulated PayPal sandbox.",
  },
  unknown: {
    ceb: "Wala mailhi ang gigikanan sa bayad.",
    fil: "Hindi alam ang pinagmulan ng bayad.",
    en: "Payment rail unknown.",
  },
};

const REPLAY_CHIP: Record<Lang, string> = {
  ceb: "Gi-replay · Simulated PayPal sandbox",
  fil: "Ni-replay · Simulated PayPal sandbox",
  en: "Replayed · Simulated PayPal sandbox",
};

const PLANNED_REPLAY: Record<Lang, { chip: string; copy: string }> = {
  ceb: {
    chip: "Giplano nga replay (labelled) · Simulated PayPal sandbox",
    copy: "Giplano ang labelled replay sa simulated PayPal sandbox. Wala pay payout item; ang kahimtang sa linya iya niini nga run.",
  },
  fil: {
    chip: "Planadong replay (labelled) · Simulated PayPal sandbox",
    copy: "Planado ang labelled replay sa simulated PayPal sandbox. Wala pang payout item; ang status ng linya ay para sa run na ito.",
  },
  en: {
    chip: "Planned replay (labelled) · Simulated PayPal sandbox",
    copy: "This run plans a labelled replay of the simulated PayPal sandbox payout step. No payout item exists yet; the line status belongs to this run.",
  },
};

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
    chip:
      kind === "unknown"
        ? COPY.unknown[lang]
        : kind === "replay"
          ? REPLAY_CHIP[lang]
          : "Simulated PayPal sandbox",
    copy: COPY[kind][lang],
    review: pendingReview(lang),
  };
}

const STATUS: Readonly<Record<string, ItemStatus>> = {
  PENDING: "PENDING",
  PROCESSING: "PENDING",
  SUCCEEDED: "SUCCESS",
  SUCCESS: "SUCCESS",
  UNCLAIMED: "UNCLAIMED",
  RETURNED: "RETURNED",
  ONHOLD: "ONHOLD",
  HELD: "ONHOLD",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  REVERSED: "REVERSED",
};

/** fs-api only appends webhook events after verification; POST acceptance is never settlement. */
export function memberEvent(event: RunEvent): RunEvent<"item.updated", ItemUpdatedPayload> | null {
  if (event.type !== "item.updated") return null;
  const p = event.payload as {
    to?: string;
    status?: string;
    source?: string;
    eventId?: string | null;
    senderItemId?: string;
    memberNo?: string;
    payoutItemId?: string;
  };
  const status = STATUS[p.to ?? p.status ?? ""];
  if (!status || !p.senderItemId || !p.memberNo) return null;
  if (
    status === "SUCCESS" &&
    !(
      event.provenance === "replay" ||
      (event.provenance === "simulated_rail" && p.source === "webhook" && p.eventId)
    )
  )
    return null;
  if (p.source !== "webhook" && p.source !== "status_check") return null;
  return {
    ...event,
    type: "item.updated",
    payload: {
      senderItemId: p.senderItemId,
      memberNo: p.memberNo,
      status,
      source: p.source,
      payoutItemId: p.payoutItemId,
    },
  };
}

export function statementRail(dto: StatementDTO, lang: Lang, track?: Pick<ItemTrack, "provenance">) {
  if (dto.provenance === "replay" && !dto.item && track?.provenance !== "replay") {
    return { kind: "replay-planned", ...PLANNED_REPLAY[lang], review: pendingReview(lang) };
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
  const simulatedLabel = "Simulated PayPal sandbox";
  const replayed = input.paypal && PAYPAL_STATUS.has(input.status) && input.evidence.includes("replay");
  return {
    statusWord: replayed ? t(lang, "M-MB-01.replayStatus", { status: input.statusWord }) : input.statusWord,
    tone: replayed ? ("neutral" as const) : STATUS_TONE[input.status],
    amountState:
      replayed && (input.amountState === "landed" || input.amountState === "attested")
        ? ("hollow" as const)
        : input.amountState,
    replayed,
    simulatedLabel,
  };
}

export interface PaidSignal {
  eventId: string;
  at: string;
  receivedAt: number;
}

/** The store's complete item event transition, including the only signal allowed to start MM-1. */
export function applyStatementItemEvent(
  track: ItemTrack,
  event: RunEvent,
  senderItemId: string,
  receivedAt: number,
  demo = false,
): { track: ItemTrack; effect: ItemEffect | "ignored"; paid: PaidSignal | null } {
  const adapted =
    demo && event.type === "item.updated"
      ? (event as RunEvent<"item.updated", ItemUpdatedPayload>)
      : memberEvent(event);
  if (!adapted) return { track, effect: "ignored", paid: null };
  const result = reduceItemEvent(track, adapted, senderItemId);
  const paid =
    result.effect === "applied" && track.status !== "SUCCESS" && confirmedPayment(result.track)
      ? { eventId: event.id, at: event.at, receivedAt }
      : null;
  return { ...result, paid };
}
