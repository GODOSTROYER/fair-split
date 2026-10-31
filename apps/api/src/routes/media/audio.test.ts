// IC-11 (ADR-0011) without a database: how fs-api reads the published audio manifest and which clip, if any,
// each spoken sentence gets. A clip is served only when its exact words match; anything else is the device voice.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUDIO_SLOTS, StatementAudio } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATEMENT_SLOTS } from "../../statements/types.js";
import {
  AUDIO_CLIP_FILE_RE,
  type ManifestEntry,
  readAudioManifest,
  resolveStatementAudio,
  type SpokenSentence,
  sha256Text,
} from "./audio.js";

const LINE = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";
const GREETING = "Maayong adlaw, Nang Celing. Salamat sa inyong paghago.";
const SOURCES = "Gikan kini sa inyong resibo 0 4 0 3 ug 0 4 1 9.";
const sentences: SpokenSentence[] = [
  { slot: "GREETING", variant: "default", text: GREETING, mentions: [], placeholders: ["HONORIFIC_NAME"] },
  {
    slot: "SOURCES",
    variant: "default",
    text: SOURCES,
    mentions: ["slip:0403", "slip:0419"],
    placeholders: ["SLIPS"],
  },
];

let mediaDir: string;

function entry(over: Partial<ManifestEntry> & { text: string; slot: ManifestEntry["slot"] }): ManifestEntry {
  return {
    member_no: "M-014",
    lang: "ceb",
    file: `audio/M-014/ceb/${over.slot}.m4a`,
    duration_ms: 4_000,
    text_sha256: sha256Text(over.text),
    synthetic: true,
    draft: false,
    model: "gemini-3.8-flash-tts",
    voice: "Sulafat",
    created_at: "2026-11-03T03:30:00.000Z",
    ...over,
  };
}

function resolve(entries: ManifestEntry[], s: SpokenSentence[] = sentences) {
  return StatementAudio.parse(
    resolveStatementAudio({ lineId: LINE, memberNo: "M-014", lang: "ceb", sentences: s, entries, mediaDir }),
  );
}

function writeManifest(dir: string, body: unknown): void {
  mkdirSync(path.join(dir, "audio"), { recursive: true });
  writeFileSync(path.join(dir, "audio", "manifest.json"), JSON.stringify(body));
}

beforeAll(() => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "fs-audio-"));
  for (const rel of [
    "audio/M-014/ceb/GREETING.m4a",
    "audio/M-014/ceb/SOURCES.m4a",
    "audio/M-014/ceb/PAY.m4a",
    "audio/M-014/ceb/GREETING-old.m4a",
    "audio/M-014/ceb/GREETING-new.m4a",
    "audio/drafts/M-014/ceb/GREETING.m4a",
    "audio/M-007/ceb/GREETING.m4a",
  ]) {
    mkdirSync(path.dirname(path.join(mediaDir, rel)), { recursive: true });
    writeFileSync(path.join(mediaDir, rel), Buffer.alloc(64));
  }
});
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

describe("textSha256", () => {
  it("is the lowercase hex SHA-256 of the sentence's UTF-8 bytes, nothing trimmed or normalised", () => {
    expect(sha256Text(GREETING)).toBe("596b9e42811ddd3d6788f221ff7c7ad905a4936bb007cbea1875fdc09fc7618b");
    expect(sha256Text("₱")).toBe(
      createHash("sha256")
        .update(Buffer.from([0xe2, 0x82, 0xb1]))
        .digest("hex"),
    );
    expect(sha256Text(`${GREETING} `)).not.toBe(sha256Text(GREETING));
  });

  it("the contract's slots are the statement plan's slots", () => {
    expect([...AUDIO_SLOTS]).toEqual([...STATEMENT_SLOTS]);
  });
});

describe("a sentence gets a clip only when every rule of ADR-0011 §5 holds", () => {
  it("serves the matching clip from /media/audio, labelled by the server, with its offsets in time order", () => {
    const a = resolve([
      entry({ slot: "GREETING", text: GREETING }),
      entry({
        slot: "SOURCES",
        text: SOURCES,
        offsets: [
          { ref: "slip:0419", at_ms: 3_100 },
          { ref: "slip:0403", at_ms: 2_200 },
          { ref: "fact:SLIPS", at_ms: 2_000 },
        ],
      }),
    ]);
    expect(a.source).toBe("gemini");
    expect(a.label).toBe("Sintetikong tingog (Gemini TTS)");
    expect(a.deviceLabel).toBe("Tingog sa telepono");
    expect(a.sentences).toEqual([
      {
        slot: "GREETING",
        variant: "default",
        mentions: [],
        textSha256: sha256Text(GREETING),
        clip: {
          url: "/media/audio/M-014/ceb/GREETING.m4a",
          textSha256: sha256Text(GREETING),
          label: "Sintetikong tingog (Gemini TTS)",
          slot: "GREETING",
          offsets: [],
          durationMs: 4_000,
        },
      },
      {
        slot: "SOURCES",
        variant: "default",
        mentions: ["slip:0403", "slip:0419"],
        textSha256: sha256Text(SOURCES),
        clip: expect.objectContaining({
          url: "/media/audio/M-014/ceb/SOURCES.m4a",
          offsets: [
            { ref: "fact:SLIPS", atMs: 2_000 },
            { ref: "slip:0403", atMs: 2_200 },
            { ref: "slip:0419", atMs: 3_100 },
          ],
        }),
      },
    ]);
  });

  it("names each sentence by slot, variant and mentions, never by its words, so a client pairs it with its own", () => {
    const deductions: SpokenSentence[] = ["R1", "R3"].map((rule) => ({
      slot: "DEDUCTION",
      variant: "default",
      text: `Less something for ${rule === "R1" ? "CBU" : "a loan"}.`,
      mentions: [`rule:${rule}`],
      placeholders: ["DEDUCTION_USD"],
    }));
    const a = resolve([], [...sentences, ...deductions]);
    expect(a.sentences.map((s) => [s.slot, s.variant, s.mentions])).toEqual([
      ["GREETING", "default", []],
      ["SOURCES", "default", ["slip:0403", "slip:0419"]],
      ["DEDUCTION", "default", ["rule:R1"]],
      ["DEDUCTION", "default", ["rule:R3"]],
    ]);
    expect(Object.keys(a.sentences[0] ?? {}).sort()).toEqual([
      "clip",
      "mentions",
      "slot",
      "textSha256",
      "variant",
    ]);
  });

  it("names the form of the slot fs-api rendered: the cash PAY and the seeded AI note say so", () => {
    const PAY_CASH = "Ang inyong bayad karong season: ₱3,716.00, cash sa bodega.";
    const NOTE = "Niini nga demo, ang pagbasa sa mga resibo usa ka tin-aw nga puli.";
    const a = resolve(
      [entry({ slot: "PAY", text: PAY_CASH })],
      [
        { slot: "PAY", variant: "cash_nodate", text: PAY_CASH, mentions: [], placeholders: ["NET_PHP"] },
        { slot: "AI_NOTE", variant: "seeded", text: NOTE, mentions: [], placeholders: [] },
      ],
    );
    expect(a.sentences.map((s) => [s.slot, s.variant, s.clip?.url ?? null])).toEqual([
      ["PAY", "cash_nodate", "/media/audio/M-014/ceb/PAY.m4a"],
      ["AI_NOTE", "seeded", null],
    ]);
  });

  it("keeps only offsets the sentence has, inside the clip", () => {
    const a = resolve([
      entry({
        slot: "SOURCES",
        text: SOURCES,
        offsets: [
          { ref: "slip:0403", at_ms: 2_200 },
          { ref: "slip:0436", at_ms: 2_500 },
          { ref: "rule:R1", at_ms: 2_600 },
          { ref: "fact:NET_USD", at_ms: 2_700 },
          { ref: "slip:0419", at_ms: 4_001 },
        ],
      }),
    ]);
    expect(a.sentences[1]?.clip?.offsets).toEqual([{ ref: "slip:0403", atMs: 2_200 }]);
    expect(a.source).toBe("mixed");
  });

  it("mismatch: changed words get no clip and the labelled device voice, never the near one", () => {
    const changed = [{ ...sentences[0], text: `${GREETING} ` } as SpokenSentence];
    const a = resolve([entry({ slot: "GREETING", text: GREETING })], changed);
    expect(a).toMatchObject({
      source: "device",
      label: "Tingog sa telepono",
      deviceLabel: "Tingog sa telepono",
    });
    expect(a.sentences).toEqual([
      {
        slot: "GREETING",
        variant: "default",
        mentions: [],
        textSha256: sha256Text(`${GREETING} `),
        clip: null,
      },
    ]);
  });

  it("mismatch: a manifest whose text does not hash to its text_sha256 is not trusted", () => {
    const lying = entry({ slot: "GREETING", text: "Other words.", text_sha256: sha256Text(GREETING) });
    expect(resolve([lying]).sentences[0]?.clip).toBeNull();
  });

  it("mismatch: another slot, member or language with the same words is not this sentence's clip", () => {
    for (const e of [
      entry({ slot: "HELP", text: GREETING, file: "audio/M-014/ceb/GREETING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, member_no: "M-007", file: "audio/M-007/ceb/GREETING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, lang: "fil", file: "audio/M-014/fil/GREETING.m4a" }),
    ]) {
      expect(resolve([e]).sentences[0]?.clip, JSON.stringify(e)).toBeNull();
    }
  });

  it("drafts, missing files and anything outside audio/{member}/{lang}/ are never served", () => {
    for (const e of [
      entry({ slot: "GREETING", text: GREETING, draft: true }),
      entry({ slot: "GREETING", text: GREETING, file: "audio/drafts/M-014/ceb/GREETING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, file: "audio/M-007/ceb/GREETING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, file: "audio/M-014/ceb/../ceb/GREETING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, file: "audio/M-014/ceb/MISSING.m4a" }),
      entry({ slot: "GREETING", text: GREETING, file: "prompts/M-014/ceb/GREETING.m4a" }),
    ]) {
      expect(resolve([e]).sentences[0]?.clip, e.file).toBeNull();
    }
    expect(AUDIO_CLIP_FILE_RE.test("audio/M-014/ceb/s1.m4a")).toBe(true);
    expect(AUDIO_CLIP_FILE_RE.test("audio/drafts/M-014/ceb/s1.m4a")).toBe(false);
  });

  it("of two takes of the same words, the newer one plays", () => {
    const a = resolve([
      entry({ slot: "GREETING", text: GREETING, file: "audio/M-014/ceb/GREETING-old.m4a" }),
      entry({
        slot: "GREETING",
        text: GREETING,
        file: "audio/M-014/ceb/GREETING-new.m4a",
        created_at: "2026-11-05T03:30:00.000Z",
      }),
    ]);
    expect(a.sentences[0]?.clip?.url).toBe("/media/audio/M-014/ceb/GREETING-new.m4a");
  });
});

describe("readAudioManifest: media/public/audio/manifest.json, entry by entry", () => {
  it("reads nothing when the file is missing, unreadable or a bare array", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fs-audio-m-"));
    try {
      expect(readAudioManifest(dir)).toEqual([]);
      writeManifest(dir, [entry({ slot: "GREETING", text: GREETING })]);
      expect(readAudioManifest(dir)).toEqual([]);
      mkdirSync(path.join(dir, "audio"), { recursive: true });
      writeFileSync(path.join(dir, "audio", "manifest.json"), "{not json");
      expect(readAudioManifest(dir)).toEqual([]);
      writeManifest(dir, { v: 2, synthetic: true, entries: [entry({ slot: "GREETING", text: GREETING })] });
      expect(readAudioManifest(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps each entry that parses, ignores the producer's own fields, and skips the rest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fs-audio-m-"));
    try {
      const good = entry({ slot: "GREETING", text: GREETING });
      writeManifest(dir, {
        v: 1,
        synthetic: true,
        notice: "Every clip is a synthetic voice.",
        entries: [
          { ...good, style: "warm", codec: { codec: "aac" }, review: "pending", request: { id: "x" } },
          { ...good, slot: "s1" },
          { ...good, synthetic: false },
          { ...good, text_sha256: "A".repeat(64) },
          { ...good, offsets: [{ ref: "slip:0403", at_ms: -1 }] },
        ],
      });
      expect(readAudioManifest(dir)).toEqual([good]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
