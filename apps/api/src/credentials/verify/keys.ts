// Key material for credentials, derived once at boot and never logged.
//
// - FS_COOKIE_SECRET (≥ 32 chars) is the root of every HMAC: each purpose gets its own HKDF-SHA256 subkey
//   (`cookie:fs_js`, `cookie:fs_ops`, `ip-hash`, …), so a key leaked from one use cannot forge another.
// - FS_LINK_SIGNING_KEY is an Ed25519 seed (64 hex). The verify side needs only its public half; the
//   judge slice's issuer signs with the private half through `signLink()` in ./codec.ts.
// Outside production either may be absent: an ephemeral random key is used (and boot logs that sessions
// and links end on restart). Production refuses to boot without them (src/env.ts).
import { hkdfSync, type KeyObject, randomBytes } from "node:crypto";
import { ed25519FromSeed } from "@fairsplit/domain";

export type HmacPurpose = "cookie:fs_js" | "cookie:fs_ops" | "ip-hash" | (string & {});

export interface CredentialKeys {
  /** A 32-byte HMAC key for one purpose. */
  hmacKey(purpose: HmacPurpose): Buffer;
  /** Link verification key (raw Ed25519 public key, hex). */
  readonly linkPublicKeyHex: string;
  /** Link signing key, for the issuer only. */
  readonly linkPrivateKey: KeyObject;
  /** True when a key was generated for this process because the env had none. */
  readonly ephemeral: { cookie: boolean; link: boolean };
}

export function createCredentialKeys(secrets: {
  cookieSecret?: string | undefined;
  linkSigningKey?: string | undefined;
}): CredentialKeys {
  const cookieRoot = secrets.cookieSecret ? Buffer.from(secrets.cookieSecret, "utf8") : randomBytes(32);
  const linkSeed = secrets.linkSigningKey ?? randomBytes(32).toString("hex");
  const link = ed25519FromSeed(linkSeed);
  const cache = new Map<string, Buffer>();
  return {
    hmacKey(purpose) {
      let key = cache.get(purpose);
      if (!key) {
        key = Buffer.from(hkdfSync("sha256", cookieRoot, "fair-split/fs-api", purpose, 32));
        cache.set(purpose, key);
      }
      return key;
    },
    linkPublicKeyHex: link.publicKeyHex,
    linkPrivateKey: link.privateKey,
    ephemeral: { cookie: !secrets.cookieSecret, link: !secrets.linkSigningKey },
  };
}
