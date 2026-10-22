// Identifier generators in PayPal's documented shapes, so every ID passes the spec patterns and the
// Agent Toolkit's regexes. Only `debug_id` (and the marker header) carry the simulator's own format.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { isoSeconds } from "./time.js";

const UPPER_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIXED_ALNUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomString(length: number, alphabet = UPPER_ALNUM): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

const up = (n: number) => randomString(n);
const mixed = (n: number) => randomString(n, MIXED_ALNUM);

/** `INV2-XXXX-XXXX-XXXX-XXXX` (24 characters). */
export const newInvoiceId = (): string => `INV2-${up(4)}-${up(4)}-${up(4)}-${up(4)}`;
/** Payout batch and item IDs are 13 upper-case alphanumerics (`5UXD2E8A7EBQJ`). */
export const newBatchId = (): string => up(13);
export const newItemId = (): string => up(13);
/** Transaction and activity IDs are 17 characters. */
export const newTransactionId = (): string => up(17);
export const newWebhookId = (): string => up(17);
export const newLookupId = (): string => up(17);
/** `WH-<17>-<17>`, as in PayPal's event IDs. */
export const newEventId = (): string => `WH-${up(17)}-${up(17)}`;
/** Transmission IDs are UUIDs. */
export const newTransmissionId = (): string => randomUUID();
/** `CR-XXXX-XXXX-XXXXXXXX-XXXX-XXXXXXXXXXXX` (39 characters). */
export const newRuleId = (): string => `CR-${mixed(4)}-${mixed(4)}-${mixed(8)}-${mixed(4)}-${mixed(12)}`;
/** External (recorded) payment IDs: `EXTR-` + 17. */
export const newExternalPaymentId = (): string => `EXTR-${up(17)}`;
/**
 * The simulator's own debug_id format (`sim-` + 12 hex). Real PayPal debug IDs are 13 hex characters,
 * so a simulated one can never be mistaken for a real one.
 */
export const newDebugId = (): string => `sim-${randomBytes(6).toString("hex")}`;
export const newAccessToken = (): string => `SIM.${randomBytes(32).toString("base64url")}`;
export const newNonce = (ms: number): string => `${isoSeconds(ms)}${randomBytes(24).toString("base64url")}`;
export const newCorrelationId = (): string => randomBytes(7).toString("hex").slice(0, 13);
