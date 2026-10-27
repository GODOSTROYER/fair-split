import { createHash, generateKeyPairSync, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCertificate, keyIdentifier, toPem } from "../src/crypto/x509.js";
import { defaultAccountsFile, loadRegistry } from "../src/state.js";
import { fromCents, multiplyQuantity, percentOf, toCents } from "../src/util/money.js";
import { rawMember } from "../src/util/rawjson.js";
import { addDays, ptDate, Scheduler } from "../src/util/time.js";

describe("money in integer cents", () => {
  it("parses PayPal decimal strings", () => {
    expect(toCents("4333.50")).toBe(433_350);
    expect(toCents("1.0")).toBe(100);
    expect(toCents(".5")).toBe(50);
    expect(toCents("-1.09")).toBe(-109);
    expect(toCents("10.000")).toBe(1000);
    expect(toCents("10.005")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents("")).toBeNull();
  });
  it("prints two decimals", () => {
    expect(fromCents(433_350)).toBe("4333.50");
    expect(fromCents(-109)).toBe("-1.09");
    expect(fromCents(5)).toBe("0.05");
  });
  it("multiplies quantities and percentages half-up", () => {
    expect(multiplyQuantity(1000, "1.5")).toBe(1500);
    expect(multiplyQuantity(333, "0.5")).toBe(167);
    expect(multiplyQuantity(100, "x")).toBeNull();
    expect(percentOf(9500, "7.25")).toBe(689);
    expect(percentOf(433_350, "4.40")).toBe(19_067);
  });
  it("sums the canonical batch exactly", () => {
    const items = ["64.45", "62.71", "55.96", "55.63", "38.32", "34.40", "30.27", "26.65"];
    expect(fromCents(items.reduce((s, v) => s + (toCents(v) ?? 0), 0))).toBe("368.39");
  });
});

describe("raw JSON member extraction", () => {
  it("returns the exact bytes of a member", () => {
    const raw = '{"a":1,"webhook_event":{"id":"WH-1","x":[1,{"y":"}"}]} , "b":"c"}';
    expect(rawMember(raw, "webhook_event")).toBe('{"id":"WH-1","x":[1,{"y":"}"}]}');
    expect(rawMember(raw, "b")).toBe('"c"');
    expect(rawMember(raw, "missing")).toBeNull();
    expect(rawMember("not json", "a")).toBeNull();
  });
});

describe("time helpers", () => {
  it("dates invoices in Pacific time", () => {
    // 2026-10-23T05:30Z is still 22 Oct in Los Angeles (PDT, UTC−7).
    expect(ptDate(Date.parse("2026-10-23T05:30:00Z"))).toBe("2026-10-22");
    expect(addDays("2026-10-22", 25)).toBe("2026-11-16");
  });
  it("scheduler idles after chained work and can be cancelled", async () => {
    const order: string[] = [];
    const s = new Scheduler(0, (e) => {
      throw e;
    });
    s.schedule(1, () => {
      order.push("a");
      s.schedule(1, () => order.push("c"));
    });
    s.schedule(1, () => order.push("b"));
    await s.idle();
    expect(order).toEqual(["a", "b", "c"]);
    s.schedule(0, () => order.push("never"));
    s.cancelAll();
    await s.idle();
    expect(order).not.toContain("never");
  });
});

describe("X.509 writer", () => {
  it("produces a CA and a leaf that node:crypto accepts", () => {
    const ca = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const leaf = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const dn = { commonName: "Test CA", organization: "Fair Split test", country: "US" };
    const now = new Date();
    const caCert = new X509Certificate(
      toPem(
        createCertificate({
          subject: dn,
          issuer: dn,
          subjectPublicKey: ca.publicKey,
          issuerPrivateKey: ca.privateKey,
          issuerPublicKey: ca.publicKey,
          notBefore: now,
          notAfter: new Date(now.getTime() + 86_400_000),
          isCA: true,
        }),
      ),
    );
    const leafCert = new X509Certificate(
      createCertificate({
        subject: { commonName: "Leaf", organization: "Fair Split test" },
        issuer: dn,
        subjectPublicKey: leaf.publicKey,
        issuerPrivateKey: ca.privateKey,
        issuerPublicKey: ca.publicKey,
        notBefore: now,
        notAfter: new Date(now.getTime() + 86_400_000),
        isCA: false,
      }),
    );
    expect(caCert.ca).toBe(true);
    expect(leafCert.ca).toBe(false);
    expect(leafCert.checkIssued(caCert)).toBe(true);
    expect(leafCert.verify(ca.publicKey)).toBe(true);
    expect(leafCert.verify(leaf.publicKey)).toBe(false);
    expect(keyIdentifier(leaf.publicKey)).toHaveLength(20);
    expect(createHash("sha256").update(leafCert.raw).digest("hex")).toHaveLength(64);
  });
});

describe("seed registry", () => {
  it("has the co-op, Lantern Bay and seven members; Rhea has no account", () => {
    const r = loadRegistry(defaultAccountsFile());
    expect(r.accounts.map((a) => a.key)).toEqual([
      "coop",
      "lantern-bay",
      "M-014",
      "M-007",
      "M-060",
      "M-018",
      "M-039",
      "M-022",
      "M-002",
    ]);
    for (const a of r.accounts) expect(a.email.endsWith("@example.org")).toBe(true);
    expect(r.accounts.some((a) => a.email === "rhea.jumawan@example.org")).toBe(false);
    expect(r.unregistered_receivers[0]?.member_no).toBe("M-031");
    expect(r.apps.map((a) => a.name)).toEqual(["fs-dev", "fs-judge"]);
  });
});
