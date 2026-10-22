// Pins our parser and leaf checks to a genuine PayPal certificate (public data, see the fixture header).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYPAL_CERT_SUBJECTS } from "../env.js";
import { checkLeafCertificate, parsePemChain } from "./certs.js";

const fixture = readFileSync(
  new URL("./__fixtures__/paypal-sandbox-cert-ab66f33d.pem", import.meta.url),
  "utf8",
);
const crlf = fixture.replace(/\r?\n/g, "\r\n");

describe("a real PayPal sandbox message-verification certificate", () => {
  it("parses in both LF and PayPal's CRLF form, ignoring text outside the PEM armour", () => {
    const [lf] = parsePemChain(fixture);
    const [cr] = parsePemChain(crlf);
    expect(lf?.fingerprint256).toBe(cr?.fingerprint256);
    expect(lf?.subject).toContain("CN=messageverificationcerts.sandbox.paypal.com");
    expect(lf?.issuer).toContain("CN=DigiCert SHA2 Extended Validation Server CA");
  });

  it("passes the default sandbox leaf checks inside its validity window", () => {
    const [leaf] = parsePemChain(crlf);
    if (!leaf) throw new Error("fixture has no certificate");
    const at = Date.parse("2024-09-01T00:00:00Z");
    const loaded = { leaf, intermediates: [], fetchedAt: at };
    expect(checkLeafCertificate(loaded, { at, subjects: PAYPAL_CERT_SUBJECTS.sandbox })).toBeNull();
    expect(leaf.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("is refused as expired today and with the live subject", () => {
    const [leaf] = parsePemChain(fixture);
    if (!leaf) throw new Error("fixture has no certificate");
    const loaded = { leaf, intermediates: [], fetchedAt: 0 };
    expect(
      checkLeafCertificate(loaded, {
        at: Date.parse("2026-10-22T00:00:00Z"),
        subjects: PAYPAL_CERT_SUBJECTS.sandbox,
      }),
    ).toBe("CERT_EXPIRED");
    expect(
      checkLeafCertificate(loaded, {
        at: Date.parse("2024-09-01T00:00:00Z"),
        subjects: PAYPAL_CERT_SUBJECTS.live,
      }),
    ).toBe("CERT_SUBJECT_MISMATCH");
  });

  it("parsePemChain throws when there is no certificate", () => {
    expect(() => parsePemChain("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----")).toThrow();
  });
});
