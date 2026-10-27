// Adapted from paypal/agent-toolkit PR #107 (typescript/src/shared/parameters.ts at 5cca31b,
// "=== PAYOUT PARAMETERS ==="), Apache-2.0. Copyright PayPal and contributors. See NOTICE.
// The four schemas are unchanged, so this tool drops into the toolkit as-is. Fair Split's
// stricter batch rules (EMAIL, USD, two decimals) live in fair-split-schema.ts.

import { z } from "zod";
import { PAYOUT_BATCH_ID_REGEX, PAYOUT_ITEM_ID_REGEX, POSITIVE_DECIMAL_STRING_REGEX } from "./regex.js";

/** The toolkit's Context type (shared/configuration.ts in 1.11.0). */
export type Context = {
  merchant_id?: string;
  sandbox?: boolean;
  access_token?: string;
  request_id?: string;
  tenant_context?: unknown;
  debug?: boolean;
  [key: string]: unknown;
};

// === PAYOUT PARAMETERS ===

const payoutRecipientType = () => z.enum(["EMAIL", "PHONE", "PAYPAL_ID", "USER_HANDLE"]);

const payoutAmount = () =>
  z.object({
    currency: z.string().length(3).describe("The three-character ISO-4217 currency code, for example USD."),
    value: z
      .string()
      .regex(POSITIVE_DECIMAL_STRING_REGEX, 'value must be a positive amount, e.g. "10" or "10.00"')
      .describe(
        "The amount to pay the receiver, as a positive decimal string (e.g. '10.00'). Use whole numbers for currencies without decimals, such as JPY.",
      ),
  });

const payoutItem = () =>
  z.object({
    recipient_type: payoutRecipientType()
      .optional()
      .describe(
        "The type of receiver for this item: EMAIL, PHONE, PAYPAL_ID, or USER_HANDLE (Venmo). Overrides the recipient_type in sender_batch_header.",
      ),
    receiver: z
      .string()
      .min(1)
      .max(127)
      .describe(
        "The receiver of the payment, matching recipient_type: an email address, a phone number, a PayPal account ID, or a Venmo user handle.",
      ),
    amount: payoutAmount().describe("The currency and amount to pay the receiver."),
    note: z
      .string()
      .max(4000)
      .optional()
      .describe("A note to the recipient about this payment. Required for Venmo recipients."),
    sender_item_id: z
      .string()
      .max(63)
      .optional()
      .describe("Your own ID for this item, used to track it in your records."),
    recipient_wallet: z
      .enum(["PAYPAL", "VENMO"])
      .optional()
      .describe(
        "The wallet that receives the payout. Defaults to PAYPAL. VENMO is available for US recipients only.",
      ),
    purpose: z
      .enum([
        "AWARDS",
        "PRIZES",
        "DONATIONS",
        "GOODS",
        "SERVICES",
        "REBATES",
        "CASHBACK",
        "DISCOUNTS",
        "NON_GOODS_OR_SERVICES",
      ])
      .optional()
      .describe("The purpose of the payment."),
  });

export const createPayoutBatchParameters = (_context: Context) =>
  z.object({
    sender_batch_header: z
      .object({
        sender_batch_id: z
          .string()
          .min(1)
          .max(256)
          .describe(
            "A unique ID for this payout, used to track it in your own records. PayPal rejects a sender_batch_id that was already used in the last 30 days, which prevents the same payout from being sent twice.",
          ),
        recipient_type: payoutRecipientType()
          .optional()
          .describe(
            "The type of every receiver in the batch: EMAIL, PHONE, PAYPAL_ID, or USER_HANDLE (Venmo). If omitted, every item must set its own recipient_type.",
          ),
        email_subject: z
          .string()
          .max(255)
          .optional()
          .describe("The subject line of the email PayPal sends to each recipient."),
        email_message: z
          .string()
          .max(1000)
          .optional()
          .describe("The message of the email PayPal sends to each recipient."),
        note: z
          .string()
          .max(1000)
          .optional()
          .describe("A note for the payout. It is combined with each item note in the notification email."),
      })
      .describe("The sender-provided header for the payout."),
    items: z.array(payoutItem()).min(1).max(15000).describe("The payout items, one for each recipient."),
  });

export const getPayoutBatchParameters = (_context: Context) =>
  z.object({
    payout_batch_id: z
      .string()
      .regex(PAYOUT_BATCH_ID_REGEX, "Invalid PayPal Payout Batch ID")
      .describe(
        "The ID of the payout batch to retrieve, returned as batch_header.payout_batch_id by create_payout_batch.",
      ),
    page: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(1)
      .describe("The page number of the payout items to fetch."),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("The number of payout items to return per page (maximum 1000)."),
    total_required: z
      .boolean()
      .default(true)
      .describe("Indicates whether the response should include the total count of items and pages."),
  });

export const getPayoutItemParameters = (_context: Context) =>
  z.object({
    payout_item_id: z
      .string()
      .regex(PAYOUT_ITEM_ID_REGEX, "Invalid PayPal Payout Item ID")
      .describe("The ID of the payout item to retrieve."),
  });

export const cancelUnclaimedPayoutItemParameters = (_context: Context) =>
  z.object({
    payout_item_id: z
      .string()
      .regex(PAYOUT_ITEM_ID_REGEX, "Invalid PayPal Payout Item ID")
      .describe("The ID of the UNCLAIMED payout item to cancel."),
  });

export type CreatePayoutBatchParams = z.input<ReturnType<typeof createPayoutBatchParameters>>;
export type GetPayoutBatchParams = z.input<ReturnType<typeof getPayoutBatchParameters>>;
export type GetPayoutItemParams = z.input<ReturnType<typeof getPayoutItemParameters>>;
export type CancelUnclaimedPayoutItemParams = z.input<ReturnType<typeof cancelUnclaimedPayoutItemParameters>>;
