// Composition root: one PayPalAuth, one PayPalHttp and one webhook verifier per process, wired to
// the injected limiter and recorder (WS-DATA's Postgres implementations in production). The verifier
// shares both, so its certificate fetches count toward the 40/min budget and land in paypal_calls.

import { createPayPalAuth, type PayPalAuth } from "./auth.js";
import type { PayPalRuntimeConfig } from "./config.js";
import { createPayPalHttp, type PayPalHttp, type RetryPolicy } from "./http.js";
import type { PayPalLimiter } from "./limiter.js";
import type { PayPalCallRecorder } from "./recorder.js";
import { assertScopes, type ScopeReport } from "./scopes.js";
import type { FetchLike, HeadersLike, LoggerLike } from "./types.js";
import { createPostbackVerifier } from "./webhook/postback.js";
import {
  createPayPalWebhookVerifier,
  type ExpiredCertPolicy,
  type PayPalWebhookVerifier,
  type PostbackFn,
  type RawBody,
  type TransmissionStore,
  type VerifyMode,
  type VerifyOptions,
} from "./webhook/verify.js";

export interface PayPalCoreOptions {
  /** `knownCertIds` (PP_CERT_ALLOW) is pinned in the verifier together with `webhookKnownCertIds`. */
  config: Pick<PayPalRuntimeConfig, "clientId" | "clientSecret" | "devMocks"> &
    Partial<Pick<PayPalRuntimeConfig, "knownCertIds">>;
  limiter: PayPalLimiter;
  recorder?: PayPalCallRecorder;
  logger?: LoggerLike;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  retry?: Partial<RetryPolicy>;
  /** Extra PEM trust anchors for webhook certificates (tests, pinning). */
  webhookTrustAnchors?: readonly string[];
  /** Deliveries signed with an expired PayPal certificate (default 'postback': PayPal confirms each one). */
  webhookExpiredCertPolicy?: ExpiredCertPolicy;
  /** Replay tracking of webhook transmission ids (production: WS-DATA's Postgres store; default in memory). */
  webhookTransmissionStore?: TransmissionStore;
  /** More PayPal cert ids trusted before any delivery: reserved fetch budget, kept once loaded. */
  webhookKnownCertIds?: readonly string[];
}

export interface PayPalCore {
  auth: PayPalAuth;
  http: PayPalHttp;
  verifier: PayPalWebhookVerifier;
  /** One bounded verify-webhook-signature call (one attempt, 5 s); for processWebhook's badge step. */
  postback: PostbackFn;
  /** IC-05 verifyPayPal, bound to this process's verifier (shared certificate cache, postback via http). */
  verifyPayPal(
    raw: RawBody,
    headers: HeadersLike,
    webhookId: string,
    opts?: VerifyOptions,
  ): Promise<VerifyMode | false>;
  /** Boot check: fetch a token and assert the invoicing, payouts and webhooks scopes. */
  boot(): Promise<ScopeReport>;
}

export function createPayPalCore(options: PayPalCoreOptions): PayPalCore {
  const shared = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  };
  const auth = createPayPalAuth({
    clientId: options.config.clientId,
    clientSecret: options.config.clientSecret,
    ...(options.recorder ? { recorder: options.recorder } : {}),
    ...shared,
  });
  const http = createPayPalHttp({
    auth,
    limiter: options.limiter,
    ...(options.recorder ? { recorder: options.recorder } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    ...shared,
  });
  const postback = createPostbackVerifier(http);
  const knownCertIds = [
    ...new Set([...(options.config.knownCertIds ?? []), ...(options.webhookKnownCertIds ?? [])]),
  ];
  const verifier = createPayPalWebhookVerifier({
    devMocks: options.config.devMocks,
    postback,
    limiter: options.limiter,
    ...(options.recorder ? { recorder: options.recorder } : {}),
    ...(options.webhookTrustAnchors ? { trustAnchors: options.webhookTrustAnchors } : {}),
    ...(options.webhookExpiredCertPolicy ? { expiredCertPolicy: options.webhookExpiredCertPolicy } : {}),
    ...(options.webhookTransmissionStore ? { transmissionStore: options.webhookTransmissionStore } : {}),
    ...(knownCertIds.length > 0 ? { knownCertIds } : {}),
    ...shared,
  });
  return {
    auth,
    http,
    verifier,
    postback,
    verifyPayPal: (raw, headers, webhookId, opts) => verifier.verifyPayPal(raw, headers, webhookId, opts),
    async boot() {
      const token = await auth.token();
      return assertScopes(token.scopes);
    },
  };
}
