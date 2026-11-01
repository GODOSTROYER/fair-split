import { expect, it } from "vitest";
import { sentenceSpans } from "./export.js";

it("locates each spoken slip in SOURCES without mistaking the list for one mention", () => {
  const result = sentenceSpans(
    {
      slot: "SOURCES",
      variant: "default",
      facts: { SLIPS: { k: "slips", serials: ["0403", "0404"] } },
      mentions: ["slip:0403", "slip:0404"],
    },
    "en",
  );
  expect(result.placeholders[0]?.spoken).toBe("zero four zero three and zero four zero four");
  expect(result.mentionSpans.map((m) => m.spoken)).toEqual(["zero four zero three", "zero four zero four"]);
  expect(result.mentionSpans[1]?.start).toBeGreaterThan(result.mentionSpans[0]?.start ?? -1);
});
