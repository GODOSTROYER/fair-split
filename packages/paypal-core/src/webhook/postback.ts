// Postback verification: POST /v1/notifications/verify-webhook-signature (S3.6.5).
//
// PayPal requires `webhook_event` to be the event "exactly as received, with no reformatting", so the
// request body is built by splicing the raw bytes in after `"webhook_event":` instead of re-serializing.
// PayPal answers FAILURE for simulator events, so the verifier only calls this after a successful
// self-verification of a real event (once per live run, for the "PayPal: SUCCESS" badge).

import { z } from "zod";
import type { PayPalHttp } from "../http.js";
import type { CallPriority } from "../types.js";
import type { PostbackFn, PostbackInput } from "./verify.js";

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

/** A `PostbackFn` that calls PayPal through the shared PayPalHttp (limiter, token, recorder). */
export function createPostbackVerifier(
  http: PayPalHttp,
  options: { priority?: CallPriority } = {},
): PostbackFn {
  return async (input) => {
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
      idempotent: true,
    });
    if (!result.ok) return "ERROR";
    const parsed = PostbackResponseSchema.safeParse(result.body);
    return parsed.success ? parsed.data.verification_status : "ERROR";
  };
}
