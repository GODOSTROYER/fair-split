// Who decided: initials stamps and names from the snapshot's officers (register §2). A person's decision
// carries their 18 px ink stamp with the time on hover (design §2.5); the engine never gets a stamp.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import type { StampView } from "@fairsplit/ui-web";
import { format } from "../../../lib/format.js";

export interface Officer {
  readonly initials: string;
  readonly name: string;
  readonly shortName: string;
  readonly role: "TREASURER" | "CHAIR" | "SECRETARY" | "CLERK";
}

/** Finds an officer by initials ("AS"), persona ("treasurer:analyn", "analyn") or role ("treasurer"). */
export function officer(
  snapshot: SeasonSnapshot | undefined,
  who: string | null | undefined,
): Officer | null {
  if (!snapshot || !who) return null;
  const key = who.toLowerCase();
  for (const o of snapshot.officers) {
    const persona = o.persona.toLowerCase();
    if (
      o.initials.toLowerCase() === key ||
      persona === key ||
      persona.split(":")[1] === key ||
      o.role.toLowerCase() === key ||
      (key === "board" && o.role === "CHAIR")
    ) {
      return { initials: o.initials, name: o.name, shortName: o.shortName, role: o.role };
    }
  }
  return null;
}

/** "10:24" from an ISO instant (Manila time), or "" when unknown. */
export function stampTime(at: string | null | undefined): string {
  if (!at || Number.isNaN(Date.parse(at))) return "";
  return format.time(at).slice(0, 5);
}

/** The ink stamp for a person's decision, or null for the engine and unknown actors. */
export function stampFor(
  snapshot: SeasonSnapshot | undefined,
  who: string | null | undefined,
  at: string | null | undefined,
): StampView | null {
  if (!who || who === "engine") return null;
  const o = officer(snapshot, who);
  const initials = o?.initials ?? (/^[A-Z]{2}$/.test(who) ? who : null);
  if (!initials) return null;
  return { initials, name: o?.name ?? initials, at: stampTime(at) };
}
