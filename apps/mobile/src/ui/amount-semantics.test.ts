import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("spoken amounts in the Chair web frame", () => {
  it("gives the atomic spoken amount a named web role while preserving its full native label", () => {
    const source = readFileSync(new URL("./amount.tsx", import.meta.url), "utf8");
    const spoken = source.slice(source.indexOf("function spoken("), source.indexOf("function LargeAmount("));
    expect(spoken).toMatch(/role:\s*"img"/);
    expect(spoken).toMatch(/accessibilityRole:\s*"text"/);
    expect(spoken).toMatch(/accessibilityLabel:\s*srLabel/);
    expect(spoken).toContain('"aria-hidden": true');
    // Both large and inline wrappers inherit the same spoken/hidden semantics.
    expect(source.match(/\.\.\.spoken\(srLabel\)/g)).toHaveLength(2);
  });
});
