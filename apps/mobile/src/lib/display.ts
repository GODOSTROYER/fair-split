/**
 * Display text for ids and dates on the phone (UI gate round 3: one truth for counts and ids). Pure, tested in Node.
 *
 * - `seasonLabel`: the season reads "2026-A" everywhere a person reads it. A run slug spells it "2026A" ("2026A-r1");
 *   the slug stays as data (routes, presence, the signed payload), only the words change.
 * - `voiceWords`: the voice's label without its provider in brackets (round 5), which stays in the accessible name.
 * - `followingDay`: the demo statement's expected pay date follows the clock, as its history does, so a judge never
 *   reads a date before the run they are about to start (the console dates the bodega's day the same way: the run's
 *   first day in Calinan plus the seed's gap).
 */

/**
 * The voice's words as a member reads them (UI gate round 5): the provider in brackets ("(Gemini TTS)") stays in the
 * accessible name and leaves the screen, so a line reads "Sintetikong tingog". Where words follow the brackets (a
 * mixed reading: "… ug tingog sa telepono"), the line breaks there, between the two voices, never on an orphan word.
 */
export function voiceWords(label: string): string {
  return label
    .replace(/\s*\([^)]*\)\s*/g, "\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

const SEASON = /^(\d{4})-?([A-Za-z])$/;

/** "2026A" → "2026-A"; "2026-A" stays; anything else is shown as it came. */
export function seasonLabel(code: string): string {
  const m = SEASON.exec(code.trim());
  if (!m?.[1] || !m[2]) return code;
  return `${m[1]}-${m[2].toUpperCase()}`;
}

const DAY_MS = 86_400_000;
/** Calinan, Davao City: UTC+8 all year. */
const CALINAN_MS = 8 * 3_600_000;

/** The calendar day of `iso` in Calinan, as "YYYY-MM-DD". */
function calinanDay(ms: number): string {
  return new Date(ms + CALINAN_MS).toISOString().slice(0, 10);
}

/**
 * The day `gapDays` after `nowIso` in Calinan, at the seed's hour (08:00 +08:00): the demo's expected pay date. With
 * the seed's gap (holds resolved 29 Oct, the bodega's day 30 Oct) that is the next day, whatever today is.
 */
export function followingDay(nowIso: string, gapDays: number): string {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return nowIso;
  return `${calinanDay(now + gapDays * DAY_MS)}T08:00:00+08:00`;
}

/** Whole days from the Calinan day of `fromIso` to that of `toIso` (the seed's gap: 29 Oct → 30 Oct is 1). */
export function dayGap(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  const a = Date.parse(`${calinanDay(from)}T00:00:00Z`);
  const b = Date.parse(`${calinanDay(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}
