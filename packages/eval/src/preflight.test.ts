import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeGateway, MemoryReplayStore, MemorySpendMeter, staticFlags } from "@fairsplit/ai/gateway";
import { expect, it, vi } from "vitest";
import { defaultOptions, parseArgs, runEval } from "./run.js";

it("preflights every input before starting a potentially billable pipeline", async () => {
  const root = mkdtempSync(join(tmpdir(), "fs-r1-preflight-"));
  try {
    const labelsDir = join(root, "labels");
    mkdirSync(labelsDir);
    writeFileSync(
      join(labelsDir, "missing.json"),
      JSON.stringify({
        case: "missing",
        set: "dev",
        kind: "slip_page",
        image: "missing.jpg",
        slips: [],
        reviewer: "test",
        reviewed_at: "2026-11-01T00:00:00Z",
      }),
    );
    const gateway = new ClaudeGateway({
      store: new MemoryReplayStore(),
      spend: new MemorySpendMeter(),
      flags: staticFlags({ kill_ai_live: true }),
    });
    const call = vi.spyOn(gateway, "call");
    await expect(
      runEval(
        defaultOptions({
          mode: "live",
          set: "dev",
          mediaRoot: root,
          labelsDir,
          gateway,
          outDir: join(root, "out"),
        }),
      ),
    ).rejects.toThrow(/preflight.*missing/i);
    expect(call).not.toHaveBeenCalled();
    writeFileSync(join(labelsDir, "broken.json"), "{}");
    await expect(
      runEval(
        defaultOptions({
          mode: "live",
          set: "dev",
          mediaRoot: root,
          labelsDir,
          gateway,
          outDir: join(root, "out"),
        }),
      ),
    ).rejects.toThrow(/preflight.*invalid label/i);
    expect(call).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("accepts an explicitly unscored image without inventing a label", () => {
  expect(parseArgs(["--unscored", "masters/spike-4up.jpg"])).toEqual({
    unscoredImages: ["masters/spike-4up.jpg"],
  });
});
