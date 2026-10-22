/**
 * Board signing keys on the phone (architecture §9, S3.8, C-13). An Ed25519 key is generated on the device with
 * @noble/curves and kept in SecureStore:
 * - "biometric-bound" when the phone has strong biometrics: the key itself requires a fingerprint to read
 *   (SecureStore `requireAuthentication`, Android Keystore user-auth-bound), so the OS shows the prompt;
 * - "pin-gated" otherwise: expo-local-authentication asks for the fingerprint or device PIN before the key is read
 *   ("No biometric: the device PIN is used", design D2).
 * A phone with no screen lock cannot hold a co-sign key.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Signer, SignOutcome } from "../lib/signing";
import { prefs } from "./kv";
import { randomBytes } from "./random";

export type BiometricClass = "biometric-bound" | "pin-gated" | "none";

export interface KeyMeta {
  keyId: string;
  publicKeyHex: string;
  biometricClass: BiometricClass;
  createdAt: string;
}

export interface KeyVault {
  readonly kind: "device" | "demo";
  current(): Promise<KeyMeta | null>;
  ensureKey(
    persona: string,
    prompt: string,
  ): Promise<KeyMeta | { error: "no-lock" | "cancelled" | "failed" }>;
  signer(meta: KeyMeta, cancelLabel: string): Signer;
  forget(): Promise<void>;
}

const META = "fs.boardKey.meta";
const secretName = (keyId: string) => `fs.boardKey.sk.${keyId}`;
const base: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function classify(e: unknown): SignOutcome {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/cancel/i.test(msg)) return { ok: false, reason: "cancelled" };
  if (/invalidat|KeyPermanentlyInvalidated|decrypt/i.test(msg)) return { ok: false, reason: "invalidated" };
  return { ok: false, reason: "error" };
}

export const keyVault: KeyVault = {
  kind: "device",

  async current() {
    const raw = await prefs.get(META);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as KeyMeta;
    } catch {
      return null;
    }
  },

  async ensureKey(persona, prompt) {
    const existing = await this.current();
    if (existing) return existing;
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return { error: "no-lock" };
    const biometricClass: BiometricClass =
      level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG && Platform.OS === "android"
        ? "biometric-bound"
        : "pin-gated";
    const sk = randomBytes(32);
    const keyId = `fs-${persona}-a1`;
    try {
      await SecureStore.setItemAsync(
        secretName(keyId),
        bytesToHex(sk),
        biometricClass === "biometric-bound"
          ? { ...base, requireAuthentication: true, authenticationPrompt: prompt }
          : base,
      );
    } catch (e) {
      return { error: /cancel/i.test(String(e)) ? "cancelled" : "failed" };
    }
    const meta: KeyMeta = {
      keyId,
      publicKeyHex: bytesToHex(ed25519.getPublicKey(sk)),
      biometricClass,
      createdAt: new Date().toISOString(),
    };
    sk.fill(0);
    await prefs.set(META, JSON.stringify(meta));
    return meta;
  },

  signer(meta, cancelLabel) {
    return {
      keyId: meta.keyId,
      kind: "device",
      publicKeyHex: async () => meta.publicKeyHex,
      async sign(message, prompt) {
        let hex: string | null;
        try {
          if (meta.biometricClass === "biometric-bound") {
            hex = await SecureStore.getItemAsync(secretName(meta.keyId), {
              ...base,
              requireAuthentication: true,
              authenticationPrompt: prompt,
            });
          } else {
            const auth = await LocalAuthentication.authenticateAsync({
              promptMessage: prompt,
              cancelLabel,
              disableDeviceFallback: false,
              requireConfirmation: false,
            });
            if (!auth.success) {
              const cancelled = ["user_cancel", "system_cancel", "app_cancel", "user_fallback"].includes(
                auth.error,
              );
              return {
                ok: false,
                reason: cancelled ? "cancelled" : auth.error === "not_enrolled" ? "unavailable" : "error",
              };
            }
            hex = await SecureStore.getItemAsync(secretName(meta.keyId), base);
          }
        } catch (e) {
          return classify(e);
        }
        if (!hex) return { ok: false, reason: "invalidated" };
        const sk = hexToBytes(hex);
        try {
          return { ok: true, signatureHex: bytesToHex(ed25519.sign(message, sk)) };
        } finally {
          sk.fill(0);
        }
      },
    };
  },

  async forget() {
    const meta = await this.current();
    if (meta) await SecureStore.deleteItemAsync(secretName(meta.keyId), base).catch(() => {});
    await prefs.del(META);
  },
};
