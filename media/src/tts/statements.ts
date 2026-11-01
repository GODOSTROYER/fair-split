import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.js";
import { detectSilences, encodeAac, planCuts, probeAudio } from "./ffmpeg.js";
import { DEFAULT_VOICE, TTS_MODEL } from "./gemini.js";
import {
  AudioEntry,
  type AudioManifest,
  loadAudioManifest,
  saveAudioManifest,
  upsertEntry,
  voiceLabel,
} from "./manifest.js";
import { requestOnce, type TtsDeps } from "./pipeline.js";
import { APPROVED_STATEMENT_REQUESTS } from "./plan.js";
import { LANGS, STYLE_NOTE } from "./statement.js";
import { parseWav } from "./wav.js";

const SLOTS = [
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
const Span = z.object({ spoken: z.string().min(1), start: z.number().int().nonnegative() });
const Sentence = z.object({
  slot: z.enum(SLOTS),
  variant: z.string().regex(/^[a-z_]+$/),
  text: z.string().min(1),
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  mentions: z.array(z.string()),
  placeholders: z.array(Span.extend({ name: z.string().regex(/^[A-Z][A-Z_]*$/) })),
  mentionSpans: z.array(Span.extend({ ref: z.string().regex(/^(slip|rule):[A-Za-z0-9-]+$/) })),
  displayText: z.string(),
});
export const PlannedStatement = z.object({
  member_no: z.string().regex(/^M-\d{3}$/),
  lang: z.enum(LANGS),
  lineId: z.string(),
  sentences: z.array(Sentence).min(1),
});
export type PlannedStatement = z.infer<typeof PlannedStatement>;
export const StatementPlans = z.object({
  v: z.literal(1),
  synthetic: z.literal(true),
  notice: z.string(),
  requests: z.array(PlannedStatement),
});

/** Validate the export before creating a client or spending quota. */
export async function loadStatementPlans(mediaRoot: string) {
  const plans = StatementPlans.parse(
    JSON.parse(await readFile(join(mediaRoot, "statement-plans.json"), "utf8")),
  );
  const key = (x: { member_no: string; lang: string }) => `${x.member_no}:${x.lang}`;
  if (JSON.stringify(plans.requests.map(key)) !== JSON.stringify(APPROVED_STATEMENT_REQUESTS.map(key)))
    throw new Error("statement export must contain all eleven approved requests in plan order");
  for (const request of plans.requests) markRequest(request);
  return plans;
}

export function selectRequests(requests: readonly PlannedStatement[], only?: string): PlannedStatement[] {
  if (only === undefined) return [...requests];
  const selected = requests.filter((r) => `${r.member_no}:${r.lang}` === only);
  if (selected.length !== 1) throw new Error("--only must name one planned member:language request");
  return selected;
}

interface Segment {
  sentence: number;
  refs: string[];
  text: string;
}

export class StatementSplitError extends Error {
  constructor(
    readonly expectedSegments: number,
    readonly detectedInteriorPauses: number,
    reason: string,
  ) {
    super(`statement split refused: ${reason}; no clips published, no sentence retries`);
    this.name = "StatementSplitError";
  }
}
/** Every measured onset gets a pause. Text hashes always name the untouched exported sentence. */
export function markRequest(input: PlannedStatement): { text: string; segments: Segment[] } {
  const request = PlannedStatement.parse(input);
  const segments: Segment[] = [];
  request.sentences.forEach((s, sentence) => {
    if (sha256(s.text) !== s.textSha256) throw new Error("statement export text hash mismatch");
    if (/<[^>]*pause[^>]*>/i.test(s.text)) throw new Error("statement text contains a pause marker");
    const mentionSpans = [...s.mentionSpans].sort((a, b) => a.start - b.start);
    if (JSON.stringify(mentionSpans.map((m) => m.ref)) !== JSON.stringify(s.mentions))
      throw new Error("statement mention order or mention count mismatch");
    const anchors = [...s.placeholders.map((p) => ({ ...p, ref: `fact:${p.name}` })), ...mentionSpans].sort(
      (a, b) => a.start - b.start,
    );
    const starts = new Map<number, string[]>([[0, []]]);
    for (const a of anchors) {
      if (s.text.slice(a.start, a.start + a.spoken.length) !== a.spoken)
        throw new Error("statement spoken span does not match its exact text");
      starts.set(a.start, [...new Set([...(starts.get(a.start) ?? []), a.ref])]);
    }
    const positions = [...starts.keys()].sort((a, b) => a - b);
    positions.forEach((start, i) => {
      const text = s.text.slice(start, positions[i + 1]);
      if (!text.trim()) throw new Error("statement pause would delimit empty speech");
      segments.push({ sentence, refs: starts.get(start) ?? [], text });
    });
  });
  return { text: segments.map((s) => s.text).join(" <long pause> "), segments };
}

function publishedFile(request: PlannedStatement, sentence: z.infer<typeof Sentence>, draft: boolean) {
  const nn = String(SLOTS.indexOf(sentence.slot) + 1).padStart(2, "0");
  return `audio/${draft ? "drafts/" : ""}${request.member_no}/${request.lang}/s${nn}-${sentence.slot}-${sentence.textSha256.slice(0, 12)}.m4a`;
}

/** One pooled generation, then local splitting. No sentence retry or guessed onset can enter the manifest. */
export async function synthesizePlannedStatement(
  request: PlannedStatement,
  deps: TtsDeps,
  manifest: AudioManifest,
  opts: { draft?: boolean; voice?: string } = {},
): Promise<AudioManifest> {
  const marked = markRequest(request);
  const draft = opts.draft ?? false;
  const draftPath = join(deps.mediaRoot, "audio", "drafts", "manifest.json");
  let target = draft
    ? await loadAudioManifest(draftPath)
    : { ...manifest, entries: manifest.entries.filter((entry) => !entry.draft) };
  const ready = (s: z.infer<typeof Sentence>) =>
    target.entries.some(
      (e) =>
        e.member_no === request.member_no &&
        e.lang === request.lang &&
        e.slot === s.slot &&
        e.text_sha256 === s.textSha256 &&
        e.text === s.text &&
        e.draft === draft &&
        existsSync(join(deps.mediaRoot, e.file)),
    );
  if (request.sentences.every(ready)) return draft ? manifest : target;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const take = await requestOnce(deps, { text: marked.text, model: TTS_MODEL, voice, style: STYLE_NOTE });
  const duration = parseWav(take.wav).durationMs / 1000;
  const silences = await detectSilences(take.path, duration);
  const split = planCuts(duration, silences, marked.segments.length);
  if (!split.ok) throw new StatementSplitError(marked.segments.length, split.interior, split.reason);
  const entries: AudioEntry[] = [];
  for (const [i, sentence] of request.sentences.entries()) {
    if (ready(sentence)) continue;
    const segments = marked.segments
      .map((s, n) => ({ ...s, cut: split.cuts[n] }))
      .filter((s) => s.sentence === i);
    const start = segments[0]?.cut?.start;
    const end = segments.at(-1)?.cut?.end;
    if (start === undefined || end === undefined) throw new Error("statement split lost a sentence");
    let file = publishedFile(request, sentence, draft);
    const stem = file.slice(0, -4);
    // Immutable paths: an orphan or retake gets a fresh filename too.
    for (let takeNo = 2; existsSync(join(deps.mediaRoot, file)); takeNo++) file = `${stem}-t${takeNo}.m4a`;
    const out = join(deps.mediaRoot, file);
    await encodeAac(take.path, out, { start, end });
    const probe = await probeAudio(out);
    if (probe.codec !== "aac" || probe.channels !== 1) throw new Error("statement AAC encoding mismatch");
    const offsets = segments.flatMap((s) =>
      s.refs.map((ref) => {
        const boundary = s.cut?.start ?? start;
        // planCuts preserves 150 ms of silence before speech. Offsets name the detected onset,
        // not the padded cut's beginning; also handles an initial leading marker.
        const pause = silences.find((p) => Math.abs(Math.max(0, p.end - 0.15) - boundary) < 0.002);
        return { ref, at_ms: Math.round(((pause?.end ?? boundary) - start) * 1000) };
      }),
    );
    if (offsets.some((o) => o.at_ms > probe.durationMs))
      throw new Error("statement offset exceeds encoded clip");
    entries.push(
      AudioEntry.parse({
        member_no: request.member_no,
        lang: request.lang,
        slot: sentence.slot,
        variant: sentence.variant,
        file,
        duration_ms: probe.durationMs,
        text: sentence.text,
        text_sha256: sentence.textSha256,
        model: TTS_MODEL,
        voice,
        style: STYLE_NOTE,
        codec: { codec: "aac", bit_rate_kbps: 32, channels: 1 },
        created_at: (deps.now?.() ?? new Date()).toISOString(),
        synthetic: true,
        label: voiceLabel(request.lang),
        draft,
        review: "machine-translated, pending native review",
        offsets,
        request: {
          id: take.interactionId ?? "cached-statement",
          latency_ms: take.latencyMs,
          sentences: request.sentences.length,
        },
      }),
    );
  }
  for (const entry of entries) target = upsertEntry(target, entry);
  if (draft) {
    await saveAudioManifest(draftPath, target);
    return manifest;
  }
  return target;
}
