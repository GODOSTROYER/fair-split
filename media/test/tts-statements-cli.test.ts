import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ASR_MODEL } from "../src/tts/asr.js";
import { main } from "../src/tts/cli.js";
import { TTS_MODEL } from "../src/tts/gemini.js";
import { KeyPool, PoolExhaustedError } from "../src/tts/keys.js";
import { AUDIO_NOTICE, type AudioEntry, type AudioManifest } from "../src/tts/manifest.js";
import { AsrUnavailableError } from "../src/tts/statement-asr.js";
import {
  loadStatementPlans,
  type PlannedStatement,
  StatementSplitError,
  StatementVerificationError,
  synthesizePlannedStatement,
} from "../src/tts/statements.js";
import { REPO_ROOT } from "../src/util/env.js";
import { sha256 } from "../src/util/hash.js";

vi.mock("../src/tts/ffmpeg.js", async (original) => ({
  ...(await original<object>()),
  hasFfmpeg: () => true,
}));
vi.mock("../src/tts/statements.js", async (original) => ({
  ...(await original<object>()),
  loadStatementPlans: vi.fn(),
  synthesizePlannedStatement: vi.fn(),
}));
const roots: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadStatementPlans).mockResolvedValue({
    v: 1,
    synthetic: true,
    notice: "Synthetic test",
    requests: [{ member_no: "M-014", lang: "ceb", lineId: "test", sentences: [] }],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "au3-cli-"));
  roots.push(root);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const request = (member: string): PlannedStatement => ({
    member_no: member,
    lang: "ceb",
    lineId: `line-${member}`,
    sentences: [
      {
        slot: "GREETING",
        variant: "default",
        text: "Hello farmer.",
        textSha256: sha256("Hello farmer."),
        mentions: [],
        placeholders: [],
        mentionSpans: [],
        displayText: "Hello farmer.",
      },
    ],
  });
  const requests = [request("M-014"), request("M-007")];
  vi.mocked(loadStatementPlans).mockResolvedValue({
    v: 1,
    synthetic: true,
    notice: "Synthetic test",
    requests,
  });
  const empty: AudioManifest = { v: 1, synthetic: true, notice: AUDIO_NOTICE, entries: [] };
  return {
    root,
    requests,
    empty,
    report: () => JSON.parse(readFileSync(join(root, "audio", "statement-validation.json"), "utf8")),
  };
}

it("continues later requests after a verification refusal and reports the partial result", async () => {
  const f = fixture();
  vi.mocked(synthesizePlannedStatement)
    .mockRejectedValueOnce(new StatementVerificationError(["GREETING:failed"]))
    .mockResolvedValueOnce(f.empty);
  expect(await main(["statements"], f.root, { keys: [`offline-${"standin".repeat(5)}`] })).toBe(2);
  expect(synthesizePlannedStatement).toHaveBeenCalledTimes(2);
  expect(vi.mocked(synthesizePlannedStatement).mock.calls[1]?.[0].member_no).toBe("M-007");
  expect(f.report()).toMatchObject({
    outcome: "verification_refused",
    quotaRefused: false,
    failures: [{ request: "M-014:ceb", failed: ["GREETING:failed"] }],
  });
});

it("inv.i8.asr-service-report: stops an outage without calling it spent quota", async () => {
  const f = fixture();
  vi.mocked(synthesizePlannedStatement).mockRejectedValue(new AsrUnavailableError());
  expect(await main(["statements"], f.root, { keys: [`offline-${"standin".repeat(5)}`] })).toBe(2);
  expect(synthesizePlannedStatement).toHaveBeenCalledTimes(1);
  expect(f.report()).toMatchObject({
    outcome: "service_unavailable",
    quotaRefused: false,
    model: ASR_MODEL,
    planned: [
      { sentences: [{ status: "waiting_on_service" }] },
      { sentences: [{ status: "waiting_on_service" }] },
    ],
  });
  expect(f.report().keyResets).toHaveLength(1);
});

it("stops on pool exhaustion, includes every key/model reset and rejects unverified legacy progress", async () => {
  const f = fixture();
  const reset = "2026-11-02T08:00:00.000Z";
  const cooling = "2026-11-01T18:00:00.000Z";
  vi.spyOn(KeyPool.prototype, "status").mockResolvedValue({
    day: "2026-11-01",
    resetsAt: reset,
    disclosure: "offline",
    models: [TTS_MODEL, ASR_MODEL],
    legacyKey: null,
    total: {},
    keys: [
      {
        id: "testkey1",
        dropped: null,
        models: {
          [TTS_MODEL]: { used: 10, cap: 10, remaining: 0, cooling: { until: cooling, scope: "day" } },
          [ASR_MODEL]: { used: 10, cap: 10, remaining: 0, cooling: null },
        },
      },
      {
        id: "testkey2",
        dropped: null,
        models: {
          [TTS_MODEL]: { used: 10, cap: 10, remaining: 0, cooling: null },
          [ASR_MODEL]: { used: 10, cap: 10, remaining: 0, cooling: null },
        },
      },
    ],
  });
  const first = f.requests[0];
  if (!first?.sentences[0]) throw new Error("missing fixture");
  const s = first.sentences[0];
  const file = "audio/M-014/ceb/legacy.m4a";
  const entry: AudioEntry = {
    member_no: "M-014",
    lang: "ceb",
    slot: s.slot,
    text: s.text,
    text_sha256: s.textSha256,
    file,
    duration_ms: 1_000,
    model: TTS_MODEL,
    voice: "Sulafat",
    style: "test",
    codec: { codec: "aac", bit_rate_kbps: 32, channels: 1 },
    created_at: reset,
    synthetic: true,
    label: "Sintetikong tingog (Gemini TTS)",
    draft: false,
    review: "machine-translated, pending native review",
    request: { id: "test", latency_ms: 1, sentences: 1 },
  };
  mkdirSync(join(f.root, "audio/M-014/ceb"), { recursive: true });
  writeFileSync(join(f.root, file), "offline encoded bytes");
  writeFileSync(join(f.root, "audio/manifest.json"), JSON.stringify({ ...f.empty, entries: [entry] }));
  vi.mocked(synthesizePlannedStatement).mockRejectedValue(
    new PoolExhaustedError("quota refused", ASR_MODEL, new Date(reset)),
  );
  expect(await main(["statements"], f.root, { keys: [`offline-${"standin".repeat(5)}`] })).toBe(2);
  expect(synthesizePlannedStatement).toHaveBeenCalledTimes(1);
  expect(f.report()).toMatchObject({
    outcome: "quota_refused",
    model: ASR_MODEL,
    dailyResetsAt: reset,
    keyResets: [
      { keyId: "testkey1", models: { [TTS_MODEL]: { resetsAt: cooling }, [ASR_MODEL]: { resetsAt: reset } } },
      { keyId: "testkey2", models: { [TTS_MODEL]: { resetsAt: reset }, [ASR_MODEL]: { resetsAt: reset } } },
    ],
    planned: [
      { sentences: [{ status: "waiting_on_quota" }] },
      { sentences: [{ status: "waiting_on_quota" }] },
    ],
  });
  writeFileSync(
    join(f.root, "audio/statement-verification.json"),
    JSON.stringify({
      v: 1,
      clips: [
        {
          file,
          textSha256: s.textSha256,
          audioSha256: sha256("wrong bytes"),
          asrModel: ASR_MODEL,
          cer: 0,
          threshold: 0.12,
        },
      ],
    }),
  );
  await main(["statements"], f.root, { keys: [`offline-${"standin".repeat(5)}`] });
  expect(f.report().planned[0].sentences[0].status).toBe("waiting_on_quota");
  writeFileSync(
    join(f.root, "audio/statement-verification.json"),
    JSON.stringify({
      v: 1,
      clips: [
        {
          file,
          textSha256: s.textSha256,
          audioSha256: sha256("offline encoded bytes"),
          asrModel: ASR_MODEL,
          cer: 0.02,
          threshold: 0.12,
        },
      ],
    }),
  );
  await main(["statements"], f.root, { keys: [`offline-${"standin".repeat(5)}`] });
  expect(f.report().planned[0].sentences[0].status).toBe("published");
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
  expect(vi.mocked(synthesizePlannedStatement).mock.calls.at(-1)?.[1]).toHaveProperty("asrPool");
  expect(vi.mocked(synthesizePlannedStatement).mock.calls.at(-1)?.[1].maxAttempts).toBeUndefined();
});
