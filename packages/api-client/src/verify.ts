// "Verify in your browser" (S3.12): the Proof verifier from `@fairsplit/domain/verify` with crypto that runs in
// a browser, in Node and in React Native: a synchronous SHA-256 (./bytes.ts) and Ed25519 from @noble/curves.
// Trust anchors always come from outside the bundle (`/.well-known/fairsplit-keys.json`); seeded and demo keys
// read "sample", never "verified".
//
//   import { verifyProof } from "@fairsplit/api-client/verify";
//   const result = verifyProof(bundle, publishedKeys, { demoMode: true });
//   result.status  // "verified" | "sample" | "failed", with each plate's verdict
import type { ChainVerification, ProofBundle, ProofTrust, PublishedKeys } from "@fairsplit/contracts";
import { type ProofCrypto, type VerifyOptions, verifyChainWith } from "@fairsplit/domain/verify";
import { ed25519 } from "@noble/curves/ed25519.js";
import { fromHex, sha256Hex } from "./bytes.js";

export * from "@fairsplit/domain/verify";

/** Portable crypto for the Proof verifier (identical results to the server's node:crypto). */
export const proofCrypto: ProofCrypto = {
  sha256Hex(data: string): string {
    return sha256Hex(data);
  },
  verifyEd25519(publicKeyHex: string, message: Uint8Array, signatureHex: string): boolean {
    try {
      return ed25519.verify(fromHex(signatureHex), message, fromHex(publicKeyHex));
    } catch {
      return false;
    }
  },
};

/** Verifies a Proof bundle's ledger chain, checkpoint and six plates against published keys. */
export function verifyProof(
  bundle: ProofBundle,
  trust: ProofTrust | PublishedKeys,
  options: VerifyOptions = {},
): ChainVerification {
  return verifyChainWith(bundle, proofCrypto, trust, options);
}
