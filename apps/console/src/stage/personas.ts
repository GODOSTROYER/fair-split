// The phone's three tabs (S1.6): Nang Celing on her statement (M-MB-01, Cebuano, Adlaw), Ernesto on the
// co-sign request (M-BD-01) and Jessie on the scanner (M-CL-01). Names come from the snapshot.

import { MEMBER_LINE_LABELS, type ScreenId, type SeasonSnapshot } from "@fairsplit/contracts";
import type { MessageKey } from "@fairsplit/i18n";
import type { FramePersona } from "../data/adapter.js";
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

/** The 64 px tab's words: "Nang Celing: Gisusi pa" (member status words are Cebuano, register §7). */
export function personaStatus(persona: FramePersona, view: RunView | undefined): string | null {
  if (persona === "member") {
    const state = view?.lines[HERO_MEMBER]?.state ?? "COMPUTED";
    return MEMBER_LINE_LABELS[state].ceb;
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
