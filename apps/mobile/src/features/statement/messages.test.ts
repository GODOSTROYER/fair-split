import { describe, expect, it } from "vitest";
import { catalogProblems } from "../../_shims/i18n";
import { messages } from "./messages";

describe("statement copy", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages)).toEqual([]);
  });
  it.each(["ceb", "fil", "en"] as const)(
    "inv.i8.mixed-voice: %s names Gemini TTS alongside the device voice",
    (lang) => {
      expect(messages["M-MB-03.mixed"][lang]).toContain("Gemini TTS");
    },
  );
});
