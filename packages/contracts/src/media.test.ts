// IC-11 statement audio (ADR-0011): one clip per spoken sentence, served only from /media/audio, always labelled.
import { describe, expect, it } from "vitest";
import {
  AUDIO_CLIP_URL_RE,
  AUDIO_SLOTS,
  AudioOffset,
  DEVICE_VOICE_LABELS,
  LANGS,
  StatementAudio,
  StatementAudioClip,
  StatementAudioQuery,
  SYNTHETIC_VOICE_LABELS,
} from "./index.js";

const HASH = "596b9e42811ddd3d6788f221ff7c7ad905a4936bb007cbea1875fdc09fc7618b";
const clip = {
  url: "/media/audio/M-014/ceb/s1.m4a",
  textSha256: HASH,
  label: "Sintetikong tingog (Gemini TTS)",
  slot: "GREETING",
  offsets: [{ ref: "fact:HONORIFIC_NAME", atMs: 1_250 }],
  durationMs: 4_634,
} as const;

describe("IC-11 StatementAudioClip", () => {
  it("is the per-sentence shape {url, textSha256, label, slot, offsets, durationMs}", () => {
    expect(StatementAudioClip.parse(clip)).toEqual(clip);
    expect(StatementAudioClip.safeParse({ ...clip, cues: [] }).success, "no extra keys").toBe(false);
    expect(StatementAudioClip.safeParse({ ...clip, offsets: undefined }).success, "offsets present").toBe(
      false,
    );
    expect(StatementAudioClip.safeParse({ ...clip, offsets: [] }).success, "offsets may be empty").toBe(true);
  });

  it("accepts only same-origin clip URLs under /media/audio/{member}/{lang}/", () => {
    for (const url of [
      "/media/audio/M-014/ceb/s1.m4a",
      "/media/audio/M-031/en/PAY-0a1b2c3d4e5f.m4a",
      "/media/audio/M-053/fil/AI_NOTE-0a1b2c3d4e5f-t2.m4a",
    ]) {
      expect(AUDIO_CLIP_URL_RE.test(url), url).toBe(true);
      expect(StatementAudioClip.safeParse({ ...clip, url }).success, url).toBe(true);
    }
    for (const url of [
      "/media/audio/drafts/M-014/ceb/s1.m4a",
      "/media/audio/M-014/ceb/../../prompts/x.m4a",
      "/media/audio/M-014/hil/s1.m4a",
      "/media/audio/M-014/ceb/s1.wav",
      "/media/eval/M-014/ceb/s1.m4a",
      "https://cdn.example/media/audio/M-014/ceb/s1.m4a",
      "media/audio/M-014/ceb/s1.m4a",
    ]) {
      expect(AUDIO_CLIP_URL_RE.test(url), url).toBe(false);
      expect(StatementAudioClip.safeParse({ ...clip, url }).success, url).toBe(false);
    }
  });

  it("hashes are lowercase hex SHA-256, and the slot is a statement plan slot", () => {
    expect(StatementAudioClip.safeParse({ ...clip, textSha256: HASH.toUpperCase() }).success).toBe(false);
    expect(StatementAudioClip.safeParse({ ...clip, slot: "s1" }).success).toBe(false);
    expect(AUDIO_SLOTS).toEqual([
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
    ]);
  });

  it("an offset names a mention (slip, rule) or a filled amount or name (fact:PLACEHOLDER), in clip ms", () => {
    for (const ref of ["slip:0403", "rule:R1", "fact:NET_USD", "fact:HONORIFIC_NAME"]) {
      expect(AudioOffset.safeParse({ ref, atMs: 0 }).success, ref).toBe(true);
    }
    for (const ref of ["0403", "fact:net_usd", "fact:", "amount:NET_USD", "slip:04 03"]) {
      expect(AudioOffset.safeParse({ ref, atMs: 0 }).success, ref).toBe(false);
    }
    expect(AudioOffset.safeParse({ ref: "slip:0403", atMs: -1 }).success).toBe(false);
    expect(AudioOffset.safeParse({ ref: "slip:0403", atMs: 1.5 }).success).toBe(false);
  });
});

describe("IC-11 StatementAudio (GET /v1/media/audio/:lineId)", () => {
  const answer = {
    lineId: "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f",
    memberNo: "M-014",
    lang: "ceb",
    source: "mixed",
    label: "Sintetikong tingog (Gemini TTS)",
    deviceLabel: "Tingog sa telepono",
    sentences: [
      { slot: "GREETING", textSha256: HASH, clip },
      { slot: "PAY", textSha256: "b".repeat(64), clip: null },
    ],
  } as const;

  it("lists every spoken sentence with its clip or null, and both labels (I8)", () => {
    expect(StatementAudio.parse(answer)).toEqual(answer);
    expect(StatementAudio.safeParse({ ...answer, source: "partial" }).success).toBe(false);
    expect(StatementAudio.safeParse({ ...answer, label: "" }).success).toBe(false);
    expect(StatementAudio.safeParse({ ...answer, deviceLabel: "" }).success).toBe(false);
    expect(StatementAudio.safeParse({ ...answer, cues: [] }).success, "the one-file cues are retired").toBe(
      false,
    );
  });

  it("takes an optional language", () => {
    expect(StatementAudioQuery.parse({})).toEqual({});
    expect(StatementAudioQuery.parse({ lang: "fil" })).toEqual({ lang: "fil" });
    expect(StatementAudioQuery.safeParse({ lang: "hil" }).success).toBe(false);
  });

  it("labels: the plan's synthetic-voice words and the phone's voice, in every language", () => {
    expect(SYNTHETIC_VOICE_LABELS).toEqual({
      ceb: "Sintetikong tingog (Gemini TTS)",
      fil: "Sintetikong boses (Gemini TTS)",
      en: "Synthetic voice (Gemini TTS)",
    });
    expect(DEVICE_VOICE_LABELS).toEqual({
      ceb: "Tingog sa telepono",
      fil: "Boses ng telepono",
      en: "Device voice",
    });
    for (const lang of LANGS) {
      expect(SYNTHETIC_VOICE_LABELS[lang]).not.toBe(DEVICE_VOICE_LABELS[lang]);
    }
  });
});
