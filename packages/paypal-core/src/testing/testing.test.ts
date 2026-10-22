import { verify, X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createCertificate, createTestPki, signWebhook, TEST_CERT_SUBJECT, TEST_CERT_URL } from "./index.js";

describe("testing PKI (node:crypto only)", () => {
  const pki = createTestPki();
  const leaf = pki.issueLeaf();

  it("builds a CA certificate that Node parses as a CA", () => {
    expect(pki.ca.cert.ca).toBe(true);
    expect(pki.ca.cert.subject).toContain("CN=Fair Split Throwaway Test CA");
    expect(pki.ca.cert.verify(pki.ca.publicKey)).toBe(true);
  });

  it("issues a leaf that chains to the CA and carries the PayPal sandbox subject", () => {
    expect(leaf.cert.ca).toBe(false);
    expect(leaf.cert.checkIssued(pki.ca.cert)).toBe(true);
    expect(leaf.cert.verify(pki.ca.publicKey)).toBe(true);
    expect(leaf.cert.checkHost(TEST_CERT_SUBJECT)).toBe(TEST_CERT_SUBJECT);
    expect(leaf.cert.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("writes PEM with CRLF line endings, like PayPal's cert endpoint", () => {
    expect(leaf.pem.startsWith("-----BEGIN CERTIFICATE-----\r\n")).toBe(true);
    expect(new X509Certificate(leaf.pem).fingerprint256).toBe(leaf.cert.fingerprint256);
  });

  it("encodes validity windows outside 1950-2049 as GeneralizedTime", () => {
    const far = createCertificate({
      commonName: "far.example.test",
      notBefore: new Date("2049-12-31T00:00:00Z"),
      notAfter: new Date("2051-01-01T00:00:00Z"),
    });
    expect(far.cert.validToDate.toISOString()).toBe("2051-01-01T00:00:00.000Z");
  });

  it("signs webhooks the way PayPal does", () => {
    const signed = signWebhook({
      body: { id: "WH-1", event_type: "X" },
      webhookId: "WH123",
      privateKey: leaf.privateKey,
    });
    const h = signed.headers;
    expect(h["paypal-cert-url"]).toBe(TEST_CERT_URL);
    expect(h["paypal-auth-algo"]).toBe("SHA256withRSA");
    const crc = crc32(Buffer.from(signed.body)) >>> 0;
    expect(signed.crc32).toBe(crc);
    const message = `${h["paypal-transmission-id"]}|${h["paypal-transmission-time"]}|WH123|${crc}`;
    const sig = Buffer.from(h["paypal-transmission-sig"] ?? "", "base64");
    expect(verify("sha256", Buffer.from(message), leaf.publicKey, sig)).toBe(true);
  });
});
