// Every officer key enters `device_keys` through contracts `DeviceKey` (S3.8, C-13): its kind fits its ID shape
// (`app` is `fs-{persona}-a{n}`, `web` `fs-{persona}-w{n}` such as the treasurer's `fs-analyn-w1` registered
// from /ops, and `web_demo` a judge session's `fs-{persona}-demo-{6}`), so a judge's key can never take a real
// key's ID and one misfit row can never make the published key list (Proof plate 5) unreadable. The database
// holds each kind to the same shape (WS-DATA's per-kind CHECKs); this refuses it before the insert.
import { DeviceKey, type DeviceKeyKind } from "@fairsplit/contracts";
import { type schema, uuidv7 } from "@fairsplit/db";

export interface DeviceKeyInput {
  workspaceId: string;
  keyId: string;
  /** The officer's persona ("analyn") or full approver id ("treasurer:analyn"). */
  persona: string;
  publicKeyHex: string;
  kind: DeviceKeyKind;
  /** How the key is shown ("Treasurer web key", "Demo key (this browser only)"). */
  label: string;
  platform: "web" | "android" | "ios";
}

export type DeviceKeyRow = typeof schema.deviceKeys.$inferInsert;

/** The raw 32-byte Ed25519 key as `device_keys.public_key` stores it (base64url). */
export function storedPublicKey(publicKeyHex: string): string {
  return Buffer.from(publicKeyHex, "hex").toString("base64url");
}

/**
 * The `device_keys` row for a key, built through contracts `DeviceKey`, or why it is not one (a key ID that does
 * not have its kind's shape, a malformed public key). Callers turn a refusal into their own problem.
 */
export function deviceKeyRow(
  k: DeviceKeyInput,
): { ok: true; key: DeviceKey; row: DeviceKeyRow } | { ok: false; reason: string } {
  const parsed = DeviceKey.safeParse({
    id: uuidv7(),
    workspaceId: k.workspaceId,
    keyId: k.keyId,
    persona: k.persona,
    publicKeyHex: k.publicKeyHex,
    kind: k.kind,
    label: k.label,
    revokedAt: null,
  });
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "not a device key" };
  }
  const key = parsed.data;
  return {
    ok: true,
    key,
    row: {
      id: key.id,
      workspaceId: key.workspaceId,
      keyId: key.keyId,
      persona: key.persona,
      publicKey: storedPublicKey(key.publicKeyHex),
      kind: key.kind,
      platform: k.platform,
    },
  };
}
