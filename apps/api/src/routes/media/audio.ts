// IC-11 statement audio (ADR-0011): which synthetic clip, if any, reads each spoken sentence of a statement.
//
// The published manifest is `${STATIC_MEDIA_DIR}/audio/manifest.json`: on Render the folder tools/assemble-media.ts
// writes (apps/api/dist/media) from media/audio by its allowlist, drafts included; unset, media/public. A sentence
// gets a clip only when an entry passes every rule of ADR-0011 §5: it parses (one malformed offset spoils the whole
// entry), it is synthetic and not a draft, its file is `audio/{its member}/{its lang}/{name}.m4a` (never
// `audio/drafts/…`) and exists in the static media directory, its `text` hashes to its `text_sha256`, and member,
// language, slot and hash equal the rendered sentence's. Otherwise the sentence has no clip and the phone's voice
// reads it, labelled; never a near clip.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  AudioOffsetRef,
  AudioSlot,
  DEVICE_VOICE_LABELS,
  Lang,
  MemberNo,
  Sha256Hex,
  type StatementAudio,
  type StatementAudioClip,
  SYNTHETIC_VOICE_LABELS,
} from "@fairsplit/contracts";
import { z } from "zod";
import { spokenTextSha256 } from "../../statements/render.js";

/** The only clip files fs-api points at: `audio/{member}/{lang}/{name}.m4a`, relative to the media root. */
export const AUDIO_CLIP_FILE_RE = /^audio\/(M-\d{3})\/(ceb|fil|en)\/[A-Za-z0-9_-]{1,64}\.m4a$/;

const ManifestOffset = z.strictObject({ ref: AudioOffsetRef, at_ms: z.int().nonnegative() });

/** One manifest entry as fs-api reads it; the producer's other fields (style, codec, review, request) are dropped. */
export const ManifestEntry = z.object({
  member_no: MemberNo,
  lang: Lang,
  slot: AudioSlot,
  file: z.string(),
  duration_ms: z.int().positive(),
  /** The exact spoken sentence the clip reads. */
  text: z.string().min(1),
  text_sha256: Sha256Hex,
  synthetic: z.literal(true),
  draft: z.boolean(),
  model: z.string(),
  voice: z.string(),
  created_at: z.string().optional(),
  offsets: z.array(ManifestOffset).optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

const Manifest = z.object({ v: z.literal(1), synthetic: z.literal(true), entries: z.array(z.unknown()) });

// One hash for IC-11's `textSha256` (ADR-0011 §3): T1's `spokenTextSha256`, the SHA-256 (lowercase hex) of a spoken
// sentence's UTF-8 bytes with no trimming or normalisation, the very helper the manifest producer's `spokenScript`
// writes `text_sha256` with. The route keeps no hash of its own, so the two can never disagree.

/** The published manifest's entries that parse, one by one (read per request: it is small). */
export function readAudioManifest(mediaDir: string): ManifestEntry[] {
  const file = path.join(mediaDir, "audio", "manifest.json");
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const m = Manifest.safeParse(raw);
  if (!m.success) return [];
  return m.data.entries.flatMap((e) => {
    const p = ManifestEntry.safeParse(e);
    return p.success ? [p.data] : [];
  });
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** ADR-0011 §5 rules 1–4: an entry fs-api may serve at all. */
function servable(e: ManifestEntry, mediaDir: string): boolean {
  if (e.draft || e.synthetic !== true) return false;
  const m = AUDIO_CLIP_FILE_RE.exec(e.file);
  if (!m || m[1] !== e.member_no || m[2] !== e.lang) return false;
  if (spokenTextSha256(e.text) !== e.text_sha256) return false;
  return isFile(path.join(mediaDir, ...e.file.split("/")));
}

/** One spoken sentence as the statement view renders it, with what it names. */
export interface SpokenSentence {
  slot: AudioSlot;
  /** The template variant rendered (`{slot}.{variant}`: `paypal`, `cash`, `default`, T1's `seeded`). */
  variant: string;
  text: string;
  /** `slip:0403`, `rule:R1`. */
  mentions: readonly string[];
  /** The placeholders the sentence fills (`NET_USD`, `HONORIFIC_NAME`), for `fact:` offsets. */
  placeholders: readonly string[];
}

function clipOf(e: ManifestEntry, s: SpokenSentence): StatementAudioClip {
  const known = new Set([...s.mentions, ...s.placeholders.map((p) => `fact:${p}`)]);
  const offsets = (e.offsets ?? [])
    .filter((o) => known.has(o.ref) && o.at_ms <= e.duration_ms)
    .map((o) => ({ ref: o.ref, atMs: o.at_ms }))
    .sort((a, b) => a.atMs - b.atMs);
  return {
    url: `/media/${e.file}`,
    textSha256: e.text_sha256,
    label: SYNTHETIC_VOICE_LABELS[e.lang],
    slot: e.slot,
    offsets,
    durationMs: e.duration_ms,
  };
}

/** Which voice reads each sentence of one member's statement in one language. */
export function resolveStatementAudio(args: {
  lineId: string;
  memberNo: string;
  lang: Lang;
  sentences: readonly SpokenSentence[];
  entries: readonly ManifestEntry[];
  mediaDir: string;
}): StatementAudio {
  const { memberNo, lang } = args;
  const candidates = args.entries
    .filter((e) => e.member_no === memberNo && e.lang === lang && servable(e, args.mediaDir))
    // the newest take first; entries without a date keep their order after dated ones
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.created_at ?? "").localeCompare(a.e.created_at ?? "") || a.i - b.i)
    .map(({ e }) => e);
  const sentences = args.sentences.map((s) => {
    const textSha256 = spokenTextSha256(s.text);
    const hit = candidates.find((e) => e.slot === s.slot && e.text_sha256 === textSha256);
    // slot, variant and mentions say which sentence this is, so a client pairs it with its own without reading
    // words, and never pairs one form of a slot (PAY.paypal, the seeded AI note) with another (ADR-0011 §6)
    return {
      slot: s.slot,
      variant: s.variant,
      mentions: [...s.mentions],
      textSha256,
      clip: hit ? clipOf(hit, s) : null,
    };
  });
  const clipped = sentences.filter((s) => s.clip !== null).length;
  const source =
    sentences.length > 0 && clipped === sentences.length ? "gemini" : clipped > 0 ? "mixed" : "device";
  return {
    lineId: args.lineId,
    memberNo,
    lang,
    source,
    label: source === "device" ? DEVICE_VOICE_LABELS[lang] : SYNTHETIC_VOICE_LABELS[lang],
    deviceLabel: DEVICE_VOICE_LABELS[lang],
    sentences,
  };
}
