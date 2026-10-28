import { describe, expect, it } from "vitest";
import { catalogProblems, interpolate, messages, pendingReview, translate, translateIn } from "./i18n";

describe("native review (OD-2, S1.6)", () => {
  it("marks every Cebuano and Filipino surface as machine-translated until a native speaker signs it off", () => {
    expect(pendingReview("ceb")).toBe(true);
    expect(pendingReview("fil")).toBe(true);
    expect(pendingReview("en")).toBe(false);
  });

  it("says so in the same words in every language, so a judge reads it on camera", () => {
    const chip = messages["common.machineTranslated"];
    expect(chip.ceb).toBe("Machine-translated, pending native review");
    expect(chip.fil).toBe(chip.ceb);
  });
});

describe("shell copy (the @fairsplit/i18n shim)", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages, { shell: true })).toEqual([]);
  });

  it("fills arguments and leaves a missing one visible rather than blank", () => {
    expect(interpolate("Katapusang kopya, {time}", { time: "10:21" })).toBe("Katapusang kopya, 10:21");
    expect(interpolate("Hello {name}", {})).toBe("Hello {name}");
    expect(translate("ceb", "common.lastCopy", { time: "10:21" })).toBe("Katapusang kopya, 10:21");
  });

  it("names each language in its own words for the language picker", () => {
    expect(translate("ceb", "common.langName")).toBe("Cebuano");
    expect(translate("fil", "common.langName")).toBe("Filipino");
    expect(translate("en", "common.langName")).toBe("English");
  });

  it("lets a slice catalog fall back to the shell's keys, and flags a slice key that shadows one", () => {
    const slice = { "M-XX-01.hello": { ceb: "Kumusta {name}", fil: "Kumusta {name}", en: "Hello {name}" } };
    expect(translateIn(slice, "en", "M-XX-01.hello", { name: "Jessie" })).toBe("Hello Jessie");
    expect(translateIn(slice, "en", "common.cancel")).toBe("Cancel");
    expect(catalogProblems(slice)).toEqual([]);
    expect(catalogProblems({ "common.cancel": { ceb: "a", fil: "b", en: "c" } })).toEqual([
      "common.cancel: shadows a shell key",
    ]);
    expect(catalogProblems({ "M-XX-01.x": { ceb: "{a}", fil: "", en: "{b}" } })).toEqual([
      "M-XX-01.x: no fil",
      "M-XX-01.x: placeholders differ between languages",
    ]);
  });
});
