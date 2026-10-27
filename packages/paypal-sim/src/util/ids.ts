// Identifier generators in PayPal's documented shapes, so every ID passes the spec patterns and the Agent
// Toolkit's regexes. Every resource ID the simulator mints also starts with the marker `SIM` inside that
// shape (`INV2-SIMx-…`, batch `SIM…`, `WH-SIM…-…`), so an ID copied into a database still says where it came
// from. A real PayPal ID could start with SIM by chance (about 1 in 46,656), so the marker is a label, not
// proof: provenance comes from the rail (PayPalRail.provenance), and `debug_id`s use the simulator's own
// `sim-` format.
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { isoSeconds } from "./time.js";

const UPPER_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIXED_ALNUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The marker at the start of every simulator-minted resource ID (inside PayPal's format). */
export const SIM_ID_MARKER = "SIM";

export function randomString(length: number, alphabet = UPPER_ALNUM): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

const up = (n: number) => randomString(n);
const mixed = (n: number) => randomString(n, MIXED_ALNUM);

/** `INV2-SIMX-XXXX-XXXX-XXXX` (PayPal: `INV2-XXXX-XXXX-XXXX-XXXX`, 24 characters). */
export const newInvoiceId = (): string => `INV2-SIM${up(1)}-${up(4)}-${up(4)}-${up(4)}`;
/** Payout batch and item IDs are 13 upper-case alphanumerics (`5UXD2E8A7EBQJ`): `SIM` + 10. */
export const newBatchId = (): string => `SIM${up(10)}`;
export const newItemId = (): string => `SIM${up(10)}`;
/** Transaction, activity, webhook and lookup IDs are 17 characters: `SIM` + 14. */
export const newTransactionId = (): string => `SIM${up(14)}`;
export const newWebhookId = (): string => `SIM${up(14)}`;
export const newLookupId = (): string => `SIM${up(14)}`;
/** `WH-<17>-<17>`, as in PayPal's event IDs: `WH-SIM<14>-<17>`. */
export const newEventId = (): string => `WH-SIM${up(14)}-${up(17)}`;
/** Transmission IDs are UUIDs. */
export const newTransmissionId = (): string => randomUUID();
/** `CR-XXXX-XXXX-XXXXXXXX-XXXX-XXXXXXXXXXXX` (39 characters): `CR-SIMx-…`. */
export const newRuleId = (): string => `CR-SIM${mixed(1)}-${mixed(4)}-${mixed(8)}-${mixed(4)}-${mixed(12)}`;
/** External (recorded) payment IDs: `EXTR-` + 17, here `EXTR-SIM` + 14. */
export const newExternalPaymentId = (): string => `EXTR-SIM${up(14)}`;
/**
 * The simulator's own debug_id format (`sim-` + 12 hex). Real PayPal debug IDs are 13 hex characters,
 * so a simulated one can never be mistaken for a real one.
 */
export const newDebugId = (): string => `sim-${randomBytes(6).toString("hex")}`;
export const newAccessToken = (): string => `SIM.${randomBytes(32).toString("base64url")}`;
export const newNonce = (ms: number): string => `${isoSeconds(ms)}${randomBytes(24).toString("base64url")}`;
export const newCorrelationId = (): string => randomBytes(7).toString("hex").slice(0, 13);

const SIMULATED_ID = [
  /^INV2-SIM[A-Z0-9](-[A-Z0-9]{4}){3}$/,
  /^SIM[A-Z0-9]{10}$/,
  /^SIM[A-Z0-9]{14}$/,
  /^WH-SIM[A-Z0-9]{14}-[A-Z0-9]{17}$/,
  /^CR-SIM[A-Za-z0-9]-[A-Za-z0-9]{4}-[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{12}$/,
  /^EXTR-SIM[A-Z0-9]{14}$/,
];

/** True when `id` has the shape of a simulator-minted resource ID (see the module comment for its limits). */
export function isSimulatedId(id: string): boolean {
  return SIMULATED_ID.some((re) => re.test(id));
}
