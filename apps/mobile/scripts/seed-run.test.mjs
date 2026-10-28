import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSeedRun, OUT, readSnapshot } from "./seed-run.mjs";

describe("the demo co-sign run is the seed snapshot's run (WS-CORE)", () => {
  it("copies run r37 from packages/seed exactly: rerun `node scripts/seed-run.mjs` when this fails", () => {
    const copy = JSON.parse(readFileSync(OUT, "utf8"));
    expect(copy).toEqual(extractSeedRun(readSnapshot()));
  });

  it("carries every member line, PayPal and cash, and the eight PayPal items", () => {
    const copy = JSON.parse(readFileSync(OUT, "utf8"));
    expect(copy.lines).toHaveLength(64);
    expect(copy.items).toHaveLength(8);
    expect(copy.lines.filter((l) => l.rail === "CASH")).toHaveLength(56);
    expect(new Set(copy.lines.map((l) => l.memberNo)).size).toBe(64);
  });
});
