// IC-11 statement audio (ADR-0011): one synthetic clip per spoken sentence, matched to the sentence by the SHA-256
// of its exact spoken text, served only from the curated `/media/audio/…` and always labelled (I8). fs-api's
// `GET /v1/media/audio/:lineId` answers with `StatementAudio`; the api-client and the app read these same types.
import { z } from "zod";
import { Lang, MemberNo, Sha256Hex, Uuid } from "./primitives.js";

/**
 * The statement plan's sentence slots in reading order (fs-api `STATEMENT_SLOTS`, plan "AI system › Statements").
 * The AI-8 `StatementSlot` in domain.ts is an older list without PAY and AI_NOTE.
 */
export const AUDIO_SLOTS = [
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
] as const;
export const AudioSlot = z.enum(AUDIO_SLOTS);
export type AudioSlot = z.infer<typeof AudioSlot>;

/** A same-origin clip URL: `/media/audio/{memberNo}/{lang}/{name}.m4a`, nothing else (no drafts, no `..`). */
export const AUDIO_CLIP_URL_RE = /^\/media\/audio\/M-\d{3}\/(?:ceb|fil|en)\/[A-Za-z0-9_-]{1,64}\.m4a$/;

/**
 * What a sentence names: one of its mentions (`slip:0403`, `rule:R1`), or `fact:{PLACEHOLDER}` for an amount or a
 * name it fills (`fact:NET_USD`, `fact:HONORIFIC_NAME`).
 */
export const AudioOffsetRef = z.string().regex(/^(?:(?:slip|rule):[A-Za-z0-9-]+|fact:[A-Z][A-Z_]*)$/);

/** Where the voice starts saying `ref`, in ms of the clip's own media time (the playback rate does not change it). */
export const AudioOffset = z.strictObject({ ref: AudioOffsetRef, atMs: z.int().nonnegative() });
export type AudioOffset = z.infer<typeof AudioOffset>;

/** One synthetic voice reading one spoken sentence. */
export const StatementAudioClip = z.strictObject({
  url: z.string().regex(AUDIO_CLIP_URL_RE),
  /** SHA-256 (lowercase hex) of the UTF-8 bytes of the exact spoken sentence the clip reads. */
  textSha256: Sha256Hex,
  /** The synthetic-voice label in the clip's language (`SYNTHETIC_VOICE_LABELS`), shown while it plays. */
  label: z.string().min(1),
  slot: AudioSlot,
  /** Sorted by time; empty when the producer recorded none (the app then estimates from the clip's length). */
  offsets: z.array(AudioOffset),
  durationMs: z.int().positive(),
});
export type StatementAudioClip = z.infer<typeof StatementAudioClip>;

/** A slip or a rule a sentence names, as fs-api's statement plan lists it. */
export const AudioMention = z.string().regex(/^(?:slip|rule):[A-Za-z0-9-]+$/);

/**
 * Which form of its slot a sentence is: fs-api's template key is `{slot}.{variant}` (`PAY.paypal`, `PAY.cash`,
 * `AI_NOTE.default`, T1's `AI_NOTE.seeded`, `HELP.noname`). Two forms of one slot say different things, so a clip of
 * one is never played for the other (ADR-0011 §6).
 */
export const AudioVariant = z.string().regex(/^[a-z_]+$/);

/**
 * One spoken sentence of the statement: its clip, or null when the phone's voice reads it (`deviceLabel`). A client
 * finds its own sentence by `slot`, `variant` and `mentions` (which deduction or credit), in reading order, never by
 * its words: only fs-api renders the spoken text, and `textSha256` is fs-api's hash of it (ADR-0011 §3, §6).
 */
export const StatementAudioSentence = z.strictObject({
  slot: AudioSlot,
  /** The template variant fs-api rendered for this sentence (`paypal`, `cash`, `default`, `seeded`). */
  variant: AudioVariant,
  /** The slips and rules the sentence names, in order (`rule:R1`, `slip:0403`). */
  mentions: z.array(AudioMention),
  textSha256: Sha256Hex,
  clip: StatementAudioClip.nullable(),
});
export type StatementAudioSentence = z.infer<typeof StatementAudioSentence>;

export const StatementAudioQuery = z.strictObject({ lang: Lang.optional() });
export type StatementAudioQuery = z.infer<typeof StatementAudioQuery>;

/** `GET /v1/media/audio/:lineId`: which voice reads each sentence of a member's statement. */
export const StatementAudio = z.strictObject({
  lineId: Uuid,
  memberNo: MemberNo,
  lang: Lang,
  /** Every sentence has a clip (`gemini`), some do (`mixed`), or none do (`device`). */
  source: z.enum(["gemini", "mixed", "device"]),
  /** Shown with the player: the synthetic-voice label, or the phone's voice when no sentence has a clip. */
  label: z.string().min(1),
  /** Names the phone's voice for each sentence without a clip. */
  deviceLabel: z.string().min(1),
  /** Every spoken sentence, in reading order. */
  sentences: z.array(StatementAudioSentence),
});
export type StatementAudio = z.infer<typeof StatementAudio>;

/** S1 "Audio": every clip says it is a synthetic voice, in its own language. */
export const SYNTHETIC_VOICE_LABELS = {
  ceb: "Sintetikong tingog (Gemini TTS)",
  fil: "Sintetikong boses (Gemini TTS)",
  en: "Synthetic voice (Gemini TTS)",
} as const satisfies Record<Lang, string>;

/** The phone's own voice (`expo-speech`; `speechSynthesis` in web frames), named as such. */
export const DEVICE_VOICE_LABELS = {
  ceb: "Tingog sa telepono",
  fil: "Boses ng telepono",
  en: "Device voice",
} as const satisfies Record<Lang, string>;
