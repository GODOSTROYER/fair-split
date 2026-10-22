// Fair Split's own batch rules, stricter than PR #107's schema and applied on top of it:
// recipient_type EMAIL only (sandbox accounts are US; PHONE is unsupported there), USD only, two
// decimals, every item tracked by sender_item_id, and nothing else in the body.

import { z } from "zod";

const usdAmount = z
  .object({
    currency: z.literal("USD"),
    value: z
      .string()
      .regex(/^(0|[1-9]\d*)\.\d{2}$/, "two-decimal USD")
      .refine((v) => v !== "0.00", "a payout must be positive"),
  })
  .strict();

export const fairSplitPayoutItem = z
  .object({
    receiver: z.string().email().max(127),
    amount: usdAmount,
    sender_item_id: z.string().min(1).max(63),
    purpose: z.literal("GOODS"),
  })
  .strict();

export const fairSplitPayoutBatch = z
  .object({
    sender_batch_header: z
      .object({
        sender_batch_id: z.string().min(1).max(256),
        recipient_type: z.literal("EMAIL"),
        note: z.string().min(1).max(1000),
      })
      .strict(),
    items: z.array(fairSplitPayoutItem).min(1).max(15000),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const seen = new Set<string>();
    batch.items.forEach((item, i) => {
      if (seen.has(item.sender_item_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "sender_item_id"],
          message: "duplicate",
        });
      }
      seen.add(item.sender_item_id);
    });
  });

export type FairSplitPayoutBatch = z.infer<typeof fairSplitPayoutBatch>;
