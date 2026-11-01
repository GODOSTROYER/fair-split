import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ASR_MODEL, ASR_MODELS, type GenerateContentClient } from "../src/tts/asr.js";
import { main } from "../src/tts/cli.js";
import { encodeAac, probeAudio } from "../src/tts/ffmpeg.js";
import { DEFAULT_VOICE, TTS_MODEL } from "../src/tts/gemini.js";
import { KeyPool, PoolExhaustedError } from "../src/tts/keys.js";
import { AUDIO_NOTICE, type AudioManifest } from "../src/tts/manifest.js";
import { requestOnce } from "../src/tts/pipeline.js";
import { APPROVED_STATEMENT_REQUESTS } from "../src/tts/plan.js";
import { QuotaLedger } from "../src/tts/quota.js";
import { STYLE_NOTE } from "../src/tts/statement.js";
import { markRequest, selectRequests, synthesizePlannedStatement } from "../src/tts/statements.js";
import { synthToneWav } from "../src/tts/wav.js";
import { REPO_ROOT } from "../src/util/env.js";

const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const timestamped = (text: string, starts: number[]) =>
  JSON.stringify({
    words: text.split(" ").map((text, i) => ({
      text,
      start: starts[i] ?? i * 0.25 + 0.1,
      end: (starts[i] ?? i * 0.25 + 0.1) + 0.15,
    })),
  });
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
  const transcripts: string[] = [];
  const timed: string[] = [];
  const asrByAudio = new Map<string, string>();
  const takes: Buffer[] = [];
  const asrErrors: Error[] = [];
  const concurrency = { active: 0, max: 0, barrier: 0 };
  let release: (() => void) | undefined;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  let time = Date.now();
  const now = () => new Date(time);
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json"), now),
    now,
    sleep: async (ms) => {
      time += ms;
    },
    makeClient: () => ({
      models: {
        generateContent: async (params: Record<string, unknown>) => {
          const error = asrErrors.shift();
          if (error) throw error;
          concurrency.active++;
          concurrency.max = Math.max(concurrency.max, concurrency.active);
          const contents = params.contents as { parts: { inlineData?: { data: string } }[] }[];
          const data = contents[0]?.parts.find((part) => part.inlineData)?.inlineData?.data;
          const keyed = data && asrByAudio.get(hash(Buffer.from(data, "base64")));
          const text =
            keyed ||
            ((params.config as { responseMimeType?: string })?.responseMimeType
              ? (timed.shift() ?? '{"words":[]}')
              : (transcripts.shift() ?? sentence.text));
          if (concurrency.barrier) {
            if (concurrency.active >= concurrency.barrier) release?.();
            await together;
          }
          concurrency.active--;
          return { text };
        },
      },
      interactions: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            output_audio: { data: (takes.shift() ?? wav).toString("base64"), mime_type: "audio/wav" },
          };
        },
      },
    }),
  });
  return {
    pool,
    asrPool: pool,
    asrSleep: async (ms: number) => {
      time += ms;
    },
    mediaRoot: root,
    cacheDir: join(root, "cache"),
    calls,
    transcripts,
    asrErrors,
    timed,
    asrByAudio,
    wav,
    takes,
    concurrency,
  };
}

async function groundTruthClip(d: ReturnType<typeof deps>, start: number, end: number) {
  const source = join(d.mediaRoot, "fixture.wav");
  const encoded = join(d.mediaRoot, `fixture-${start}-${end}.m4a`);
  writeFileSync(source, d.wav);
  await encodeAac(source, encoded, { start, end });
  return hash(readFileSync(encoded));
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

it("inv.i8.cached-retake: verifies a cached sentence before spending on a full take or new TTS", async () => {
  const d = deps(synthToneWav([{ ms: 4000, tone: true }]));
  await requestOnce(d, { model: TTS_MODEL, voice: DEFAULT_VOICE, style: STYLE_NOTE, text: sentence.text });
  d.timed.push(timestamped(sentence.text, []));
  const out = await synthesizePlannedStatement(request, d, empty);
  expect(out.entries).toHaveLength(1);
  expect(d.calls).toHaveLength(1);
  expect(
    JSON.parse(readFileSync(join(d.mediaRoot, "audio", "statement-verification.json"), "utf8")).clips[0]
      .method,
  ).toBe("per-sentence-asr");
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
  d.timed.push(timestamped(sentence.text, [0, 0.5, 2.2, 2.5, 3, 3.5, 4.4, 4.7]));
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
  writeFileSync(join(d.mediaRoot, "audio", "statement-verification.json"), '{"v":1,"clips":[]}');
  // A legacy manifest entry without verification evidence cannot suppress the ASR gate.
  const transitions: AudioManifest[] = [];
  const restored = await synthesizePlannedStatement(request, d, out, {
    onProgress: async (m) => {
      transitions.push(m);
    },
  });
  expect(transitions[0]?.entries).toHaveLength(0);
  expect(
    JSON.parse(readFileSync(join(d.mediaRoot, "audio", "archive", "manifest.json"), "utf8")).entries.some(
      (x: { file: string }) => x.file === out.entries[0]?.file,
    ),
  ).toBe(true);
  expect(
    JSON.parse(readFileSync(join(d.mediaRoot, "audio", "statement-verification.json"), "utf8")).clips,
  ).toHaveLength(1);
  const evidencePath = join(d.mediaRoot, "audio", "statement-verification.json");
  const bad = JSON.parse(readFileSync(evidencePath, "utf8"));
  bad.clips[0].cer = -1;
  writeFileSync(evidencePath, JSON.stringify(bad));
  const rechecked = await synthesizePlannedStatement(request, d, restored);
  expect(
    JSON.parse(readFileSync(evidencePath, "utf8")).clips.find(
      (c: { file: string }) => c.file === rechecked.entries[0]?.file,
    ).cer,
  ).toBeGreaterThanOrEqual(0);
});

it("falls back per sentence on unverified splits, refusing wrong speech without publishing", async () => {
  const d = deps(synthToneWav([{ ms: 3000, tone: true }]));
  d.transcripts.push("Wrong words.");
  await expect(synthesizePlannedStatement(request, d, empty)).rejects.toThrow(/verif/);
  expect(d.calls).toHaveLength(2);
  expect(existsSync(join(d.mediaRoot, "audio", "M-014"))).toBe(false);
  expect(empty.entries).toHaveLength(0);
});

it("rejects a count-perfect split when the encoded clip's own transcription is wrong", async () => {
  const d = deps(
    synthToneWav([
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
    ]),
  );
  d.transcripts.push("Entirely different words.", "Still wrong words.");
  await expect(synthesizePlannedStatement(request, d, empty)).rejects.toThrow(/verif/);
  expect(existsSync(join(d.mediaRoot, "audio", "M-014"))).toBe(false);
});
it("never publishes guessed mention positions when sentence words match but timestamp anchors do not", async () => {
  const d = deps(
    synthToneWav([
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
    ]),
  );
  await expect(synthesizePlannedStatement(request, d, empty)).rejects.toThrow(/verification/);
  expect(existsSync(join(d.mediaRoot, "audio", "M-014"))).toBe(false);
});

it("publishes an independently verified per-sentence retake with measured mention offsets and progress", async () => {
  const d = deps(synthToneWav([{ ms: 3000, tone: true }]));
  d.takes.push(synthToneWav([{ ms: 3000, tone: true }]), synthToneWav([{ ms: 4000, tone: true }]));
  d.timed.push(
    '{"words":[]}',
    JSON.stringify({
      words: sentence.text
        .split(" ")
        .map((text, i) => ({ text, start: i * 0.25 + 0.1, end: i * 0.25 + 0.3 })),
    }),
  );
  const progress: AudioManifest[] = [];
  const out = await synthesizePlannedStatement(request, d, empty, {
    onProgress: async (m) => {
      progress.push(m);
    },
  });
  expect(d.calls).toHaveLength(2);
  expect(out.entries[0]?.offsets).toEqual([
    { ref: "slip:04", at_ms: 600 },
    { ref: "slip:05", at_ms: 1600 },
  ]);
  expect(progress).toHaveLength(1);
  const evidence = JSON.parse(
    readFileSync(join(d.mediaRoot, "audio", "statement-verification.json"), "utf8"),
  );
  expect(evidence.clips[0]).toMatchObject({ method: "per-sentence-asr", cer: 0, transcript: sentence.text });
});

it("moves to sentence retakes after bounded ASR unavailability while preserving quota exceptions", async () => {
  const d = deps(synthToneWav([{ ms: 3000, tone: true }]));
  d.takes.push(synthToneWav([{ ms: 3000, tone: true }]), synthToneWav([{ ms: 4000, tone: true }]));
  d.asrErrors.push(
    ...Array.from({ length: 3 * ASR_MODELS.length }, () => Object.assign(new Error("busy"), { status: 503 })),
  );
  d.timed.push(
    JSON.stringify({
      words: sentence.text
        .split(" ")
        .map((text, i) => ({ text, start: i * 0.25 + 0.1, end: i * 0.25 + 0.3 })),
    }),
  );
  expect((await synthesizePlannedStatement(request, d, empty)).entries).toHaveLength(1);
  expect(d.calls).toHaveLength(2);
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
  d.asrByAudio.set(await groundTruthClip(d, 0, 3.35), timestamped(greeting.text, [0.1, 0.5, 2.2]));
  d.asrByAudio.set(await groundTruthClip(d, 4.25, 5.4), timestamped(pay.text, [0.15, 0.4, 0.7]));
  d.concurrency.barrier = 2;
  const out = await synthesizePlannedStatement({ ...request, sentences: [greeting, pay] }, d, empty);
  expect(d.calls).toHaveLength(1);
  expect(out.entries).toHaveLength(2);
  expect(d.concurrency.max).toBe(2);
  expect(out.entries.find((e) => e.slot === "GREETING")?.offsets).toEqual([
    { ref: "fact:HONORIFIC_NAME", at_ms: 2200 },
  ]);
  expect(out.entries.find((e) => e.slot === "DEDUCTION")?.offsets).toEqual([
    { ref: "fact:RULE_ID", at_ms: 150 },
    { ref: "rule:R1", at_ms: 150 },
  ]);
  expect(out.entries.find((e) => e.slot === "DEDUCTION")?.duration_ms).toBeLessThan(1400);
});

it("preserves an independently verified sentence before propagating another sentence's quota exhaustion", async () => {
  const d = deps(
    synthToneWav([
      { ms: 1000, tone: true },
      { ms: 1200, tone: false },
      { ms: 1000, tone: true },
    ]),
  );
  const plain = (slot: "GREETING" | "PAY", text: string) => ({
    ...sentence,
    slot,
    text,
    textSha256: hash(text),
    mentions: [],
    mentionSpans: [],
    placeholders: [],
  });
  const greeting = plain("GREETING", "Hello farmer.");
  const pay = plain("PAY", "Your pay follows.");
  const greetingAudio = await groundTruthClip(d, 0, 1.15);
  const payAudio = await groundTruthClip(d, 2.05, 3.2);
  const exhausted = new PoolExhaustedError(
    "offline daily cap",
    ASR_MODEL,
    new Date("2026-11-02T08:00:00.000Z"),
  );
  const asrPool = {
    async run<T>(_model: string, fn: (client: GenerateContentClient) => Promise<T>): Promise<T> {
      return fn({
        models: {
          generateContent: async (params) => {
            const contents = params.contents as { parts: { inlineData?: { data: string } }[] }[];
            const data = contents[0]?.parts.find((part) => part.inlineData)?.inlineData?.data;
            const digest = hash(Buffer.from(data ?? "", "base64"));
            if (digest === payAudio) throw exhausted;
            if (digest === greetingAudio) return { text: greeting.text };
            throw new Error("unrecognised synthetic clip bytes");
          },
        },
      });
    },
  } as unknown as typeof d.asrPool;
  const progress: AudioManifest[] = [];
  await expect(
    synthesizePlannedStatement({ ...request, sentences: [greeting, pay] }, { ...d, asrPool }, empty, {
      onProgress: async (manifest) => {
        progress.push(manifest);
      },
    }),
  ).rejects.toBe(exhausted);
  expect(progress).toHaveLength(1);
  expect(progress[0]?.entries).toHaveLength(1);
  expect(progress[0]?.entries[0]).toMatchObject({ slot: "GREETING", text_sha256: greeting.textSha256 });
  const published = progress[0]?.entries[0];
  expect(published && existsSync(join(d.mediaRoot, published.file))).toBe(true);
  expect(
    JSON.parse(readFileSync(join(d.mediaRoot, "audio", "statement-verification.json"), "utf8")).clips,
  ).toHaveLength(1);
  expect(d.calls).toHaveLength(1);
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
  d.transcripts.push(plain.text);
  const one = await synthesizePlannedStatement(r, d, empty);
  const legacyDraft = {
    ...one.entries[0],
    draft: true,
    file: "audio/drafts/M-014/ceb/s07-PAY-legacy.m4a",
  } as NonNullable<(typeof one.entries)[0]>;
  const cleaned = await synthesizePlannedStatement(r, d, { ...one, entries: [...one.entries, legacyDraft] });
  expect(cleaned.entries.every((e) => !e.draft)).toBe(true);
  expect(
    JSON.parse(readFileSync(join(d.mediaRoot, "audio", "drafts", "manifest.json"), "utf8")).entries.some(
      (e: { file: string }) => e.file === legacyDraft.file,
    ),
  ).toBe(true);
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
