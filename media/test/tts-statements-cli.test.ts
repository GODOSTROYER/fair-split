import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "../src/tts/cli.js";
import { StatementSplitError, synthesizePlannedStatement } from "../src/tts/statements.js";
import { REPO_ROOT } from "../src/util/env.js";

vi.mock("../src/tts/ffmpeg.js", async (original) => ({
  ...(await original<object>()),
  hasFfmpeg: () => true,
}));
vi.mock("../src/tts/statements.js", async (original) => ({
  ...(await original<object>()),
  loadStatementPlans: async () => ({ requests: [{ member_no: "M-014", lang: "ceb", sentences: [] }] }),
  synthesizePlannedStatement: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("records a split refusal separately from quota exhaustion and does not suggest waiting for quota", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "au2-cli-"));
  roots.push(root);
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((s) => {
    lines.push(String(s));
  });
  vi.spyOn(console, "error").mockImplementation((s) => {
    lines.push(String(s));
  });
  vi.mocked(synthesizePlannedStatement).mockRejectedValue(new StatementSplitError(28, 17, "missing pauses"));
  expect(
    await main(["statements", "--only", "M-014:ceb"], root, { keys: [`offline-${"standin".repeat(5)}`] }),
  ).toBe(2);
  const report = JSON.parse(readFileSync(join(root, "audio", "statement-validation.json"), "utf8"));
  expect(report).toMatchObject({
    outcome: "split_refused",
    quotaRefused: false,
    expectedSegments: 28,
    detectedInteriorPauses: 17,
  });
  expect(lines.join("\n")).not.toContain("daily cap reset");
  expect(synthesizePlannedStatement).toHaveBeenCalledTimes(1);
});
