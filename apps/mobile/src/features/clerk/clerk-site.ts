/**
 * Who and where this clerk phone is, from data and never from the copy catalog: the station on the chip and on every
 * capture ("Purok 2 pickup"), the treasurer the refusal copy sends the clerk to ("See Treasurer Analyn"), and the
 * initials on the clerk's ink stamp.
 *
 * Each comes from the pairing first (`station` and `treasurerName`, which the shell is asked to add to
 * `PairedSession`; read here as soon as they arrive), then from the co-op's cash-day answer, and from the seed only on
 * demo data. A live phone whose co-op names no station shows no station chip, copy without a name says "the
 * treasurer", and a pairing without the clerk's name files no cash receipt (a stamp is never a placeholder).
 *
 * Pure (tested in Node).
 */
import { people } from "../../_shims/seed";
import type { PairedSession } from "../../services/session";
import { type CashDayDTO, initialsOf } from "./cash-day";

/** The spec's example station (S1 M-CK-01, design K1): shown on demo data only. */
export const DEMO_STATION = "Purok 2 pickup";

export interface ClerkSite {
  /** Where this phone files from, or null when nothing names a station. */
  station: string | null;
  /** The treasurer's name as the clerk knows her, or null: the copy then says "the treasurer". */
  treasurer: string | null;
  /** The clerk's initials for the ink stamp, or null: no cash receipt can be filed. */
  initials: string | null;
}

/** A text field the pairing may carry beyond `PairedSession`'s own, trimmed; null when absent or blank. */
export function sessionText(session: PairedSession | null, key: "station" | "treasurerName"): string | null {
  if (!session) return null;
  const v: unknown = Reflect.get(session, key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function clerkSite(input: {
  session: PairedSession | null;
  /** Demo data (no fs-api): the seed may stand in for what a live co-op would say. */
  demo: boolean;
  day: Pick<CashDayDTO, "station" | "treasurer"> | null;
}): ClerkSite {
  const { session, demo, day } = input;
  return {
    station: sessionText(session, "station") ?? day?.station ?? (demo ? DEMO_STATION : null),
    treasurer:
      sessionText(session, "treasurerName") ??
      day?.treasurer?.first ??
      (demo ? people.treasurer.first : null),
    // `||`: a pairing may carry an empty name, which is no name.
    initials: initialsOf(session?.displayName || "") ?? (demo ? initialsOf(people.clerk.name) : null),
  };
}
