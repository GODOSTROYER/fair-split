// @fairsplit/paypal-core/testing: a throwaway webhook PKI and a PayPal-style webhook signer, built on
// node:crypto only. Used by this package's tests, the webhook route's tests and (later) test-kit's
// re-signed fixtures. Never import from production code: keys are generated in memory per process.

import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
  sign,
  X509Certificate,
} from "node:crypto";
import { crc32 } from "node:zlib";
import {
  bitString,
  boolean,
  explicit,
  implicitPrimitive,
  integer,
  nullValue,
  objectIdentifier,
  octetString,
  printableString,
  sequence,
  set,
  time,
  utf8String,
} from "./der.js";

const SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const DAY = 24 * 60 * 60_000;

export const TEST_CERT_SUBJECT = "messageverificationcerts.sandbox.paypal.com";
/**
 * A cert URL that passes the sandbox allowlist and PayPal's id shape; serve the test PEM here with msw
 * or an injected fetch. Real PayPal ids start CERT-360caa42-, so the zeros mark this one as synthetic.
 */
export const TEST_CERT_URL =
  "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-00000000-00000000-00000001";
export const TEST_WEBHOOK_ID = "8PT597110X687430LKGECATA";

/** A further synthetic, well-formed cert URL, stable per label (`CERT-00000000-00000000-<sha256(label)[0..8]>`). */
export function testCertUrl(label: string, host = "api.sandbox.paypal.com"): string {
  const id = createHash("sha256").update(label).digest("hex").slice(0, 8);
  return `https://${host}/v1/notifications/certs/CERT-00000000-00000000-${id}`;
}

export interface TestCertificate {
  pem: string;
  der: Buffer;
  cert: X509Certificate;
  privateKey: KeyObject;
  publicKey: KeyObject;
  commonName: string;
}

export interface CertificateOptions {
  commonName: string;
  dnsNames?: readonly string[];
  notBefore?: Date;
  notAfter?: Date;
  isCA?: boolean;
  keyBits?: number;
  /** Signing certificate; omit for a self-signed certificate. */
  issuer?: TestCertificate;
  serial?: bigint;
}

const name = (commonName: string) =>
  sequence(
    set(sequence(objectIdentifier("2.5.4.6"), printableString("US"))),
    set(sequence(objectIdentifier("2.5.4.10"), utf8String("Fair Split Test PKI"))),
    set(sequence(objectIdentifier("2.5.4.3"), utf8String(commonName))),
  );

const extension = (oid: string, critical: boolean, value: Buffer) =>
  sequence(objectIdentifier(oid), ...(critical ? [boolean(true)] : []), octetString(value));

function toPem(der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  // PayPal serves its certificates with CRLF line endings; so do we.
  return `-----BEGIN CERTIFICATE-----\r\n${lines.join("\r\n")}\r\n-----END CERTIFICATE-----\r\n`;
}

let serialCounter = 0x1000n;

/** Build and sign an X.509 v3 certificate (sha256WithRSAEncryption). */
export function createCertificate(options: CertificateOptions): TestCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: options.keyBits ?? 2048 });
  const now = Date.now();
  const notBefore = options.notBefore ?? new Date(now - DAY);
  const notAfter = options.notAfter ?? new Date(now + 365 * DAY);
  const isCA = options.isCA === true;
  serialCounter += 1n;
  const extensions = [
    extension("2.5.29.19", true, isCA ? sequence(boolean(true)) : sequence()),
    // keyUsage: CA = keyCertSign + cRLSign (0x06, 1 unused bit); leaf = digitalSignature (0x80, 7 unused bits)
    extension(
      "2.5.29.15",
      true,
      isCA ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7),
    ),
    ...(options.dnsNames && options.dnsNames.length > 0
      ? [
          extension(
            "2.5.29.17",
            false,
            sequence(...options.dnsNames.map((dns) => implicitPrimitive(2, Buffer.from(dns, "ascii")))),
          ),
        ]
      : []),
  ];
  const algorithm = sequence(objectIdentifier(SHA256_WITH_RSA), nullValue());
  const tbs = sequence(
    explicit(0, integer(2n)),
    integer(options.serial ?? serialCounter),
    algorithm,
    name(options.issuer?.commonName ?? options.commonName),
    sequence(time(notBefore), time(notAfter)),
    name(options.commonName),
    publicKey.export({ type: "spki", format: "der" }),
    explicit(3, sequence(...extensions)),
  );
  const signature = sign("sha256", tbs, options.issuer?.privateKey ?? privateKey);
  const der = sequence(tbs, algorithm, bitString(signature));
  const pem = toPem(der);
  return { pem, der, cert: new X509Certificate(pem), privateKey, publicKey, commonName: options.commonName };
}

export interface TestPki {
  ca: TestCertificate;
  /** A message-verification leaf issued by this CA (SAN messageverificationcerts.sandbox.paypal.com by default). */
  issueLeaf(options?: Partial<Omit<CertificateOptions, "issuer">>): TestCertificate;
}

/** A throwaway CA plus a leaf factory. */
export function createTestPki(
  options: { commonName?: string; notBefore?: Date; notAfter?: Date } = {},
): TestPki {
  const ca = createCertificate({
    commonName: options.commonName ?? "Fair Split Throwaway Test CA",
    isCA: true,
    ...(options.notBefore ? { notBefore: options.notBefore } : {}),
    ...(options.notAfter ? { notAfter: options.notAfter } : {}),
  });
  return {
    ca,
    issueLeaf(leaf = {}) {
      return createCertificate({
        commonName: TEST_CERT_SUBJECT,
        dnsNames: [TEST_CERT_SUBJECT],
        ...leaf,
        issuer: ca,
      });
    },
  };
}

export interface SignWebhookOptions {
  /** Raw body as sent; objects are serialized compactly, as PayPal does. */
  body: string | object;
  webhookId: string;
  privateKey: KeyObject;
  certUrl?: string;
  transmissionId?: string;
  transmissionTime?: string;
  authAlgo?: string;
}

export interface SignedWebhook {
  body: string;
  headers: Record<string, string>;
  crc32: number;
}

/** Sign a body exactly as PayPal does: RSA-SHA256 over `id|time|webhookId|crc32(raw)`. */
export function signWebhook(options: SignWebhookOptions): SignedWebhook {
  const body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  const transmissionId = options.transmissionId ?? randomUUID();
  const transmissionTime = options.transmissionTime ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const crc = crc32(Buffer.from(body, "utf8")) >>> 0;
  const signature = sign(
    "sha256",
    Buffer.from(`${transmissionId}|${transmissionTime}|${options.webhookId}|${crc}`, "utf8"),
    options.privateKey,
  ).toString("base64");
  return {
    body,
    crc32: crc,
    headers: {
      "content-type": "application/json",
      "paypal-auth-algo": options.authAlgo ?? "SHA256withRSA",
      "paypal-auth-version": "v2",
      "paypal-cert-url": options.certUrl ?? TEST_CERT_URL,
      "paypal-transmission-id": transmissionId,
      "paypal-transmission-sig": signature,
      "paypal-transmission-time": transmissionTime,
    },
  };
}

/** A synthetic webhook event in PayPal's envelope shape. Ids are deterministic for a given seed. */
export function syntheticEvent(
  eventType: string,
  resource: Record<string, unknown>,
  seed = eventType,
): object {
  const digest = createHash("sha256").update(seed).digest("hex").toUpperCase();
  return {
    id: `WH-${digest.slice(0, 17)}-${digest.slice(17, 34)}`,
    event_version: "1.0",
    create_time: "2026-10-29T09:12:44.000Z",
    resource_type: eventType.startsWith("INVOICING.")
      ? "invoices"
      : eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")
        ? "payouts_item"
        : "payouts",
    event_type: eventType,
    summary: `Synthetic ${eventType} (Fair Split test)`,
    resource,
    links: [],
  };
}

/** Item event resource as PayPal sends it (sender_item_id nested under payout_item). */
export function payoutItemResource(options: {
  senderItemId: string;
  payoutItemId: string;
  payoutBatchId: string;
  transactionStatus: string;
}): Record<string, unknown> {
  return {
    payout_item_id: options.payoutItemId,
    transaction_status: options.transactionStatus,
    payout_batch_id: options.payoutBatchId,
    payout_item: {
      recipient_type: "EMAIL",
      amount: { currency: "USD", value: "1.00" },
      receiver: "member@example.test",
      sender_item_id: options.senderItemId,
    },
    links: [],
  };
}
