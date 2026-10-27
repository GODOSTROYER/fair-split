// RFC 8785 JSON Canonicalization (JCS). Pure: no node built-ins, so browser code can use it.
import canonicalize from "canonicalize";

/** JCS string of a JSON value. Throws on values JSON cannot carry (bigint, undefined, NaN). */
export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("value is not JSON-serialisable");
  return out;
}

/** UTF-8 bytes of the JCS form (what an approver signs). */
export function jcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(jcs(value));
}
