// POST /webhooks/paypal: framework-agnostic handler factory plus a Hono adapter
// (architecture §6.4, S3.6.5, register §8 "Webhooks").
//
//   1. Read the raw body before any parse (64 KB cap; PayPal events are a few KB).
//   2. Verify offline: CRC32 of the raw bytes + RSA-SHA256 with PayPal's cert (injected verifier),
//      transmission time within 5 minutes, each transmission id once (replay), per-IP and global
//      certificate-fetch budgets keyed by the client address the adapter derives.
//      The route never asks for the badge postback (processWebhook does, after the 200). Its only
//      PayPal calls are a first-time certificate fetch (at most 3 in any hour, all deliveries together)
//      and, only for a delivery whose signature verifies under an expired PayPal certificate, that
//      delivery's own verify-webhook-signature call (at most 20 an hour; forged and replayed copies
//      cost none). Verification is capped at `verifyTimeoutMs` (20 s; PayPal waits 30 s).
//   3. One transaction: INSERT webhook_events ON CONFLICT (paypal_event_id) DO NOTHING;
//      inserted → enqueue('processWebhook', {webhookEventId}, 'wh:<event id>') in the same
//      transaction (I7); already there → record the duplicate delivery ("already applied").
//   4. Return 200 at once. Everything else happens in processWebhook, including the once-per-run
//      postback that upgrades `verified` to 'postback' (./postback.ts) from the transmission headers
//      kept in the row's `delivery`.
//   Bad signature, stale or replayed transmission → 400 and a 'rejected' row (raw truncated to 8 KB),
//   rate-limited over a sliding hour: at most 10 rows per client address (IPv6 by /64) and 100 overall
//   in any 60 minutes (S3: at most 100 rejects an hour; E-18), so a burst across the top of the hour
//   cannot store twice the cap. The rest are only counted, in `handler.health()` (no body, no address),
//   and logged at most once an hour.
//   Could not be checked now (fetch budget, limiter, PayPal's cert host, replay store) → 503 and no
//   row: PayPal retries, and nothing is recorded as forged that was merely unchecked.
//   If the event could not be stored (500), the transmission id is released so PayPal's retry passes.
//
// The route changes no state. processWebhook applies events under the contract in ./apply.ts
// (re-exported here): only a signature-verified PAYOUTS-ITEM.SUCCEEDED whose stored `delivery` says
// `certWarning: null` (an in-date certificate) applies at once, corroborated by the settle GETs at
// +25 s / +90 s (a GET that disagrees wins, with an /ops alert); every other status, anything stored with
// a `delivery.certWarning` (an expired certificate), and a row whose `delivery` was not kept as written
// (null, or its null-valued keys stripped), changes state only after a fresh GET. So MM-1 needs the
// repository to store `delivery` as is (see the persistence shim).
//
// Persistence, the outbox and the verifier are injected, so this file needs no database or HTTP
// framework to compile or test.

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  MAX_WEBHOOK_BODY_BYTES as CORE_MAX_WEBHOOK_BODY_BYTES,
  clientIpKey,
  type HeadersLike,
  type LoggerLike,
  type PayPalWebhookVerifier,
  type PrewarmResult,
  parseWebhookEnvelope,
  readHeader,
  resourceKeyOf,
  TRANSMISSION_ID_PATTERN,
  type VerifyMode,
  type VerifyOutcome,
} from "@fairsplit/paypal-core";
import {
  type ProcessWebhookArgs,
  processWebhookDedupeKey,
  type WebhookEventStatus,
  type WebhookReceivedRunEvent,
  type WebhookVerifiedLabel,
} from "./_shims/contracts.js";
import type { Enqueue, RunInTransaction, WebhookDelivery } from "./_shims/persistence.js";

export {
  corroborateWithSettleGet,
  openForSettleGets,
  SETTLE_GET_DELAYS_MS,
  type SettleCorroboration,
  type WebhookApplyRule,
  type WebhookGetMismatchAlert,
  webhookApplyRule,
} from "./apply.js";

/** PayPal webhook events are a few KB; anything over 64 KB is refused before verification (plan). */
export const MAX_WEBHOOK_BODY_BYTES = CORE_MAX_WEBHOOK_BODY_BYTES;
/** Rejected bodies are kept for forensics, truncated. */
export const MAX_REJECTED_RAW_BYTES = 8 * 1024;
/** Upper bound on verification (a cold certificate fetch is capped at 5 s, an expired-cert postback at 6 s). */
export const VERIFY_TIMEOUT_MS = 20_000;

/** Seconds PayPal is asked to wait before retrying a 503 (it may ignore it; its own schedule is fine). */
export const RETRY_AFTER_SECONDS = 60;

/**
 * How many 'rejected' rows may be stored in any `windowMs` (a sliding window: a row counts for
 * `windowMs` after it was stored, whatever the clock hour); the rest are only counted.
 */
export interface RejectedRowLimits {
  /** Per client address (IPv6 by /64; requests with no address share one). Whole number, ≥ 0. */
  perIp: number;
  /** Overall. Whole number, ≥ 0. */
  global: number;
  /** Positive and finite. */
  windowMs: number;
}

/** S3: `webhook_rejects` keeps at most 100 rows an hour; E-18: at most 100 stored rejects. */
export const DEFAULT_REJECTED_ROW_LIMITS: Readonly<RejectedRowLimits> = Object.freeze({
  perIp: 10,
  global: 100,
  windowMs: 3_600_000,
});

/** The route's own health, for the `/readyz` body (never fail readiness on it) and `/ops`. Counters only. */
export interface WebhookRouteHealth {
  status: "ok" | "degraded";
  problems: string[];
  rejectedRows: {
    windowMs: number;
    perIpLimit: number;
    globalLimit: number;
    /** Rows stored in the last `windowMs` (sliding). */
    stored: number;
    /**
     * Rejections not stored in the last `windowMs`, by the limit that refused them; counted in
     * sixtieths of the window (to the minute, by default).
     */
    notStored: { perIp: number; global: number };
    /** Rejections not stored since the process started. */
    notStoredTotal: number;
  };
}

/**
 * A row for `webhook_events`: exactly the columns of architecture §3 / S3.4, plus the proposed
 * `delivery` jsonb (see the persistence shim), which MM-1 requires. `workspace_id` stays null until
 * processWebhook resolves it.
 */
export interface WebhookEventInsert {
  paypalEventId: string;
  eventType: string | null;
  resourceKey: string | null;
  /** How it was authenticated; `fetched` rows come from the catch-up listing; null when rejected. */
  verified: WebhookVerifiedLabel | null;
  status: Extract<WebhookEventStatus, "received" | "rejected">;
  raw: string;
  /**
   * PROPOSED column (WS-DATA): transmission headers, reject reason, certificate warning. Null for fetched
   * rows. REQUIRED for MM-1: store it as is, null-valued keys included (`certWarning: null` is what lets an
   * in-date SUCCEEDED apply at once), and hand it back to webhookApplyRule.
   */
  delivery: WebhookDelivery | null;
}

export interface DuplicateDelivery {
  paypalEventId: string;
  eventType: string;
  /** How this repeated delivery verified. Map it with `webhookRunEvent(d, true)`; never relabel it. */
  verified: VerifyMode;
  transmissionId: string | null;
}

/** What the route knows about the request beyond its bytes. */
export interface WebhookRequestContext {
  /** The client address the adapter derived (null when unknown); feeds the per-IP fetch budget. */
  clientIp: string | null;
}

export interface PayPalWebhookDeps<Tx> {
  /**
   * Verify the raw delivery offline, e.g.
   * `(raw, h, ctx) => core.verifier.verifyDetailed(raw, h, env.PP_WEBHOOK_ID, { clientIp: ctx.clientIp })`.
   * Do not request a postback here: processWebhook makes it after the 200 (./postback.ts).
   */
  verify(raw: Uint8Array, headers: HeadersLike, context: WebhookRequestContext): Promise<VerifyOutcome>;
  /**
   * `core.verifier.releaseTransmission`: called when an accepted delivery could not be stored, or
   * finished verifying after the route gave up, so PayPal's retry of that transmission is not a replay.
   */
  releaseTransmission?(transmissionId: string): Promise<void>;
  transaction: RunInTransaction<Tx>;
  /** INSERT … ON CONFLICT (paypal_event_id) DO NOTHING RETURNING id: null when the event was already stored. */
  insertWebhookEvent(tx: Tx, row: WebhookEventInsert): Promise<{ id: string } | null>;
  enqueue: Enqueue<Tx>;
  /** A repeated delivery of a stored event: append `webhookRunEvent(delivery, true)` when it is not null. */
  onDuplicate?(tx: Tx, delivery: DuplicateDelivery): Promise<void>;
  logger?: LoggerLike;
  maxBodyBytes?: number;
  verifyTimeoutMs?: number;
  /**
   * Limits on stored 'rejected' rows; unset (or undefined) fields keep DEFAULT_REJECTED_ROW_LIMITS. A
   * value that would lift the cap (negative, fractional, NaN, a non-positive or infinite window) throws.
   */
  rejectedRowLimits?: Partial<RejectedRowLimits>;
  /** Clock for the rejected-row window (default Date.now). */
  now?: () => number;
}

export type WebhookOutcome = "accepted" | "duplicate" | "rejected" | "unavailable" | "too_large" | "error";

export interface WebhookResponse {
  status: 200 | 400 | 413 | 500 | 503;
  outcome: WebhookOutcome;
  paypalEventId: string | null;
  /** Rejection or error reason (verifier reason, MALFORMED_EVENT, VERIFY_TIMEOUT, …); null otherwise. */
  reason: string | null;
}

export interface WebhookRequest {
  rawBody: Uint8Array;
  headers: HeadersLike;
  /** See WebhookRequestContext; the Hono adapter fills it in. */
  clientIp?: string | null;
}

export interface PayPalWebhookHandler {
  (req: WebhookRequest): Promise<WebhookResponse>;
  /** Rejected rows stored and not stored (counters only), for /readyz and /ops. */
  health(): WebhookRouteHealth;
}

/**
 * The IC-01 `webhook.received` run event for a stored or repeated delivery, or null when the frozen
 * contract cannot carry its label ('dev_mock', 'fetched'): such an event is never reported under
 * another label (I8). Becomes total once WS-CORE widens `verified` (see the contracts shim).
 */
export function webhookRunEvent(
  event: { paypalEventId: string; eventType: string; verified: WebhookVerifiedLabel },
  duplicate: boolean,
): WebhookReceivedRunEvent | null {
  if (event.verified !== "self" && event.verified !== "postback") return null;
  return {
    type: "webhook.received",
    eventId: event.paypalEventId,
    eventType: event.eventType,
    verified: event.verified,
    duplicate,
  };
}

const decode = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");

const clip = (value: string | null, max: number): string | null =>
  value === null ? null : value.slice(0, max);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const TIMED_OUT = Symbol("timed out");

async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** health() counts refusals in this many slices of the window: to the minute for an hour. */
const REFUSAL_SLICES = 60;

/** DEFAULT_REJECTED_ROW_LIMITS overlaid with the fields `overrides` sets; throws on any that would lift the cap. */
function rejectedRowLimitsOf(overrides: Partial<RejectedRowLimits> = {}): RejectedRowLimits {
  const limits: RejectedRowLimits = {
    perIp: overrides.perIp ?? DEFAULT_REJECTED_ROW_LIMITS.perIp,
    global: overrides.global ?? DEFAULT_REJECTED_ROW_LIMITS.global,
    windowMs: overrides.windowMs ?? DEFAULT_REJECTED_ROW_LIMITS.windowMs,
  };
  const isCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const isSpan = (ms: number) => Number.isFinite(ms) && ms > 0;
  if (!isCount(limits.perIp) || !isCount(limits.global) || !isSpan(limits.windowMs)) {
    throw new RangeError(
      "rejectedRowLimits: perIp and global must be whole numbers >= 0, windowMs a positive finite number of ms",
    );
  }
  return limits;
}

const spanOf = (ms: number) =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.ceil(ms / 1_000)} s`;

/**
 * Sliding-window limits on stored 'rejected' rows. A row counts against its address and the overall
 * cap for `windowMs` after it was stored, so no span of `windowMs` (one across the top of the hour
 * included) ever holds more than `global` rows, or more than `perIp` from one address. A slot is taken
 * before the insert and given back when no row was written. Memory stays flat whatever the flood: only
 * rows still in the window are kept (at most `global`, with their address keys), and refusals are only
 * counted, in REFUSAL_SLICES slices of the window.
 */
function rejectedRowGate(limits: RejectedRowLimits, now: () => number) {
  /** Rows stored in the last `windowMs`, oldest first. */
  const live: { at: number; key: string }[] = [];
  /** How many of `live` each address holds. */
  const perKey = new Map<string, number>();
  const sliceMs = limits.windowMs / REFUSAL_SLICES;
  const refusals = Array.from({ length: REFUSAL_SLICES }, () => ({ slice: Number.NaN, perIp: 0, global: 0 }));
  let notStoredTotal = 0;
  let lastReportAt = Number.NEGATIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  /** Never runs backwards, so `live` stays in order; a clock stepped back only keeps rows counted longer. */
  const clock = () => {
    latest = Math.max(latest, now());
    return latest;
  };
  const forget = (key: string) => {
    const left = (perKey.get(key) ?? 1) - 1;
    if (left > 0) perKey.set(key, left);
    else perKey.delete(key);
  };
  const expire = (t: number) => {
    for (let oldest = live[0]; oldest !== undefined && t - oldest.at >= limits.windowMs; oldest = live[0]) {
      live.shift();
      forget(oldest.key);
    }
  };
  const sliceOf = (t: number) => Math.floor(t / sliceMs);
  const countRefusal = (t: number, by: "perIp" | "global") => {
    const slice = sliceOf(t);
    const bucket = refusals[((slice % REFUSAL_SLICES) + REFUSAL_SLICES) % REFUSAL_SLICES];
    if (!bucket) return;
    if (bucket.slice !== slice) {
      bucket.slice = slice;
      bucket.perIp = 0;
      bucket.global = 0;
    }
    bucket[by] += 1;
  };
  const refusedInWindow = (t: number) => {
    const current = sliceOf(t);
    const sum = { perIp: 0, global: 0 };
    for (const bucket of refusals) {
      if (current - bucket.slice < REFUSAL_SLICES) {
        sum.perIp += bucket.perIp;
        sum.global += bucket.global;
      }
    }
    return sum;
  };

  return {
    /**
     * Take a slot for a row from this address, or say that a limit refused it; `report` is true for at
     * most one refusal per window, the one to log.
     */
    take(clientIp: string | null): { ok: true; giveBack: () => void } | { ok: false; report: boolean } {
      const t = clock();
      expire(t);
      const key = clientIpKey(clientIp);
      const used = perKey.get(key) ?? 0;
      const refusedBy = used >= limits.perIp ? "perIp" : live.length >= limits.global ? "global" : null;
      if (refusedBy) {
        countRefusal(t, refusedBy);
        notStoredTotal += 1;
        const report = t - lastReportAt >= limits.windowMs;
        if (report) lastReportAt = t;
        return { ok: false, report };
      }
      const row = { at: t, key };
      live.push(row);
      perKey.set(key, used + 1);
      let returned = false;
      return {
        ok: true,
        giveBack: () => {
          if (returned) return;
          returned = true;
          const index = live.indexOf(row);
          if (index === -1) return; // already out of the window
          live.splice(index, 1);
          forget(key);
        },
      };
    },
    health(): WebhookRouteHealth {
      const t = clock();
      expire(t);
      const notStored = refusedInWindow(t);
      const refused = notStored.perIp + notStored.global;
      return {
        status: refused > 0 ? "degraded" : "ok",
        problems:
          refused > 0
            ? [
                `${refused} rejected webhook ${refused === 1 ? "delivery" : "deliveries"} in the last ` +
                  `${spanOf(limits.windowMs)} not stored (limits: ${limits.perIp} per address, ` +
                  `${limits.global} overall); counted only`,
              ]
            : [],
        rejectedRows: {
          windowMs: limits.windowMs,
          perIpLimit: limits.perIp,
          globalLimit: limits.global,
          stored: live.length,
          notStored,
          notStoredTotal,
        },
      };
    },
  };
}

export function createPayPalWebhookHandler<Tx>(deps: PayPalWebhookDeps<Tx>): PayPalWebhookHandler {
  const maxBodyBytes = deps.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  const verifyTimeoutMs = deps.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;
  const log = deps.logger;
  const rejectedRows = rejectedRowGate(rejectedRowLimitsOf(deps.rejectedRowLimits), deps.now ?? Date.now);

  /** PayPal's (public) transmission headers, clipped, as kept in `delivery`. */
  function deliveryOf(
    headers: HeadersLike,
    verification: VerifyOutcome,
    transmissionId: string | null,
    rejectReason: string | null,
  ): WebhookDelivery {
    return {
      transmissionId,
      transmissionTime: clip(readHeader(headers, "paypal-transmission-time"), 64),
      transmissionSig: clip(readHeader(headers, "paypal-transmission-sig"), 2048),
      certUrl: clip(verification.certUrl ?? readHeader(headers, "paypal-cert-url"), 500),
      authAlgo: clip(readHeader(headers, "paypal-auth-algo"), 40),
      rejectReason,
      certWarning: verification.certWarning,
    };
  }

  /** Store a 'rejected' row under the slot `giveBack` belongs to; the slot is returned if no row was written. */
  async function storeRejected(
    raw: Uint8Array,
    row: Omit<WebhookEventInsert, "raw" | "status" | "verified">,
    giveBack: () => void,
  ) {
    try {
      const inserted = await deps.transaction((tx) =>
        deps.insertWebhookEvent(tx, {
          ...row,
          raw: decode(raw.subarray(0, MAX_REJECTED_RAW_BYTES)),
          status: "rejected",
          verified: null,
        }),
      );
      if (!inserted) giveBack(); // identical junk, already on file
    } catch (err) {
      giveBack();
      log?.error?.(
        { error: errorMessage(err), paypalEventId: row.paypalEventId },
        "storing rejected webhook failed",
      );
    }
  }

  /** Free an accepted transmission id we will not store, so PayPal's retry of it is judged afresh. */
  async function release(transmissionId: string | null) {
    if (!transmissionId || !deps.releaseTransmission) return;
    try {
      await deps.releaseTransmission(transmissionId);
    } catch (err) {
      log?.error?.(
        { error: errorMessage(err), transmissionId },
        "releasing a webhook transmission id failed",
      );
    }
  }

  async function handlePayPalWebhook({
    rawBody,
    headers,
    clientIp = null,
  }: WebhookRequest): Promise<WebhookResponse> {
    if (rawBody.byteLength > maxBodyBytes) {
      log?.warn?.({ bytes: rawBody.byteLength }, "paypal webhook body too large");
      return { status: 413, outcome: "too_large", paypalEventId: null, reason: "TOO_LARGE" };
    }

    const envelope = parseWebhookEnvelope(rawBody);
    const hintType = envelope.ok ? envelope.event.event_type : envelope.eventType;

    let verification: VerifyOutcome;
    try {
      const pending = deps.verify(rawBody, headers, { clientIp });
      const result = await within(pending, verifyTimeoutMs);
      if (result === TIMED_OUT) {
        log?.error?.(
          { timeoutMs: verifyTimeoutMs, eventType: hintType },
          "paypal webhook verification timed out",
        );
        // If it still completes and records the transmission id, free it: we answered 500, so PayPal retries.
        pending.then(
          (late) => (late.mode !== false ? release(late.transmissionId) : undefined),
          () => undefined,
        );
        return { status: 500, outcome: "error", paypalEventId: null, reason: "VERIFY_TIMEOUT" };
      }
      verification = result;
    } catch (err) {
      log?.error?.({ error: errorMessage(err) }, "paypal webhook verification threw");
      return { status: 500, outcome: "error", paypalEventId: null, reason: "VERIFY_ERROR" };
    }

    const headerTransmissionId = verification.transmissionId ?? readHeader(headers, "paypal-transmission-id");
    // Anything that does not look like a PayPal transmission id never becomes a key or a log field as-is.
    const transmissionId =
      headerTransmissionId && TRANSMISSION_ID_PATTERN.test(headerTransmissionId)
        ? headerTransmissionId
        : null;

    if (verification.mode === false && verification.retryable) {
      // Not a verdict: the delivery could not be checked now. PayPal retries a 503; store nothing.
      log?.warn?.(
        { reason: verification.reason, detail: verification.detail, transmissionId, eventType: hintType },
        "paypal webhook could not be verified now; answering 503",
      );
      return { status: 503, outcome: "unavailable", paypalEventId: null, reason: verification.reason };
    }

    if (verification.mode === false || !envelope.ok) {
      const reason = verification.mode === false ? (verification.reason ?? "UNVERIFIED") : "MALFORMED_EVENT";
      const slot = rejectedRows.take(clientIp);
      if (!slot.ok) {
        // Over the row limit: counted in health(), never stored, and logged at most once per window.
        if (slot.report) {
          log?.warn?.(
            { reason },
            "rejected paypal webhooks over the row limit are counted, not stored (logged at most once per window)",
          );
        }
        return { status: 400, outcome: "rejected", paypalEventId: null, reason };
      }
      const rejectReason = verification.detail ? `${reason}:${verification.detail}` : reason;
      log?.warn?.(
        {
          reason,
          detail: verification.detail,
          transmissionId,
          eventType: hintType,
          certUrl: verification.certUrl?.slice(0, 200) ?? null,
        },
        "paypal webhook rejected",
      );
      // Identical junk dedupes on its body hash; a real transmission id keys the row otherwise.
      const rejectionKey = `rejected:${transmissionId ?? `sha256-${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`}`;
      await storeRejected(
        rawBody,
        {
          paypalEventId: rejectionKey,
          eventType: hintType,
          resourceKey: null,
          delivery: deliveryOf(headers, verification, transmissionId, rejectReason),
        },
        slot.giveBack,
      );
      return { status: 400, outcome: "rejected", paypalEventId: null, reason };
    }

    const event = envelope.event;
    const mode = verification.mode;
    if (verification.certWarning) {
      log?.warn?.(
        { paypalEventId: event.id, certWarning: verification.certWarning, certUrl: verification.certUrl },
        "paypal webhook accepted with an expired certificate",
      );
    }
    try {
      const outcome = await deps.transaction(async (tx) => {
        const inserted = await deps.insertWebhookEvent(tx, {
          paypalEventId: event.id,
          eventType: event.event_type,
          resourceKey: resourceKeyOf(event),
          verified: mode,
          status: "received",
          raw: decode(rawBody),
          delivery: deliveryOf(headers, verification, transmissionId, null),
        });
        if (inserted) {
          const args: ProcessWebhookArgs = { webhookEventId: inserted.id };
          await deps.enqueue(tx, "processWebhook", args, processWebhookDedupeKey(event.id));
          return "accepted" as const;
        }
        await deps.onDuplicate?.(tx, {
          paypalEventId: event.id,
          eventType: event.event_type,
          verified: mode,
          transmissionId,
        });
        return "duplicate" as const;
      });
      log?.info?.(
        { paypalEventId: event.id, eventType: event.event_type, verified: mode, outcome },
        "paypal webhook stored",
      );
      return { status: 200, outcome, paypalEventId: event.id, reason: null };
    } catch (err) {
      // Nothing was committed: PayPal retries a non-2xx delivery, so the event is not lost, and the
      // transmission id is freed so that retry is not refused as a replay.
      log?.error?.({ error: errorMessage(err), paypalEventId: event.id }, "paypal webhook store failed");
      await release(transmissionId);
      return { status: 500, outcome: "error", paypalEventId: event.id, reason: "STORE_FAILED" };
    }
  }

  return Object.assign(handlePayPalWebhook, { health: () => rejectedRows.health() });
}

export interface PrewarmDeps {
  verifier: Pick<PayPalWebhookVerifier, "prewarm">;
  /**
   * `delivery->>'certUrl'` of the newest verified rows, newest first, e.g. `SELECT DISTINCT … FROM
   * webhook_events WHERE verified IN ('self','postback') ORDER BY created_at DESC LIMIT 2`.
   */
  latestVerifiedCertUrls(): Promise<string[]>;
  logger?: LoggerLike;
}

/**
 * At boot (or from warmCaches): load the certificate that signed the newest stored deliveries, so the
 * first delivery after a deploy needs no fetch and that URL keeps its reserved fetch slot. Never throws.
 */
export async function prewarmWebhookCertificates(deps: PrewarmDeps): Promise<PrewarmResult[]> {
  try {
    const results = await deps.verifier.prewarm(await deps.latestVerifiedCertUrls());
    deps.logger?.info?.(
      {
        results: results.map((r) => ({ certUrl: r.certUrl, ok: r.ok, reason: r.reason, validTo: r.validTo })),
      },
      "paypal webhook certificates pre-warmed",
    );
    return results;
  } catch (err) {
    deps.logger?.warn?.({ error: errorMessage(err) }, "paypal webhook certificate pre-warm failed");
    return [];
  }
}

/** Read a request body, giving up (null) as soon as it exceeds `maxBytes`. */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Strip `[v6]:port`, `v4:port` and surrounding space from one forwarded address; null when it is not an IP. */
function bareAddress(entry: string): string | null {
  let value = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1]) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  return isIP(value) !== 0 ? value : null;
}

/**
 * The client address for the per-IP certificate-fetch budget, from `X-Forwarded-For`. A client can
 * put anything in the header; each proxy we run behind appends the address it saw, so only the
 * rightmost `trustedHops` entries are ours and the entry `trustedHops` from the right is the client.
 * Render appends the connecting address (UNVERIFIED: WS-API confirms the hop count at spike S5 and
 * passes `clientIp` to the adapter if it differs). Null when there is no such entry or it is not an IP.
 */
export function clientIpFromForwardedFor(header: string | null, trustedHops = 1): string | null {
  if (!header) return null;
  const entries = header.split(",").filter((entry) => entry.trim() !== "");
  const entry = entries[entries.length - trustedHops];
  return entry === undefined ? null : bareAddress(entry);
}

/** The slice of Hono's Context this route needs (keeps this file free of a Hono import). */
export interface HonoLikeContext {
  req: { raw: Request; arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * Hono adapter: `app.post('/webhooks/paypal', honoPayPalWebhook(handler))`. Reads the raw bytes
 * (bounded) before anything parses them; if a middleware already consumed the body, Hono's cached
 * copy is used instead. The client address comes from `options.clientIp`, by default the rightmost
 * `X-Forwarded-For` entry. A 503 carries `Retry-After`.
 */
export function honoPayPalWebhook(
  handler: (req: WebhookRequest) => Promise<WebhookResponse>,
  options: { maxBodyBytes?: number; clientIp?: (request: Request) => string | null } = {},
): (c: HonoLikeContext) => Promise<Response> {
  const maxBytes = options.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  const clientIpOf =
    options.clientIp ??
    ((request: Request) => clientIpFromForwardedFor(request.headers.get("x-forwarded-for")));
  return async (c) => {
    const raw = c.req.raw.bodyUsed
      ? new Uint8Array(await c.req.arrayBuffer())
      : await readBodyWithLimit(c.req.raw, maxBytes);
    if (raw === null || raw.byteLength > maxBytes) return new Response(null, { status: 413 });
    const result = await handler({
      rawBody: raw,
      headers: c.req.raw.headers,
      clientIp: clientIpOf(c.req.raw),
    });
    return new Response(null, {
      status: result.status,
      ...(result.status === 503 ? { headers: { "retry-after": String(RETRY_AFTER_SECONDS) } } : {}),
    });
  };
}
