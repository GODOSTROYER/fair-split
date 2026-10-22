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
 * `@fairsplit/db` sits below the paypal-* packages and cannot import them; `WebhookTransmissionStore` is the same
 * shape as paypal-core's `TransmissionStore`, so it is assignable to it.
 */
import { eq, lt, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { webhookTransmissions } from "./schema/index.js";

/** PayPal transmission ids are UUIDs (at most 50 characters); paypal-core refuses anything else before it gets here. */
export const TRANSMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Structurally paypal-core's `TransmissionStore` (src/webhook/transmission.ts). */
export interface WebhookTransmissionStore {
  /**
   * Records `transmissionId` until `expiresAt` (epoch ms). True when it was not recorded, or its record had expired
   * by `now` (epoch ms, the app clock; default this store's clock); false when it is a repeat. Atomic: of concurrent
   * claims of one id, exactly one is true. Throws (the delivery fails closed and retryable) on a malformed id or
   * instant, or when the database cannot answer.
   */
  claim(transmissionId: string, expiresAt: number, now?: number): Promise<boolean>;
  /** Forgets an id: the delivery was accepted but not stored, so PayPal's retry must not look like a replay. */
  release(transmissionId: string): Promise<void>;
}

function checkId(transmissionId: string): void {
  if (typeof transmissionId !== "string" || !TRANSMISSION_ID_PATTERN.test(transmissionId)) {
    throw new TypeError("webhook transmission id must be 1-64 characters of A-Z, a-z, 0-9, _ and -");
  }
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
    async claim(transmissionId, expiresAt, now) {
      checkId(transmissionId);
      const until = instant(expiresAt, "expiresAt");
      const at = instant(now ?? clock(), "now");
      // a row back means "first time": inserted, or an expired record taken over. The comparison is with the
      // app's `at`, never now(); the primary key makes concurrent claims of one id serialise on its index entry.
      const rows = await db
        .insert(webhookTransmissions)
        .values({ transmissionId, expiresAt: until })
        .onConflictDoUpdate({
          target: webhookTransmissions.transmissionId,
          set: { expiresAt: sql`excluded.expires_at` },
          setWhere: lte(webhookTransmissions.expiresAt, at),
        })
        .returning({ transmissionId: webhookTransmissions.transmissionId });
      return rows.length > 0;
    },
    async release(transmissionId) {
      checkId(transmissionId);
      await db.delete(webhookTransmissions).where(eq(webhookTransmissions.transmissionId, transmissionId));
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
