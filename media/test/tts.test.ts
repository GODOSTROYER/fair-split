import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hasFfmpeg, parseSilencedetect, planCuts } from "../src/tts/ffmpeg.js";
import {
  buildTtsParams,
  type InteractionsClient,
  synthesize,
  TTS_MODEL,
  TtsError,
} from "../src/tts/gemini.js";
import { KeyPool } from "../src/tts/keys.js";
import {
  type AudioEntry,
  AudioManifest,
  needsRegeneration,
  upsertEntry,
  VOICE_LABELS,
} from "../src/tts/manifest.js";
import { synthesizeStatement } from "../src/tts/pipeline.js";
import {
  DEFAULT_MIN_INTERVAL_MS,
  pacificDay,
  parseRpm,
  QuotaExceededError,
  QuotaLedger,
} from "../src/tts/quota.js";
import { hasNoDigits, numberWords, spokenDigits, spokenPhp, spokenUsd } from "../src/tts/spoken.js";
import { joinForRequest, LANGS, m014SpikeStatement, STYLE_NOTE } from "../src/tts/statement.js";
import { parseWav, pcmToWav, synthToneWav } from "../src/tts/wav.js";
import { MEDIA_ROOT } from "../src/util/env.js";

describe("spoken templates (S4.5)", () => {
  it("speaks money in English number words and slip numbers digit by digit", () => {
    expect(numberWords(0)).toBe("zero");
    expect(numberWords(64)).toBe("sixty-four");
    expect(numberWords(100)).toBe("one hundred");
    expect(numberWords(4028)).toBe("four thousand and twenty-eight");
    expect(numberWords(7990)).toBe("seven thousand nine hundred and ninety");
    expect(spokenUsd(6445)).toBe("sixty-four dollars and forty-five cents");
    expect(spokenUsd(100)).toBe("one dollar");
    expect(spokenUsd(1)).toBe("zero dollars and one cent");
    expect(spokenPhp(4028)).toBe("four thousand and twenty-eight pesos");
    expect(spokenDigits("0403")).toBe("zero four zero three");
    expect(() => numberWords(-1)).toThrow();
    expect(() => spokenDigits("04a3")).toThrow();
  });

  it("gives M-014 a greeting and a pay sentence in each language, with no digits", () => {
    for (const lang of LANGS) {
      const s = m014SpikeStatement(lang);
      expect(s.map((x) => x.slot)).toEqual(["s1", "s5"]);
      for (const x of s) expect(hasNoDigits(x.text)).toBe(true);
      expect(s[1]?.text).toContain("sixty-four dollars and forty-five cents");
      expect(joinForRequest(s)).toContain(" <long pause> ");
    }
    expect(m014SpikeStatement("ceb")[0]?.text).toBe("Maayong adlaw, Nang Celing. Salamat sa inyong paghago.");
    expect(hasNoDigits("US$64.45")).toBe(false);
  });
});

describe("WAV handling", () => {
  it("reads the format and duration of Gemini's 24 kHz mono 16-bit WAV", () => {
    const wav = synthToneWav([
      { ms: 500, tone: true },
      { ms: 250, tone: false },
    ]);
    expect(parseWav(wav)).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 750,
    });
    const raw = pcmToWav(Buffer.alloc(48_000), 24_000);
    expect(parseWav(raw).durationMs).toBe(1000);
    expect(() => parseWav(Buffer.from("not a wav file at all"))).toThrow(/RIFF/);
  });
});

describe("silence splitting (S4.6)", () => {
  it("parses ffmpeg silencedetect output, including a silence running to the end", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 3.536875",
      "[silencedetect @ 0x1] silence_end: 4.651958 | silence_duration: 1.115083",
      "[silencedetect @ 0x1] silence_start: 14.2",
    ].join("\n");
    expect(parseSilencedetect(stderr, 14.6)).toEqual([
      { start: 3.536875, end: 4.651958 },
      { start: 14.2, end: 14.6 },
    ]);
  });

  it("cuts one clip per sentence at the pauses, keeping a little silence", () => {
    const plan = planCuts(10, [{ start: 4, end: 5 }], 2);
    expect(plan).toEqual({
      ok: true,
      cuts: [
        { start: 0, end: 4.15 },
        { start: 4.85, end: 10 },
      ],
    });
    const trimmed = planCuts(
      10,
      [
        { start: 0, end: 0.5 },
        { start: 4, end: 5 },
        { start: 9.5, end: 10 },
      ],
      2,
    );
    expect(trimmed).toEqual({
      ok: true,
      cuts: [
        { start: 0.35, end: 4.15 },
        { start: 4.85, end: 9.65 },
      ],
    });
  });

  it("uses the longest pauses when a sentence holds its own natural pause (measured 22 Oct)", () => {
    // English M-014 statement: the <long pause> gave 1.115 s, a comma inside sentence 2 gave 0.613 s.
    const plan = planCuts(
      14.6,
      [
        { start: 3.536875, end: 4.651958 },
        { start: 6.786417, end: 7.399167 },
      ],
      2,
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.cuts[0]?.end).toBeCloseTo(3.687, 3);
  });

  it("refuses when the pauses are ambiguous or missing, so the caller re-requests per sentence", () => {
    expect(
      planCuts(
        10,
        [
          { start: 3, end: 3.7 },
          { start: 6, end: 6.75 },
        ],
        2,
      ).ok,
    ).toBe(false);
    expect(planCuts(10, [], 2)).toMatchObject({ ok: false, interior: 0 });
  });
});

/** A key id as the pool names keys (first 8 hex of the key's sha256); the ledger never sees a key. */
const KEY_ID = "0a1b2c3d";

describe("quota ledger and pacing", () => {
  it("counts per Pacific day, which turns over at Pacific midnight", () => {
    expect(pacificDay(new Date("2026-10-23T06:59:00Z"))).toBe("2026-10-22");
    expect(pacificDay(new Date("2026-10-23T07:00:00Z"))).toBe("2026-10-23");
  });

  it("paces requests on one key to one model, refuses past the key's cap, and records the limit a 429 states", async () => {
    let now = Date.parse("2026-10-22T08:00:00Z");
    const waits: number[] = [];
    const ledger = new QuotaLedger(
      join(mkdtempSync(join(tmpdir(), "quota-")), ".quota.json"),
      () => new Date(now),
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    expect(await ledger.reserve(TTS_MODEL, KEY_ID)).toBe(0);
    now += 5_000;
    expect(await ledger.reserve(TTS_MODEL, KEY_ID)).toBe(DEFAULT_MIN_INTERVAL_MS - 5_000);
    expect(waits).toEqual([DEFAULT_MIN_INTERVAL_MS - 5_000]);
    await ledger.settle(TTS_MODEL, KEY_ID, {
      ok: false,
      rateLimited: true,
      message:
        "429 Rate limit exceeded for model gemini-3.8-flash-tts (limit: 3 requests per minute on Free Tier).",
    });
    const q = await ledger.read();
    expect(q.observed[TTS_MODEL]?.rpm).toBe(3);
    expect((await ledger.today(TTS_MODEL)).rateLimited).toBe(1);
    q.caps[TTS_MODEL] = 2;
    const { writeJson } = await import("../src/util/json.js");
    await writeJson(ledger.path, q);
    now += 60_000;
    await expect(ledger.reserve(TTS_MODEL, KEY_ID)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(parseRpm("nothing here")).toBeNull();
  });
});

const WAV_TWO_SENTENCES = synthToneWav([
  { ms: 300, tone: false },
  { ms: 1500, tone: true },
  { ms: 1200, tone: false },
  { ms: 2000, tone: true },
  { ms: 300, tone: false },
]);

describe("Gemini TTS over the Interactions API (msw-mocked)", () => {
  const bodies: unknown[] = [];
  let mode: "ok" | "429" = "ok";
  const server = setupServer(
    http.post(/generativelanguage\.googleapis\.com\/.*\/interactions$/, async ({ request }) => {
      bodies.push(await request.json());
      if (mode === "429") {
        return HttpResponse.json(
          {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "Rate limit exceeded (limit: 3 requests per minute on Free Tier).",
            },
          },
          { status: 429 },
        );
      }
      return HttpResponse.json({
        id: "int-test-1",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "audio",
                data: WAV_TWO_SENTENCES.toString("base64"),
                mime_type: "audio/wav",
                sample_rate: 24000,
              },
            ],
          },
        ],
      });
    }),
  );
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    bodies.length = 0;
    mode = "ok";
  });
  afterAll(() => server.close());

  const client = () => new GoogleGenAI({ apiKey: "test-key-not-a-secret" }) as unknown as InteractionsClient;
  const pool = (ledger: QuotaLedger) =>
    new KeyPool<InteractionsClient>(["test-key-not-a-secret"], { ledger, makeClient: () => client() });

  it("sends one request with the voice, the style as speech metadata, and returns the WAV", async () => {
    const r = await synthesize(client(), {
      model: TTS_MODEL,
      voice: "Sulafat",
      style: STYLE_NOTE,
      text: "Maayong adlaw.",
    });
    expect(r.interactionId).toBe("int-test-1");
    expect(parseWav(r.wav).durationMs).toBe(5300);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject(
      buildTtsParams({ model: TTS_MODEL, voice: "Sulafat", style: STYLE_NOTE, text: "Maayong adlaw." }),
    );
    expect(JSON.stringify(bodies[0])).toContain('"speech_metadata"');
  });

  it("surfaces a 429 once, without the SDK retrying it", async () => {
    mode = "429";
    const err = await synthesize(client(), {
      model: TTS_MODEL,
      voice: "Sulafat",
      style: STYLE_NOTE,
      text: "x",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as TtsError).rateLimited).toBe(true);
    expect(bodies).toHaveLength(1);
  });

  it.skipIf(!hasFfmpeg())(
    "splits one statement request into one AAC 32 kbps mono clip per sentence",
    async () => {
      const media = mkdtempSync(join(tmpdir(), "tts-media-"));
      const ledger = new QuotaLedger(
        join(media, "audio", ".quota.json"),
        () => new Date(),
        async () => undefined,
      );
      const empty: AudioManifest = { v: 1, synthetic: true, notice: "test", entries: [] };
      const { result, manifest } = await synthesizeStatement(
        {
          member_no: "M-014",
          lang: "ceb",
          sentences: m014SpikeStatement("ceb"),
          model: TTS_MODEL,
          voice: "Sulafat",
          draft: false,
        },
        { pool: pool(ledger), mediaRoot: media, cacheDir: join(media, ".cache", "tts") },
        empty,
      );
      expect(result.split).toEqual({ ok: true, fallback: false });
      expect(manifest.entries.map((e) => e.file)).toEqual([
        "audio/M-014/ceb/s1.m4a",
        "audio/M-014/ceb/s5.m4a",
      ]);
      for (const e of manifest.entries) {
        expect(existsSync(join(media, e.file))).toBe(true);
        expect(e).toMatchObject({
          synthetic: true,
          label: VOICE_LABELS.ceb,
          codec: { codec: "aac", bit_rate_kbps: 32, channels: 1 },
        });
      }
      expect(manifest.entries[0]?.duration_ms).toBeGreaterThan(1500);
      expect(manifest.entries[0]?.duration_ms).toBeLessThan(2200);
      // A second run is served from the cache: no new request, no quota spent.
      const before = bodies.length;
      await synthesizeStatement(
        {
          member_no: "M-014",
          lang: "ceb",
          sentences: m014SpikeStatement("ceb"),
          model: TTS_MODEL,
          voice: "Sulafat",
          draft: false,
        },
        { pool: pool(ledger), mediaRoot: media, cacheDir: join(media, ".cache", "tts") },
        empty,
      );
      expect(bodies.length).toBe(before);
      expect((await ledger.today(TTS_MODEL)).requests).toBe(1);
    },
  );
});

describe("audio manifest (S4.6)", () => {
  const entry = (over: Partial<AudioEntry> = {}): AudioEntry => ({
    member_no: "M-014",
    lang: "ceb",
    slot: "s1",
    file: "audio/M-014/ceb/s1.m4a",
    duration_ms: 4634,
    text: "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.",
    text_sha256: "a".repeat(64),
    model: TTS_MODEL,
    voice: "Sulafat",
    style: STYLE_NOTE,
    codec: { codec: "aac", bit_rate_kbps: 32, channels: 1 },
    created_at: "2026-10-22T07:28:00.000Z",
    synthetic: true,
    label: VOICE_LABELS.ceb,
    draft: false,
    review: "machine-translated, pending native review",
    request: { id: "int-1", latency_ms: 11099, sentences: 2 },
    ...over,
  });

  it("replaces a clip only for the same member, language, slot and draft flag", () => {
    let m: AudioManifest = { v: 1, synthetic: true, notice: "n", entries: [] };
    m = upsertEntry(m, entry());
    m = upsertEntry(m, entry({ draft: true, file: "audio/drafts/M-014/ceb/s1.m4a" }));
    m = upsertEntry(m, entry({ duration_ms: 4700 }));
    expect(m.entries).toHaveLength(2);
    expect(m.entries.find((e) => !e.draft)?.duration_ms).toBe(4700);
  });

  it("regenerates a clip only when its text changes", () => {
    const m: AudioManifest = { v: 1, synthetic: true, notice: "n", entries: [entry()] };
    const key = { member_no: "M-014", lang: "ceb", slot: "s1", draft: false };
    expect(needsRegeneration(m, { ...key, text_sha256: "a".repeat(64) })).toBe(false);
    expect(needsRegeneration(m, { ...key, text_sha256: "b".repeat(64) })).toBe(true);
    expect(needsRegeneration(m, { ...key, slot: "s2", text_sha256: "a".repeat(64) })).toBe(true);
  });

  it("refuses an unlabelled clip", () => {
    const bad = { v: 1, synthetic: true, notice: "n", entries: [{ ...entry(), synthetic: false }] };
    expect(AudioManifest.safeParse(bad).success).toBe(false);
  });

  it("labels each clip as a synthetic voice in the clip's own language (S1 audio labels)", () => {
    expect(VOICE_LABELS).toEqual({
      ceb: "Sintetikong tingog (Gemini TTS)",
      fil: "Sintetikong boses (Gemini TTS)",
      en: "Synthetic voice (Gemini TTS)",
    });
    for (const lang of LANGS) {
      const ok = {
        v: 1,
        synthetic: true,
        notice: "n",
        entries: [entry({ lang, label: VOICE_LABELS[lang] })],
      };
      expect(AudioManifest.safeParse(ok).success).toBe(true);
    }
    // A Filipino clip carrying the Cebuano label, or an English one with no "(Gemini TTS)", is refused.
    const wrongLang = { v: 1, synthetic: true, notice: "n", entries: [entry({ lang: "fil" })] };
    expect(AudioManifest.safeParse(wrongLang).success).toBe(false);
    const bare = {
      v: 1,
      synthetic: true,
      notice: "n",
      entries: [{ ...entry({ lang: "en" }), label: "Voice" }],
    };
    expect(AudioManifest.safeParse(bare).success).toBe(false);
  });

  it("keeps a clip's mention offsets (IC-11, ADR-0011) and refuses a malformed one", () => {
    const offsets = [
      { ref: "fact:HONORIFIC_NAME", at_ms: 700 },
      { ref: "slip:0403", at_ms: 2200 },
    ];
    const m: AudioManifest = { v: 1, synthetic: true, notice: "n", entries: [] };
    expect(upsertEntry(m, entry({ offsets })).entries[0]?.offsets).toEqual(offsets);
    expect(upsertEntry(m, entry()).entries[0]?.offsets).toBeUndefined();
    for (const bad of [
      { ref: "0403", at_ms: 1 },
      { ref: "slip:0403", at_ms: -1 },
      { ref: "fact:net", at_ms: 1 },
    ]) {
      const doc = { v: 1, synthetic: true, notice: "n", entries: [entry({ offsets: [bad] })] };
      expect(AudioManifest.safeParse(doc).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the committed manifest names statement slots, and each text hashes to its text_sha256 (ADR-0011 §4)", () => {
    const m = AudioManifest.parse(
      JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "manifest.json"), "utf8")),
    );
    const slots = [
      "GREETING",
      "DELIVERY",
      "PREMIUM",
      "BONUS",
      "DEDUCTION",
      "CREDIT",
      "PAY",
      "SOURCES",
      "HELP",
      "AI_NOTE",
    ];
    for (const e of m.entries) {
      expect(slots, `${e.file}: ${e.slot}`).toContain(e.slot);
      expect(createHash("sha256").update(e.text, "utf8").digest("hex"), e.file).toBe(e.text_sha256);
      const published = /^audio\/(M-\d{3})\/(ceb|fil|en)\/[A-Za-z0-9_-]{1,64}\.m4a$/.exec(e.file);
      if (!e.draft) expect([published?.[1], published?.[2]], e.file).toEqual([e.member_no, e.lang]);
    }
  });

  it("has M-014 in Cebuano, Filipino and English from the S10 spike", () => {
    const m = AudioManifest.parse(
      JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "manifest.json"), "utf8")),
    );
    const finals = m.entries.filter((e) => e.member_no === "M-014" && !e.draft);
    expect(new Set(finals.map((e) => e.lang))).toEqual(new Set(["ceb", "fil", "en"]));
    for (const e of finals) expect(e.model).toBe(TTS_MODEL);
  });
});
