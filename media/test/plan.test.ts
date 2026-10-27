import { describe, expect, it } from "vitest";
import { findAsset } from "../src/content/spike.js";
import {
  type AssetEntry,
  emptyManifest,
  GENERATOR,
  type Manifest,
  SYNTHETIC_LABEL,
} from "../src/imagegen/manifest.js";
import { type FixtureStatus, planGeneration } from "../src/imagegen/plan.js";

const SHA = "a".repeat(64);

function entry(id: string, withMaster: boolean, editOf?: string): AssetEntry {
  return {
    id,
    kind: "slip_page",
    title: id,
    synthetic: true,
    label: SYNTHETIC_LABEL,
    pipeline: editOf ? "edit" : "direct",
    generator: GENERATOR,
    codexCli: "codex-cli test",
    promptVersion: "p2",
    prompt: { file: `prompts/history/${id}.aaaaaaaa.md`, sha256: SHA },
    source: { kind: "provisional", note: "test" },
    ...(editOf ? { editOf } : {}),
    attempts: withMaster
      ? [
          {
            n: 1,
            purpose: "accept",
            promptFile: `prompts/history/${id}.aaaaaaaa.md`,
            promptSha256: SHA,
            inputImages: [],
            threadId: "t",
            startedAt: "2026-10-22T07:00:00Z",
            durationMs: 1,
            exitCode: 0,
            outcome: "accepted",
            usage: null,
          },
        ]
      : [],
    master: withMaster ? { file: `masters/${id}.jpg`, sha256: SHA, width: 1, height: 1, bytes: 1 } : null,
    display: withMaster ? { file: `slips/${id}.webp`, sha256: SHA, width: 1, height: 1, bytes: 1 } : null,
    fixture: null,
    review: { status: "pending", reviewer: null, at: null, method: null, fieldMatch: null, deviations: [] },
    trials: [],
  };
}

function manifest(entries: AssetEntry[]): Manifest {
  const m = emptyManifest();
  for (const e of entries) m.assets[e.id] = e;
  return m;
}

const none = (): FixtureStatus => null;

describe("planGeneration: gen never spends quota on an accepted master by accident", () => {
  const m = manifest([
    entry("spike-0403", true),
    entry("spike-0457-white", true),
    entry("spike-0457-pink", true, "spike-0457-white"),
  ]);
  const a0403 = findAsset("spike-0403");
  const a0419 = findAsset("spike-0419");

  it("skips assets that already have a master and runs only the missing ones", () => {
    const p = planGeneration([a0403, a0419], m, none, { all: false, force: false, replaceReviewed: false });
    expect(p.run.map((a) => a.id)).toEqual(["spike-0419"]);
    expect(p.skipped).toEqual([
      { id: "spike-0403", reason: "has an accepted master (attempt 1); pass --force to replace it" },
    ]);
    expect(p.refused).toEqual([]);
  });

  it("replaces a named master with --force", () => {
    const p = planGeneration([a0403], m, none, { all: false, force: true, replaceReviewed: false });
    expect(p.run.map((a) => a.id)).toEqual(["spike-0403"]);
  });

  it("refuses --force with `all`, and runs nothing", () => {
    const p = planGeneration([a0403, a0419], m, none, { all: true, force: true, replaceReviewed: false });
    expect(p.run).toEqual([]);
    expect(p.refused[0]?.reason).toMatch(/never applies to `all`/);
  });

  it("refuses to replace a human-reviewed master without --replace-reviewed, and then runs nothing", () => {
    const reviewed = (id: string): FixtureStatus =>
      id === "spike-0403" ? "human-reviewed" : "agent-checked";
    const p = planGeneration([a0403, a0419], m, reviewed, {
      all: false,
      force: true,
      replaceReviewed: false,
    });
    expect(p.run).toEqual([]);
    expect(p.refused).toEqual([{ id: "spike-0403", reason: expect.stringMatching(/--replace-reviewed/) }]);
    const ok = planGeneration([a0403], m, reviewed, { all: false, force: true, replaceReviewed: true });
    expect(ok.run.map((a) => a.id)).toEqual(["spike-0403"]);
  });

  it("warns that a carbon copy goes stale when its white original is replaced", () => {
    const p = planGeneration([findAsset("spike-0457-white")], m, none, {
      all: false,
      force: true,
      replaceReviewed: false,
    });
    expect(p.warnings).toEqual([expect.stringMatching(/spike-0457-pink is an edit of spike-0457-white/)]);
    const both = planGeneration([findAsset("spike-0457-white"), findAsset("spike-0457-pink")], m, none, {
      all: false,
      force: true,
      replaceReviewed: false,
    });
    expect(both.warnings).toEqual([]);
  });
});
