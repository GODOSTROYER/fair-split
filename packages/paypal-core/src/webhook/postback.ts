// Postback verification: POST /v1/notifications/verify-webhook-signature (S3.6.5).
//
// PayPal requires `webhook_event` to be the event "exactly as received, with no reformatting", so the
// request body is built by splicing the raw bytes in after `"webhook_event":` instead of re-serializing.
// PayPal answers FAILURE for simulator events, so it is only ever asked about real, self-verified ones.
//
// Cost and latency are bounded (register §8: one postback verify per live run, out of ~11 calls):
//   - exactly one HTTP attempt: the call is marked non-idempotent, so PayPalHttp never retries it;
//   - each attempt times out after 5 s, and `postbackWithDeadline` puts an overall deadline (6 s by
//     default) on the whole thing, limiter wait and OAuth included, aborting the attempt in flight.
// The webhook route never calls it: processWebhook does, after the 200 (apps/api/src/webhooks/postback.ts).
// The only in-request use is the verifier's expired-certificate fallback, once per certificate.

import { z } from "zod";
import type { PayPalHttp } from "../http.js";
import type { CallPriority, LoggerLike } from "../types.js";
import type { PostbackFn, PostbackInput, PostbackResult } from "./verify.js";

/** Per-attempt timeout of the postback call. */
export const POSTBACK_TIMEOUT_MS = 5_000;
/** Overall deadline for one postback, limiter wait and token fetch included. */
export const POSTBACK_DEADLINE_MS = 6_000;

const PostbackResponseSchema = z
  .object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) })
  .passthrough();

/** Build the request body with the raw event spliced in. Throws if the raw event is not a JSON object. */
export function buildPostbackBody(input: PostbackInput): string {
  const parsed: unknown = JSON.parse(input.rawEvent);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("webhook_event must be a JSON object");
  }
  const head = JSON.stringify({
    auth_algo: input.authAlgo,
    cert_url: input.certUrl,
    transmission_id: input.transmissionId,
    transmission_sig: input.transmissionSig,
    transmission_time: input.transmissionTime,
    webhook_id: input.webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${input.rawEvent}}`;
}

export interface PostbackVerifierOptions {
  priority?: CallPriority;
  /** Per-attempt timeout (default 5 s). */
  timeoutMs?: number;
}

/**
 * A `PostbackFn` that calls PayPal through the shared PayPalHttp (limiter, token, recorder), with a
 * single attempt: a 5xx, timeout or network error is reported as ERROR, never retried.
 */
export function createPostbackVerifier(http: PayPalHttp, options: PostbackVerifierOptions = {}): PostbackFn {
  const timeoutMs = options.timeoutMs ?? POSTBACK_TIMEOUT_MS;
  return async (input, callOptions = {}) => {
    let body: string;
    try {
      body = buildPostbackBody(input);
    } catch {
      return "ERROR";
    }
    const result = await http.request<unknown>({
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      rawJsonBody: body,
      purpose: "webhooks.verify",
      priority: options.priority ?? "live",
      idempotent: false,
      timeoutMs,
      ...(callOptions.signal ? { signal: callOptions.signal } : {}),
    });
    if (!result.ok) return "ERROR";
    const parsed = PostbackResponseSchema.safeParse(result.body);
    return parsed.success ? parsed.data.verification_status : "ERROR";
  };
}

/**
 * Run one postback under an overall deadline. When the deadline passes first, the attempt in flight
 * is aborted and the answer is TIMEOUT; a thrown error is ERROR. Never throws, never waits longer than
 * `deadlineMs` (plus a timer tick).
 */
export async function postbackWithDeadline(
  postback: PostbackFn,
  input: PostbackInput,
  options: { deadlineMs?: number; logger?: LoggerLike } = {},
): Promise<PostbackResult | "TIMEOUT"> {
  const deadlineMs = options.deadlineMs ?? POSTBACK_DEADLINE_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("postback deadline passed", "TimeoutError"));
      resolve("TIMEOUT");
    }, deadlineMs);
    timer.unref?.();
  });
  const call = (async (): Promise<PostbackResult> => {
    try {
      return await postback(input, { signal: controller.signal });
    } catch (err) {
      options.logger?.warn?.(
        { error: err instanceof Error ? err.message : String(err) },
        "paypal webhook postback verification failed",
      );
      return "ERROR";
    }
  })();
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
