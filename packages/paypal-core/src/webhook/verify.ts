// verifyPayPal(raw, headers, webhookId) → 'self' | 'postback' | 'dev_mock' | false (IC-05).
//
// PayPal's documented self-verification (developer.paypal.com/api/rest/webhooks/rest), checked on
// 22 Oct 2026 against three genuine PayPal-signed simulator deliveries:
//   message   = `${paypal-transmission-id}|${paypal-transmission-time}|${webhookId}|${crc32(raw body)}`
//   crc32     = unsigned decimal CRC-32 of the raw bytes (never a re-serialized body)
//   signature = base64 `paypal-transmission-sig`, RSA-SHA256 (PKCS#1 v1.5) with the public key of the
//               certificate at `paypal-cert-url`; `paypal-auth-algo` must be SHA256withRSA.
// Simulator ("mock") events are signed with the literal webhook id `WEBHOOK_ID`; we accept them
// only when dev mocks are switched on (PP_DEV_MOCKS=1, never on fs-judge) and label them 'dev_mock'.
// Postback (`POST /v1/notifications/verify-webhook-signature`) runs only after a successful
// self-verification and only when asked (once per live run, for the on-screen badge), so a forged
// request can never make us spend a PayPal call.

import { verify as rsaVerify, type X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { isPayPalHost, PAYPAL_API_HOSTS, PAYPAL_CERT_SUBJECTS, type PayPalEnv } from "../env.js";
import { PayPalConfigError } from "../errors.js";
import { defaultFetch, type FetchLike, type HeadersLike, type LoggerLike, readHeader } from "../types.js";
import { isTimeoutError } from "../util.js";
import { checkCertUrl } from "./cert-url.js";
import {
  type CertCache,
  checkLeafCertificate,
  createMemoryCertCache,
  type LoadedCert,
  parsePemChain,
} from "./certs.js";

/** The webhook id PayPal's simulator signs with. */
export const MOCK_WEBHOOK_ID = "WEBHOOK_ID";

export type VerifyMode = "self" | "postback" | "dev_mock";

export type VerifyFailureReason =
  | "MISSING_HEADER"
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

export type PostbackFn = (input: PostbackInput) => Promise<PostbackResult>;

export interface VerifyOutcome {
  mode: VerifyMode | false;
  reason: VerifyFailureReason | null;
  /** Non-secret detail for logs (which header, why a URL was refused, HTTP status of a cert fetch). */
  detail: string | null;
  transmissionId: string | null;
  certUrl: string | null;
  crc32: number | null;
  /** Postback result; null when it was not requested or self-verification failed. */
  postback: PostbackResult | "SKIPPED" | null;
  certSource: "cache" | "network" | null;
}

export interface VerifyOptions {
  /** Also ask PayPal (one API call). `true` uses the verifier's configured postback function. */
  postback?: boolean | PostbackFn;
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
  fetch?: FetchLike;
  now?: () => number;
  certCache?: CertCache;
  certFetchTimeoutMs?: number;
  maxCertBytes?: number;
  /** Fetches of cert URLs not yet cached, per minute. Bounds what forged requests can make us fetch. */
  newCertFetchesPerMinute?: number;
  /** How long a failed cert URL is not retried. */
  failedCertRetryMs?: number;
  logger?: LoggerLike;
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
  /** Number of cached certificates (for /ops). */
  cachedCerts(): number;
}

type LoadResult =
  | { ok: true; cert: LoadedCert; source: "cache" | "network" }
  | {
      ok: false;
      reason: "CERT_FETCH_FAILED" | "CERT_FETCH_THROTTLED" | "CERT_PARSE_FAILED";
      detail: string | null;
    };

const SIGNATURE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function toBytes(raw: RawBody): Uint8Array {
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(raw);
}

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
  const cache = config.certCache ?? createMemoryCertCache({ now });
  const fetchTimeoutMs = config.certFetchTimeoutMs ?? 5_000;
  const maxCertBytes = config.maxCertBytes ?? 64 * 1024;
  const perMinute = config.newCertFetchesPerMinute ?? 6;
  const failedRetryMs = config.failedCertRetryMs ?? 60_000;
  const devMocks = config.devMocks === true;

  const inflight = new Map<string, Promise<LoadResult>>();
  const failedUntil = new Map<string, number>();
  let budget = perMinute;
  let budgetAt = now();

  const takeBudget = () => {
    const t = now();
    budget = Math.min(perMinute, budget + ((t - budgetAt) * perMinute) / 60_000);
    budgetAt = t;
    if (budget < 1) return false;
    budget -= 1;
    return true;
  };

  async function fetchCert(url: URL): Promise<LoadResult> {
    let res: Response;
    try {
      res = await fetchImpl(url.href, {
        method: "GET",
        headers: { accept: "application/x-pem-file, text/plain;q=0.9, */*;q=0.1" },
        redirect: "error",
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch (err) {
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: isTimeoutError(err) ? "timeout" : "network" };
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: `HTTP ${res.status}` };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxCertBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "CERT_FETCH_FAILED", detail: "too large" };
    }
    const text = await res.text().catch(() => null);
    if (text === null) return { ok: false, reason: "CERT_FETCH_FAILED", detail: "body read failed" };
    if (text.length > maxCertBytes) return { ok: false, reason: "CERT_FETCH_FAILED", detail: "too large" };
    let chain: X509Certificate[];
    try {
      chain = parsePemChain(text);
    } catch {
      return { ok: false, reason: "CERT_PARSE_FAILED", detail: null };
    }
    const [leaf, ...intermediates] = chain;
    if (!leaf) return { ok: false, reason: "CERT_PARSE_FAILED", detail: null };
    return { ok: true, cert: { leaf, intermediates, fetchedAt: now() }, source: "network" };
  }

  function loadCert(url: URL, key: string): Promise<LoadResult> {
    const hit = cache.get(key);
    if (hit) return Promise.resolve({ ok: true, cert: hit, source: "cache" });
    const pending = inflight.get(key);
    if (pending) return pending;
    const blocked = failedUntil.get(key);
    if (blocked !== undefined && blocked > now()) {
      return Promise.resolve({ ok: false, reason: "CERT_FETCH_FAILED", detail: "recently failed" });
    }
    if (!takeBudget()) return Promise.resolve({ ok: false, reason: "CERT_FETCH_THROTTLED", detail: null });
    const run = fetchCert(url)
      .then((result) => {
        if (result.ok) {
          cache.set(key, result.cert);
          failedUntil.delete(key);
        } else {
          failedUntil.set(key, now() + failedRetryMs);
          if (failedUntil.size > 256) {
            const oldest = failedUntil.keys().next();
            if (!oldest.done) failedUntil.delete(oldest.value);
          }
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
    const transmissionId = readHeader(headers, "paypal-transmission-id");
    const transmissionTime = readHeader(headers, "paypal-transmission-time");
    const transmissionSig = readHeader(headers, "paypal-transmission-sig");
    const certUrl = readHeader(headers, "paypal-cert-url");
    const authAlgo = readHeader(headers, "paypal-auth-algo");
    let crc: number | null = null;
    let certSource: VerifyOutcome["certSource"] = null;
    const fail = (reason: VerifyFailureReason, detail: string | null = null): VerifyOutcome => ({
      mode: false,
      reason,
      detail,
      transmissionId,
      certUrl,
      crc32: crc,
      postback: null,
      certSource,
    });

    if (!transmissionId) return fail("MISSING_HEADER", "paypal-transmission-id");
    if (!transmissionTime) return fail("MISSING_HEADER", "paypal-transmission-time");
    if (!transmissionSig) return fail("MISSING_HEADER", "paypal-transmission-sig");
    if (!certUrl) return fail("MISSING_HEADER", "paypal-cert-url");
    if (!authAlgo) return fail("MISSING_HEADER", "paypal-auth-algo");
    if (!webhookId) return fail("WEBHOOK_ID_MISSING");
    if (webhookId === MOCK_WEBHOOK_ID && !devMocks) return fail("WEBHOOK_ID_IS_MOCK_LITERAL");
    if (authAlgo.toUpperCase() !== "SHA256WITHRSA") return fail("UNSUPPORTED_ALGO", authAlgo.slice(0, 40));

    const urlCheck = checkCertUrl(certUrl, certHosts);
    if (!urlCheck.ok) return fail("CERT_URL_REJECTED", urlCheck.reason);

    const sigText = transmissionSig.trim();
    const signature = SIGNATURE_B64.test(sigText) ? Buffer.from(sigText, "base64") : null;
    if (!signature || signature.length < 128 || signature.length > 1024)
      return fail("BAD_SIGNATURE_ENCODING");

    const bytes = toBytes(raw);
    if (bytes.length === 0) return fail("EMPTY_BODY");
    crc = crc32(bytes) >>> 0;

    const loaded = await loadCert(urlCheck.url, urlCheck.cacheKey);
    if (!loaded.ok) return fail(loaded.reason, loaded.detail);
    certSource = loaded.source;

    const certProblem = checkLeafCertificate(loaded.cert, {
      at: now(),
      subjects,
      ...(anchors ? { trustAnchors: anchors } : {}),
    });
    if (certProblem) return fail(certProblem);

    const signedWith = (id: string) => {
      try {
        return rsaVerify(
          "sha256",
          Buffer.from(`${transmissionId}|${transmissionTime}|${id}|${crc}`, "utf8"),
          loaded.cert.leaf.publicKey,
          signature,
        );
      } catch {
        return false;
      }
    };

    let mode: VerifyMode | false = false;
    if (webhookId !== MOCK_WEBHOOK_ID && signedWith(webhookId)) mode = "self";
    else if (devMocks && signedWith(MOCK_WEBHOOK_ID)) mode = "dev_mock";
    if (mode === false) return fail("SIGNATURE_MISMATCH");

    let postback: VerifyOutcome["postback"] = null;
    if (opts.postback && mode === "self") {
      const fn = typeof opts.postback === "function" ? opts.postback : config.postback;
      if (!fn) {
        postback = "SKIPPED";
      } else {
        try {
          postback = await fn({
            authAlgo,
            certUrl,
            transmissionId,
            transmissionSig,
            transmissionTime,
            webhookId,
            rawEvent: Buffer.from(bytes).toString("utf8"),
          });
        } catch (err) {
          config.logger?.warn?.(
            { error: err instanceof Error ? err.message : String(err) },
            "paypal webhook postback verification failed",
          );
          postback = "ERROR";
        }
      }
    } else if (opts.postback && mode === "dev_mock") {
      // PayPal's postback always answers FAILURE for simulator events; do not spend a call.
      postback = "SKIPPED";
    }

    return {
      mode: postback === "SUCCESS" ? "postback" : mode,
      reason: null,
      detail: null,
      transmissionId,
      certUrl,
      crc32: crc,
      postback,
      certSource,
    };
  }

  return {
    verifyDetailed,
    async verifyPayPal(raw, headers, webhookId, opts) {
      return (await verifyDetailed(raw, headers, webhookId, opts)).mode;
    },
    cachedCerts: () => cache.size,
  };
}

let defaultVerifier: PayPalWebhookVerifier | null = null;

/**
 * IC-05 `verifyPayPal(raw, headers, webhookId)`, on a process-wide sandbox verifier with a shared
 * certificate cache. Dev mocks are never accepted here; build a verifier with
 * `createPayPalWebhookVerifier({ devMocks: true })` for local simulator runs.
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
