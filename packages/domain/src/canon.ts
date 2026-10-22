// JCS plus sha256 (node:crypto). Every hash in Fair Split is computed with these: the rate card,
// line hashes, the batch digest, approval payloads and the ledger chain.
import { createHash } from "node:crypto";
import { jcs } from "./jcs.js";

export { jcs, jcsBytes } from "./jcs.js";

/** Lowercase hex sha256. Strings are hashed as their UTF-8 bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of the JCS form of a value. */
export function jcsSha256(value: unknown): string {
  return sha256Hex(jcs(value));
}
