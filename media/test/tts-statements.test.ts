import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { main } from "../src/tts/cli.js";
import { probeAudio } from "../src/tts/ffmpeg.js";
import { TTS_MODEL } from "../src/tts/gemini.js";
import { KeyPool } from "../src/tts/keys.js";
import { AUDIO_NOTICE, type AudioManifest } from "../src/tts/manifest.js";
import { APPROVED_STATEMENT_REQUESTS } from "../src/tts/plan.js";
import { QuotaLedger } from "../src/tts/quota.js";
import { markRequest, selectRequests, synthesizePlannedStatement } from "../src/tts/statements.js";
import { synthToneWav } from "../src/tts/wav.js";
import { REPO_ROOT } from "../src/util/env.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const sentence = {
  slot: "SOURCES" as const,
  variant: "default",
  text: "See slip zero four and slip zero five.",
  textSha256: hash("See slip zero four and slip zero five."),
  mentions: ["slip:04", "slip:05"],
  placeholders: [],
  displayText: "See slips 04 and 05.",
  mentionSpans: [
    { ref: "slip:04", spoken: "zero four", start: 9 },
    { ref: "slip:05", spoken: "zero five", start: 28 },
  ],
};
const request = { member_no: "M-014", lang: "ceb" as const, lineId: "seed-line", sentences: [sentence] };
const empty: AudioManifest = { v: 1, synthetic: true, notice: AUDIO_NOTICE, entries: [] };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function deps(wav: Buffer) {
  const scratch = join(REPO_ROOT, ".codex-scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "fs-au2-"));
  roots.push(root);
  const calls: unknown[] = [];
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json")),
    makeClient: () => ({
      interactions: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return { output_audio: { data: wav.toString("base64"), mime_type: "audio/wav" } };
        },
      },
    }),
  });
  return { pool, mediaRoot: root, cacheDir: join(root, "cache"), calls };
}

it("inserts measured pause markers without changing the hashed words, and checks mention order", () => {
  const marked = markRequest(request);
  expect(marked.text).toBe("See slip  <long pause> zero four and slip  <long pause> zero five.");
  expect(marked.segments).toHaveLength(3);
  expect(() =>
    markRequest({ ...request, sentences: [{ ...sentence, mentions: [...sentence.mentions].reverse() }] }),
  ).toThrow(/mention order/);
  expect(() => markRequest({ ...request, sentences: [{ ...sentence, textSha256: "0".repeat(64) }] })).toThrow(
    /hash/,
  );
  expect(() => markRequest({ ...request, sentences: [{ ...sentence, mentionSpans: [] }] })).toThrow(
    /mention/,
  );
});

it("uses one pooled request and synthetic WAV pause boundaries for clip-relative mention offsets", async () => {
  const d = deps(
    synthToneWav([
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
    ]),
  );
  const out = await synthesizePlannedStatement(request, d, empty);
  expect(d.calls).toHaveLength(1);
  expect(d.calls[0]).toMatchObject({ model: TTS_MODEL });
  expect(out.entries).toHaveLength(1);
  const e = out.entries[0];
  expect(e).toMatchObject({
    slot: "SOURCES",
    text: sentence.text,
    text_sha256: sentence.textSha256,
    label: "Sintetikong tingog (Gemini TTS)",
    draft: false,
    offsets: [
      { ref: "slip:04", at_ms: 2200 },
      { ref: "slip:05", at_ms: 4400 },
    ],
    file: `audio/M-014/ceb/s08-SOURCES-${sentence.textSha256.slice(0, 12)}.m4a`,
  });
  const audio = await probeAudio(join(d.mediaRoot, e?.file ?? ""));
  expect(audio).toMatchObject({ codec: "aac", channels: 1 });
  expect(audio.durationMs).toBeGreaterThan(5000);
  expect(e?.offsets?.every((x) => x.at_ms <= audio.durationMs)).toBe(true);
  const again = await synthesizePlannedStatement(request, d, out);
  expect(again).toEqual(out);
  expect(d.calls).toHaveLength(1);
  const original = readFileSync(join(d.mediaRoot, e?.file ?? ""));
  const retake = await synthesizePlannedStatement(request, d, empty);
  expect(retake.entries[0]?.file).toBe(e?.file.replace(/\.m4a$/, "-t2.m4a"));
  expect(readFileSync(join(d.mediaRoot, e?.file ?? ""))).toEqual(original);
  expect(d.calls).toHaveLength(1);
});

it("refuses sentence/marker-count mismatches without per-sentence retries or manifest writes", async () => {
  const d = deps(synthToneWav([{ ms: 3000, tone: true }]));
  await expect(synthesizePlannedStatement(request, d, empty)).rejects.toThrow(/split/);
  expect(d.calls).toHaveLength(1);
  expect(existsSync(join(d.mediaRoot, "audio"))).toBe(false);
  expect(empty.entries).toHaveLength(0);
});

it("splits two sentences into distinct slot clips and resets offsets to each clip's media clock", async () => {
  const d = deps(
    synthToneWav([
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
    ]),
  );
  const greeting = {
    ...sentence,
    slot: "GREETING" as const,
    text: "Good day, Maria.",
    textSha256: hash("Good day, Maria."),
    mentions: [],
    mentionSpans: [],
    placeholders: [{ name: "HONORIFIC_NAME", spoken: "Maria", start: 10 }],
  };
  const pay = {
    ...sentence,
    slot: "DEDUCTION" as const,
    text: "R one applies.",
    textSha256: hash("R one applies."),
    mentions: ["rule:R1"],
    mentionSpans: [{ ref: "rule:R1", spoken: "R one", start: 0 }],
    placeholders: [{ name: "RULE_ID", spoken: "R one", start: 0 }],
  };
  const out = await synthesizePlannedStatement({ ...request, sentences: [greeting, pay] }, d, empty);
  expect(d.calls).toHaveLength(1);
  expect(out.entries).toHaveLength(2);
  expect(out.entries.find((e) => e.slot === "GREETING")?.offsets).toEqual([
    { ref: "fact:HONORIFIC_NAME", at_ms: 2200 },
  ]);
  expect(out.entries.find((e) => e.slot === "DEDUCTION")?.offsets).toEqual([
    { ref: "fact:RULE_ID", at_ms: 150 },
    { ref: "rule:R1", at_ms: 150 },
  ]);
  expect(out.entries.find((e) => e.slot === "DEDUCTION")?.duration_ms).toBeLessThan(1400);
});

it("preserves both PAY hashes and keeps draft entries out of the served manifest", async () => {
  const d = deps(synthToneWav([{ ms: 1000, tone: true }]));
  const plain = {
    ...sentence,
    slot: "PAY" as const,
    text: "Cash is due.",
    textSha256: hash("Cash is due."),
    mentions: [],
    mentionSpans: [],
  };
  const r = { ...request, sentences: [plain] };
  const one = await synthesizePlannedStatement(r, d, empty);
  const legacyDraft = {
    ...one.entries[0],
    draft: true,
    file: "audio/drafts/M-014/ceb/s07-PAY-legacy.m4a",
  } as NonNullable<(typeof one.entries)[0]>;
  const cleaned = await synthesizePlannedStatement(r, d, { ...one, entries: [...one.entries, legacyDraft] });
  expect(cleaned.entries.every((e) => !e.draft)).toBe(true);
  const other = { ...one.entries[0], text: "PayPal is due.", text_sha256: hash("PayPal is due.") };
  const { upsertEntry } = await import("../src/tts/manifest.js");
  expect(upsertEntry(one, other as NonNullable<(typeof one.entries)[0]>).entries).toHaveLength(2);
  const draft = await synthesizePlannedStatement(r, d, one, { draft: true });
  expect(draft).toEqual(one);
  expect(existsSync(join(d.mediaRoot, "audio", "drafts", "manifest.json"))).toBe(true);
  expect(readFileSync(join(d.mediaRoot, "audio", "drafts", "manifest.json"), "utf8")).toContain(
    '"draft": true',
  );
});

it("selects the approved order, rejects unknown filters and supports an offline dry run", async () => {
  const { requests } = await (await import("../src/tts/statements.js")).loadStatementPlans(
    join(REPO_ROOT, "media"),
  );
  expect(selectRequests(requests).map((r) => `${r.member_no}:${r.lang}`)).toEqual(
    APPROVED_STATEMENT_REQUESTS.map((r) => `${r.member_no}:${r.lang}`),
  );
  expect(selectRequests([request], "M-014:ceb")).toEqual([request]);
  expect(() => selectRequests([request], "M-999:en")).toThrow(/planned/);
  const code = await main(["statements", "--dry-run", "--only", "M-014:ceb"], join(REPO_ROOT, "media"), {
    keys: [],
  });
  expect(code).toBe(0);
});
