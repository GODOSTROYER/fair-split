/**
 * The production replay store behind paypal-core's `TransmissionStore` (webhook trust model step 5): a verified
 * delivery's `paypal-transmission-id` is accepted once until transmission time + 6 minutes. Freshness is judged by
 * the app's clock, so the store compares a record's expiry with the `now` the verifier passes (claim(id, expiresAt,
 * now)), never with the database's now(): a database clock running ahead would expire a live id early and let a
 * replayed copy through (paypal-core README, "For WS-DATA").
 *
 * Each claim carries the verifier's own token (claim(id, expiresAt, now, claimToken)), stored with the record, and
 * release(id, claimToken) forgets the record only when that claim made it: a claim that reported an error may still
 * have committed, so the verifier releases it, and that release must never delete a record a concurrent copy holds.
 */
import { randomUUID } from "node:crypto";
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

async function tokenOf(id: string): Promise<string | null | undefined> {
  const [row] = await t.owner.db
    .select({ claimToken: webhookTransmissions.claimToken })
    .from(webhookTransmissions)
    .where(eq(webhookTransmissions.transmissionId, id));
  return row?.claimToken;
}

/**
 * paypal-core's `TransmissionStore` as ws/ppcore defines it (src/webhook/transmission.ts). @fairsplit/db sits below
 * the paypal-* packages and cannot import it, so the shape is restated here and the store must satisfy it.
 */
interface PayPalCoreTransmissionStore {
  claim(transmissionId: string, expiresAt: number, now?: number, claimToken?: string): Promise<boolean>;
  release(transmissionId: string, claimToken?: string): Promise<void>;
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

describe("a release forgets only its own claim's record (claim tokens)", () => {
  it("the store is paypal-core's TransmissionStore, claim token and all", () => {
    const asCore: PayPalCoreTransmissionStore = store;
    expect(typeof asCore.release).toBe("function");
  });

  it("release(id, token) deletes the record its claim made, and a copy's token deletes nothing", async () => {
    const id = tid();
    const now = Date.now();
    const mine = randomUUID();
    expect(await store.claim(id, now + 6 * MIN, now, mine)).toBe(true);
    expect(await tokenOf(id)).toBe(mine);
    // a concurrent copy was refused (false); its error path releases with its own token: the record stays
    const copy = randomUUID();
    expect(await store.claim(id, now + 6 * MIN, now + 10, copy)).toBe(false);
    expect(await tokenOf(id)).toBe(mine);
    await store.release(id, copy);
    expect(await expiryOf(id)).toBe(now + 6 * MIN);
    // the claim that made it releases it (its reply was lost, so the verifier forgets the id for PayPal's retry)
    await store.release(id, mine);
    expect(await expiryOf(id)).toBeNull();
    expect(await store.claim(id, now + 6 * MIN, now + 20, randomUUID())).toBe(true);
  });

  it("an old claim's late release cannot delete the record that took over after it expired", async () => {
    const id = tid();
    const t0 = Date.now();
    const first = randomUUID();
    const second = randomUUID();
    expect(await store.claim(id, t0 + 6 * MIN, t0, first)).toBe(true);
    // expired at t0 + 6 min: a new delivery takes the id over under its own token
    expect(await store.claim(id, t0 + 12 * MIN, t0 + 6 * MIN, second)).toBe(true);
    expect(await tokenOf(id)).toBe(second);
    await store.release(id, first);
    expect(await expiryOf(id)).toBe(t0 + 12 * MIN);
    // so a replay of the second delivery is still refused
    expect(await store.claim(id, t0 + 13 * MIN, t0 + 7 * MIN, randomUUID())).toBe(false);
    await store.release(id, second);
    expect(await expiryOf(id)).toBeNull();
  });

  it("concurrent claims and the losers' releases leave exactly the winner's record", async () => {
    const id = tid();
    const now = Date.now();
    const tokens = Array.from({ length: 6 }, () => randomUUID());
    const won = await Promise.all(tokens.map((tok) => store.claim(id, now + 6 * MIN, now, tok)));
    expect(won.filter(Boolean)).toHaveLength(1);
    const winner = tokens[won.indexOf(true)];
    await Promise.all(tokens.filter((tok) => tok !== winner).map((tok) => store.release(id, tok)));
    expect(await tokenOf(id)).toBe(winner);
    expect(await store.claim(id, now + 6 * MIN, now + 1, randomUUID())).toBe(false);
  });

  it("without a token, a release forgets whoever recorded the id (the route's release after a failed insert)", async () => {
    const id = tid();
    const now = Date.now();
    expect(await store.claim(id, now + 6 * MIN, now, randomUUID())).toBe(true);
    await store.release(id);
    expect(await expiryOf(id)).toBeNull();
    // a claim without a token stores none, and a tokened release never matches it
    expect(await store.claim(id, now + 6 * MIN, now + 1)).toBe(true);
    expect(await tokenOf(id)).toBeNull();
    await store.release(id, randomUUID());
    expect(await expiryOf(id)).toBe(now + 6 * MIN);
  });

  it("a malformed token is refused before the database sees it", async () => {
    const now = Date.now();
    for (const bad of ["", "not-a-uuid", `${randomUUID()}x`, "'; drop table webhook_transmissions; --"]) {
      await expect(store.claim(tid(), now + 6 * MIN, now, bad)).rejects.toThrow(TypeError);
      await expect(store.release(tid(), bad)).rejects.toThrow(TypeError);
    }
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
