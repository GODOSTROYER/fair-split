import { describe, expect, it } from "vitest";
import { LANGS } from "../../_shims/contracts";
import { catalogProblems } from "../../_shims/i18n";
import { messages, t } from "./messages";

describe("onboarding copy", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages)).toEqual([]);
  });

  it("keeps S1.9's Cebuano lines word for word", () => {
    expect(messages["M-ON-01.pair.title"].ceb).toBe("Pangayo sa treasurer sa inyong QR.");
    expect(messages["M-ON-01.pair.expired"].ceb).toBe(
      "Nag-expire na kini nga code. Pangayo og bag-o sa treasurer.",
    );
    expect(messages["M-ON-01.listen.title"].ceb).toBe("Unsa ang una ninyong gusto: basahon o paminawon?");
    expect(messages["M-ON-01.listen.read"].ceb).toBe("Basahon");
    expect(messages["M-ON-01.listen.listen"].ceb).toBe("Paminawon una");
  });

  it("names each language in its own words and speaks a sample with no digits (I1)", () => {
    for (const l of LANGS) {
      expect(t(l, "M-ON-01.lang.name")).toBeTruthy();
      expect(t(l, "M-ON-01.lang.sample")).not.toMatch(/\d/);
      expect(t(l, "M-ON-01.listen.sample")).not.toMatch(/\d/);
    }
    expect(new Set(LANGS.map((l) => t(l, "M-ON-01.lang.name"))).size).toBe(3);
  });

  it("asks before a link replaces a pairing, naming who the phone is paired to and the key it would lose", () => {
    const who = "Ernesto P. Cabahug, Board";
    for (const l of LANGS) {
      expect(t(l, "M-ON-01.pair.replaceTitle")).toMatch(/\?$/);
      expect(t(l, "M-ON-01.pair.replaceBody", { who })).toContain(who);
      const withKey = t(l, "M-ON-01.pair.replaceBodyKey", { who, key: "fs-ernesto-a1" });
      expect(t(l, "M-ON-01.pair.replaceBodyUnread")).not.toMatch(/\d/);
      expect(t(l, "M-ON-01.pair.replaceBodyUnread")).not.toBe(t(l, "M-ON-01.pair.replaceBody", { who }));
      expect(withKey).toContain(who);
      expect(withKey).toContain("fs-ernesto-a1");
      // The two answers say what they do, and differ.
      expect(t(l, "M-ON-01.pair.replaceConfirm")).not.toBe(t(l, "M-ON-01.pair.replaceCancel"));
    }
  });

  it("never says error or fraud, and never shouts (S1.11)", () => {
    for (const [key, entry] of Object.entries(messages)) {
      for (const text of Object.values(entry)) {
        expect(text, key).not.toMatch(/\berror\b|\bfraud\b|!/i);
      }
    }
  });
});
