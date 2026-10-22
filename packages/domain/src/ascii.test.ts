import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asciiEmailKey, foldAsciiCase, isAsciiEmail } from "./ascii.js";

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

  it("property: an accepted address is printable ASCII, and folding changes only A-Z", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 40 }), (s) => {
        const folded = foldAsciiCase(s);
        expect(folded).toHaveLength(s.length);
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          expect(folded.charCodeAt(i)).toBe(c >= 65 && c <= 90 ? c + 32 : c);
        }
        if (isAsciiEmail(s)) expect(s).toMatch(/^[\x21-\x7E]+$/);
      }),
      { numRuns: 500 },
    );
  });
});
