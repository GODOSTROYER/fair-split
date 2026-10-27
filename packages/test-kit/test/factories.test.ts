import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFactories,
  hasSeedSnapshot,
  loadSeedSnapshot,
  SEED_SNAPSHOT_PATH,
  SeedSnapshotUnavailableError,
} from "../src/factories.js";

const tmp = mkdtempSync(join(tmpdir(), "fs-factories-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("factories (placeholder over the seed snapshot)", () => {
  it("points at the IC-03 snapshot path", () => {
    expect(SEED_SNAPSHOT_PATH.replace(/\\/g, "/")).toMatch(/packages\/seed\/snapshot\/season-2026A\.json$/);
  });

  it("explains clearly when the snapshot does not exist yet", () => {
    const missing = join(tmp, "nope.json");
    expect(hasSeedSnapshot(missing)).toBe(false);
    expect(() => loadSeedSnapshot(missing)).toThrow(SeedSnapshotUnavailableError);
  });

  it("reads whatever snapshot it is given", () => {
    const file = join(tmp, "snapshot.json");
    writeFileSync(file, JSON.stringify({ season: "2026A" }));
    expect(createFactories(file).snapshot).toEqual({ season: "2026A" });
  });
});
