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
// recorder, and a 429 opens the circuit. Before that, a local budget (6 new URLs a minute) keeps
// forged requests away from the shared limiter, with one extra slot a minute held back for URLs that
// already signed a verified delivery (or were pre-warmed from stored ones at boot).
//
// Expired certificates. PayPal rotates its signing certificate yearly with a few weeks of overlap
// (sandbox: …ab66f33d to 7 Mar 2025, …90621ecd to 1 Mar 2026, …bf9ab596 from 27 Jan 2026 to 26 Jan
// 2027, which signed real sandbox deliveries on 19 Oct 2026). If PayPal ever signs with an expired
// certificate, a hard reject would 400 every real delivery, so `expiredCertPolicy` decides, and only
// for deliveries whose signature verifies under that (allowlisted, PayPal-served) certificate:
//   - 'postback' (default): ask PayPal once per certificate (bounded, one call); on SUCCESS accept
//     ('postback'), remember the certificate for 24 h and accept later deliveries as 'self' with
//     certWarning CERT_EXPIRED_CONFIRMED. Otherwise reject (400, PayPal retries).
//   - 'accept': accept with certWarning CERT_EXPIRED_ACCEPTED. 'reject': the strict behaviour.
// Every such delivery is logged and counted; health() turns degraded, for /readyz and /ops.
//
// Postback (`POST /v1/notifications/verify-webhook-signature`) otherwise runs only when asked and only
// after a successful self-verification, so a forged request can never make us spend a PayPal call.
// It is bounded to one attempt under a 6 s deadline. The webhook route does not ask for it.
//
// Freshness and replay (./transmission.ts): bodies over 64 KB, malformed transmission ids and
// transmission times more than 5 minutes from our (injectable) clock are refused before any other
// work; after the signature verifies, the transmission id is recorded in the injected store and a
// repeat is refused (TRANSMISSION_REPLAYED). Event-id dedupe is the route's, and separate.
//
// `retryable` on a refusal means "could not be checked now" (fetch budget, limiter, PayPal's cert host
// down, replay store down): the route answers 503 so PayPal retries, instead of a 4xx verdict.

import { verify as rsaVerify, type X509Certificate } from "node:crypto";
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
import { checkCertUrl } from "./cert-url.js";
import {
  type CertCache,
  checkCertValidity,
  checkLeafProperties,
  createMemoryCertCache,
  type LoadedCert,
  parsePemChain,
} from "./certs.js";
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

/** What to do with a delivery whose signature verifies under an expired PayPal certificate. */
export type ExpiredCertPolicy = "reject" | "postback" | "accept";

/** Why a delivery was accepted although its certificate had expired. */
export type CertWarning = "CERT_EXPIRED_CONFIRMED" | "CERT_EXPIRED_ACCEPTED";

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
  /** Under 'postback': wait before asking PayPal about the same expired certificate again (default 10 min). */
  expiredCertRetryMs?: number;
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
  /** Fetches of cert URLs not yet cached, per minute. Bounds what forged requests can make us fetch. */
  newCertFetchesPerMinute?: number;
  /** Extra fetches per minute held back for cert URLs that already signed a verified delivery (default 1). */
  knownCertFetchReserve?: number;
  /** How long a failed cert URL is not retried. */
  failedCertRetryMs?: number;
  /** Window of the health() counters (default 15 min). */
  healthWindowMs?: number;
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

/** Verification health for `/readyz` (report it in the body; never fail readiness on it) and `/ops`. */
export interface WebhookVerifierHealth {
  status: "ok" | "degraded";
  /** Plain-language problems, empty when ok. */
  problems: string[];
  windowMs: number;
  /** Deliveries accepted in the window. */
  verified: number;
  /** Rejections in the window, by reason (forged junk lands here too). */
  rejected: Partial<Record<VerifyFailureReason, number>>;
  /** Deliveries whose signature verified under an expired PayPal certificate, accepted or not. */
  signedWithExpiredCert: number;
  /** Of those, accepted under expiredCertPolicy. */
  acceptedWithExpiredCert: number;
  expiredCertPolicy: ExpiredCertPolicy;
  lastVerifiedAt: string | null;
  /** Certificate of the most recent accepted delivery. */
  signingCert: { certUrl: string; validTo: string; daysLeft: number } | null;
  certsCached: number;
  knownCertUrls: number;
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
  | { at: number; kind: "verified" | "signed_expired" | "accepted_expired" }
  | { at: number; kind: "rejected"; reason: VerifyFailureReason }
  | { at: number; kind: "known_fetch_failed"; certUrl: string; why: string };

const SIGNATURE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DAY_MS = 86_400_000;
const MAX_TRACKED = 64;
const MAX_FAILED_URLS = 256;
const MAX_MARKS = 2_000;
/** How long a PayPal-confirmed expired certificate keeps being accepted without asking again. */
const EXPIRED_CONFIRMATION_TTL_MS = DAY_MS;
/** Prewarm fetches at most this many URLs per call. */
const MAX_PREWARM = 4;

function toBytes(raw: RawBody): Uint8Array {
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(raw);
}

/** A continuously refilled token bucket holding at most `perMinute` tokens. */
function tokenBucket(perMinute: number, now: () => number): () => boolean {
  let tokens = perMinute;
  let at = now();
  return () => {
    const t = now();
    tokens = Math.min(perMinute, tokens + ((t - at) * perMinute) / 60_000);
    at = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
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
  const expiredRetryMs = config.expiredCertRetryMs ?? 10 * 60_000;
  const postbackDeadlineMs = config.postbackDeadlineMs ?? POSTBACK_DEADLINE_MS;
  const certPriority = config.certFetchPriority ?? "background";
  const healthWindowMs = config.healthWindowMs ?? 15 * 60_000;
  const warnDays = config.certExpiryWarningDays ?? 14;
  const { limiter, recorder, logger } = config;
  const leafOptions = (at: number) => ({ at, subjects, ...(anchors ? { trustAnchors: anchors } : {}) });

  const takeNewSlot = tokenBucket(config.newCertFetchesPerMinute ?? 6, now);
  const takeReservedSlot = tokenBucket(config.knownCertFetchReserve ?? 1, now);
  const inflight = new Map<string, Promise<LoadResult>>();
  /** Cert URLs whose fetch failed: until when they are not retried, and whether that failure was retryable. */
  const failedUntil = new Map<string, { until: number; retryable: boolean }>();
  /** Cert URLs (cache keys) that signed a verified delivery or were pre-warmed from stored ones. */
  const knownGood = new Map<string, number>();
  /** Expired certificates PayPal confirmed by postback: fingerprint → when. */
  const confirmedExpired = new Map<string, number>();
  /** Last postback about an expired certificate: fingerprint → when. */
  const expiredAskedAt = new Map<string, number>();
  /** The confirmation in flight per expired certificate, shared by concurrent deliveries. */
  const confirming = new Map<string, Promise<PostbackResult | "TIMEOUT">>();
  const marks: Mark[] = [];
  let lastVerified: { at: number; certUrl: string; validTo: number } | null = null;

  const mark = (m: Mark) => {
    marks.push(m);
    if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  };

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

  function loadCert(url: URL, key: string): Promise<LoadResult> {
    const hit = cache.get(key);
    if (hit) return Promise.resolve({ ok: true, cert: hit, source: "cache" });
    const pending = inflight.get(key);
    if (pending) return pending;
    const blocked = failedUntil.get(key);
    if (blocked !== undefined && blocked.until > now()) {
      return Promise.resolve({
        ok: false,
        reason: "CERT_FETCH_FAILED",
        detail: "recently failed",
        retryable: blocked.retryable,
      });
    }
    // The local budget comes first, so forged requests never reach the shared limiter.
    if (!takeNewSlot() && !(knownGood.has(key) && takeReservedSlot())) {
      return Promise.resolve({
        ok: false,
        reason: "CERT_FETCH_THROTTLED",
        detail: "fetch budget",
        retryable: true,
      });
    }
    const run = fetchCert(url)
      .then((result) => {
        if (result.ok) {
          cache.set(key, result.cert);
          failedUntil.delete(key);
        } else if (result.reason !== "CERT_FETCH_THROTTLED") {
          touch(
            failedUntil,
            key,
            { until: now() + failedRetryMs, retryable: result.retryable },
            MAX_FAILED_URLS,
          );
        }
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, run);
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
      mark({ at: now(), kind: "rejected", reason });
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

    const sigText = transmissionSig.trim();
    const signature = SIGNATURE_B64.test(sigText) ? Buffer.from(sigText, "base64") : null;
    if (!signature || signature.length < 128 || signature.length > 1024)
      return fail("BAD_SIGNATURE_ENCODING");

    if (bytes.length === 0) return fail("EMPTY_BODY");
    crc = crc32(bytes) >>> 0;

    const loaded = await loadCert(urlCheck.url, certKey);
    if (!loaded.ok) {
      if (knownGood.has(certKey)) {
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

    let mode: VerifyMode = signed;
    let certWarning: CertWarning | null = null;
    let postback: VerifyOutcome["postback"] = null;

    if (validity === "CERT_EXPIRED") {
      const validTo = leaf.validToDate.toISOString();
      mark({ at: now(), kind: "signed_expired" });
      logger?.warn?.(
        { certUrl: certKey, validTo, expiredCertPolicy: expiredPolicy, mode: signed, transmissionId },
        "paypal webhook signed with an expired certificate",
      );
      if (expiredPolicy === "reject") {
        return fail("CERT_EXPIRED", `signature valid; certificate expired ${validTo}; policy reject`);
      }
      if (expiredPolicy === "accept" || signed === "dev_mock") {
        certWarning = "CERT_EXPIRED_ACCEPTED";
      } else {
        // 'postback': PayPal confirms once per certificate; later deliveries signed with it pass as 'self'.
        const fingerprint = leaf.fingerprint256;
        const confirmedAt = confirmedExpired.get(fingerprint);
        if (confirmedAt !== undefined && now() - confirmedAt < EXPIRED_CONFIRMATION_TTL_MS) {
          certWarning = "CERT_EXPIRED_CONFIRMED";
        } else {
          const fn = config.postback;
          if (!fn) return fail("CERT_EXPIRED", "signature valid; no postback configured to confirm it");
          const pending = confirming.get(fingerprint);
          if (pending) {
            // A burst signed with the same certificate waits for the one confirmation in flight.
            const answer = await pending;
            if (answer !== "SUCCESS") {
              return fail("CERT_EXPIRED", `signature valid; postback ${answer} for this certificate`);
            }
            certWarning = "CERT_EXPIRED_CONFIRMED";
          } else {
            const askedAt = expiredAskedAt.get(fingerprint);
            if (askedAt !== undefined && now() - askedAt < expiredRetryMs) {
              return fail("CERT_EXPIRED", "signature valid; PayPal was asked recently and did not confirm");
            }
            touch(expiredAskedAt, fingerprint, now(), MAX_TRACKED);
            const asking = askPayPal(fn);
            confirming.set(fingerprint, asking);
            const answer = await asking.finally(() => confirming.delete(fingerprint));
            if (answer !== "SUCCESS") {
              return fail("CERT_EXPIRED", `signature valid; postback ${answer}`, { postback: answer });
            }
            touch(confirmedExpired, fingerprint, now(), MAX_TRACKED);
            certWarning = "CERT_EXPIRED_CONFIRMED";
            postback = "SUCCESS";
            mode = "postback";
          }
        }
      }
    }

    // Signed by PayPal and fresh: record the transmission id, once. A repeat is a replayed copy.
    let firstTime: boolean;
    try {
      firstTime = await transmissions.claim(
        transmissionId,
        sentAt + MAX_TRANSMISSION_SKEW_MS + TRANSMISSION_RETENTION_MARGIN_MS,
      );
    } catch (err) {
      logger?.error?.(
        { error: err instanceof Error ? err.message : String(err), transmissionId },
        "recording a webhook transmission id failed",
      );
      return fail("REPLAY_CHECK_FAILED", "transmission store error", { retryable: true });
    }
    if (!firstTime) {
      logger?.warn?.({ transmissionId, certUrl: certKey }, "paypal webhook transmission replayed");
      return fail("TRANSMISSION_REPLAYED");
    }
    if (validity === "CERT_EXPIRED") mark({ at: now(), kind: "accepted_expired" });

    // Accepted. Remember the certificate URL as one PayPal really signs with.
    touch(knownGood, certKey, now(), MAX_TRACKED);
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
      // These URLs signed stored, verified events, so they may use the reserved fetch slot.
      touch(knownGood, check.cacheKey, now(), MAX_TRACKED);
      const loaded = await loadCert(check.url, check.cacheKey);
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
    for (const m of marks) {
      if (m.kind === "verified") verified += 1;
      else if (m.kind === "signed_expired") signedExpired += 1;
      else if (m.kind === "accepted_expired") acceptedExpired += 1;
      else if (m.kind === "rejected") rejected[m.reason] = (rejected[m.reason] ?? 0) + 1;
      else if (m.kind === "known_fetch_failed") fetchProblems.set(m.certUrl, m.why);
    }

    const minutes = Math.round(healthWindowMs / 60_000);
    const problems: string[] = [];
    if (signedExpired > 0) {
      problems.push(
        `${signedExpired} PayPal ${signedExpired === 1 ? "delivery" : "deliveries"} in the last ${minutes} min ` +
          `signed with an expired certificate (expiredCertPolicy ${expiredPolicy}, ${acceptedExpired} accepted)`,
      );
    }
    for (const [url, why] of fetchProblems) {
      problems.push(`could not fetch ${url}, which signed earlier deliveries: ${why}`);
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
        problems.push(`PayPal's signing certificate expired on ${isoDay(lastVerified.validTo)}`);
      } else if (daysLeft < warnDays) {
        problems.push(
          `PayPal's signing certificate expires in ${daysLeft} days (${isoDay(lastVerified.validTo)})`,
        );
      }
    }
    return {
      status: problems.length > 0 ? "degraded" : "ok",
      problems,
      windowMs: healthWindowMs,
      verified,
      rejected,
      signedWithExpiredCert: signedExpired,
      acceptedWithExpiredCert: acceptedExpired,
      expiredCertPolicy: expiredPolicy,
      lastVerifiedAt: lastVerified ? new Date(lastVerified.at).toISOString() : null,
      signingCert,
      certsCached: cache.size,
      knownCertUrls: knownGood.size,
    };
  }

  return {
    verifyDetailed,
    async verifyPayPal(raw, headers, webhookId, opts) {
      return (await verifyDetailed(raw, headers, webhookId, opts)).mode;
    },
    prewarm,
    async releaseTransmission(transmissionId) {
      try {
        await transmissions.release(transmissionId);
      } catch (err) {
        logger?.error?.(
          { error: err instanceof Error ? err.message : String(err), transmissionId },
          "releasing a webhook transmission id failed",
        );
      }
    },
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
