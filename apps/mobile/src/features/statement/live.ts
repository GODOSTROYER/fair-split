import type { StatementDTO } from "../../_shims/api-client";
import type { ItemStatus, ItemUpdatedPayload, Lang, RunEvent } from "../../_shims/contracts";
import { pendingReview } from "../../_shims/i18n";
import type { ItemTrack } from "../../lib/item-status";

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
  return railLabel(dto.paypalRail, track?.provenance === "replay" ? "replay" : dto.provenance, lang);
}
