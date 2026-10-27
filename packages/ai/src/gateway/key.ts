import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { ClaudeModel, Effort, Variant } from "./types.js";

/** RFC 8785 JSON Canonicalization Scheme. Throws on values JSON cannot represent. */
export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("jcs: value has no JSON representation");
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256(JCS(value)): the `inputSha` of a text call (S4 register deviation 2). */
export function inputShaOf(value: unknown): string {
  return sha256Hex(jcs(value));
}

export interface CacheKeyParts {
  imageSha: string;
  variant: Variant;
  promptV: string;
  schemaV: string;
  model: ClaudeModel;
  effort: Effort;
}

/** Register §9: the replay cache key is sha256 of {imageSha, variant, promptV, schemaV, model, effort}. */
export function cacheKey(parts: CacheKeyParts): string {
  const { imageSha, variant, promptV, schemaV, model, effort } = parts;
  return sha256Hex(jcs({ imageSha, variant, promptV, schemaV, model, effort }));
}
