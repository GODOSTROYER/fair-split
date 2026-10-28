// Key 1 of MM-5 (S3.8, register C-13): the treasurer's Ed25519 key, made in this browser and never sent
// anywhere. WebCrypto makes it non-extractable, so not even this page can read the private half; where a
// browser lacks WebCrypto Ed25519, a labelled demo key from @noble/curves lives in memory for the session
// instead. Only the signature and the public half ever leave the page. Both kinds are demo keys in Judge Mode
// (a device key is registered from /ops), and the screen says which one signed.

import { ed25519 } from "@noble/curves/ed25519.js";
import { toHex } from "../../lib/sha256.js";

export type BrowserKeyKind = "webcrypto" | "demo";

export interface BrowserKey {
  /** The contract's device-key form, `fs-{persona}-w{n}`: a web key (IC-01 DeviceKeyId). */
  readonly keyId: string;
  readonly kind: BrowserKeyKind;
  /** The raw 32-byte public key, hex: shown in groups of four so a person can compare it. */
  readonly publicKeyHex: string;
  /** Ed25519 over `bytes`; 64 bytes as 128 hex characters. */
  sign(bytes: Uint8Array): Promise<string>;
}

/** `fs-analyn-w1` from the officer's persona (`treasurer:analyn`). */
export function webKeyId(persona: string, n = 1): string {
  const name = (persona.split(":")[1] ?? persona).toLowerCase().replace(/[^a-z]/g, "");
  return `fs-${name}-w${n}`;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function webCryptoKey(keyId: string): Promise<BrowserKey | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const pair = (await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    // A key that could be exported is not the key the design promises: fall back rather than use it.
    if (pair.privateKey.extractable) return null;
    const publicKey = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    return {
      keyId,
      kind: "webcrypto",
      publicKeyHex: toHex(publicKey),
      sign: async (bytes) =>
        toHex(new Uint8Array(await subtle.sign({ name: "Ed25519" }, pair.privateKey, bufferOf(bytes)))),
    };
  } catch {
    return null;
  }
}

function demoKey(keyId: string): BrowserKey {
  const secret = ed25519.utils.randomSecretKey();
  return {
    keyId,
    kind: "demo",
    publicKeyHex: toHex(ed25519.getPublicKey(secret)),
    sign: async (bytes) => toHex(ed25519.sign(bytes, secret)),
  };
}

/** Makes a key: WebCrypto's non-extractable Ed25519 when the browser has it, else the labelled demo key. */
export async function makeBrowserKey(
  keyId: string,
  prefer: BrowserKeyKind = "webcrypto",
): Promise<BrowserKey> {
  if (prefer === "webcrypto") {
    const key = await webCryptoKey(keyId);
    if (key) return key;
  }
  return demoKey(keyId);
}

const keys = new Map<string, Promise<BrowserKey>>();

/**
 * One key per signer and judge session: the same scope gets the same key back (so a re-render never makes
 * a second key), and a new session makes a new one.
 */
export function browserKey(keyId: string, scope: string): Promise<BrowserKey> {
  const id = `${scope}:${keyId}`;
  let key = keys.get(id);
  if (!key) {
    key = makeBrowserKey(keyId);
    keys.set(id, key);
  }
  return key;
}

/** Tests: forget every key made in this page. */
export function forgetBrowserKeys(): void {
  keys.clear();
}
