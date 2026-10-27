// Freshness and replay tracking for PayPal webhook deliveries (plan, "Webhooks": transmission time
// within 5 minutes, unique `transmission_id`).
//
// Why both. PayPal's signature covers `transmissionId|transmissionTime|webhookId|crc32(body)`, so
// neither header can be changed without breaking it, but a captured genuine delivery can be sent again
// byte for byte. The freshness window bounds how long such a copy is accepted at all (5 minutes either
// way, which also absorbs clock skew), and the transmission-id record closes that window: each id is
// accepted once. Ids are recorded only after the signature verified, so a forged request cannot burn
// the id of a genuine delivery that is still on its way.
//
// This is separate from event-id dedupe (`webhook_events ON CONFLICT (paypal_event_id) DO NOTHING`).
// PayPal's resend of an event (`webhooks-events/{id}/resend`, the duplicate beat) carries a new
// transmission id, time and signature, so it passes here and is then stored as a duplicate.
//
// UNVERIFIED (spike S5 records it): PayPal does not document whether a retry after a non-2xx is a new
// transmission (new id, time and signature) or the first attempt's headers again (checked 22 Oct 2026
// against developer.paypal.com/api/rest/webhooks/rest). If retries reuse the first headers, a retry
// more than 5 minutes later is refused here, and the event is recovered by the next catch-up pass
// (`verified = 'fetched'`, apps/api/src/webhooks/catchup.ts), which starts from the previous pass's
// `completedThrough`, not from the newest applied event, so an older refused event is still listed.
// That holds while WS-OPS persists `completedThrough` and runs the passes. The route frees an id it
// recorded when it could not store the event (releaseTransmission), and the verifier frees one whose
// claim reported an error, so an immediate retry passes.

/** `paypal-transmission-time` must be within this of our clock, in either direction. */
export const MAX_TRANSMISSION_SKEW_MS = 5 * 60_000;

/** A recorded id is kept this long beyond the freshness window (our clock may step, too). */
export const TRANSMISSION_RETENTION_MARGIN_MS = 60_000;

/**
 * PayPal transmission ids are UUIDs (Webhooks v1: `\w+\S+`, at most 50 characters). Anything else is
 * refused before any work, and never becomes a key or a log field.
 */
export const TRANSMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** RFC 3339 / ISO 8601 date-time with seconds and an explicit zone, as PayPal sends it ("2024-05-16T05:19:23Z"). */
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([Zz])|([+-])(\d{2}):?(\d{2}))$/;

/** Parse `paypal-transmission-time` strictly: epoch milliseconds, or null when it is not a real instant. */
export function parseTransmissionTime(value: string): number | null {
  const m = DATE_TIME.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const millis = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  const local = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(local);
  // Rejects 30 February and the like (Date.UTC would roll them over), and years 0-99 (mapped to 19xx).
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  if (m[8]) return local;
  const offsetHours = Number(m[10]);
  const offsetMinutes = Number(m[11]);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const sign = m[9] === "-" ? -1 : 1;
  return local - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

/**
 * Where accepted transmission ids are recorded. Production (PROPOSED to WS-DATA): a table
 * `webhook_transmissions (transmission_id text PRIMARY KEY, expires_at timestamptz NOT NULL,
 * claim_token uuid)` and
 *   claim:   INSERT … VALUES ($1, $2, $4) ON CONFLICT (transmission_id) DO UPDATE
 *              SET expires_at = EXCLUDED.expires_at, claim_token = EXCLUDED.claim_token
 *            WHERE webhook_transmissions.expires_at <= $3 RETURNING 1   -- a row back means "first time"
 *   release: DELETE FROM webhook_transmissions
 *            WHERE transmission_id = $1 AND ($2::uuid IS NULL OR claim_token = $2)
 * plus an hourly `DELETE … WHERE expires_at < $1` with an app-supplied time. $3 is `now`, the app's
 * clock, never the database's now(): freshness is judged by the app clock, and a database clock
 * running ahead would expire ids early and let a replay through. The primary key is the uniqueness
 * guarantee.
 */
export interface TransmissionStore {
  /**
   * Record `transmissionId` until `expiresAt` (epoch ms) under `claimToken` (the verifier passes a fresh
   * UUID per claim). Resolves true when it was not recorded (or its record had expired), false when it
   * is a repeat. Must be atomic. `now` (epoch ms) is the app clock the verifier judged freshness by:
   * compare `expiresAt` of an existing record with it, never with the store's own clock.
   * Throwing fails the delivery closed and retryable (503). A claim that throws may still have
   * committed (a lost reply, a client timeout), so the verifier then calls `release(id, claimToken)`:
   * otherwise PayPal's retry of that transmission would be refused as a replay with nothing stored.
   */
  claim(transmissionId: string, expiresAt: number, now?: number, claimToken?: string): Promise<boolean>;
  /**
   * Forget an id: the delivery was accepted but not stored (or its claim failed), so PayPal's retry
   * must not look like a replay. With `claimToken`, forget it only if that claim recorded it, never a
   * concurrent copy's record (a release after a failed claim does not know whether its own claim landed);
   * without one, whoever recorded it. An id that is not recorded is a no-op. Throwing is retried once,
   * then raised as TRANSMISSION_RELEASE_FAILED in the verifier's health().
   */
  release(transmissionId: string, claimToken?: string): Promise<void>;
}

/**
 * In-process store for one API instance (fs-api runs one), tools and tests. A restart forgets the
 * ids; event-id dedupe still stops a replayed event from being applied twice. Only verified
 * deliveries are recorded, so forged traffic cannot fill it; when it is full of unexpired ids it
 * throws (fail closed: the delivery is answered 503 and PayPal retries).
 */
export function createMemoryTransmissionStore(
  options: { now?: () => number; maxEntries?: number } = {},
): TransmissionStore {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 10_000;
  const seen = new Map<string, { expiresAt: number; claimToken: string | undefined }>();
  const sweep = (t: number) => {
    for (const [id, record] of seen) if (record.expiresAt <= t) seen.delete(id);
  };
  return {
    // No await before the check-and-set: concurrent claims of one id cannot both see it as new.
    async claim(transmissionId, expiresAt, at, claimToken) {
      const t = at ?? now();
      const existing = seen.get(transmissionId);
      if (existing !== undefined && existing.expiresAt > t) return false;
      if (existing === undefined && seen.size >= maxEntries) {
        sweep(t);
        if (seen.size >= maxEntries) throw new Error("transmission store full");
      }
      seen.set(transmissionId, { expiresAt, claimToken });
      return true;
    },
    async release(transmissionId, claimToken) {
      if (claimToken !== undefined && seen.get(transmissionId)?.claimToken !== claimToken) return;
      seen.delete(transmissionId);
    },
  };
}
