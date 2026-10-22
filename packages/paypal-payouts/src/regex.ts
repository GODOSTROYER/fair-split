// Adapted from paypal/agent-toolkit PR #107 (typescript/src/shared/regex.ts at 5cca31b), Apache-2.0.
// Copyright PayPal and contributors. See NOTICE. Unchanged.

export const POSITIVE_DECIMAL_STRING_REGEX = /^([0-9]*[1-9][0-9]*(\.[0-9]+)?|[0-9]*\.[0-9]*[1-9][0-9]*)$/;
export const PAYOUT_BATCH_ID_REGEX = /^[A-Za-z0-9_-]{1,30}$/;
export const PAYOUT_ITEM_ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
