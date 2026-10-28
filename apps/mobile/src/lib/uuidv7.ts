/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix milliseconds, version 7, 74 random bits. Captures use it as the
 * Idempotency-Key, so a retried upload is the same request (architecture §6.7, "Mobile capture").
 */
export type RandomBytes = (n: number) => Uint8Array;

export function uuidv7(nowMs: number, randomBytes: RandomBytes): string {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffff_ffff_ffff)
    throw new RangeError("Bad timestamp");
  const b = new Uint8Array(16);
  const r = randomBytes(10);
  if (r.length < 10) throw new RangeError("randomBytes returned too few bytes");
  let ms = nowMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b.set(r, 6);
  b[6] = 0x70 | ((b[6] ?? 0) & 0x0f); // version 7
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f); // RFC 9562 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Milliseconds encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
