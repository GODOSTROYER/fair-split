// Pins our parser and leaf checks to genuine PayPal certificates (public data, see the fixture headers).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYPAL_CERT_SUBJECTS } from "../env.js";
import { checkCertUrl } from "./cert-url.js";
import { checkCertValidity, checkLeafCertificate, checkLeafProperties, parsePemChain } from "./certs.js";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const expired2025 = fixture("paypal-sandbox-cert-ab66f33d.pem");
const current = fixture("paypal-sandbox-cert-bf9ab596.pem");
const crlf = (pem: string) => pem.replace(/\r?\n/g, "\r\n");
const leafOf = (pem: string) => {
  const [leaf] = parsePemChain(pem);
  if (!leaf) throw new Error("fixture has no certificate");
  return { leaf, intermediates: [], fetchedAt: 0 };
};

describe("a real PayPal sandbox message-verification certificate (ab66f33d, expired 7 Mar 2025)", () => {
  it("parses in both LF and PayPal's CRLF form, ignoring text outside the PEM armour", () => {
    const [lf] = parsePemChain(expired2025);
    const [cr] = parsePemChain(crlf(expired2025));
    expect(lf?.fingerprint256).toBe(cr?.fingerprint256);
    expect(lf?.subject).toContain("CN=messageverificationcerts.sandbox.paypal.com");
    expect(lf?.issuer).toContain("CN=DigiCert SHA2 Extended Validation Server CA");
  });

  it("passes the default sandbox leaf checks inside its validity window", () => {
    const loaded = leafOf(crlf(expired2025));
    const at = Date.parse("2024-09-01T00:00:00Z");
    expect(checkLeafCertificate(loaded, { at, subjects: PAYPAL_CERT_SUBJECTS.sandbox })).toBeNull();
    expect(loaded.leaf.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("is refused as expired today and with the live subject", () => {
    const loaded = leafOf(expired2025);
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

  it("keeps passing the non-validity checks after expiry, so a signature under it can still be judged", () => {
    const loaded = leafOf(expired2025);
    const at = Date.parse("2026-10-22T00:00:00Z");
    expect(checkCertValidity(loaded.leaf, at)).toBe("CERT_EXPIRED");
    expect(checkLeafProperties(loaded, { at, subjects: PAYPAL_CERT_SUBJECTS.sandbox })).toBeNull();
  });

  it("parsePemChain throws when there is no certificate", () => {
    expect(() => parsePemChain("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----")).toThrow();
  });
});

describe("the sandbox signing certificate in use in October 2026 (bf9ab596)", () => {
  const url = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596";

  it("has PayPal's subject, an RSA-2048 key, a new issuer, and a URL our allowlist accepts", () => {
    const { leaf } = leafOf(crlf(current));
    expect(leaf.subject).toContain("CN=messageverificationcerts.sandbox.paypal.com");
    expect(leaf.issuer).toContain("CN=DigiCert EV RSA CA G2");
    expect(leaf.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(leaf.ca).toBe(false);
    expect(checkCertUrl(url, ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"]).ok).toBe(true);
  });

  it("passes every leaf check on 22 Oct 2026 and through the 12 Nov deadline and the December freeze", () => {
    const loaded = leafOf(current);
    for (const day of ["2026-10-22T08:00:00Z", "2026-11-13T00:00:00Z", "2026-12-15T23:59:59Z"]) {
      expect(
        checkLeafCertificate(loaded, { at: Date.parse(day), subjects: PAYPAL_CERT_SUBJECTS.sandbox }),
      ).toBe(null);
    }
  });

  it("expires after 26 Jan 2027, when PayPal will have rotated again", () => {
    const loaded = leafOf(current);
    expect(loaded.leaf.validToDate.toISOString()).toBe("2027-01-26T23:59:59.000Z");
    expect(checkCertValidity(loaded.leaf, Date.parse("2027-01-27T00:00:00Z"))).toBe("CERT_EXPIRED");
  });
});
