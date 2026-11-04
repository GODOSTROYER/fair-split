import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("radio Chip semantics on the real Member web frame", () => {
  it("supplies checked directly to React Native Web and preserves the native state", () => {
    const source = readFileSync(new URL("./primitives.tsx", import.meta.url), "utf8");
    const radio = source.slice(
      source.indexOf("export function Chip("),
      source.indexOf("/* ------------------------------------------------------------------ Ink stamp"),
    );
    // This RN Web version reads aria-checked; it does not map accessibilityState to the required radio attribute.
    expect(radio).toMatch(/aria-checked=\{role === "radio" \? !!selected : undefined\}/);
    expect(radio).toContain(
      'accessibilityState={role === "radio" ? { checked: !!selected } : { selected: !!selected }}',
    );
  });
});
