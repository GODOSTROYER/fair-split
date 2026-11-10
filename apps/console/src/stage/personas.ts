// The phone's three tabs (S1.6): Nang Celing on her statement (M-MB-01, Cebuano, Adlaw), Ernesto on the
// co-sign request (M-BD-01) and Jessie on the scanner (M-CL-01). Names come from the snapshot.

import { MEMBER_LINE_LABELS, type RunEvent, type ScreenId, type SeasonSnapshot } from "@fairsplit/contracts";
import type { MessageKey } from "@fairsplit/i18n";
import type { FramePersona } from "../data/adapter.js";
import { payoutStatus, SIMULATED_PAYOUT_LABEL } from "../data/payout-replay.js";
import { atLeast, type RunView } from "../data/run-view.js";

/** The hero member the Member tab follows (register §2). */
export const HERO_MEMBER = "M-014";

export interface PersonaInfo {
  readonly persona: FramePersona;
  readonly tab: MessageKey;
  readonly name: string;
  readonly screen: ScreenId;
}

export function personaInfo(persona: FramePersona, snapshot: SeasonSnapshot | undefined): PersonaInfo {
  const officer = (role: "CHAIR" | "CLERK") => snapshot?.officers.find((o) => o.role === role)?.shortName;
  switch (persona) {
    case "member":
      return {
        persona,
        tab: "W-JG-01.tab.member",
        name: snapshot?.members.find((m) => m.memberNo === HERO_MEMBER)?.consoleName ?? HERO_MEMBER,
        screen: "M-MB-01",
      };
    case "chair":
      return { persona, tab: "W-JG-01.tab.chair", name: officer("CHAIR") ?? "Chair", screen: "M-BD-01" };
    case "clerk":
      return { persona, tab: "W-JG-01.tab.clerk", name: officer("CLERK") ?? "Clerk", screen: "M-CL-01" };
  }
}

/**
 * MM-1's cue (S1.6): M-014's payment landed in this run. The helper decides "landed", so a replayed SUCCESS (the
 * earlier run's) never raises the phone.
 */
export function heroPaymentLanded(event: RunEvent): boolean {
  return (
    event.type === "item.updated" &&
    event.payload.memberNo === HERO_MEMBER &&
    payoutStatus({ itemStatus: event.payload.to, provenance: event.provenance }).amountState === "landed"
  );
}

/** A persona's initials for the phone rail's avatar: "Nang Celing" → "NC", "Ernesto" → "E". */
export function personaInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}]/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The rail's status dot for a persona (round 3): jade ("paid") only for her payment the simulated PayPal confirmed
 * in this run (never a replay), marigold while a person must act (her line in review, the Chair's co-sign
 * request), ink ("done") once the Chair has signed (a signature is not money), a hollow neutral dot while it is on
 * its way, and none for a frame with nothing to say.
 */
export function personaTone(
  persona: FramePersona,
  view: RunView | undefined,
): "done" | "paid" | "held" | "pending" | null {
  if (persona === "member") {
    const state = view?.lines[HERO_MEMBER]?.state ?? "COMPUTED";
    const status = payoutStatus({ state, view, memberNo: HERO_MEMBER, statusWord: "" });
    if (status.amountState === "landed") return "paid";
    if (["SUBMITTED", "PAYPAL_PENDING", "LOCKED", "OFF_RAIL_DUE", "REROUTED"].includes(state))
      return "pending";
    return "held";
  }
  if (persona === "chair" && view) {
    if (view.state === "AWAITING_BOARD" || view.state === "TREASURER_APPROVED") return "held";
    if (atLeast(view, "APPROVED")) return "done";
  }
  return null;
}

/**
 * The 64 px tab's words: "Nang Celing: Gisusi pa" (member status words are Cebuano, register §7). The tab has no
 * room for a detail line, so a replayed status keeps the rail label beside the item it replayed, like a live one.
 */
export function personaStatus(persona: FramePersona, view: RunView | undefined): string | null {
  if (persona === "member") {
    const state = view?.lines[HERO_MEMBER]?.state ?? "COMPUTED";
    const status = payoutStatus({
      state,
      view,
      memberNo: HERO_MEMBER,
      statusWord: MEMBER_LINE_LABELS[state].ceb,
    });
    return status.replayed ? `${status.statusWord} (${SIMULATED_PAYOUT_LABEL})` : status.statusWord;
  }
  if (
    persona === "chair" &&
    view &&
    (view.state === "AWAITING_BOARD" || view.state === "TREASURER_APPROVED")
  ) {
    return "co-sign request";
  }
  if (persona === "chair" && view && atLeast(view, "APPROVED")) return "signed";
  return null;
}
