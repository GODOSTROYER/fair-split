// "Identical across surfaces" rests on every JavaScript engine computing the same Math.sin, Math.cos and
// Math.atan2 before the 0.01 px rounding. Node (V8) pins the drawings below; the phone (Hermes), the Expo web
// export and the push renderer prove the claim by running verifySealGolden() and getting no mismatches. The
// fingerprint is a pure-JS FNV-1a so it needs no crypto module on any engine.

import { seal } from "./seal.js";

/** FNV-1a, 32 bits, over UTF-16 code units, as 8 lowercase hex digits. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A seal's drawing in 8 hex digits: every ring's path data, in ring order. */
export function sealFingerprint(batchSha256: string, size: number): string {
  return fnv1a32(
    seal(batchSha256, size)
      .rings.map((r) => r.d)
      .join("|"),
  );
}

export interface SealGoldenCase {
  readonly digest: string;
  readonly size: number;
  readonly fingerprint: string;
}

/**
 * Drawings pinned on Node 24 (V8), 22 Oct 2026: both variants, the print size, and digests whose bytes sit at
 * the ends of every range. Any change to the drawing changes these on purpose.
 */
export const SEAL_GOLDEN: readonly SealGoldenCase[] = [
  { digest: "0".repeat(64), size: 200, fingerprint: "769ab9e5" },
  { digest: "f".repeat(64), size: 200, fingerprint: "d4222dc2" },
  { digest: "0".repeat(64), size: 64, fingerprint: "9b547ef9" },
  { digest: "f".repeat(64), size: 64, fingerprint: "f750dcdb" },
  {
    digest: "7f3a91c2deadbeef0123456789abcdef0123456789abcdef0123456789abcdef",
    size: 96,
    fingerprint: "badd1893",
  },
  {
    digest: "7f3a91c2deadbeef0123456789abcdef0123456789abcdef0123456789abcdef",
    size: 384,
    fingerprint: "af1699ec",
  },
  {
    digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    size: 128,
    fingerprint: "8e633dea",
  },
  {
    digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    size: 320,
    fingerprint: "0dc02375",
  },
];

export interface SealGoldenReport {
  readonly ok: boolean;
  readonly mismatches: readonly (SealGoldenCase & { readonly actual: string })[];
}

/** Redraws every golden seal on this engine and lists any drawing that differs from Node's. */
export function verifySealGolden(cases: readonly SealGoldenCase[] = SEAL_GOLDEN): SealGoldenReport {
  const mismatches = cases
    .map((c) => ({ ...c, actual: sealFingerprint(c.digest, c.size) }))
    .filter((c) => c.actual !== c.fingerprint);
  return { ok: mismatches.length === 0, mismatches };
}
