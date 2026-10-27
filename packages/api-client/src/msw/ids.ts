// Deterministic identifiers for the mock world: the same seed label always yields the same UUID, so a UI
// test can hard-code `mockId("hold:DUPLICATE_SLIP:0457")` and a reload of the dev server keeps every URL.
import { sha256Hex, uuidv7 } from "../bytes.js";

/** A stable RFC 9562 UUID (version 7 layout, variant 10) derived from `label`. */
export function mockId(label: string): string {
  const h = sha256Hex(`fairsplit-mock:${label}`);
  const variant = ((Number.parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A fresh UUIDv7 (captures, sessions, review requests). */
export function freshId(nowMs: number): string {
  return uuidv7(nowMs);
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A token shaped like the server's (`fst_` frame/console, `fsd_` device): prefix plus 43 base64url chars. */
export function mockToken(prefix: "fst_" | "fsd_", seed: string): string {
  const hex = sha256Hex(`fairsplit-mock-token:${seed}`) + sha256Hex(`fairsplit-mock-token:${seed}:2`);
  let out = prefix;
  for (let i = 0; i < 43; i++) out += B64URL.charAt(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) & 63);
  return out;
}

/** Lowercase hex of `n` pseudo-random bytes derived from `seed` (nonces). */
export function mockHex(seed: string, bytes = 16): string {
  return sha256Hex(`fairsplit-mock-hex:${seed}`).slice(0, bytes * 2);
}
