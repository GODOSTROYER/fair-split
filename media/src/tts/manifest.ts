import { z } from "zod";
import { readJsonOr, writeJson } from "../util/json.js";

/** Label shown with every clip (I8: nothing simulated goes unlabelled; S1 M-MB-03 "Sintetikong tingog"). */
export const VOICE_LABEL = "Synthetic voice (Gemini TTS)";

/** One clip per sentence (S4.6 manifest fields, plus the label, draft flag and review state). */
export const AudioEntry = z.object({
  member_no: z.string().regex(/^M-\d{3}$/),
  lang: z.enum(["ceb", "fil", "en"]),
  slot: z.string().min(1),
  file: z.string().regex(/\.m4a$/),
  duration_ms: z.number().int().positive(),
  text: z.string().min(1),
  text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string(),
  voice: z.string(),
  style: z.string(),
  codec: z.object({ codec: z.literal("aac"), bit_rate_kbps: z.number(), channels: z.literal(1) }),
  created_at: z.string(),
  /** I8: every clip is a synthetic voice and says so. */
  synthetic: z.literal(true),
  label: z.literal(VOICE_LABEL),
  draft: z.boolean(),
  review: z.enum(["machine-translated, pending native review", "native-reviewed"]),
  request: z.object({ id: z.string(), latency_ms: z.number(), sentences: z.number().int().positive() }),
});
export type AudioEntry = z.infer<typeof AudioEntry>;

export const AudioManifest = z.object({
  v: z.literal(1),
  synthetic: z.literal(true),
  notice: z.string(),
  entries: z.array(AudioEntry),
});
export type AudioManifest = z.infer<typeof AudioManifest>;

export const AUDIO_NOTICE =
  "Every clip is a synthetic voice generated with Gemini TTS from synthetic statement text for fictional members. Cebuano and Filipino wording is machine-translated and pending native review.";

export async function loadAudioManifest(path: string): Promise<AudioManifest> {
  return AudioManifest.parse(
    await readJsonOr(path, {
      v: 1,
      synthetic: true,
      notice: AUDIO_NOTICE,
      entries: [],
    } satisfies AudioManifest),
  );
}

/** Replaces the entry for the same (member, lang, slot, draft) and keeps the list sorted. */
export function upsertEntry(m: AudioManifest, e: AudioEntry): AudioManifest {
  const key = (x: AudioEntry) => `${x.member_no}/${x.lang}/${x.slot}/${x.draft ? "draft" : "final"}`;
  const entries = [...m.entries.filter((x) => key(x) !== key(e)), AudioEntry.parse(e)].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
  return { ...m, entries };
}

/** A clip is regenerated only when its text changes (S4.6). */
export function needsRegeneration(
  m: AudioManifest,
  q: { member_no: string; lang: string; slot: string; draft: boolean; text_sha256: string },
): boolean {
  const hit = m.entries.find(
    (x) => x.member_no === q.member_no && x.lang === q.lang && x.slot === q.slot && x.draft === q.draft,
  );
  return !hit || hit.text_sha256 !== q.text_sha256;
}

export async function saveAudioManifest(path: string, m: AudioManifest): Promise<void> {
  await writeJson(path, AudioManifest.parse(m));
}
