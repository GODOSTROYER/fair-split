// Stable identifiers for the mock API: UUID-shaped (version 7 layout, RFC 9562 variant) so every contract
// schema accepts them, derived from a name so the same hold or line keeps the same ID across a session.
// Not random and not secret: mock data only.

import { sha256Hex } from "../../lib/sha256.js";

/** A deterministic UUID for a name. */
export function mockUuid(name: string): string {
  const h = sha256Hex(`fs-mock:${name}`);
  const variant = ((Number.parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A deterministic lowercase hex string of `length` characters. */
export function mockHex(name: string, length: number): string {
  let out = "";
  let i = 0;
  while (out.length < length) {
    out += sha256Hex(`fs-mock:${name}:${i}`);
    i += 1;
  }
  return out.slice(0, length);
}

/** RFC 8785 canonical JSON for the flat payloads the mock signs over: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
