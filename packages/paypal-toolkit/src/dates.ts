const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** The UTC calendar date of an instant, yyyy-MM-dd (PayPal invoice dates are UTC). */
export function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Parses yyyy-MM-dd strictly (rejects 2026-02-30). */
export function parseIsoDate(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new RangeError(`Not a yyyy-MM-dd date: ${JSON.stringify(iso)}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (utcDate(new Date(t)) !== iso) throw new RangeError(`Not a calendar date: ${iso}`);
  return t;
}

export function addDays(iso: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Whole days only: ${days}`);
  return utcDate(new Date(parseIsoDate(iso) + days * DAY_MS));
}
