// Deterministic UUIDv7 (RFC 9562): a 48-bit Unix-millisecond timestamp, version 7, variant 10, and
// 74 bits taken from sha256(seed). The seed generator uses it so every ID in the snapshot is stable.
import { sha256Hex } from "./canon.js";

export function uuidv7(ms: number, seed: string): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms >= 2 ** 48) throw new RangeError("timestamp out of range");
  const ts = ms.toString(16).padStart(12, "0");
  const h = sha256Hex(seed);
  const randA = h.slice(0, 3);
  const variantNibble = ((Number.parseInt(h.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  const randB = h.slice(4, 19);
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${randA}-${variantNibble}${randB.slice(0, 3)}-${randB.slice(3, 15)}`;
}

/** Milliseconds encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
}
