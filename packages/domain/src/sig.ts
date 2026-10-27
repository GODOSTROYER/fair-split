// Ed25519 over raw 32-byte keys, using node:crypto (pure computation, no IO). Devices sign with
// @noble/curves; the server and the Proof verifier only verify. The seed derives labelled demo keys.
import { createPrivateKey, createPublicKey, type KeyObject, sign, verify } from "node:crypto";

const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

function b64urlToHex(s: string): string {
  return Buffer.from(s, "base64url").toString("hex");
}

function hexToB64url(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64url");
}

export interface Ed25519KeyPair {
  privateKey: KeyObject;
  publicKeyHex: string;
}

/** Key pair from a 32-byte seed (hex). Deterministic: used for the seed's labelled demo keys. */
export function ed25519FromSeed(seedHex: string): Ed25519KeyPair {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new RangeError("seed must be 32 bytes of hex");
  const privateKey = createPrivateKey({
    key: Buffer.from(PKCS8_ED25519_PREFIX + seedHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("could not derive the public key");
  return { privateKey, publicKeyHex: b64urlToHex(jwk.x) };
}

function bytes(message: string | Uint8Array): Buffer {
  return typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
}

export function ed25519Sign(privateKey: KeyObject, message: string | Uint8Array): string {
  return sign(null, bytes(message), privateKey).toString("hex");
}

/** Verifies a hex signature against a raw hex public key. Never throws on bad input. */
export function ed25519Verify(
  publicKeyHex: string,
  message: string | Uint8Array,
  signatureHex: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex) || !/^[0-9a-f]{128}$/.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: hexToB64url(publicKeyHex) },
      format: "jwk",
    });
    return verify(null, bytes(message), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
