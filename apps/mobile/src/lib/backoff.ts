/**
 * Upload retry schedule for the clerk outbox (M-CL-01 `failed`): 10, 20, 40, 80, 160 s, then every 5 minutes, so
 * the third attempt reads "Mosulay pag-usab sa 40 s". The schedule is deterministic on purpose: the countdown the
 * clerk reads is the one the outbox keeps. When fs-api asks for longer (`Retry-After` on a 429 or 503), the longer
 * wait wins, up to an hour, so a struggling server is never hammered by a queue of phones.
 *
 * Pure: no clock, no I/O.
 */
export const RETRY_BASE_MS = 10_000;
export const RETRY_CAP_MS = 300_000;
/** A Retry-After longer than this is treated as this: the clerk can always press "Ipadala karon". */
export const RETRY_AFTER_MAX_MS = 3_600_000;

/** The wait after `attempts` failed attempts (0 → due now). */
export function retryDelayMs(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts <= 0) return 0;
  const doublings = Math.min(Math.floor(attempts) - 1, 20);
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** doublings);
}

/**
 * RFC 9110 §10.2.3 `Retry-After`: delay-seconds or an HTTP-date, as a wait in ms from `now`, capped at an hour.
 * Null when absent or unreadable (the backoff alone decides then).
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Math.min(RETRY_AFTER_MAX_MS, Number(v) * 1000);
  // An HTTP-date always names its month and carries a time; anything else ("1.5", "-5") is not one, however
  // leniently a JS engine would parse it.
  if (!/[A-Za-z]{3}/.test(v) || !/\d{1,2}:\d{2}/.test(v)) return null;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, at - now));
}

/** When the next attempt is due: the backoff, or the server's Retry-After when it asks for longer. */
export function nextAttemptAt(now: number, attempts: number, retryAfterMs?: number | null): number {
  return now + Math.max(retryDelayMs(attempts), retryAfterMs ?? 0);
}
