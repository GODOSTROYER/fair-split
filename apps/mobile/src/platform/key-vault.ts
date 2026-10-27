/**
 * The Chair's signing key on the phone (architecture §9, S3.8, C-13): Ed25519 from @noble/curves, the secret half in
 * SecureStore (Android Keystore, this device only, readable only while unlocked), never in a file, a log or a URL.
 *
 * One presence step per signature, chosen from what the phone has enrolled (`biometricClassFor`):
 * - "biometric-bound" (a strong fingerprint on Android): the key itself is user-authentication-bound
 *   (`requireAuthentication`), so the OS fingerprint prompt guards every read. A new key is made, signs, and is stored
 *   behind that same prompt, so the first signature asks once; a cancelled prompt discards key and signature.
 * - "pin-gated" (weak biometrics, a PIN or pattern only, or iOS): expo-local-authentication asks for the fingerprint
 *   or the device PIN ("No biometric: the device PIN is used", design D2), then the key is read.
 * A phone with no screen lock cannot hold a co-sign key. Fingerprints added or removed invalidate a bound key; the
 * Chair makes a new one, which the server must accept for his paired phone before it counts.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  authFailure,
  type BiometricClass,
  biometricClassFor,
  deviceKeyId,
  enrolledLevel,
  type KeyMeta,
  type KeySignOutcome,
  type KeyVault,
  secureStoreFailure,
} from "../lib/signing";
import { prefs } from "./kv";
import { randomBytes } from "./random";

export type { BiometricClass, KeyMeta, KeyVault } from "../lib/signing";

const META = "fs.boardKey.meta";
/** SecureStore keys allow letters, digits, `.`, `-` and `_`: key IDs already fit. */
const secretName = (keyId: string) => `fs.boardKey.sk.${keyId}`;
const base: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function readMeta(): Promise<KeyMeta | null> {
  const raw = await prefs.get(META);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<KeyMeta>;
    if (
      typeof m.keyId !== "string" ||
      typeof m.publicKeyHex !== "string" ||
      typeof m.createdAt !== "string"
    ) {
      return null;
    }
    const cls = m.biometricClass === "biometric-bound" ? "biometric-bound" : "pin-gated";
    return { keyId: m.keyId, publicKeyHex: m.publicKeyHex, biometricClass: cls, createdAt: m.createdAt };
  } catch {
    return null;
  }
}

async function presenceClass(): Promise<BiometricClass | null> {
  try {
    return biometricClassFor(enrolledLevel(await LocalAuthentication.getEnrolledLevelAsync()), Platform.OS);
  } catch {
    return null;
  }
}

/** The fingerprint-or-PIN prompt of a pin-gated key. */
async function askPresence(prompt: string, detail: string | undefined, cancelLabel: string) {
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    promptSubtitle: detail,
    cancelLabel,
    disableDeviceFallback: false,
    requireConfirmation: false,
  });
  return auth.success ? null : authFailure(auth.error);
}

function signWith(skHex: string, message: Uint8Array): string {
  const sk = hexToBytes(skHex);
  try {
    return bytesToHex(ed25519.sign(message, sk));
  } finally {
    sk.fill(0);
  }
}

async function forgetKey(meta: KeyMeta | null): Promise<void> {
  if (meta) await SecureStore.deleteItemAsync(secretName(meta.keyId), base).catch(() => {});
  await prefs.del(META);
}

export const keyVault: KeyVault = {
  kind: "device",

  current: readMeta,

  presence: presenceClass,

  async sign(req): Promise<KeySignOutcome> {
    const cls = await presenceClass();
    if (!cls) return { ok: false, reason: "no-lock" };
    const keyId = deviceKeyId(req.persona);
    let meta = await readMeta();
    // A phone re-paired to another officer never signs with the previous officer's key.
    if (meta && meta.keyId !== keyId) {
      await forgetKey(meta);
      meta = null;
    }

    if (meta) {
      let skHex: string | null;
      try {
        if (meta.biometricClass === "biometric-bound") {
          skHex = await SecureStore.getItemAsync(secretName(meta.keyId), {
            ...base,
            requireAuthentication: true,
            authenticationPrompt: req.prompt,
          });
        } else {
          const failed = await askPresence(req.prompt, req.detail, req.cancelLabel);
          if (failed) return { ok: false, reason: failed };
          skHex = await SecureStore.getItemAsync(secretName(meta.keyId), base);
        }
      } catch (e) {
        return { ok: false, reason: secureStoreFailure(e) };
      }
      // Null means the system invalidated the key (fingerprints changed) or the store was cleared.
      if (!skHex) return { ok: false, reason: "invalidated" };
      return { ok: true, key: meta, signatureHex: signWith(skHex, req.message), created: false };
    }

    // First signature: make the key inside the one presence step.
    const sk = randomBytes(32);
    const skHex = bytesToHex(sk);
    const fresh: KeyMeta = {
      keyId,
      publicKeyHex: bytesToHex(ed25519.getPublicKey(sk)),
      biometricClass: cls,
      createdAt: new Date().toISOString(),
    };
    try {
      if (cls === "biometric-bound") {
        // Android asks for the fingerprint to store a bound key: that prompt is this signature's presence step.
        const signatureHex = bytesToHex(ed25519.sign(req.message, sk));
        await SecureStore.setItemAsync(secretName(keyId), skHex, {
          ...base,
          requireAuthentication: true,
          authenticationPrompt: req.prompt,
        });
        await prefs.set(META, JSON.stringify(fresh));
        return { ok: true, key: fresh, signatureHex, created: true };
      }
      const failed = await askPresence(req.prompt, req.detail, req.cancelLabel);
      if (failed) return { ok: false, reason: failed };
      await SecureStore.setItemAsync(secretName(keyId), skHex, base);
      await prefs.set(META, JSON.stringify(fresh));
      return { ok: true, key: fresh, signatureHex: bytesToHex(ed25519.sign(req.message, sk)), created: true };
    } catch (e) {
      return { ok: false, reason: secureStoreFailure(e) };
    } finally {
      sk.fill(0);
    }
  },

  async forget() {
    await forgetKey(await readMeta());
  },
};
