// verifyPayPal(raw, headers, webhookId) → 'self' | 'postback' | 'dev_mock' | false (IC-05).
//
// PayPal's documented self-verification (developer.paypal.com/api/rest/webhooks/rest), checked on
// 22 Oct 2026 against genuine PayPal-signed deliveries:
//   message   = `${paypal-transmission-id}|${paypal-transmission-time}|${webhookId}|${crc32(raw body)}`
//   crc32     = unsigned decimal CRC-32 of the raw bytes (never a re-serialized body)
//   signature = base64 `paypal-transmission-sig`, RSA-SHA256 (PKCS#1 v1.5) with the public key of the
//               certificate at `paypal-cert-url`; `paypal-auth-algo` must be SHA256withRSA.
// Simulator ("mock") events are signed with the literal webhook id `WEBHOOK_ID`; we accept them
// only when dev mocks are switched on (PP_DEV_MOCKS=1, never on fs-judge) and label them 'dev_mock'.
//
// Certificate fetches are PayPal calls like any other: they take a token from the injected limiter
// (purpose `webhooks.cert`, background priority), are written to `paypal_calls` by the injected
// recorder, and a 429 opens the circuit. Before that, local budgets decide whether an unauthenticated
// request may make us fetch at all (security review finding 2). In order:
//   0. One hard cap over everything: at most 3 certificate fetches in any 60 minutes (a sliding
//      window, `totalPerHour`), of any id, known or not, prewarm included (S3.6.7 "cert fetches: at
//      most 3 an hour"; plan: 1,000 forged deliveries cost at most 3). Nothing below adds to it.
//   1. Known certificates never need a fetch: a certificate that signed a verified delivery (or was
//      pre-warmed, or is pinned with `knownCertIds`) is kept as last-known-good, outside the cache's
//      TTL and LRU, for as long as the process lives. Its validity is still checked on every use.
//   2. Known ids that are not loaded yet (pinned with `knownCertIds` / PP_CERT_ALLOW, pre-warmed, or
//      seen before a restart) may make 2 fetches in any hour (`knownPerHour`), and those are held back
//      out of the 3: an unknown id may fetch only while one stays free for each known id not loaded
//      yet. They go first, without the per-IP budget, so neither a flood of unknown ids nor one that
//      shares PayPal's client key (no X-Forwarded-For, a miscounted proxy hop) can keep them out; once
//      their 2 are spent they go on as below.
//   3. Per client IP (IPv6 by /64, ./client-ip.ts), 2 fetches an hour. One address cannot drain the
//      global budget; requests with no address share one budget.
//   4. Shared, by cert id: ids with PayPal's shape (`CERT-360caa42-…`, every PayPal cert id since
//      2015) have their own 2 an hour; any other well-formed id shares 1 an hour (PayPal-shaped and
//      known ids may use it too).
//      Every local use is given back when the limiter refuses the fetch (nothing was sent).
// A delivery refused by any budget is CERT_FETCH_THROTTLED and retryable: the route answers 503 and
// PayPal retries (25 times over 3 days), so a flood delays a genuine delivery but cannot make us
// call it forged. The bound, for a burst of forged deliveries of any size and whatever is pinned: at
// most 3 certificate fetches, and no other PayPal call; sustained, at most 3 in any 60 minutes.
// Starvation: a sustained flood can keep spending the shared buckets, so a genuine certificate nobody
// has verified yet (fresh deploy, PayPal's yearly rotation) may wait while the flood lasts. Pin the
// current and the next cert id in PP_CERT_ALLOW: pinned ids draw on the fetches held back for them; an
// id that becomes known only after a flood spent the hour's 3 waits for the hour like any other. health()
// raises CERT_FETCH_THROTTLED once throttling persists (more than 5 in 15 minutes by default). A fetch
// is charged before its status is known, 404s included: charging only 200s would let a flood of random
// PayPal-shaped ids (all 404) fetch without bound, since any budget that admits a fetch must be one a
// 404 can spend.
//
// Expired certificates. PayPal rotates its signing certificate yearly with a few weeks of overlap
// (sandbox: …ab66f33d to 7 Mar 2025, …90621ecd to 1 Mar 2026, …bf9ab596 from 27 Jan 2026 to 26 Jan
// 2027, which signed real sandbox deliveries on 19 Oct 2026). If PayPal ever signs with an expired
// certificate, a hard reject would 400 every real delivery. But the key behind an expired certificate
// is the one we should trust least, so such a delivery is never 'self', and one delivery PayPal
// confirmed never vouches for another (security review, MEDIUM). `expiredCertPolicy` decides, and only
// for deliveries whose signature verifies under that (allowlisted, PayPal-served) certificate:
//   - 'postback' (default): each delivery is confirmed on its own. Its transmission id is claimed
//     first (a replayed copy costs nothing), then PayPal is asked about this transmission (one call,
//     6 s deadline, at most `expiredCertPostbacksPerHour` such calls). SUCCESS: accepted as 'postback'.
//     FAILURE: rejected (400), the id stays claimed. ERROR, TIMEOUT or no budget left: retryable
//     (503), the id is released so PayPal's retry is judged afresh. Nothing is cached per certificate
//     and nothing is shared between concurrent deliveries.
//   - 'reject': the strict behaviour (400).
// Every accepted one carries certWarning CERT_EXPIRED, which webhookApplyRule
// (apps/api/src/webhooks/apply.ts) turns into "fresh GET from PayPal before any state change", for a
// PAYOUTS-ITEM.SUCCEEDED too: state comes from PayPal's GET, never from an expired-certificate body.
// Simulator events stay 'dev_mock' (labelled CERT_EXPIRED, no postback: PayPal answers FAILURE for them).
// Every such delivery is logged and counted; health() turns degraded, for /readyz and /ops.
//
// Postback (`POST /v1/notifications/verify-webhook-signature`) otherwise runs only when asked and only
// after a successful self-verification, so a forged request can never make us spend a PayPal call.
// It is bounded to one attempt under a 6 s deadline. The webhook route does not ask for it.
//
// Freshness and replay (./transmission.ts): bodies over 64 KB, malformed transmission ids and
// transmission times more than 5 minutes from our (injectable) clock are refused before any other
// work; after the signature verifies, the transmission id is recorded in the injected store and a
// repeat is refused (TRANSMISSION_REPLAYED). Event-id dedupe is the route's, and separate. A claim
// that reports an error may still have committed, so the delivery is answered 503 and that claim's own
// record is released (by its claim token, never a concurrent copy's); a release that fails is retried
// once, then raised in health() as TRANSMISSION_RELEASE_FAILED.
//
// `retryable` on a refusal means "could not be checked now" (fetch budget, limiter, PayPal's cert host
// down, replay store down): the route answers 503 so PayPal retries, instead of a 4xx verdict.

import { randomUUID, verify as rsaVerify, type X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { isPayPalHost, PAYPAL_API_HOSTS, PAYPAL_CERT_SUBJECTS, type PayPalEnv } from "../env.js";
import { PayPalConfigError } from "../errors.js";
import type { PayPalLimiter } from "../limiter.js";
import { type CallOutcome, type PayPalCallRecorder, recordSafely } from "../recorder.js";
import {
  type CallPriority,
  defaultFetch,
  type FetchLike,
  type HeadersLike,
  type LoggerLike,
  readHeader,
} from "../types.js";
import { isTimeoutError } from "../util.js";
import { CERT_ID_PATTERN, checkCertUrl } from "./cert-url.js";
import {
  type CertCache,
  checkCertValidity,
  checkLeafProperties,
  createMemoryCertCache,
  type LoadedCert,
  parsePemChain,
} from "./certs.js";
import { clientIpKey } from "./client-ip.js";
import { POSTBACK_DEADLINE_MS, postbackWithDeadline } from "./postback.js";
import {
  createMemoryTransmissionStore,
  MAX_TRANSMISSION_SKEW_MS,
  parseTransmissionTime,
  TRANSMISSION_ID_PATTERN,
  TRANSMISSION_RETENTION_MARGIN_MS,
  type TransmissionStore,
} from "./transmission.js";

export {
  createMemoryTransmissionStore,
  MAX_TRANSMISSION_SKEW_MS,
  parseTransmissionTime,
  TRANSMISSION_ID_PATTERN,
  type TransmissionStore,
};

/** The webhook id PayPal's simulator signs with. */
export const MOCK_WEBHOOK_ID = "WEBHOOK_ID";

/** PayPal webhook events are a few KB; larger bodies are refused before any work (plan: 64 KB cap). */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

/**
 * The shape of PayPal's own certificate ids: all 13 seen from 2015 to 2026, sandbox and live, start
 * `CERT-360caa42-` (e.g. CERT-360caa42-fca2a594-bf9ab596, CERT-360caa42-fca2a784-5edc0ebc).
 */
export const PAYPAL_CERT_ID_PATTERN = /^CERT-360caa42-[0-9a-f]{8}-[0-9a-f]{8}$/;

/** Certificate fetches allowed per hour. */
export interface CertFetchBudget {
  /**
   * Every certificate fetch, of any id, known or not, prewarm included: at most this many in any 60
   * minutes (a sliding window). S3.6.7 "cert fetches: at most 3 an hour"; plan: 1,000 forged
   * deliveries cost at most 3.
   */
  totalPerHour: number;
  /** Per client IP (IPv6 by /64), checked before any global budget (a token bucket). */
  perIpPerHour: number;
  /** Unknown ids with PayPal's shape (PAYPAL_CERT_ID_PATTERN) (a token bucket). */
  expectedPerHour: number;
  /** Shared by every other unknown id, and PayPal-shaped ids once theirs is spent (a token bucket). */
  otherPerHour: number;
  /**
   * Known ids that are not loaded yet (pinned, pre-warmed, or seen before a restart): at most this many
   * fetches in any 60 minutes, without the per-IP budget, held back out of `totalPerHour`: an unknown
   * id may fetch only while one stays free for each known id not loaded yet (up to this many).
   */
  knownPerHour: number;
}

/**
 * 3 fetches in any hour, all ids together (S3.6.7); of those, unknown PayPal-shaped ids may use 2 and
 * other ids 1, and up to 2 are held back for known ids not loaded yet.
 */
export const DEFAULT_CERT_FETCH_BUDGET: Readonly<CertFetchBudget> = Object.freeze({
  totalPerHour: 3,
  perIpPerHour: 2,
  expectedPerHour: 2,
  otherPerHour: 1,
  knownPerHour: 2,
});

export type VerifyMode = "self" | "postback" | "dev_mock";

export type VerifyFailureReason =
  | "BODY_TOO_LARGE"
  | "MISSING_HEADER"
  /** A header PayPal always sends in a fixed shape does not have it (detail: which header). */
  | "MALFORMED_HEADER"
  | "TRANSMISSION_TIME_INVALID"
  /** `paypal-transmission-time` more than 5 minutes from our clock (detail: `skew ±N s`). */
  | "TRANSMISSION_TIME_OUT_OF_WINDOW"
  /** This transmission id was already accepted: a replayed copy of a genuine delivery. */
  | "TRANSMISSION_REPLAYED"
  /** The transmission store failed; retryable. */
  | "REPLAY_CHECK_FAILED"
  | "WEBHOOK_ID_MISSING"
  | "WEBHOOK_ID_IS_MOCK_LITERAL"
  | "UNSUPPORTED_ALGO"
  | "CERT_URL_REJECTED"
  | "BAD_SIGNATURE_ENCODING"
  | "EMPTY_BODY"
  | "CERT_FETCH_FAILED"
  | "CERT_FETCH_THROTTLED"
  | "CERT_PARSE_FAILED"
  | "CERT_NOT_YET_VALID"
  /** The signature verifies, but with a certificate past its validity (see expiredCertPolicy). */
  | "CERT_EXPIRED"
  | "CERT_KEY_UNSUPPORTED"
  | "CERT_IS_CA"
  | "CERT_SUBJECT_MISMATCH"
  | "CERT_UNTRUSTED"
  | "SIGNATURE_MISMATCH";

export type PostbackResult = "SUCCESS" | "FAILURE" | "ERROR";

export interface PostbackInput {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  /** The raw event body, spliced in unchanged. */
  rawEvent: string;
}

/** Ask PayPal about one delivery. `signal` carries the caller's deadline. */
export type PostbackFn = (
  input: PostbackInput,
  options?: { signal?: AbortSignal },
) => Promise<PostbackResult>;

/**
 * What to do with a delivery whose signature verifies under an expired PayPal certificate. There is no
 * 'accept': an expired certificate is never trusted on our own signature check alone.
 */
export type ExpiredCertPolicy = "reject" | "postback";

const EXPIRED_CERT_POLICIES: readonly ExpiredCertPolicy[] = ["reject", "postback"];

/**
 * Set on a delivery accepted although its certificate had expired: processWebhook must take state from
 * a fresh GET, never from the body (webhookApplyRule). Stored in `webhook_events.delivery`.
 */
export type CertWarning = "CERT_EXPIRED";

/** Default for `expiredCertPostbacksPerHour`. */
export const DEFAULT_EXPIRED_CERT_POSTBACKS_PER_HOUR = 20;

export interface VerifyOutcome {
  mode: VerifyMode | false;
  reason: VerifyFailureReason | null;
  /** Non-secret detail for logs (which header, why a URL was refused, HTTP status of a cert fetch). */
  detail: string | null;
  /**
   * True when the delivery could not be checked now and may pass later (budget, limiter, PayPal's
   * certificate host, the transmission store): answer 503 so PayPal retries. False for verdicts.
   */
  retryable: boolean;
  /** `paypal-transmission-id` when it has PayPal's shape; null otherwise. */
  transmissionId: string | null;
  certUrl: string | null;
  crc32: number | null;
  /** Postback answer; null when none was made. */
  postback: PostbackResult | "TIMEOUT" | "SKIPPED" | null;
  certSource: "cache" | "network" | null;
  /** Set when the delivery was accepted although PayPal's certificate had expired. */
  certWarning: CertWarning | null;
}

export interface VerifyOptions {
  /** Also ask PayPal (one call, bounded). `true` uses the verifier's configured postback function. */
  postback?: boolean | PostbackFn;
  /**
   * The requesting client's address, for the per-IP certificate-fetch budget (IPv6 counted by /64).
   * The webhook route always passes it (null when unknown: all such requests share one budget);
   * leave it out only for internal callers.
   */
  clientIp?: string | null;
}

export type RawBody = Uint8Array | ArrayBuffer | string;

export interface WebhookVerifierConfig {
  env?: PayPalEnv;
  /** Hosts allowed in `paypal-cert-url`. Default: the env's API hosts. Each must be a paypal.com host. */
  certHosts?: readonly string[];
  /** Expected certificate subject (SAN dNSName). Default: messageverificationcerts[.sandbox].paypal.com. */
  certSubjects?: readonly string[];
  /** PEM certificates the leaf must chain to. Off by default (trust comes from TLS to PayPal). */
  trustAnchors?: readonly string[];
  /** Accept simulator events signed with the literal `WEBHOOK_ID`, labelled 'dev_mock'. Dev only. */
  devMocks?: boolean;
  postback?: PostbackFn;
  /** Overall deadline for one postback, limiter wait and token fetch included (default 6 s). */
  postbackDeadlineMs?: number;
  /** See the header comment. Default 'postback' (which rejects when no postback is configured). */
  expiredCertPolicy?: ExpiredCertPolicy;
  /**
   * Under 'postback': PayPal calls allowed per hour to confirm expired-certificate deliveries, one per
   * delivery (default 20). Beyond it such a delivery is retryable (503), so a leaked expired key cannot
   * spend our PayPal budget.
   */
  expiredCertPostbacksPerHour?: number;
  /** The shared limiter: certificate fetches count toward the 40/min budget and open the circuit on a 429. */
  limiter?: PayPalLimiter;
  /** Writes each certificate fetch to `paypal_calls`, like every other PayPal call. */
  recorder?: PayPalCallRecorder;
  /** Limiter lane for certificate fetches (default background). */
  certFetchPriority?: CallPriority;
  fetch?: FetchLike;
  /** Our clock: certificate validity, the 5-minute freshness window and every budget use it. */
  now?: () => number;
  /** Records accepted transmission ids (replay tracking). Default: in memory, per verifier. */
  transmissionStore?: TransmissionStore;
  /** Bodies above this are refused before any work (default 64 KB). */
  maxBodyBytes?: number;
  certCache?: CertCache;
  certFetchTimeoutMs?: number;
  maxCertBytes?: number;
  /** Certificate-fetch budgets (see the header comment); unset fields keep DEFAULT_CERT_FETCH_BUDGET. */
  certFetchBudget?: Partial<CertFetchBudget>;
  /** Ids with PayPal's own shape get their own global budget. Default PAYPAL_CERT_ID_PATTERN. */
  expectedCertIdPattern?: RegExp;
  /**
   * Cert ids trusted to be PayPal's before any delivery (e.g. from `PP_CERT_ALLOW` after spike S5):
   * they get the reserved budget and, once loaded, stay as last-known-good. Default none.
   */
  knownCertIds?: readonly string[];
  /** How long a failed cert URL is not retried. */
  failedCertRetryMs?: number;
  /** Window of the health() counters (default 15 min). */
  healthWindowMs?: number;
  /**
   * health() raises CERT_FETCH_THROTTLED when more than `threshold` deliveries were throttled within
   * `windowMs` (default more than 5 in 15 min; the window is capped at healthWindowMs). Fewer are
   * counted but not a problem: PayPal retries a 503.
   */
  certFetchThrottleAlert?: { threshold?: number; windowMs?: number };
  /** health() turns degraded when the signing certificate has fewer days left than this (default 14). */
  certExpiryWarningDays?: number;
  logger?: LoggerLike;
}

export interface PrewarmResult {
  certUrl: string;
  ok: boolean;
  source: "cache" | "network" | null;
  reason: VerifyFailureReason | null;
  detail: string | null;
  validTo: string | null;
}

/** Machine-readable codes for health() problems (one per kind of problem). */
export type WebhookVerifierAlert =
  /** Throttled certificate fetches persist: a flood may be delaying a certificate PayPal has not used before. */
  | "CERT_FETCH_THROTTLED"
  | "SIGNED_WITH_EXPIRED_CERT"
  | "KNOWN_CERT_FETCH_FAILED"
  | "SIGNING_CERT_EXPIRED"
  | "SIGNING_CERT_EXPIRING"
  /**
   * A transmission id could not be released (twice): PayPal's retry of that delivery is refused as a
   * replay until its 5-minute window closes, and only catch-up recovers the event.
   */
  | "TRANSMISSION_RELEASE_FAILED";

/** Verification health for `/readyz` (report it in the body; never fail readiness on it) and `/ops`. */
export interface WebhookVerifierHealth {
  status: "ok" | "degraded";
  /** Plain-language problems, empty when ok. */
  problems: string[];
  /** The codes of those problems, in the same order of kinds, empty when ok. */
  alerts: WebhookVerifierAlert[];
  windowMs: number;
  /** Deliveries accepted in the window. */
  verified: number;
  /** Rejections in the window, by reason (forged junk lands here too). */
  rejected: Partial<Record<VerifyFailureReason, number>>;
  /**
   * Deliveries answered 503 because a certificate fetch was throttled, within `windowMs` of the
   * alert (at most the health window); CERT_FETCH_THROTTLED is raised when `count` exceeds `threshold`.
   */
  certFetchThrottled: { count: number; threshold: number; windowMs: number };
  /** Deliveries whose signature verified under an expired PayPal certificate, accepted or not. */
  signedWithExpiredCert: number;
  /** Of those, accepted under expiredCertPolicy (each confirmed by its own postback). */
  acceptedWithExpiredCert: number;
  expiredCertPolicy: ExpiredCertPolicy;
  lastVerifiedAt: string | null;
  /** Certificate of the most recent accepted delivery. */
  signingCert: { certUrl: string; validTo: string; daysLeft: number } | null;
  certsCached: number;
  /** Cert ids known to be PayPal's: pinned, pre-warmed or seen on a verified delivery. */
  knownCertIds: number;
  /** Of those, loaded and kept as last-known-good (never re-fetched). */
  lastKnownGoodCerts: number;
}

export interface PayPalWebhookVerifier {
  verifyPayPal(
    raw: RawBody,
    headers: HeadersLike,
    webhookId: string,
    opts?: VerifyOptions,
  ): Promise<VerifyMode | false>;
  verifyDetailed(
    raw: RawBody,
    headers: HeadersLike,
    webhookId: string,
    opts?: VerifyOptions,
  ): Promise<VerifyOutcome>;
  /**
   * Fetch and cache certificates that signed stored, verified events (call at boot or from
   * warmCaches with the newest `paypal-cert-url` on file). They are also given the reserved fetch slot.
   */
  prewarm(certUrls: readonly string[]): Promise<PrewarmResult[]>;
  /**
   * Forget an accepted transmission id. The route calls it when it could not store the event (or
   * gave up waiting for verification), so PayPal's retry of that transmission is judged afresh. Never throws.
   */
  releaseTransmission(transmissionId: string): Promise<void>;
  health(): WebhookVerifierHealth;
  /** Number of cached certificates (for /ops). */
  cachedCerts(): number;
}

type LoadResult =
  | { ok: true; cert: LoadedCert; source: "cache" | "network" }
  | {
      ok: false;
      reason: "CERT_FETCH_FAILED" | "CERT_FETCH_THROTTLED" | "CERT_PARSE_FAILED";
      detail: string | null;
      /** Could pass later: budget, limiter, timeout, network, PayPal 5xx or 429. Not: 404, junk, too large. */
      retryable: boolean;
    };

type Mark =
  | { at: number; kind: "verified" | "signed_expired" | "accepted_expired" | "release_failed" }
  | { at: number; kind: "rejected"; reason: VerifyFailureReason }
  | { at: number; kind: "known_fetch_failed"; certUrl: string; why: string };

const SIGNATURE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DAY_MS = 86_400_000;
const MAX_TRACKED = 64;
const MAX_FAILED_URLS = 256;
/** Last-known-good certificates kept (PayPal overlaps at most two signing certificates at a time). */
const MAX_LAST_GOOD = 8;
/** Client addresses with their own fetch budget; beyond that the oldest are forgotten. */
const MAX_IP_BUDGETS = 4_096;
const HOUR_MS = 3_600_000;
const MAX_MARKS = 2_000;
/**
 * Throttle times kept for the CERT_FETCH_THROTTLED alert, apart from the marks, so a flood of other
 * junk cannot push them out of the window.
 */
const MAX_THROTTLE_TIMES = 4_096;
/** Prewarm fetches at most this many URLs per call. */
const MAX_PREWARM = 4;

function toBytes(raw: RawBody): Uint8Array {
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(raw);
}

interface Bucket {
  /**
   * Take one use, leaving at least `leave` (default 0) for others. Returns how to give that use back
   * (when it was taken but not spent: the fetch never happened), or null when refused.
   */
  take(leave?: number): (() => void) | null;
}

/** A continuously refilled token bucket holding at most `perHour` tokens, starting full. */
function tokenBucket(perHour: number, now: () => number): Bucket {
  let tokens = perHour;
  let at = now();
  const refill = () => {
    const t = now();
    tokens = Math.min(perHour, tokens + ((t - at) * perHour) / HOUR_MS);
    at = t;
  };
  return {
    take(leave = 0) {
      refill();
      if (tokens - leave < 1) return null;
      tokens -= 1;
      let returned = false;
      return () => {
        if (returned) return;
        returned = true;
        refill();
        tokens = Math.min(perHour, tokens + 1);
      };
    },
  };
}

/**
 * At most `limit` uses in any hour, exactly: a use counts for one hour after it was taken (a sliding
 * window, so no span of 60 minutes, one across the top of the hour included, holds more). Memory is
 * at most `limit` timestamps.
 */
function hourWindow(limit: number, now: () => number): Bucket & { left(): number } {
  const uses: number[] = [];
  let latest = Number.NEGATIVE_INFINITY;
  /** Never runs backwards, so `uses` stays in order; a clock stepped back only keeps uses counted longer. */
  const expire = () => {
    latest = Math.max(latest, now());
    while (uses.length > 0 && latest - (uses[0] ?? latest) >= HOUR_MS) uses.shift();
    return latest;
  };
  return {
    left() {
      expire();
      return limit - uses.length;
    },
    take(leave = 0) {
      const t = expire();
      if (uses.length + 1 + leave > limit) return null;
      uses.push(t);
      let returned = false;
      return () => {
        if (returned) return;
        returned = true;
        const index = uses.indexOf(t);
        if (index !== -1) uses.splice(index, 1);
      };
    },
  };
}

/** Insert or refresh a key in a Map used as an LRU, evicting the oldest entries beyond `max`. */
function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createPayPalWebhookVerifier(config: WebhookVerifierConfig = {}): PayPalWebhookVerifier {
  const env = config.env ?? "sandbox";
  const certHosts = [...(config.certHosts ?? PAYPAL_API_HOSTS[env])];
  const bad = certHosts.filter((h) => !isPayPalHost(h));
  if (bad.length > 0) {
    throw new PayPalConfigError("INVALID_HOST", "certificate hosts must be paypal.com hosts");
  }
  const subjects = config.certSubjects ?? PAYPAL_CERT_SUBJECTS[env];
  const anchors = config.trustAnchors?.flatMap((pem) => parsePemChain(pem));
  const fetchImpl = config.fetch ?? defaultFetch;
  const now = config.now ?? Date.now;
  const transmissions = config.transmissionStore ?? createMemoryTransmissionStore({ now });
  const maxBodyBytes = config.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  const cache = config.certCache ?? createMemoryCertCache({ now });
  const fetchTimeoutMs = config.certFetchTimeoutMs ?? 5_000;
  const maxCertBytes = config.maxCertBytes ?? 64 * 1024;
  const failedRetryMs = config.failedCertRetryMs ?? 60_000;
  const devMocks = config.devMocks === true;
  const expiredPolicy = config.expiredCertPolicy ?? "postback";
  if (!EXPIRED_CERT_POLICIES.includes(expiredPolicy)) {
    throw new PayPalConfigError("INVALID_VALUE", "expiredCertPolicy must be 'reject' or 'postback'");
  }
  const expiredPostback = expiredPolicy === "postback" ? config.postback : undefined;
  const postbackDeadlineMs = config.postbackDeadlineMs ?? POSTBACK_DEADLINE_MS;
  const certPriority = config.certFetchPriority ?? "background";
  const healthWindowMs = config.healthWindowMs ?? 15 * 60_000;
  const throttleThreshold = config.certFetchThrottleAlert?.threshold ?? 5;
  const throttleWindowMs = Math.min(
    config.certFetchThrottleAlert?.windowMs ?? healthWindowMs,
    healthWindowMs,
  );
  const warnDays = config.certExpiryWarningDays ?? 14;
  const { limiter, recorder, logger } = config;
  const leafOptions = (at: number) => ({ at, subjects, ...(anchors ? { trustAnchors: anchors } : {}) });

  const budget: CertFetchBudget = { ...DEFAULT_CERT_FETCH_BUDGET, ...config.certFetchBudget };
  const expectedIds = config.expectedCertIdPattern ?? PAYPAL_CERT_ID_PATTERN;
  /** Every certificate fetch, of any id: at most totalPerHour in any 60 minutes. */
  const totalWindow = hourWindow(budget.totalPerHour, now);
  /** Fetches of known ids that are not loaded yet, held back out of totalWindow. */
  const knownWindow = hourWindow(budget.knownPerHour, now);
  const expectedBucket = tokenBucket(budget.expectedPerHour, now);
  const otherBucket = tokenBucket(budget.otherPerHour, now);
  const ipBuckets = new Map<string, Bucket>();
  // Everything below is keyed by cert id: api.sandbox and api-m.sandbox serve the same certificates.
  const inflight = new Map<string, Promise<LoadResult>>();
  /** Cert ids whose fetch failed: until when they are not retried, and whether that failure was retryable. */
  const failedUntil = new Map<string, { until: number; retryable: boolean }>();
  /** Cert ids known to be PayPal's: pinned, pre-warmed from stored deliveries, or seen on a verified one. */
  const knownGood = new Map<string, number>();
  for (const id of config.knownCertIds ?? []) {
    if (!CERT_ID_PATTERN.test(id))
      throw new PayPalConfigError("INVALID_VALUE", "knownCertIds must be PayPal cert ids");
    knownGood.set(id, 0);
  }
  /** Certificates of known ids, kept outside the cache's TTL and LRU: never fetched twice. */
  const lastGood = new Map<string, LoadedCert>();
  /**
   * PayPal calls left for confirming expired-certificate deliveries, one per delivery. Deliberately
   * nothing else about expired certificates is remembered: no per-certificate confirmation, no shared
   * answer in flight. Each delivery is judged on its own.
   */
  const expiredPostbacks = tokenBucket(
    config.expiredCertPostbacksPerHour ?? DEFAULT_EXPIRED_CERT_POSTBACKS_PER_HOUR,
    now,
  );
  const marks: Mark[] = [];
  const throttleTimes: number[] = [];
  let lastVerified: { at: number; certUrl: string; validTo: number } | null = null;

  const mark = (m: Mark) => {
    marks.push(m);
    if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  };

  /**
   * Forget a recorded transmission id (with `claimToken`, only the record that claim wrote). A failed
   * release is retried once; if that fails too, it is logged and raised in health(), because PayPal's
   * retry of that delivery will then be refused as a replay until its window closes. Never throws.
   */
  async function releaseQuietly(transmissionId: string, claimToken?: string): Promise<void> {
    let failure: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await transmissions.release(transmissionId, claimToken);
        return;
      } catch (err) {
        failure = err;
      }
    }
    mark({ at: now(), kind: "release_failed" });
    logger?.error?.(
      { error: failure instanceof Error ? failure.message : String(failure), transmissionId, attempts: 2 },
      "releasing a webhook transmission id failed; PayPal's retry of it is refused as a replay until its window closes",
    );
  }

  async function fetchCert(url: URL): Promise<LoadResult> {
    let ticket: string | null = null;
    if (limiter) {
      try {
        const gate = await limiter.take({ purpose: "webhooks.cert", priority: certPriority });
        if (!gate.ok) {
          return {
            ok: false,
            reason: "CERT_FETCH_THROTTLED",
            detail: `limiter ${gate.reason}`,
            retryable: true,
          };
        }
        ticket = gate.ticket ?? null;
      } catch (err) {
        logger?.error?.(
          { error: err instanceof Error ? err.message : String(err) },
          "limiter.take failed for a webhook certificate fetch",
        );
        return { ok: false, reason: "CERT_FETCH_THROTTLED", detail: "limiter error", retryable: true };
      }
    }
    const startedAt = now();
    const record = (status: number, outcome: CallOutcome, debugId: string | null) =>
      recordSafely(
        recorder,
        {
          at: new Date(startedAt),
          purpose: "webhooks.cert",
          priority: certPriority,
          method: "GET",
          path: url.pathname,
          status,
          outcome,
          debugId,
          requestId: null,
          ms: now() - startedAt,
          attempt: 1,
          ticket,
        },
        logger,
      );
    let res: Response;
    try {
      res = await fetchImpl(url.href, {
        method: "GET",
        headers: { accept: "application/x-pem-file, text/plain;q=0.9, */*;q=0.1" },
        redirect: "error",
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch (err) {
      const timedOut = isTimeoutError(err);
      await record(0, timedOut ? "timeout" : "network_error", null);
      return {
        ok: false,
        reason: "CERT_FETCH_FAILED",
        detail: timedOut ? "timeout" : "network",
        retryable: true,
      };
    }
    await record(res.status, res.status === 200 ? "ok" : "http_error", res.headers.get("paypal-debug-id"));
    if (res.status === 429) {
      try {
        await limiter?.reportRateLimited?.(new Date(now()));
      } catch (err) {
        logger?.error?.(
          { error: err instanceof Error ? err.message : String(err) },
          "limiter.reportRateLimited failed",
        );
      }
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        reason: "CERT_FETCH_FAILED",
        detail: `HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxCertBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: "too large", retryable: false };
    }
    const text = await res.text().catch(() => null);
    if (text === null) {
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: "body read failed", retryable: true };
    }
    if (text.length > maxCertBytes) {
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: "too large", retryable: false };
    }
    let chain: X509Certificate[];
    try {
      chain = parsePemChain(text);
    } catch {
      return { ok: false, reason: "CERT_PARSE_FAILED", detail: null, retryable: false };
    }
    const [leaf, ...intermediates] = chain;
    if (!leaf) return { ok: false, reason: "CERT_PARSE_FAILED", detail: null, retryable: false };
    return { ok: true, cert: { leaf, intermediates, fetchedAt: now() }, source: "network" };
  }

  /** Keep a certificate of a known id for good (bounded), and remember the id. */
  function rememberKnown(certId: string, cert: LoadedCert): void {
    touch(knownGood, certId, now(), MAX_TRACKED);
    touch(lastGood, certId, cert, MAX_LAST_GOOD);
  }

  function ipBucket(clientIp: string | null): Bucket {
    const key = clientIpKey(clientIp);
    const bucket = ipBuckets.get(key) ?? tokenBucket(budget.perIpPerHour, now);
    touch(ipBuckets, key, bucket, MAX_IP_BUDGETS);
    return bucket;
  }

  /**
   * How many of the hour's fetches an unknown id must leave free: one per known id not loaded yet
   * (pinned, pre-warmed, or one whose certificate was dropped), at most what knownPerHour has left.
   */
  function heldBackForKnown(): number {
    let unloaded = 0;
    for (const id of knownGood.keys()) if (!lastGood.has(id)) unloaded += 1;
    return unloaded === 0 ? 0 : Math.min(unloaded, knownWindow.left());
  }

  const throttled = (detail: string): Promise<LoadResult> =>
    Promise.resolve({ ok: false, reason: "CERT_FETCH_THROTTLED", detail, retryable: true });

  /**
   * `clientIp` undefined: an internal caller (prewarm), no per-IP budget. A string or null: a request
   * from outside, budgeted per address (null = unknown, one shared budget).
   */
  function loadCert(url: URL, certId: string, clientIp?: string | null): Promise<LoadResult> {
    const kept = lastGood.get(certId);
    if (kept) return Promise.resolve({ ok: true, cert: kept, source: "cache" });
    const hit = cache.get(certId);
    if (hit) {
      if (knownGood.has(certId)) rememberKnown(certId, hit);
      return Promise.resolve({ ok: true, cert: hit, source: "cache" });
    }
    const pending = inflight.get(certId);
    if (pending) return pending;
    const blocked = failedUntil.get(certId);
    if (blocked !== undefined && blocked.until > now()) {
      return Promise.resolve({
        ok: false,
        reason: "CERT_FETCH_FAILED",
        detail: "recently failed",
        retryable: blocked.retryable,
      });
    }
    // Local budgets come first, so forged requests never reach the shared limiter. Every fetch, of any
    // id, prewarm included, spends one of totalPerHour (3) in any 60 minutes: nothing goes on top of it.
    // A known id (pinned, pre-warmed, seen) takes one of knownPerHour first, without the per-IP budget: a
    // flood that shares PayPal's client key (no X-Forwarded-For, a miscounted proxy hop) cannot keep it
    // out. Every other fetch, and a known id once knownPerHour is spent, takes a per-IP token, then a
    // shared one, then one of the hour's total that leaves enough free for the known ids not loaded yet
    // (heldBackForKnown), so a flood of unknown ids cannot spend what a pinned certificate needs.
    const charges: (() => void)[] = [];
    const charge = (bucket: Bucket, leave = 0) => {
      const giveBack = bucket.take(leave);
      if (giveBack) charges.push(giveBack);
      return giveBack !== null;
    };
    const giveAllBack = () => {
      for (const giveBack of charges.splice(0)) giveBack();
    };
    const known = knownGood.has(certId);
    if (known && charge(knownWindow)) {
      if (!charge(totalWindow)) {
        giveAllBack();
        return throttled("global budget");
      }
    } else {
      const perIp = clientIp === undefined ? null : ipBucket(clientIp);
      if (perIp && !charge(perIp)) return throttled("per-ip budget");
      const shared = known || expectedIds.test(certId) ? [expectedBucket, otherBucket] : [otherBucket];
      if (!shared.some((bucket) => charge(bucket)) || !charge(totalWindow, heldBackForKnown())) {
        giveAllBack();
        return throttled("global budget");
      }
    }
    const run = fetchCert(url)
      .then((result) => {
        if (result.ok) {
          cache.set(certId, result.cert);
          failedUntil.delete(certId);
          if (knownGood.has(certId)) rememberKnown(certId, result.cert);
        } else if (result.reason === "CERT_FETCH_THROTTLED") {
          // The limiter refused: nothing was fetched, so every local use is given back.
          giveAllBack();
        } else {
          touch(
            failedUntil,
            certId,
            { until: now() + failedRetryMs, retryable: result.retryable },
            MAX_FAILED_URLS,
          );
        }
        return result;
      })
      .finally(() => inflight.delete(certId));
    inflight.set(certId, run);
    return run;
  }

  async function verifyDetailed(
    raw: RawBody,
    headers: HeadersLike,
    webhookId: string,
    opts: VerifyOptions = {},
  ): Promise<VerifyOutcome> {
    const transmissionHeader = readHeader(headers, "paypal-transmission-id");
    const transmissionTime = readHeader(headers, "paypal-transmission-time");
    const transmissionSig = readHeader(headers, "paypal-transmission-sig");
    const certUrl = readHeader(headers, "paypal-cert-url");
    const authAlgo = readHeader(headers, "paypal-auth-algo");
    // Only an id with PayPal's shape is ever reported back (it becomes a key and a log field).
    const transmissionId =
      transmissionHeader !== null && TRANSMISSION_ID_PATTERN.test(transmissionHeader)
        ? transmissionHeader
        : null;
    let crc: number | null = null;
    let certSource: VerifyOutcome["certSource"] = null;
    const outcome = (
      fields: Pick<VerifyOutcome, "mode" | "reason" | "detail"> &
        Partial<Pick<VerifyOutcome, "postback" | "certWarning" | "retryable">>,
    ): VerifyOutcome => ({
      retryable: false,
      transmissionId,
      certUrl,
      crc32: crc,
      certSource,
      postback: null,
      certWarning: null,
      ...fields,
    });
    const fail = (
      reason: VerifyFailureReason,
      detail: string | null = null,
      extra: { postback?: VerifyOutcome["postback"]; retryable?: boolean } = {},
    ): VerifyOutcome => {
      const at = now();
      mark({ at, kind: "rejected", reason });
      if (reason === "CERT_FETCH_THROTTLED") {
        throttleTimes.push(at);
        if (throttleTimes.length > MAX_THROTTLE_TIMES)
          throttleTimes.splice(0, throttleTimes.length - MAX_THROTTLE_TIMES);
      }
      return outcome({
        mode: false,
        reason,
        detail,
        postback: extra.postback ?? null,
        retryable: extra.retryable ?? false,
      });
    };

    // Cheapest checks first: nothing below reads the body or touches the network until these pass.
    const bytes = toBytes(raw);
    if (bytes.length > maxBodyBytes) return fail("BODY_TOO_LARGE", `${bytes.length} bytes`);
    if (!transmissionHeader) return fail("MISSING_HEADER", "paypal-transmission-id");
    if (!transmissionTime) return fail("MISSING_HEADER", "paypal-transmission-time");
    if (!transmissionSig) return fail("MISSING_HEADER", "paypal-transmission-sig");
    if (!certUrl) return fail("MISSING_HEADER", "paypal-cert-url");
    if (!authAlgo) return fail("MISSING_HEADER", "paypal-auth-algo");
    if (!transmissionId) return fail("MALFORMED_HEADER", "paypal-transmission-id");
    if (!webhookId) return fail("WEBHOOK_ID_MISSING");
    if (webhookId === MOCK_WEBHOOK_ID && !devMocks) return fail("WEBHOOK_ID_IS_MOCK_LITERAL");
    if (authAlgo.toUpperCase() !== "SHA256WITHRSA") return fail("UNSUPPORTED_ALGO", authAlgo.slice(0, 40));

    const sentAt = parseTransmissionTime(transmissionTime);
    if (sentAt === null) return fail("TRANSMISSION_TIME_INVALID");
    const skew = sentAt - now();
    if (Math.abs(skew) > MAX_TRANSMISSION_SKEW_MS) {
      return fail(
        "TRANSMISSION_TIME_OUT_OF_WINDOW",
        `skew ${skew < 0 ? "-" : "+"}${Math.round(Math.abs(skew) / 1000)} s`,
      );
    }

    const urlCheck = checkCertUrl(certUrl, certHosts);
    if (!urlCheck.ok) return fail("CERT_URL_REJECTED", urlCheck.reason);
    const certKey = urlCheck.cacheKey;
    const certId = urlCheck.certId;

    const sigText = transmissionSig.trim();
    const signature = SIGNATURE_B64.test(sigText) ? Buffer.from(sigText, "base64") : null;
    if (!signature || signature.length < 128 || signature.length > 1024)
      return fail("BAD_SIGNATURE_ENCODING");

    if (bytes.length === 0) return fail("EMPTY_BODY");
    crc = crc32(bytes) >>> 0;

    const loaded = await loadCert(urlCheck.url, certId, opts.clientIp);
    if (!loaded.ok) {
      if (knownGood.has(certId)) {
        mark({
          at: now(),
          kind: "known_fetch_failed",
          certUrl: certKey,
          why: loaded.detail ? `${loaded.reason} (${loaded.detail})` : loaded.reason,
        });
      }
      return fail(loaded.reason, loaded.detail, { retryable: loaded.retryable });
    }
    certSource = loaded.source;
    const leaf = loaded.cert.leaf;
    const checkedAt = now();
    const property = checkLeafProperties(loaded.cert, leafOptions(checkedAt));
    if (property) return fail(property);
    const validity = checkCertValidity(leaf, checkedAt);
    if (validity === "CERT_NOT_YET_VALID") return fail(validity);

    const signedWith = (id: string) => {
      try {
        return rsaVerify(
          "sha256",
          Buffer.from(`${transmissionId}|${transmissionTime}|${id}|${crc}`, "utf8"),
          leaf.publicKey,
          signature,
        );
      } catch {
        return false;
      }
    };
    let signed: "self" | "dev_mock" | false = false;
    if (webhookId !== MOCK_WEBHOOK_ID && signedWith(webhookId)) signed = "self";
    else if (devMocks && signedWith(MOCK_WEBHOOK_ID)) signed = "dev_mock";
    if (signed === false) return fail("SIGNATURE_MISMATCH");

    const postbackInput = (): PostbackInput => ({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      webhookId,
      rawEvent: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"),
    });
    const askPayPal = (fn: PostbackFn) =>
      postbackWithDeadline(fn, postbackInput(), {
        deadlineMs: postbackDeadlineMs,
        ...(logger ? { logger } : {}),
      });

    const expired = validity === "CERT_EXPIRED";
    if (expired) {
      const validTo = leaf.validToDate.toISOString();
      mark({ at: now(), kind: "signed_expired" });
      logger?.warn?.(
        { certUrl: certKey, validTo, expiredCertPolicy: expiredPolicy, mode: signed, transmissionId },
        "paypal webhook signed with an expired certificate",
      );
      if (expiredPolicy === "reject") {
        return fail("CERT_EXPIRED", `signature valid; certificate expired ${validTo}; policy reject`);
      }
      if (signed === "self" && !expiredPostback) {
        return fail("CERT_EXPIRED", "signature valid; no postback configured to confirm it");
      }
    }

    // Signed by PayPal and fresh: record the transmission id, once. A repeat is a replayed copy. For an
    // expired certificate this comes before the postback, so a replayed copy costs no PayPal call.
    const claimToken = randomUUID();
    let firstTime: boolean;
    try {
      firstTime = await transmissions.claim(
        transmissionId,
        sentAt + MAX_TRANSMISSION_SKEW_MS + TRANSMISSION_RETENTION_MARGIN_MS,
        now(),
        claimToken,
      );
    } catch (err) {
      logger?.error?.(
        { error: err instanceof Error ? err.message : String(err), transmissionId },
        "recording a webhook transmission id failed",
      );
      // The claim may have committed anyway (a lost reply, a client timeout). Free it, or PayPal's retry
      // of this transmission would be refused as a replay with nothing stored; the token frees only
      // this claim's own record, never one a concurrent copy holds.
      await releaseQuietly(transmissionId, claimToken);
      return fail("REPLAY_CHECK_FAILED", "transmission store error", { retryable: true });
    }
    if (!firstTime) {
      logger?.warn?.({ transmissionId, certUrl: certKey }, "paypal webhook transmission replayed");
      return fail("TRANSMISSION_REPLAYED");
    }

    let mode: VerifyMode = signed;
    let postback: VerifyOutcome["postback"] = null;
    const certWarning: CertWarning | null = expired ? "CERT_EXPIRED" : null;
    if (expired && signed === "self" && expiredPostback) {
      // Never 'self' under an expired certificate: PayPal must confirm this very transmission. Nothing
      // is cached per certificate and nothing is shared, so no other delivery can lend it trust.
      if (expiredPostbacks.take() === null) {
        await releaseQuietly(transmissionId, claimToken);
        return fail("CERT_EXPIRED", "signature valid; expired-certificate postback budget used up", {
          retryable: true,
        });
      }
      const answer = await askPayPal(expiredPostback);
      if (answer !== "SUCCESS") {
        // FAILURE is PayPal's verdict on this transmission (keep its id: a copy is a replay). ERROR and
        // TIMEOUT only mean "not checked": free the id and answer 503 so PayPal's retry is judged afresh.
        const retryable = answer !== "FAILURE";
        if (retryable) await releaseQuietly(transmissionId, claimToken);
        return fail("CERT_EXPIRED", `signature valid; postback ${answer}`, { postback: answer, retryable });
      }
      postback = "SUCCESS";
      mode = "postback";
    }
    if (expired) mark({ at: now(), kind: "accepted_expired" });

    // Accepted. This certificate is one PayPal really signs with: keep it as last-known-good.
    rememberKnown(certId, loaded.cert);
    lastVerified = { at: now(), certUrl: certKey, validTo: leaf.validToDate.getTime() };
    mark({ at: now(), kind: "verified" });

    if (opts.postback && postback === null) {
      if (mode === "self") {
        const fn = typeof opts.postback === "function" ? opts.postback : config.postback;
        postback = fn ? await askPayPal(fn) : "SKIPPED";
      } else {
        // PayPal's postback always answers FAILURE for simulator events; do not spend a call.
        postback = "SKIPPED";
      }
    }
    return outcome({
      mode: postback === "SUCCESS" ? "postback" : mode,
      reason: null,
      detail: null,
      postback,
      certWarning,
    });
  }

  async function prewarm(certUrls: readonly string[]): Promise<PrewarmResult[]> {
    const results: PrewarmResult[] = [];
    for (const value of [...new Set(certUrls)].slice(0, MAX_PREWARM)) {
      const check = checkCertUrl(value, certHosts);
      if (!check.ok) {
        results.push({
          certUrl: value.slice(0, 200),
          ok: false,
          source: null,
          reason: "CERT_URL_REJECTED",
          detail: check.reason,
          validTo: null,
        });
        continue;
      }
      // These URLs signed stored, verified events, so their ids are known: the reserved budget applies.
      touch(knownGood, check.certId, now(), MAX_TRACKED);
      const loaded = await loadCert(check.url, check.certId);
      if (!loaded.ok) {
        results.push({
          certUrl: check.cacheKey,
          ok: false,
          source: null,
          reason: loaded.reason,
          detail: loaded.detail,
          validTo: null,
        });
        continue;
      }
      const at = now();
      const problem =
        checkLeafProperties(loaded.cert, leafOptions(at)) ?? checkCertValidity(loaded.cert.leaf, at);
      results.push({
        certUrl: check.cacheKey,
        ok: problem === null,
        source: loaded.source,
        reason: problem,
        detail: null,
        validTo: loaded.cert.leaf.validToDate.toISOString(),
      });
    }
    return results;
  }

  function health(): WebhookVerifierHealth {
    const t = now();
    const since = t - healthWindowMs;
    let stale = 0;
    while (stale < marks.length && (marks[stale]?.at ?? t) < since) stale += 1;
    if (stale > 0) marks.splice(0, stale);

    const rejected: Partial<Record<VerifyFailureReason, number>> = {};
    const fetchProblems = new Map<string, string>();
    let verified = 0;
    let signedExpired = 0;
    let acceptedExpired = 0;
    let releaseFailed = 0;
    for (const m of marks) {
      if (m.kind === "verified") verified += 1;
      else if (m.kind === "signed_expired") signedExpired += 1;
      else if (m.kind === "accepted_expired") acceptedExpired += 1;
      else if (m.kind === "release_failed") releaseFailed += 1;
      else if (m.kind === "rejected") rejected[m.reason] = (rejected[m.reason] ?? 0) + 1;
      else if (m.kind === "known_fetch_failed") fetchProblems.set(m.certUrl, m.why);
    }

    const minutes = Math.round(healthWindowMs / 60_000);
    const problems: string[] = [];
    const alerts: WebhookVerifierAlert[] = [];
    const problem = (alert: WebhookVerifierAlert, text: string) => {
      problems.push(text);
      if (!alerts.includes(alert)) alerts.push(alert);
    };
    let fresh = 0;
    while (fresh < throttleTimes.length && (throttleTimes[fresh] ?? t) <= t - throttleWindowMs) fresh += 1;
    if (fresh > 0) throttleTimes.splice(0, fresh);
    const throttledCount = throttleTimes.length;
    if (throttledCount > throttleThreshold) {
      problem(
        "CERT_FETCH_THROTTLED",
        `CERT_FETCH_THROTTLED: ${throttledCount} deliveries in the last ${Math.round(throttleWindowMs / 60_000)} min ` +
          "could not be checked because the certificate fetch budget was used up (answered 503; PayPal " +
          "retries). A flood of forged deliveries can delay a certificate PayPal has not used before: pin " +
          "PayPal's current and next cert ids in PP_CERT_ALLOW.",
      );
    }
    if (signedExpired > 0) {
      problem(
        "SIGNED_WITH_EXPIRED_CERT",
        `${signedExpired} PayPal ${signedExpired === 1 ? "delivery" : "deliveries"} in the last ${minutes} min ` +
          `signed with an expired certificate (expiredCertPolicy ${expiredPolicy}, ${acceptedExpired} accepted)`,
      );
    }
    for (const [url, why] of fetchProblems) {
      problem(
        "KNOWN_CERT_FETCH_FAILED",
        `could not fetch ${url}, a known PayPal signing certificate: ${why}`,
      );
    }
    if (releaseFailed > 0) {
      problem(
        "TRANSMISSION_RELEASE_FAILED",
        `${releaseFailed} webhook transmission ${releaseFailed === 1 ? "id" : "ids"} could not be released in the ` +
          `last ${minutes} min (the transmission store failed twice): PayPal's retry of ` +
          `${releaseFailed === 1 ? "that delivery" : "those deliveries"} is refused as a replay until its ` +
          "5-minute window closes; the next webhook catch-up pass recovers the event",
      );
    }
    let signingCert: WebhookVerifierHealth["signingCert"] = null;
    if (lastVerified) {
      const daysLeft = Math.floor((lastVerified.validTo - t) / DAY_MS);
      signingCert = {
        certUrl: lastVerified.certUrl,
        validTo: new Date(lastVerified.validTo).toISOString(),
        daysLeft,
      };
      if (lastVerified.validTo < t) {
        problem(
          "SIGNING_CERT_EXPIRED",
          `PayPal's signing certificate expired on ${isoDay(lastVerified.validTo)}`,
        );
      } else if (daysLeft < warnDays) {
        problem(
          "SIGNING_CERT_EXPIRING",
          `PayPal's signing certificate expires in ${daysLeft} days (${isoDay(lastVerified.validTo)})`,
        );
      }
    }
    return {
      status: problems.length > 0 ? "degraded" : "ok",
      problems,
      alerts,
      windowMs: healthWindowMs,
      verified,
      rejected,
      certFetchThrottled: { count: throttledCount, threshold: throttleThreshold, windowMs: throttleWindowMs },
      signedWithExpiredCert: signedExpired,
      acceptedWithExpiredCert: acceptedExpired,
      expiredCertPolicy: expiredPolicy,
      lastVerifiedAt: lastVerified ? new Date(lastVerified.at).toISOString() : null,
      signingCert,
      certsCached: cache.size,
      knownCertIds: knownGood.size,
      lastKnownGoodCerts: lastGood.size,
    };
  }

  return {
    verifyDetailed,
    async verifyPayPal(raw, headers, webhookId, opts) {
      return (await verifyDetailed(raw, headers, webhookId, opts)).mode;
    },
    prewarm,
    releaseTransmission: releaseQuietly,
    health,
    cachedCerts: () => cache.size,
  };
}

let defaultVerifier: PayPalWebhookVerifier | null = null;

/**
 * IC-05 `verifyPayPal(raw, headers, webhookId)`, on a process-wide sandbox verifier with a shared
 * certificate cache. It has no limiter, recorder or postback: production code uses
 * `createPayPalCore().verifyPayPal`, which has all three. Dev mocks are never accepted here; build a
 * verifier with `createPayPalWebhookVerifier({ devMocks: true })` for local simulator runs.
 */
export function verifyPayPal(
  raw: RawBody,
  headers: HeadersLike,
  webhookId: string,
  opts?: VerifyOptions,
): Promise<VerifyMode | false> {
  defaultVerifier ??= createPayPalWebhookVerifier();
  return defaultVerifier.verifyPayPal(raw, headers, webhookId, opts);
}
