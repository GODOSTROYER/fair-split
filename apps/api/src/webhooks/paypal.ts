// POST /webhooks/paypal: framework-agnostic handler factory plus a Hono adapter
// (architecture §6.4, S3.6.5, register §8 "Webhooks").
//
//   1. Read the raw body before any parse (bounded; PayPal events are a few KB).
//   2. Verify: CRC32 of the raw bytes + RSA-SHA256 with PayPal's cert (injected verifier).
//   3. One transaction: INSERT webhook_events ON CONFLICT (paypal_event_id) DO NOTHING;
//      inserted → enqueue('processWebhook', {webhookEventId}, 'wh:<event id>') in the same
//      transaction (I7); already there → record the duplicate delivery ("already applied").
//   4. Return 200 at once; processing happens in the outbox task, never in the request.
//   Bad signature → a 'rejected' row (raw truncated) and 400, so PayPal retries a genuine event.
//
// Persistence, the outbox and the verifier are injected, so this file needs no database or HTTP
// framework to compile or test.

import {
  type HeadersLike,
  type LoggerLike,
  parseWebhookEnvelope,
  readHeader,
  resourceKeyOf,
  type VerifyMode,
  type VerifyOutcome,
} from "@fairsplit/paypal-core";
import {
  type ProcessWebhookArgs,
  processWebhookDedupeKey,
  type WebhookEventStatus,
} from "./_shims/contracts.js";
import type { Enqueue, RunInTransaction } from "./_shims/persistence.js";

/** PayPal webhook events are a few KB; anything this large is not PayPal. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
/** Rejected bodies are kept for forensics, truncated. */
export const MAX_REJECTED_RAW_BYTES = 8 * 1024;

/** A row for `webhook_events` (architecture §3, S3.4). `workspace_id` stays null until processWebhook resolves it. */
export interface WebhookEventInsert {
  paypalEventId: string;
  eventType: string | null;
  resourceType: string | null;
  resourceKey: string | null;
  verified: VerifyMode | null;
  status: Extract<WebhookEventStatus, "received" | "rejected">;
  raw: string;
  transmissionId: string | null;
  rejectReason: string | null;
  receivedAt: Date;
}

export interface DuplicateDelivery {
  paypalEventId: string;
  eventType: string;
  verified: VerifyMode;
  transmissionId: string | null;
}

export interface PayPalWebhookDeps<Tx> {
  /**
   * Verify the raw delivery, e.g. `(raw, h, hint) => core.verifier.verifyDetailed(raw, h, env.PP_WEBHOOK_ID,
   * { postback: hint.eventType === 'INVOICING.INVOICE.PAID' && firstOfRun })`. `hint` comes from the
   * unverified body: use it only to decide whether to ask for a postback, which the verifier spends
   * only after self-verification succeeds.
   */
  verify(raw: Uint8Array, headers: HeadersLike, hint: { eventType: string | null }): Promise<VerifyOutcome>;
  transaction: RunInTransaction<Tx>;
  /** INSERT … ON CONFLICT (paypal_event_id) DO NOTHING RETURNING id: null when the event was already stored. */
  insertWebhookEvent(tx: Tx, row: WebhookEventInsert): Promise<{ id: string } | null>;
  enqueue: Enqueue<Tx>;
  /** A repeated delivery of a stored event, e.g. append run_event {webhook.received, duplicate: true}. */
  onDuplicate?(tx: Tx, delivery: DuplicateDelivery): Promise<void>;
  logger?: LoggerLike;
  now?: () => Date;
  maxBodyBytes?: number;
}

export type WebhookOutcome = "accepted" | "duplicate" | "rejected" | "too_large" | "error";

export interface WebhookResponse {
  status: 200 | 400 | 413 | 500;
  outcome: WebhookOutcome;
  paypalEventId: string | null;
  /** Rejection reason (verifier reason or MALFORMED_EVENT); null otherwise. */
  reason: string | null;
}

export interface WebhookRequest {
  rawBody: Uint8Array;
  headers: HeadersLike;
}

export type PayPalWebhookHandler = (req: WebhookRequest) => Promise<WebhookResponse>;

const decode = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createPayPalWebhookHandler<Tx>(deps: PayPalWebhookDeps<Tx>): PayPalWebhookHandler {
  const now = deps.now ?? (() => new Date());
  const maxBodyBytes = deps.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  const log = deps.logger;

  async function storeRejected(
    raw: Uint8Array,
    row: Omit<WebhookEventInsert, "raw" | "status" | "verified">,
  ) {
    try {
      await deps.transaction((tx) =>
        deps.insertWebhookEvent(tx, {
          ...row,
          raw: decode(raw.subarray(0, MAX_REJECTED_RAW_BYTES)),
          status: "rejected",
          verified: null,
        }),
      );
    } catch (err) {
      log?.error?.(
        { error: errorMessage(err), paypalEventId: row.paypalEventId },
        "storing rejected webhook failed",
      );
    }
  }

  return async function handlePayPalWebhook({ rawBody, headers }) {
    const receivedAt = now();
    if (rawBody.byteLength > maxBodyBytes) {
      log?.warn?.({ bytes: rawBody.byteLength }, "paypal webhook body too large");
      return { status: 413, outcome: "too_large", paypalEventId: null, reason: "TOO_LARGE" };
    }

    const envelope = parseWebhookEnvelope(rawBody);
    const hintType = envelope.ok ? envelope.event.event_type : envelope.eventType;

    let verification: VerifyOutcome;
    try {
      verification = await deps.verify(rawBody, headers, { eventType: hintType });
    } catch (err) {
      log?.error?.({ error: errorMessage(err) }, "paypal webhook verification threw");
      return { status: 500, outcome: "error", paypalEventId: null, reason: "VERIFY_ERROR" };
    }

    const transmissionId = verification.transmissionId ?? readHeader(headers, "paypal-transmission-id");
    const rejectionKey = `rejected:${transmissionId ?? `crc-${verification.crc32 ?? "none"}-${receivedAt.getTime()}`}`;

    if (verification.mode === false || !envelope.ok) {
      const reason = verification.mode === false ? (verification.reason ?? "UNVERIFIED") : "MALFORMED_EVENT";
      log?.warn?.(
        {
          reason,
          detail: verification.detail,
          transmissionId,
          eventType: hintType,
          certUrl: verification.certUrl,
        },
        "paypal webhook rejected",
      );
      await storeRejected(rawBody, {
        paypalEventId: rejectionKey,
        eventType: hintType,
        resourceType: envelope.ok ? (envelope.event.resource_type ?? null) : null,
        resourceKey: null,
        transmissionId,
        rejectReason: verification.detail ? `${reason}:${verification.detail}` : reason,
        receivedAt,
      });
      return { status: 400, outcome: "rejected", paypalEventId: null, reason };
    }

    const event = envelope.event;
    const mode = verification.mode;
    try {
      const outcome = await deps.transaction(async (tx) => {
        const inserted = await deps.insertWebhookEvent(tx, {
          paypalEventId: event.id,
          eventType: event.event_type,
          resourceType: event.resource_type ?? null,
          resourceKey: resourceKeyOf(event),
          verified: mode,
          status: "received",
          raw: decode(rawBody),
          transmissionId,
          rejectReason: null,
          receivedAt,
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
        {
          paypalEventId: event.id,
          eventType: event.event_type,
          verified: mode,
          outcome,
          postback: verification.postback,
        },
        "paypal webhook stored",
      );
      return { status: 200, outcome, paypalEventId: event.id, reason: null };
    } catch (err) {
      // Nothing was committed: PayPal retries a non-2xx delivery, so the event is not lost.
      log?.error?.({ error: errorMessage(err), paypalEventId: event.id }, "paypal webhook store failed");
      return { status: 500, outcome: "error", paypalEventId: event.id, reason: "STORE_FAILED" };
    }
  };
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

/** The slice of Hono's Context this route needs (keeps this file free of a Hono import). */
export interface HonoLikeContext {
  req: { raw: Request; arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * Hono adapter: `app.post('/webhooks/paypal', honoPayPalWebhook(handler))`. Reads the raw bytes
 * (bounded) before anything parses them; if a middleware already consumed the body, Hono's cached
 * copy is used instead.
 */
export function honoPayPalWebhook(
  handler: PayPalWebhookHandler,
  options: { maxBodyBytes?: number } = {},
): (c: HonoLikeContext) => Promise<Response> {
  const maxBytes = options.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  return async (c) => {
    const raw = c.req.raw.bodyUsed
      ? new Uint8Array(await c.req.arrayBuffer())
      : await readBodyWithLimit(c.req.raw, maxBytes);
    if (raw === null || raw.byteLength > maxBytes) return new Response(null, { status: 413 });
    const result = await handler({ rawBody: raw, headers: c.req.raw.headers });
    return new Response(null, { status: result.status });
  };
}
