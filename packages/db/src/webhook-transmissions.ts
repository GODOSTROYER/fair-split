/**
 * The production replay store for PayPal webhook deliveries: paypal-core's `TransmissionStore` on the
 * `webhook_transmissions` table (webhook trust model step 5). Once a delivery's signature verifies, its
 * `paypal-transmission-id` is claimed until transmission time + 6 minutes; a copy that arrives while the claim lives
 * is `TRANSMISSION_REPLAYED`. Inject it into paypal-core:
 *
 *   createPayPalCore({ …, webhookTransmissionStore: createWebhookTransmissionStore(db) })
 *
 * and run `purgeExpiredTransmissions(db, Date.now())` hourly.
 *
 * Clocks. The verifier judges freshness (the 5-minute window) by the app's clock, so the store compares a record's
 * `expires_at` with the app's `now` — the third argument of `claim`, else this store's own clock (`Date.now`) — and
 * never with the database's now(): a database clock running ahead would treat a live id as expired and let a replayed
 * copy through. The purge takes an app-supplied time for the same reason.
 *
 * Claim tokens. The verifier hands every claim a fresh UUID (`claim(id, expiresAt, now, claimToken)`), stored with
 * the record. A claim that throws may still have committed (a lost reply, a client timeout), so the verifier then
 * calls `release(id, claimToken)`: that deletes the record only if this claim wrote it, never the record of a
 * concurrent copy or of a later delivery that took an expired id over. `release(id)` without a token (the route,
 * after it failed to store an accepted event) forgets whoever recorded the id.
 *
 * `@fairsplit/db` sits below the paypal-* packages and cannot import them; `WebhookTransmissionStore` is the same
 * shape as paypal-core's `TransmissionStore`, so it is assignable to it.
 */
import { and, eq, lt, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { webhookTransmissions } from "./schema/index.js";

/** PayPal transmission ids are UUIDs (at most 50 characters); paypal-core refuses anything else before it gets here. */
export const TRANSMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** A claim token is a UUID (paypal-core passes `crypto.randomUUID()`), stored in a `uuid` column. */
const CLAIM_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Structurally paypal-core's `TransmissionStore` (src/webhook/transmission.ts). */
export interface WebhookTransmissionStore {
  /**
   * Records `transmissionId` until `expiresAt` (epoch ms) under `claimToken`. True when it was not recorded, or its
   * record had expired by `now` (epoch ms, the app clock; default this store's clock); false when it is a repeat, and
   * then the record and its token stay as they were. Atomic: of concurrent claims of one id, exactly one is true.
   * Throws (the delivery fails closed and retryable) on a malformed id, instant or token, or when the database
   * cannot answer.
   */
  claim(transmissionId: string, expiresAt: number, now?: number, claimToken?: string): Promise<boolean>;
  /**
   * Forgets an id: the delivery was accepted but not stored (or its claim failed), so PayPal's retry must not look
   * like a replay. With `claimToken`, only the record that claim wrote; without one, whoever recorded it. An id that
   * is not recorded (or recorded under another token) is left alone.
   */
  release(transmissionId: string, claimToken?: string): Promise<void>;
}

function checkId(transmissionId: string): void {
  if (typeof transmissionId !== "string" || !TRANSMISSION_ID_PATTERN.test(transmissionId)) {
    throw new TypeError("webhook transmission id must be 1-64 characters of A-Z, a-z, 0-9, _ and -");
  }
}

function checkToken(claimToken: string | undefined): string | null {
  if (claimToken === undefined) return null;
  if (typeof claimToken !== "string" || !CLAIM_TOKEN_PATTERN.test(claimToken)) {
    throw new TypeError("webhook transmission claim token must be a UUID");
  }
  return claimToken.toLowerCase();
}

function instant(ms: number, what: string): Date {
  if (typeof ms !== "number" || !Number.isFinite(ms))
    throw new TypeError(`${what} must be a finite epoch ms`);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new TypeError(`${what} is out of range`);
  return d;
}

export function createWebhookTransmissionStore(
  db: DbOrTx,
  options: { now?: () => number } = {},
): WebhookTransmissionStore {
  const clock = options.now ?? Date.now;
  return {
    async claim(transmissionId, expiresAt, now, claimToken) {
      checkId(transmissionId);
      const until = instant(expiresAt, "expiresAt");
      const at = instant(now ?? clock(), "now");
      const token = checkToken(claimToken);
      // a row back means "first time": inserted, or an expired record taken over (with this claim's token). The
      // comparison is with the app's `at`, never now(); the primary key makes concurrent claims of one id serialise
      // on its index entry, and a refused claim (no row back) leaves the record and its token untouched.
      const rows = await db
        .insert(webhookTransmissions)
        .values({ transmissionId, expiresAt: until, claimToken: token })
        .onConflictDoUpdate({
          target: webhookTransmissions.transmissionId,
          set: { expiresAt: sql`excluded.expires_at`, claimToken: sql`excluded.claim_token` },
          setWhere: lte(webhookTransmissions.expiresAt, at),
        })
        .returning({ transmissionId: webhookTransmissions.transmissionId });
      return rows.length > 0;
    },
    async release(transmissionId, claimToken) {
      checkId(transmissionId);
      const token = checkToken(claimToken);
      const byId = eq(webhookTransmissions.transmissionId, transmissionId);
      // with a token, a record written without one (claim_token NULL) never matches: it is not this claim's
      await db
        .delete(webhookTransmissions)
        .where(token === null ? byId : and(byId, eq(webhookTransmissions.claimToken, token)));
    },
  };
}

/** Housekeeping for the hourly cron: drops records that expired before `now` (epoch ms or Date, the app's clock). */
export async function purgeExpiredTransmissions(db: DbOrTx, now: number | Date): Promise<number> {
  const at = instant(now instanceof Date ? now.getTime() : now, "now");
  const rows = await db
    .delete(webhookTransmissions)
    .where(lt(webhookTransmissions.expiresAt, at))
    .returning({ transmissionId: webhookTransmissions.transmissionId });
  return rows.length;
}
