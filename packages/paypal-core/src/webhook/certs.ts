// PayPal message-verification certificates: fetch, cache and check.
//
// Facts checked on 22 Oct 2026 against 10 certificates PayPal serves from /v1/notifications/certs/
// (sandbox and live, 2015-2027): the response is one PEM leaf (CRLF line endings, no intermediates),
// RSA-2048, subject/SAN messageverificationcerts.sandbox.paypal.com (live: messageverificationcerts.
// paypal.com), issued by "DigiCert SHA2 Extended Validation Server CA" until 2025 and by "DigiCert EV
// RSA CA G2" since. PayPal rotates yearly with a few weeks of overlap; old cert URLs keep serving
// their expired certificates, so validity is checked on every use, not just on fetch. The verifier
// checks validity apart from the other properties (expiredCertPolicy, see verify.ts).
//
// Trust model: the PEM is fetched over TLS (Node verifies PayPal's server certificate) from an
// allowlisted PayPal host, redirects refused. On top of that the leaf must be in its validity window,
// carry the expected subject and an RSA key of at least 2048 bits, and not be a CA. Optional
// `trustAnchors` additionally require a signature chain to a pinned certificate (used by tests with a
// throwaway CA, and available for pinning).

import { X509Certificate } from "node:crypto";

export interface LoadedCert {
  readonly leaf: X509Certificate;
  /** Any further certificates in the PEM bundle (PayPal currently sends none). */
  readonly intermediates: readonly X509Certificate[];
  readonly fetchedAt: number;
}

export interface CertCache {
  get(key: string): LoadedCert | undefined;
  set(key: string, value: LoadedCert): void;
  clear(): void;
  readonly size: number;
}

/** LRU cache keyed by cert URL (origin + path). Entries live at most `ttlMs` (default 24 h). */
export function createMemoryCertCache(
  options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
): CertCache {
  const maxEntries = options.maxEntries ?? 32;
  const ttlMs = options.ttlMs ?? 24 * 60 * 60_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, LoadedCert>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (now() - hit.fetchedAt > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** Parse every CERTIFICATE block in a PEM bundle (any line endings). Throws when there is none. */
export function parsePemChain(pem: string): X509Certificate[] {
  const blocks = pem.match(PEM_BLOCK) ?? [];
  if (blocks.length === 0) throw new Error("no PEM certificate found");
  return blocks.map((block) => new X509Certificate(block));
}

export type CertCheckFailure =
  | "CERT_NOT_YET_VALID"
  | "CERT_EXPIRED"
  | "CERT_KEY_UNSUPPORTED"
  | "CERT_IS_CA"
  | "CERT_SUBJECT_MISMATCH"
  | "CERT_UNTRUSTED";

const validAt = (cert: X509Certificate, at: number) =>
  at >= cert.validFromDate.getTime() && at <= cert.validToDate.getTime();

const issuedBy = (child: X509Certificate, parent: X509Certificate) => {
  try {
    return child.checkIssued(parent) && child.verify(parent.publicKey);
  } catch {
    return false;
  }
};

/** Walk leaf → intermediates → anchor, verifying each signature. A pinned leaf is trusted directly. */
function chainsToAnchor(
  leaf: X509Certificate,
  intermediates: readonly X509Certificate[],
  anchors: readonly X509Certificate[],
  at: number,
): boolean {
  if (anchors.some((a) => a.fingerprint256 === leaf.fingerprint256)) return true;
  let current = leaf;
  const used = new Set<X509Certificate>();
  for (let depth = 0; depth < 5; depth++) {
    if (anchors.some((a) => a.ca && validAt(a, at) && issuedBy(current, a))) return true;
    const next = intermediates.find((i) => !used.has(i) && i.ca && validAt(i, at) && issuedBy(current, i));
    if (!next) return false;
    used.add(next);
    current = next;
  }
  return false;
}

export interface LeafCheckOptions {
  at: number;
  /**
   * Expected subjects (SAN dNSName). Null skips the check, and only with trustAnchors: the simulator's leaf names no
   * PayPal host, so the chain to its CA stands in for it (PP_MODE=simulator, verify.ts `simulator`).
   */
  subjects: readonly string[] | null;
  trustAnchors?: readonly X509Certificate[];
  minRsaBits?: number;
}

export type CertValidityFailure = Extract<CertCheckFailure, "CERT_NOT_YET_VALID" | "CERT_EXPIRED">;
export type CertPropertyFailure = Exclude<CertCheckFailure, CertValidityFailure>;

/** Is `at` inside the certificate's validity window? Null when it is. */
export function checkCertValidity(leaf: X509Certificate, at: number): CertValidityFailure | null {
  if (at < leaf.validFromDate.getTime()) return "CERT_NOT_YET_VALID";
  if (at > leaf.validToDate.getTime()) return "CERT_EXPIRED";
  return null;
}

/**
 * Everything except the validity window: RSA key of at least 2048 bits, not a CA, the expected
 * subject, and (with trust anchors) a verified chain. The verifier evaluates these separately so
 * that a PayPal signature made with an expired certificate can still be recognised as such.
 */
export function checkLeafProperties(cert: LoadedCert, options: LeafCheckOptions): CertPropertyFailure | null {
  const { leaf } = cert;
  const key = leaf.publicKey;
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== "rsa" || bits < (options.minRsaBits ?? 2048)) return "CERT_KEY_UNSUPPORTED";
  if (leaf.ca) return "CERT_IS_CA";
  if (options.subjects === null) {
    if (!options.trustAnchors || options.trustAnchors.length === 0) return "CERT_UNTRUSTED";
  } else if (!options.subjects.some((s) => leaf.checkHost(s) !== undefined)) return "CERT_SUBJECT_MISMATCH";
  if (options.trustAnchors && !chainsToAnchor(leaf, cert.intermediates, options.trustAnchors, options.at)) {
    return "CERT_UNTRUSTED";
  }
  return null;
}

/** Every check applied on each use of a (possibly cached) certificate. Returns null when it passes. */
export function checkLeafCertificate(cert: LoadedCert, options: LeafCheckOptions): CertCheckFailure | null {
  return checkCertValidity(cert.leaf, options.at) ?? checkLeafProperties(cert, options);
}
