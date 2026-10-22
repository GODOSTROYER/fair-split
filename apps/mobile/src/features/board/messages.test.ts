import { describe, expect, it } from "vitest";
import { catalogProblems } from "../../_shims/i18n";
import { messages } from "./messages";

describe("board copy", () => {
  it("is complete in Cebuano, Filipino and English, with the same placeholders in each", () => {
    expect(catalogProblems(messages)).toEqual([]);
  });
});
