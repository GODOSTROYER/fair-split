import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asciiEmailKey, foldAsciiCase, isAsciiEmail, requireAsciiEmail } from "./ascii.js";

describe("inv.i1.ascii-email: e-mails compare as strict printable ASCII with ASCII case folded only", () => {
  it("accepts plain ASCII e-mails and folds only A-Z", () => {
    expect(asciiEmailKey("coop-business@sandbox.example")).toBe("coop-business@sandbox.example");
    expect(asciiEmailKey("Buyer.One+inv@Kalinaw-Kakao.EXAMPLE")).toBe("buyer.one+inv@kalinaw-kakao.example");
    expect(asciiEmailKey("sb-47abc@business.example.com")).toBe("sb-47abc@business.example.com");
  });

  it("refuses lookalikes, whitespace, controls and malformed addresses instead of folding them", () => {
    for (const bad of [
      "Kakao@sandbox.example",
      "buyer@Kakao.example",
      "İnfo@sandbox.example",
      "buyer＠sandbox.example",
      "buyer@sаndbox.example",
      "bеyer@sandbox.example",
      "buyer@sandbox.еxample",
      " buyer@sandbox.example",
      "buyer@sandbox.example ",
      "buyer@sandbox.example\n",
      "buyer@sandbox.example​",
      "buyer@sandbox.example\u0000",
      "buy er@sandbox.example",
      "buyer@@sandbox.example",
      "buyer@sandbox",
      "buyer@-sandbox.example",
      "buyer@sandbox..example",
      ".buyer@sandbox.example",
      "buyer.@sandbox.example",
      '"buyer"@sandbox.example',
      "buyer@sandbox.example.",
      "buyer@[127.0.0.1]",
      `${"a".repeat(250)}@x.example`,
      "",
      42,
      null,
    ]) {
      expect(isAsciiEmail(bad), JSON.stringify(bad)).toBe(false);
      expect(asciiEmailKey(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("foldAsciiCase leaves every non-ASCII code unit alone, unlike toLowerCase", () => {
    expect(foldAsciiCase("ABCxyz-@.Z")).toBe("abcxyz-@.z");
    expect(foldAsciiCase("KİÉＡ")).toBe("KİÉＡ");
    expect("K".toLowerCase()).toBe("k");
  });

  it("property: folding changes only A-Z, code unit for code unit", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 40 }), (s) => {
        const folded = foldAsciiCase(s);
        expect(folded).toHaveLength(s.length);
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          expect(folded.charCodeAt(i)).toBe(c >= 65 && c <= 90 ? c + 32 : c);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("property: an accepted address is printable ASCII; one lookalike, space or control anywhere is refused", () => {
    // Driven from real addresses so the "accepted" half runs (random strings are never e-mails).
    const NOT_PRINTABLE_ASCII = [
      "\u212a",
      "\u0430",
      "\u0435",
      "\uff20",
      "\u00a0",
      " ",
      "\t",
      "\n",
      "\u0000",
      "\u200b",
      "\u0301",
    ];
    let accepted = 0;
    fc.assert(
      fc.property(fc.emailAddress(), fc.nat(), fc.constantFrom(...NOT_PRINTABLE_ASCII), (email, at, c) => {
        if (isAsciiEmail(email)) {
          accepted++;
          expect(email).toMatch(/^[\x21-\x7E]+$/);
          expect(asciiEmailKey(email)).toBe(foldAsciiCase(email));
        }
        const i = at % (email.length + 1);
        const mutated = email.slice(0, i) + c + email.slice(i);
        expect(isAsciiEmail(mutated), JSON.stringify(mutated)).toBe(false);
        expect(asciiEmailKey(mutated)).toBeNull();
      }),
      { numRuns: 1000 },
    );
    expect(accepted).toBeGreaterThan(500);
  });

  it("accepts punycode (IDN) top-level domains in their ASCII form, and nothing looser", () => {
    for (const ok of [
      "coop@kalinaw.xn--p1ai",
      "buyer@lantern.xn--80asehdb",
      "a@b.XN--P1AI",
      "a@xn--80ak6aa92e.example",
    ]) {
      expect(isAsciiEmail(ok), ok).toBe(true);
    }
    for (const bad of [
      "a@b.xn--",
      "a@b.xn---p1ai",
      "a@b.xn--p1ai-",
      "a@b.xn--p1ai.",
      "a@b.xn--p1\u0430i",
      `a@b.xn--${"a".repeat(60)}`,
    ]) {
      expect(isAsciiEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("requireAsciiEmail fails a bad e-mail setting at boot, naming the setting, never trimming or echoing it", () => {
    expect(requireAsciiEmail("PP_PAYER_EMAIL", "lantern-bay@sandbox.example")).toBe(
      "lantern-bay@sandbox.example",
    );
    expect(requireAsciiEmail("PP_BUSINESS_EMAIL", "coop@kalinaw.xn--p1ai")).toBe("coop@kalinaw.xn--p1ai");
    expect(() => requireAsciiEmail("PP_PAYER_EMAIL", " lantern-bay@sandbox.example")).toThrow(
      new RangeError("PP_PAYER_EMAIL is not a plain ASCII e-mail address (it has surrounding whitespace)"),
    );
    for (const bad of [undefined, "", "lantern bay", "lantern-bay@sandbox.еxample", 42]) {
      expect(() => requireAsciiEmail("PP_RECEIVERS[2]", bad), String(bad)).toThrow(
        new RangeError("PP_RECEIVERS[2] is not a plain ASCII e-mail address"),
      );
    }
  });
});
