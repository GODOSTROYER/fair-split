// The simulator's webhook signing material: a self-signed CA and a leaf certificate, generated on first start
// and (when a data directory is configured) stored under packages/paypal-sim/.data, which git ignores.
// The leaf signs deliveries exactly like PayPal: RSA-SHA256 over transmissionId|time|webhookId|crc32(body).
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCertificate, toPem } from "./x509.js";

export interface SigningMaterial {
  /** `SIMCERT-xxxxxxxx-xxxxxxxx-xxxxxxxx`, derived from the leaf certificate's fingerprint. */
  certId: string;
  /** Leaf then CA, as PayPal's cert URL serves a chain. */
  chainPem: string;
  leaf: X509Certificate;
  ca: X509Certificate;
  signMessage(message: string): string;
  verifyMessage(message: string, signatureB64: string): boolean;
}

const CA_DN = {
  commonName: "Fair Split PayPal Simulator Test CA (NOT PayPal)",
  organization: "Fair Split simulated rail",
  country: "US",
};
const LEAF_DN = {
  commonName: "Fair Split PayPal Simulator webhook signer (NOT PayPal)",
  organization: "Fair Split simulated rail",
  country: "US",
};

function generate(now: Date): { caKey: KeyObject; leafKey: KeyObject; caPem: string; leafPem: string } {
  const ca = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const leaf = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const dayMs = 86_400_000;
  const caDer = createCertificate({
    subject: CA_DN,
    issuer: CA_DN,
    subjectPublicKey: ca.publicKey,
    issuerPrivateKey: ca.privateKey,
    issuerPublicKey: ca.publicKey,
    notBefore: new Date(now.getTime() - dayMs),
    notAfter: new Date(now.getTime() + 3650 * dayMs),
    isCA: true,
  });
  const leafDer = createCertificate({
    subject: LEAF_DN,
    issuer: CA_DN,
    subjectPublicKey: leaf.publicKey,
    issuerPrivateKey: ca.privateKey,
    issuerPublicKey: ca.publicKey,
    notBefore: new Date(now.getTime() - dayMs),
    notAfter: new Date(now.getTime() + 730 * dayMs),
    isCA: false,
  });
  return { caKey: ca.privateKey, leafKey: leaf.privateKey, caPem: toPem(caDer), leafPem: toPem(leafDer) };
}

function material(leafKey: KeyObject, leafPem: string, caPem: string): SigningMaterial {
  const leaf = new X509Certificate(leafPem);
  const ca = new X509Certificate(caPem);
  const fp = createHash("sha256").update(leaf.raw).digest("hex");
  const certId = `SIMCERT-${fp.slice(0, 8)}-${fp.slice(8, 16)}-${fp.slice(16, 24)}`;
  const publicKey = createPublicKey(leafPem);
  return {
    certId,
    chainPem: leafPem + caPem,
    leaf,
    ca,
    signMessage: (message) => sign("sha256", Buffer.from(message, "utf8"), leafKey).toString("base64"),
    verifyMessage: (message, signatureB64) => {
      try {
        return verify("sha256", Buffer.from(message, "utf8"), publicKey, Buffer.from(signatureB64, "base64"));
      } catch {
        return false;
      }
    },
  };
}

let memoryCache: SigningMaterial | undefined;

/**
 * Loads signing material from `dataDir` (creating it on first start), or, when `dataDir` is null, from a
 * per-process cache so tests do not pay for RSA key generation on every simulator.
 */
export function loadSigningMaterial(dataDir: string | null, now: Date = new Date()): SigningMaterial {
  if (dataDir === null) {
    if (!memoryCache) {
      const g = generate(now);
      memoryCache = material(g.leafKey, g.leafPem, g.caPem);
    }
    return memoryCache;
  }
  const certDir = join(dataDir, "certs");
  const files = {
    caKey: join(certDir, "ca.key.pem"),
    caCert: join(certDir, "ca.cert.pem"),
    leafKey: join(certDir, "leaf.key.pem"),
    leafCert: join(certDir, "leaf.cert.pem"),
  };
  if (existsSync(files.leafKey) && existsSync(files.leafCert) && existsSync(files.caCert)) {
    const leafKey = createPrivateKey(readFileSync(files.leafKey, "utf8"));
    const m = material(leafKey, readFileSync(files.leafCert, "utf8"), readFileSync(files.caCert, "utf8"));
    if (new Date(m.leaf.validTo).getTime() > now.getTime()) return m;
  }
  mkdirSync(certDir, { recursive: true });
  const g = generate(now);
  const writePrivate = (path: string, key: KeyObject) => {
    writeFileSync(path, key.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // best effort on Windows
    }
  };
  writePrivate(files.caKey, g.caKey);
  writePrivate(files.leafKey, g.leafKey);
  writeFileSync(files.caCert, g.caPem);
  writeFileSync(files.leafCert, g.leafPem);
  return material(g.leafKey, g.leafPem, g.caPem);
}
