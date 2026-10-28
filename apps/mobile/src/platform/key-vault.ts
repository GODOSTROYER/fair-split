/**
 * The Chair's signing key on the phone (architecture §9, S3.8, C-13): Ed25519 from @noble/curves, the secret half in
 * SecureStore (Android Keystore, this device only, readable only while unlocked), never in a file, a log or a URL.
 *
 * The rules live in `createDeviceVault` (lib/signing.ts, tested in Node): one presence step per signature, chosen
 * from what the phone has enrolled (`biometricClassFor`):
 * - "biometric-bound" (a strong fingerprint on Android): the secret is user-authentication-bound
 *   (`requireAuthentication`), so the OS fingerprint prompt guards every read;
 * - "pin-gated" (weak biometrics, a PIN or pattern only, or iOS): expo-local-authentication asks for the fingerprint
 *   or the device PIN ("No biometric: the device PIN is used", design D2), then the secret is read.
 * A phone with no screen lock cannot hold a co-sign key. Fingerprints added or removed invalidate a bound key; the
 * Chair makes a new one under the next key ID (`fs-ernesto-a2`), which the server registers as a new key.
 * This file only binds those rules to SecureStore, the preferences store and the OS prompts.
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  authFailure,
  type BiometricClass,
  biometricClassFor,
  createDeviceVault,
  enrolledLevel,
  type KeyFailure,
  type KeyVault,
} from "../lib/signing";
import { prefs } from "./kv";
import { randomBytes } from "./random";

export type { BiometricClass, KeyMeta, KeyVault } from "../lib/signing";

const base: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function options(bound: boolean, prompt: string): SecureStore.SecureStoreOptions {
  return bound ? { ...base, requireAuthentication: true, authenticationPrompt: prompt } : base;
}

async function presenceClass(): Promise<BiometricClass | null> {
  try {
    return biometricClassFor(enrolledLevel(await LocalAuthentication.getEnrolledLevelAsync()), Platform.OS);
  } catch {
    return null;
  }
}

/** The fingerprint-or-PIN prompt of a pin-gated key. */
async function askPresence(
  prompt: string,
  detail: string | undefined,
  cancelLabel: string,
): Promise<KeyFailure | null> {
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    promptSubtitle: detail,
    cancelLabel,
    disableDeviceFallback: false,
    requireConfirmation: false,
  });
  return auth.success ? null : authFailure(auth.error);
}

export const keyVault: KeyVault = createDeviceVault({
  prefs,
  secrets: {
    get: (name, { bound, prompt }) => SecureStore.getItemAsync(name, options(bound, prompt)),
    set: (name, value, { bound, prompt }) => SecureStore.setItemAsync(name, value, options(bound, prompt)),
    del: (name) => SecureStore.deleteItemAsync(name, base),
  },
  presence: presenceClass,
  askPresence,
  randomBytes,
  now: () => new Date(),
});
