// Proof's "Verify in your browser" runs domain's verify-core against the published keys (brief, W-PF-01).
// It comes through @fairsplit/api-client's re-export (the layer-ui dependency rule). This seam is the
// console's only import of it, so the Verify chunk can be code-split (S2.11: ≤45 KB, lazy).
// Import it lazily: `const { verifyChainWith, browserProofCrypto } = await import("../../lib/verify.js")`.

import type { ProofCrypto } from "@fairsplit/api-client/verify";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fromHex, sha256Hex } from "./sha256.js";

export * from "@fairsplit/api-client/verify";

/**
 * verify-core's crypto in a browser: SHA-256 from ./sha256 and strict RFC 8032 Ed25519 verification from
 * @noble/curves (S3.8 names noble as the browser fallback). Malformed hex never verifies.
 */
export const browserProofCrypto: ProofCrypto = {
  sha256Hex: (data) => sha256Hex(data),
  verifyEd25519: (publicKeyHex, message, signatureHex) => {
    const publicKey = fromHex(publicKeyHex);
    const signature = fromHex(signatureHex);
    if (publicKey?.length !== 32 || !signature || signature.length !== 64) return false;
    try {
      return ed25519.verify(signature, message, publicKey, { zip215: false });
    } catch {
      return false;
    }
  },
};
