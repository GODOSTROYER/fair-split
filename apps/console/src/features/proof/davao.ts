// Instants as people in Calinan read them: the date and the wall-clock time at +08:00 (format.time's default), so a
// date never disagrees with its time near midnight UTC. Pure; never `Intl` (C-22).

import { format } from "../../lib/format.js";

export const DAVAO_OFFSET_MS = 8 * 60 * 60_000;

/** The Davao calendar date of an instant, as an ISO date ("2026-10-28"). */
export function davaoIsoDate(instant: string): string {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`not an ISO date-time: ${instant}`);
  return new Date(ms + DAVAO_OFFSET_MS).toISOString().slice(0, 10);
}

/** "28 Oct 2026, 05:14:40". */
export function davaoDateTime(instant: string): string {
  return `${format.date(davaoIsoDate(instant))}, ${format.time(instant)}`;
}

/** "28 Oct, 05:14:40". */
export function davaoShort(instant: string): string {
  return `${format.dateShort(davaoIsoDate(instant))}, ${format.time(instant)}`;
}
