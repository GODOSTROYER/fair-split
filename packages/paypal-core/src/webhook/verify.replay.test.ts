// Finding 1 (security review, MEDIUM): freshness of paypal-transmission-time, transmission-id replay
// tracking (separate from event-id dedupe) and the 64 KB body cap, plan "Webhooks".

import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server, useMswServer } from "../test-support.js";
import {
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
  testCertUrl,
} from "../testing/index.js";
import {
  createMemoryTransmissionStore,
  createPayPalWebhookVerifier,
  MAX_TRANSMISSION_SKEW_MS,
  MAX_WEBHOOK_BODY_BYTES,
  type TransmissionStore,
  type WebhookVerifierConfig,
} from "./verify.js";

useMswServer();

const DAY = 86_400_000;
const MINUTE = 60_000;
const pki = createTestPki();
const leaf = pki.issueLeaf();
const pems = new Map<string, string>();
let certFetches = 0;

beforeEach(() => {
  certFetches = 0;
  pems.clear();
  pems.set(TEST_CERT_URL, leaf.pem);
  server.use(
    http.get("https://api.sandbox.paypal.com/v1/notifications/certs/:id", ({ request }) => {
      certFetches += 1;
      const pem = pems.get(request.url);
      return pem
        ? new HttpResponse(pem, { headers: { "content-type": "application/x-pem-file" } })
        : HttpResponse.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    }),
  );
});

/** PayPal's header format: whole seconds, UTC. */
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const T0 = Math.floor(Date.now() / 1000) * 1000;
const event = syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
  payout_item_id: "5KX",
  transaction_status: "SUCCESS",
});
const signedAt = (ms: number, overrides: Partial<Parameters<typeof signWebhook>[0]> = {}) =>
  signWebhook({
    body: event,
    webhookId: TEST_WEBHOOK_ID,
    privateKey: leaf.privateKey,
    transmissionTime: iso(ms),
    ...overrides,
  });
/** A verifier whose clock reads `at()` (T0 unless moved). */
const verifierAt = (at: () => number = () => T0, config: WebhookVerifierConfig = {}) =>
  createPayPalWebhookVerifier({ now: at, ...config });

describe("verifyPayPal: paypal-transmission-time must be within 5 minutes of our clock", () => {
  it("is a 5-minute window", () => {
    expect(MAX_TRANSMISSION_SKEW_MS).toBe(5 * MINUTE);
  });

  it.each([
    ["5 minutes old", -5 * MINUTE],
    ["4 min 59 s old", -(5 * MINUTE - 1000)],
    ["sent now", 0],
    ["4 min 59 s ahead", 5 * MINUTE - 1000],
    ["5 minutes ahead", 5 * MINUTE],
  ])("accepts a delivery transmitted %s", async (_label, offset) => {
    const s = signedAt(T0 + offset);
    expect(await verifierAt().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      reason: null,
    });
  });

  it.each([
    ["5 min 1 s old", -(5 * MINUTE + 1000)],
    ["5 min 1 s ahead", 5 * MINUTE + 1000],
    ["a day old (a captured delivery)", -DAY],
    ["a day ahead", DAY],
  ])("rejects a delivery transmitted %s, before fetching a certificate", async (_label, offset) => {
    const s = signedAt(T0 + offset);
    const outcome = await verifierAt().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({
      mode: false,
      reason: "TRANSMISSION_TIME_OUT_OF_WINDOW",
      retryable: false,
    });
    expect(outcome.detail).toMatch(/^skew [+-]\d+ s$/);
    expect(certFetches).toBe(0);
  });

  it("measures the window with the injected clock, not the wall clock", async () => {
    const anHourAgo = T0 - 60 * MINUTE;
    const s = signedAt(anHourAgo);
    expect(await verifierAt(() => anHourAgo).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect((await verifierAt(() => T0).verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "TRANSMISSION_TIME_OUT_OF_WINDOW",
    );
  });

  it.each([
    "2026-10-29T09:12:44Z",
    "2026-10-29T09:12:44.123Z",
    "2026-10-29T11:12:44+02:00",
    "2026-10-29T04:12:44-0500",
    "2026-10-29t09:12:44z",
  ])("reads PayPal's ISO 8601 form %s", async (header) => {
    const at = Date.parse("2026-10-29T09:12:44Z");
    const s = signWebhook({
      body: event,
      webhookId: TEST_WEBHOOK_ID,
      privateKey: leaf.privateKey,
      transmissionTime: header,
    });
    expect(await verifierAt(() => at).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
  });

  it.each([
    "yesterday",
    "1730193164",
    "Thu, 29 Oct 2026 09:12:44 GMT",
    "2026-10-29 09:12:44Z",
    "2026-10-29T09:12:44",
    "2026-02-30T09:12:44Z",
    "2026-10-29T24:00:00Z",
    "2026-10-29T09:60:00Z",
    "+002026-10-29T09:12:44Z",
  ])("rejects an unreadable transmission time %j before fetching anything", async (header) => {
    const s = signWebhook({
      body: event,
      webhookId: TEST_WEBHOOK_ID,
      privateKey: leaf.privateKey,
      transmissionTime: header,
    });
    expect(await verifierAt().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "TRANSMISSION_TIME_INVALID",
      retryable: false,
    });
    expect(certFetches).toBe(0);
  });
});

describe("verifyPayPal: each transmission id is accepted once (replay tracking)", () => {
  it("rejects a byte-identical replay of an accepted delivery; PayPal's resend with a new transmission id passes", async () => {
    const v = verifierAt();
    const s = signedAt(T0);
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "TRANSMISSION_REPLAYED",
      retryable: false,
      transmissionId: s.headers["paypal-transmission-id"],
    });
    // PayPal's resend of the same event: same body and event id, new transmission id, time and signature.
    const resent = signedAt(T0 + 2_000);
    expect(resent.body).toBe(s.body);
    expect(await v.verifyPayPal(resent.body, resent.headers, TEST_WEBHOOK_ID)).toBe("self");
  });

  it("records each verified transmission id through the injected store, kept past the freshness window", async () => {
    const claims: [string, number][] = [];
    const store: TransmissionStore = {
      claim: async (id, expiresAt) => {
        claims.push([id, expiresAt]);
        return true;
      },
      release: async () => undefined,
    };
    const s = signedAt(T0 - 2 * MINUTE);
    expect(
      await verifierAt(() => T0, { transmissionStore: store }).verifyPayPal(
        s.body,
        s.headers,
        TEST_WEBHOOK_ID,
      ),
    ).toBe("self");
    expect(claims).toHaveLength(1);
    const [id, expiresAt] = claims[0] ?? ["", 0];
    expect(id).toBe(s.headers["paypal-transmission-id"]);
    // A copy stays fresh until transmission time + 5 min, so the id must be remembered at least that long.
    expect(expiresAt).toBeGreaterThanOrEqual(T0 - 2 * MINUTE + MAX_TRANSMISSION_SKEW_MS);
  });

  it("a store that has seen the id rejects the delivery; a store that fails makes it retryable, never accepted", async () => {
    const s = signedAt(T0);
    const seen: TransmissionStore = { claim: async () => false, release: async () => undefined };
    expect(
      await verifierAt(() => T0, { transmissionStore: seen }).verifyDetailed(
        s.body,
        s.headers,
        TEST_WEBHOOK_ID,
      ),
    ).toMatchObject({ mode: false, reason: "TRANSMISSION_REPLAYED", retryable: false });
    const down: TransmissionStore = {
      claim: async () => {
        throw new Error("connection refused");
      },
      release: async () => undefined,
    };
    expect(
      await verifierAt(() => T0, { transmissionStore: down }).verifyDetailed(
        s.body,
        s.headers,
        TEST_WEBHOOK_ID,
      ),
    ).toMatchObject({ mode: false, reason: "REPLAY_CHECK_FAILED", retryable: true });
  });

  it("never records the id of a delivery that fails verification, so a forged copy cannot block the genuine one", async () => {
    const claim = vi.fn(async () => true);
    const v = verifierAt(() => T0, { transmissionStore: { claim, release: async () => undefined } });
    const genuine = signedAt(T0);
    const forgedBody = genuine.body.replace('"SUCCESS"', '"FAILED"');
    expect((await v.verifyDetailed(forgedBody, genuine.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "SIGNATURE_MISMATCH",
    );
    const stale = signedAt(T0 - DAY, { transmissionId: genuine.headers["paypal-transmission-id"] });
    expect((await v.verifyDetailed(stale.body, stale.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "TRANSMISSION_TIME_OUT_OF_WINDOW",
    );
    expect(claim).not.toHaveBeenCalled();
    expect(await v.verifyPayPal(genuine.body, genuine.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("lets exactly one of two concurrent identical deliveries through", async () => {
    const v = verifierAt();
    const s = signedAt(T0);
    const outcomes = await Promise.all([
      v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID),
      v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID),
    ]);
    expect(outcomes.filter((o) => o.mode === "self")).toHaveLength(1);
    expect(outcomes.filter((o) => o.reason === "TRANSMISSION_REPLAYED")).toHaveLength(1);
  });

  it("keeps no id for a signed delivery that is refused later on (expired certificate), so a retry is judged afresh", async () => {
    const expired = pki.issueLeaf({ notBefore: new Date(T0 - 400 * DAY), notAfter: new Date(T0 - DAY) });
    const url = testCertUrl("replay-expired");
    pems.set(url, expired.pem);
    const v = verifierAt(() => T0, { expiredCertPolicy: "reject" });
    const s = signedAt(T0, { privateKey: expired.privateKey, certUrl: url });
    for (let i = 0; i < 2; i++) {
      expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("CERT_EXPIRED");
    }
  });

  it("releaseTransmission() forgets an accepted id (the route calls it when storing the event failed)", async () => {
    const v = verifierAt();
    const s = signedAt(T0);
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    await v.releaseTransmission(s.headers["paypal-transmission-id"] ?? "");
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
  });

  it("rejects a transmission id that does not look like PayPal's before any other work", async () => {
    const s = signedAt(T0, { transmissionId: `a'; DROP TABLE webhook_transmissions; --` });
    expect(await verifierAt().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "MALFORMED_HEADER",
      detail: "paypal-transmission-id",
    });
    expect(certFetches).toBe(0);
  });
});

// Verifier follow-up (trust, minor): a Postgres claim can commit and still report an error (a lost
// reply, a client timeout). The verifier answered 503 but left the id recorded, so PayPal's retry of
// that transmission was refused as TRANSMISSION_REPLAYED until the window closed and nothing was stored.
describe("verifyPayPal: a claim or release that fails never leaves a delivery locked out", () => {
  /** The memory store, with failures injected around it. */
  function flakyStore(failures: {
    /** Claim number n (1-based) records the id, then throws (a commit whose reply was lost). */
    claimCommitsThenThrows?: number;
    /** Claim number n throws before recording anything. */
    claimThrowsFirst?: number;
    /** How many release calls throw before they start to work. */
    releaseThrows?: number;
  }) {
    const inner = createMemoryTransmissionStore({ now: () => T0 });
    let claims = 0;
    let releaseFailuresLeft = failures.releaseThrows ?? 0;
    const releases: [string, string | undefined][] = [];
    const store: TransmissionStore = {
      async claim(id, expiresAt, at, claimToken) {
        claims += 1;
        if (claims === failures.claimThrowsFirst) throw new Error("connection reset before the INSERT");
        const first = await inner.claim(id, expiresAt, at, claimToken);
        if (claims === failures.claimCommitsThenThrows) throw new Error("connection lost after COMMIT");
        return first;
      },
      async release(id, claimToken) {
        releases.push([id, claimToken]);
        if (releaseFailuresLeft > 0) {
          releaseFailuresLeft -= 1;
          throw new Error("connection refused");
        }
        await inner.release(id, claimToken);
      },
    };
    return { store, releases };
  }

  it("a claim that committed but reported an error is released: 503 now, and PayPal's retry of the same transmission passes", async () => {
    const { store } = flakyStore({ claimCommitsThenThrows: 1 });
    let t = T0;
    const v = verifierAt(() => t, { transmissionStore: store });
    const s = signedAt(T0);
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "REPLAY_CHECK_FAILED",
      retryable: true,
    });
    // PayPal retries a 503, possibly with the first attempt's headers (UNVERIFIED until spike S5).
    t += MINUTE;
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      reason: null,
    });
    // The id is held again by the delivery that passed: a copy is still a replay.
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("TRANSMISSION_REPLAYED");
  });

  it("after a claim error, only that claim's own record is released, never a concurrent copy's", async () => {
    // Copy A claims the id; copy B's claim fails before it records anything. Releasing the id outright
    // would delete A's record and let a third copy through as a first delivery.
    const { store, releases } = flakyStore({ claimThrowsFirst: 2 });
    const v = verifierAt(() => T0, { transmissionStore: store });
    const s = signedAt(T0);
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "REPLAY_CHECK_FAILED",
      retryable: true,
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("TRANSMISSION_REPLAYED");
  });

  it("each claim carries its own token, and the token is what a release after a claim error names", async () => {
    const tokens: (string | undefined)[] = [];
    const inner = createMemoryTransmissionStore({ now: () => T0 });
    const store: TransmissionStore = {
      claim: async (id, expiresAt, at, claimToken) => {
        tokens.push(claimToken);
        return inner.claim(id, expiresAt, at, claimToken);
      },
      release: (id, claimToken) => inner.release(id, claimToken),
    };
    const v = verifierAt(() => T0, { transmissionStore: store });
    for (let i = 0; i < 3; i++) {
      const s = signedAt(T0 - i * 1_000);
      expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    }
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens)
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("a release that fails is retried once", async () => {
    const { store, releases } = flakyStore({ releaseThrows: 1 });
    const v = verifierAt(() => T0, { transmissionStore: store });
    const s = signedAt(T0);
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    await v.releaseTransmission(s.headers["paypal-transmission-id"] ?? "");
    expect(releases).toHaveLength(2);
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(v.health().alerts).not.toContain("TRANSMISSION_RELEASE_FAILED");
  });

  it("a release that fails twice raises TRANSMISSION_RELEASE_FAILED on /ops, since PayPal's retry will be refused as a replay", async () => {
    let t = T0;
    const error = vi.fn();
    const { store, releases } = flakyStore({ claimCommitsThenThrows: 1, releaseThrows: 2 });
    const v = verifierAt(() => t, { transmissionStore: store, logger: { error } });
    const s = signedAt(T0);
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("REPLAY_CHECK_FAILED");
    expect(releases).toHaveLength(2);
    const health = v.health();
    expect(health.status).toBe("degraded");
    expect(health.alerts).toEqual(["TRANSMISSION_RELEASE_FAILED"]);
    expect(health.problems).toEqual([
      expect.stringMatching(/^1 webhook transmission id could not be released in the last 15 min/),
    ]);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ transmissionId: s.headers["paypal-transmission-id"], attempts: 2 }),
      expect.stringContaining("refused as a replay"),
    );
    // It clears with the health window.
    t += 16 * MINUTE;
    expect(v.health().alerts).toEqual([]);
  });
});

describe("createMemoryTransmissionStore", () => {
  it("answers true once per id until it expires, then forgets it", async () => {
    let t = T0;
    const store = createMemoryTransmissionStore({ now: () => t });
    expect(await store.claim("a", t + 10 * MINUTE)).toBe(true);
    expect(await store.claim("a", t + 10 * MINUTE)).toBe(false);
    t += 10 * MINUTE + 1;
    expect(await store.claim("a", t + 10 * MINUTE)).toBe(true);
    await store.release("a");
    expect(await store.claim("a", t + 10 * MINUTE)).toBe(true);
  });

  it("judges expiry by the app clock it is handed, when one is (the verifier always hands it)", async () => {
    const store = createMemoryTransmissionStore({ now: () => T0 + DAY });
    expect(await store.claim("a", T0 + MINUTE, T0)).toBe(true);
    expect(await store.claim("a", T0 + MINUTE, T0 + 30_000)).toBe(false);
    expect(await store.claim("a", T0 + 2 * MINUTE, T0 + MINUTE)).toBe(true);
  });

  it("is handed the verifier's clock, so a database store compares expires_at with the app's time, not its own now()", async () => {
    const claims: [string, number, number | undefined][] = [];
    const store: TransmissionStore = {
      claim: async (id, expiresAt, at) => {
        claims.push([id, expiresAt, at]);
        return true;
      },
      release: async () => undefined,
    };
    const s = signedAt(T0 - 2 * MINUTE);
    expect(
      await verifierAt(() => T0, { transmissionStore: store }).verifyPayPal(
        s.body,
        s.headers,
        TEST_WEBHOOK_ID,
      ),
    ).toBe("self");
    expect(claims).toEqual([[s.headers["paypal-transmission-id"], T0 - 2 * MINUTE + 6 * MINUTE, T0]]);
  });

  it("release with a claim token forgets only the record that claim wrote; without one, any record", async () => {
    const store = createMemoryTransmissionStore({ now: () => T0 });
    expect(await store.claim("a", T0 + MINUTE, T0, "token-a")).toBe(true);
    await store.release("a", "token-b"); // another claim's token: not its record
    expect(await store.claim("a", T0 + MINUTE, T0, "token-c")).toBe(false);
    await store.release("missing", "token-a"); // nothing recorded: a no-op
    await store.release("a", "token-a");
    expect(await store.claim("a", T0 + MINUTE, T0, "token-d")).toBe(true);
    await store.release("a");
    expect(await store.claim("a", T0 + MINUTE, T0, "token-e")).toBe(true);
  });

  it("fails closed when full of live ids, and makes room once they expire", async () => {
    let t = T0;
    const store = createMemoryTransmissionStore({ now: () => t, maxEntries: 2 });
    expect(await store.claim("a", t + MINUTE)).toBe(true);
    expect(await store.claim("b", t + 2 * MINUTE)).toBe(true);
    await expect(store.claim("c", t + MINUTE)).rejects.toThrow(/full/);
    t += MINUTE + 1;
    expect(await store.claim("c", t + MINUTE)).toBe(true);
    expect(await store.claim("b", t + MINUTE)).toBe(false);
  });
});

describe("verifyPayPal: 64 KB body cap", () => {
  it("is 64 KB", () => {
    expect(MAX_WEBHOOK_BODY_BYTES).toBe(64 * 1024);
  });

  it("refuses a larger body before any other work: no CRC, no certificate fetch", async () => {
    const body = JSON.stringify({ ...event, pad: "x".repeat(MAX_WEBHOOK_BODY_BYTES) });
    const s = signedAt(T0, { body });
    expect(await verifierAt().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "BODY_TOO_LARGE",
      crc32: null,
      retryable: false,
    });
    expect(certFetches).toBe(0);
  });

  it("verifies a body of exactly 64 KB", async () => {
    const prefix = JSON.stringify({ ...event, pad: "" }).slice(0, -2);
    const body = `${prefix}${"x".repeat(MAX_WEBHOOK_BODY_BYTES - prefix.length - 2)}"}`;
    expect(Buffer.byteLength(body)).toBe(MAX_WEBHOOK_BODY_BYTES);
    const s = signedAt(T0, { body });
    expect(await verifierAt().verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
  });
});
