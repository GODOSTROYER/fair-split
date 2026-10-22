// Adapted from paypal/agent-toolkit PR #107 (typescript/src/shared/functions.ts at 5cca31b,
// "=== PAYOUT FUNCTIONS ==="), Apache-2.0. Copyright PayPal and contributors. See NOTICE.
// Changed: requests go through the injected IC-05 PayPalHttp (our token cache, limiter, call log
// and debug ids) instead of axios and PayPalClient, and return its result union instead of
// throwing. As in the PR, each function parses its own parameters, no read or cancel sends a
// PayPal-Request-Id, and create sends one only when the caller passes it (register §8 asks for
// sha256(sender_batch_id); the PR's sandbox probe showed the header does not replay). Create and
// cancel pass `idempotent: false`, so PayPalHttp never repeats a money-moving POST on its own: its
// caller (PayoutsService) retries, re-reading the kill switch first. Purposes are paypal_calls'.

import type { CallPriority, PayPalHttp, PayPalResult } from "./_shims/paypal-core.js";
import {
  type CancelUnclaimedPayoutItemParams,
  type Context,
  type CreatePayoutBatchParams,
  cancelUnclaimedPayoutItemParameters,
  createPayoutBatchParameters,
  type GetPayoutBatchParams,
  type GetPayoutItemParams,
  getPayoutBatchParameters,
  getPayoutItemParameters,
} from "./parameters.js";

export interface PayoutCallOptions {
  /** Sent as PayPal-Request-Id (create only). */
  requestId?: string;
  priority?: CallPriority;
}

export interface PayPalAmount {
  currency: string;
  value: string;
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: string;
  time_created?: string;
  time_completed?: string;
  sender_batch_header: {
    sender_batch_id?: string;
    recipient_type?: string;
    email_subject?: string;
    note?: string;
  };
  amount?: PayPalAmount;
  fees?: PayPalAmount;
}

/** 201 body of POST /v1/payments/payouts (`payout`). */
export interface CreatePayoutBatchResponse {
  batch_header: PayoutBatchHeader;
  links?: { href: string; rel: string; method: string }[];
}

/** One entry of `items` in GET /v1/payments/payouts/{id}, and the body of GET/cancel payouts-item. */
export interface PayoutItemResponse {
  payout_item_id: string;
  transaction_id?: string;
  activity_id?: string;
  transaction_status?: string;
  payout_item_fee?: PayPalAmount;
  payout_batch_id: string;
  sender_batch_id?: string;
  payout_item: {
    recipient_type?: string;
    amount: PayPalAmount;
    note?: string;
    receiver: string;
    sender_item_id?: string;
    purpose?: string;
  };
  time_processed?: string;
  errors?: { name?: string; message?: string };
  links?: { href: string; rel: string; method: string }[];
}

/** 200 body of GET /v1/payments/payouts/{id} (`payout_batch`). */
export interface PayoutBatchResponse {
  total_items?: number;
  total_pages?: number;
  batch_header: PayoutBatchHeader;
  items?: PayoutItemResponse[];
  links?: { href: string; rel: string; method: string }[];
}

/** Thrown before any request when the PR's own validation fails (the PR throws the same way). */
export class PayoutParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutParamsError";
  }
}

function parse<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error } },
  params: unknown,
): T {
  const result = schema.safeParse(params);
  if (!result.success) throw new PayoutParamsError(result.error.message);
  return result.data;
}

// === PAYOUT FUNCTIONS ===

export async function createPayoutBatch(
  http: PayPalHttp,
  context: Context,
  params: CreatePayoutBatchParams,
  options: PayoutCallOptions = {},
): Promise<PayPalResult<CreatePayoutBatchResponse>> {
  const payoutRequest = parse(createPayoutBatchParameters(context), params);

  if (
    !payoutRequest.sender_batch_header.recipient_type &&
    payoutRequest.items.some((item) => !item.recipient_type)
  ) {
    throw new PayoutParamsError("recipient_type must be set on sender_batch_header or on every item.");
  }

  return http.request<CreatePayoutBatchResponse>({
    method: "POST",
    path: "/v1/payments/payouts",
    body: payoutRequest,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    purpose: "payouts.create",
    priority: options.priority ?? "live",
    idempotent: false,
  });
}

export async function getPayoutBatch(
  http: PayPalHttp,
  context: Context,
  params: GetPayoutBatchParams,
  options: PayoutCallOptions = {},
): Promise<PayPalResult<PayoutBatchResponse>> {
  const { payout_batch_id, page, page_size, total_required } = parse(
    getPayoutBatchParameters(context),
    params,
  );

  return http.request<PayoutBatchResponse>({
    method: "GET",
    path: `/v1/payments/payouts/${payout_batch_id}?page=${page}&page_size=${page_size}&total_required=${total_required}`,
    purpose: "payouts.get",
    priority: options.priority ?? "live",
  });
}

export async function getPayoutItem(
  http: PayPalHttp,
  context: Context,
  params: GetPayoutItemParams,
  options: PayoutCallOptions = {},
): Promise<PayPalResult<PayoutItemResponse>> {
  const { payout_item_id } = parse(getPayoutItemParameters(context), params);

  return http.request<PayoutItemResponse>({
    method: "GET",
    path: `/v1/payments/payouts-item/${payout_item_id}`,
    purpose: "payouts.item.get",
    priority: options.priority ?? "live",
  });
}

export async function cancelUnclaimedPayoutItem(
  http: PayPalHttp,
  context: Context,
  params: CancelUnclaimedPayoutItemParams,
  options: PayoutCallOptions = {},
): Promise<PayPalResult<PayoutItemResponse>> {
  const { payout_item_id } = parse(cancelUnclaimedPayoutItemParameters(context), params);

  return http.request<PayoutItemResponse>({
    method: "POST",
    path: `/v1/payments/payouts-item/${payout_item_id}/cancel`,
    body: {},
    purpose: "payouts.item.cancel",
    priority: options.priority ?? "live",
    idempotent: false,
  });
}
