/**
 * The production replay store behind paypal-core's `TransmissionStore` (webhook trust model step 5): a verified
 * delivery's `paypal-transmission-id` is accepted once until transmission time + 6 minutes. Freshness is judged by
 * the app's clock, so the store compares a record's expiry with the `now` the verifier passes (claim(id, expiresAt,
 * now)), never with the database's now(): a database clock running ahead would expire a live id early and let a
 * replayed copy through (paypal-core README, "For WS-DATA").
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webhookTransmissions } from "../src/schema/index.js";
import { openTestDb, type TestDb } from "../src/testing/index.js";
import {
  createWebhookTransmissionStore,
  purgeExpiredTransmissions,
  type WebhookTransmissionStore,
} from "../src/webhook-transmissions.js";
import { sqlState } from "./helpers.js";

let t: TestDb;
let store: WebhookTransmissionStore;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
  store = createWebhookTransmissionStore(t.app.db);
});
afterAll(async () => {
  await t?.close();
});

const MIN = 60_000;
let n = 0;
/** PayPal transmission ids are UUIDs */
const tid = () =>
  `0d1f5a3c-${String(++n).padStart(4, "0")}-11ef-9c2a-${Date.now().toString(16).padStart(12, "0")}`;

async function expiryOf(id: string): Promise<number | null> {
  const [row] = await t.owner.db
    .select({ expiresAt: webhookTransmissions.expiresAt })
    .from(webhookTransmissions)
    .where(eq(webhookTransmissions.transmissionId, id));
  return row ? row.expiresAt.getTime() : null;
}

describe("webhook transmission ids are accepted once (TransmissionStore.claim)", () => {
  it("the first claim records the id, a copy before it expires is a replay, and an expired record is claimed again", async () => {
    const id = tid();
    const t0 = Date.now();
    expect(await store.claim(id, t0 + 6 * MIN, t0)).toBe(true);
    expect(await expiryOf(id)).toBe(t0 + 6 * MIN);
    expect(await store.claim(id, t0 + 7 * MIN, t0 + MIN)).toBe(false);
    expect(await store.claim(id, t0 + 7 * MIN, t0 + 6 * MIN - 1)).toBe(false);
    expect(await expiryOf(id)).toBe(t0 + 6 * MIN);
    // at its expiry the record is spent: the id may be accepted again, and is kept until the new expiry
    expect(await store.claim(id, t0 + 12 * MIN, t0 + 6 * MIN)).toBe(true);
    expect(await expiryOf(id)).toBe(t0 + 12 * MIN);
  });

  it("expiry is judged by the app's clock, never the database's", async () => {
    // the database clock runs a day ahead of the app's: a record the app still considers live stays live
    const behind = Date.now() - 24 * 60 * MIN;
    const live = tid();
    expect(await store.claim(live, behind + 6 * MIN, behind)).toBe(true);
    expect(await store.claim(live, behind + 7 * MIN, behind + MIN)).toBe(false);
    // and a day behind it: a record the app considers expired is claimed again
    const ahead = Date.now() + 24 * 60 * MIN;
    const old = tid();
    expect(await store.claim(old, ahead + 6 * MIN, ahead)).toBe(true);
    expect(await store.claim(old, ahead + 13 * MIN, ahead + 7 * MIN)).toBe(true);
    // without `now` the store reads its own (app) clock, not the database's
    const fixed = Date.now() - 24 * 60 * MIN;
    const clocked = createWebhookTransmissionStore(t.app.db, { now: () => fixed });
    const id = tid();
    expect(await clocked.claim(id, fixed + 6 * MIN)).toBe(true);
    expect(await clocked.claim(id, fixed + 6 * MIN)).toBe(false);
  });

  it("concurrent claims of one id: exactly one wins", async () => {
    const id = tid();
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 6 }, () => store.claim(id, now + 6 * MIN, now)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("release forgets an id, so PayPal's retry of a delivery we could not store is not a replay", async () => {
    const id = tid();
    const now = Date.now();
    expect(await store.claim(id, now + 6 * MIN, now)).toBe(true);
    await store.release(id);
    expect(await expiryOf(id)).toBeNull();
    expect(await store.claim(id, now + 6 * MIN, now + 1000)).toBe(true);
    await store.release(tid()); // an id never recorded: nothing to do
  });

  it("only well-formed ids and finite instants are recorded; the table refuses junk keys too", async () => {
    const now = Date.now();
    for (const bad of ["", "has space", "x".repeat(65), "semi;colon", "ümlaut"]) {
      await expect(store.claim(bad, now + 6 * MIN, now)).rejects.toThrow(TypeError);
    }
    await expect(store.claim(tid(), Number.NaN, now)).rejects.toThrow(TypeError);
    await expect(store.claim(tid(), now + 6 * MIN, Number.POSITIVE_INFINITY)).rejects.toThrow(TypeError);
    expect(
      await sqlState(
        () =>
          t.app.sql`insert into webhook_transmissions (transmission_id, expires_at) values ('a b', now())`,
      ),
    ).toBe("23514");
  });
});

describe("the hourly purge (purgeExpiredTransmissions) takes an app-supplied time", () => {
  it("drops records expired at that time and keeps the live ones, whatever the database clock says", async () => {
    const appNow = Date.now() - 24 * 60 * MIN; // the app is a day behind the database
    const spent = tid();
    const live = tid();
    await store.claim(spent, appNow - MIN, appNow - 10 * MIN);
    await store.claim(live, appNow + 5 * MIN, appNow);
    const dropped = await purgeExpiredTransmissions(t.app.db, appNow);
    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(await expiryOf(spent)).toBeNull();
    expect(await expiryOf(live)).toBe(appNow + 5 * MIN);
    await expect(purgeExpiredTransmissions(t.app.db, Number.NaN)).rejects.toThrow(TypeError);
    const [left] = await t.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookTransmissions)
      .where(eq(webhookTransmissions.transmissionId, live));
    expect(left?.n).toBe(1);
  });
});
