import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.js";
import { readJsonOr, writeJson } from "../util/json.js";
import { adaptiveCuts, alignWords, STATEMENT_CER_LIMIT } from "./alignment.js";
import { cer, isAsrModel } from "./asr.js";
import { type Cut, detectSilences, encodeAac, planCuts, probeAudio } from "./ffmpeg.js";
import { DEFAULT_VOICE, TTS_MODEL } from "./gemini.js";
import { GeminiCallError } from "./keys.js";
import {
  AudioEntry,
  type AudioManifest,
  loadAudioManifest,
  saveAudioManifest,
  upsertEntry,
  voiceLabel,
} from "./manifest.js";
import { isRequestCached, requestOnce, type TtsDeps } from "./pipeline.js";
import { APPROVED_STATEMENT_REQUESTS } from "./plan.js";
import { LANGS, STYLE_NOTE } from "./statement.js";
import { AsrUnavailableError, type ListeningDeps, listen } from "./statement-asr.js";
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
    super(`statement split refused: ${reason}; no unverified clips published`);
    this.name = "StatementSplitError";
  }
}
export class StatementVerificationError extends Error {
  constructor(readonly failed: string[]) {
    super(
      `statement verification refused ${failed.join(", ")}; missing sentences keep labelled device voice`,
    );
    this.name = "StatementVerificationError";
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

/** Propose local cuts, then timestamp alignment, then per-sentence requests. Every AAC is checked independently. */
export async function synthesizePlannedStatement(
  request: PlannedStatement,
  deps: TtsDeps & ListeningDeps,
  manifest: AudioManifest,
  opts: { draft?: boolean; voice?: string; onProgress?: (manifest: AudioManifest) => Promise<void> } = {},
): Promise<AudioManifest> {
  const marked = markRequest(request);
  const draft = opts.draft ?? false;
  const draftPath = join(deps.mediaRoot, "audio", "drafts", "manifest.json");
  if (!draft && manifest.entries.some((e) => e.draft)) {
    let drafts = await loadAudioManifest(draftPath);
    for (const entry of manifest.entries.filter((e) => e.draft))
      drafts = { ...drafts, entries: [...drafts.entries.filter((e) => e.file !== entry.file), entry] };
    await saveAudioManifest(draftPath, drafts);
  }
  let target = draft
    ? await loadAudioManifest(draftPath)
    : { ...manifest, entries: manifest.entries.filter((entry) => !entry.draft) };
  const evidencePath = join(deps.mediaRoot, "audio", "statement-verification.json");
  const evidence = await readJsonOr<{ v: number; clips: Record<string, unknown>[] }>(evidencePath, {
    v: 1,
    clips: [],
  });
  const archiveEntries = async (entries: AudioEntry[]) => {
    if (!entries.length) return;
    const path = join(deps.mediaRoot, "audio", "archive", "manifest.json");
    const archive = await loadAudioManifest(path);
    for (const entry of entries)
      archive.entries = [...archive.entries.filter((e) => e.file !== entry.file), entry];
    await saveAudioManifest(path, archive);
  };
  const ready = (s: z.infer<typeof Sentence>) =>
    target.entries.some(
      (e) =>
        e.member_no === request.member_no &&
        e.lang === request.lang &&
        e.slot === s.slot &&
        e.text_sha256 === s.textSha256 &&
        e.text === s.text &&
        e.draft === draft &&
        existsSync(join(deps.mediaRoot, e.file)) &&
        evidence.clips.some(
          (v) =>
            v.file === e.file &&
            v.textSha256 === s.textSha256 &&
            isAsrModel(v.asrModel) &&
            v.threshold === STATEMENT_CER_LIMIT &&
            typeof v.cer === "number" &&
            Number.isFinite(v.cer) &&
            v.cer >= 0 &&
            v.cer <= STATEMENT_CER_LIMIT &&
            typeof v.transcript === "string" &&
            v.transcript.trim().length > 0 &&
            v.audioSha256 === sha256(readFileSync(join(deps.mediaRoot, e.file))),
        ),
    );
  if (!draft) {
    const obsolete = target.entries.filter(
      (e) =>
        e.member_no === request.member_no &&
        e.lang === request.lang &&
        request.sentences.some((s) => s.slot === e.slot && s.textSha256 === e.text_sha256 && !ready(s)),
    );
    await archiveEntries(obsolete);
    if (obsolete.length) {
      target = {
        ...target,
        entries: target.entries.filter((e) => !obsolete.some((old) => old.file === e.file)),
      };
      await opts.onProgress?.(target);
    }
  }
  if (request.sentences.every(ready)) return draft ? manifest : target;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const base = { model: TTS_MODEL, voice, style: STYLE_NOTE };
  type Take = Awaited<ReturnType<typeof requestOnce>>;
  type Candidate = {
    entry: AudioEntry;
    staged: string;
    score: number;
    transcript: string;
    method: string;
    asrModel: string;
  };
  const prepare = async (
    take: Take,
    cuts: Cut[],
    _onsets: number[],
    segments: Segment[],
    sentences: PlannedStatement["sentences"],
    method: string,
  ): Promise<Candidate[] | null> => {
    const results: Candidate[] = [];
    const audio: Buffer[] = [];
    for (const [i, sentence] of sentences.entries()) {
      if (ready(sentence)) continue;
      const indices = segments.flatMap((s, n) => (s.sentence === i ? [n] : []));
      const first = indices[0];
      const last = indices.at(-1);
      if (first === undefined || last === undefined) return null;
      const start = cuts[first]?.start;
      const end = cuts[last]?.end;
      if (start === undefined || end === undefined || end <= start) return null;
      const staged = join(
        deps.cacheDir,
        `clip-${sha256(JSON.stringify([sha256(take.wav), start, end]))}.m4a`,
      );
      await encodeAac(take.path, staged, { start, end });
      const probe = await probeAudio(staged);
      if (probe.codec !== "aac" || probe.channels !== 1) throw new Error("statement AAC encoding mismatch");
      const offsets: { ref: string; at_ms: number }[] = [];
      let file = publishedFile(request, sentence, draft);
      const stem = file.slice(0, -4);
      for (let n = 2; existsSync(join(deps.mediaRoot, file)); n++) file = `${stem}-t${n}.m4a`;
      const entry = AudioEntry.parse({
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
          sentences: sentences.length,
        },
      });
      results.push({ entry, staged, score: -1, transcript: "", method, asrModel: "" });
      audio.push(await readFile(staged));
    }
    // Each request reserves a distinct next-ready key through the pool. Settle all calls before
    // propagating a quota error; no background request can race the next manifest/report write.
    const checks = await Promise.allSettled(
      results.map(async (candidate, i) => {
        const bytes = audio[i];
        if (!bytes) throw new Error("missing staged audio");
        const sentence = sentences.find((s) => s.textSha256 === candidate.entry.text_sha256);
        if (!sentence) throw new Error("missing staged sentence");
        const anchors = [
          ...sentence.placeholders.map((p) => ({ ...p, ref: `fact:${p.name}` })),
          ...sentence.mentionSpans,
        ];
        const timed = anchors.length > 0 || method === "per-sentence-asr";
        const heard = await listen(deps, bytes, "audio/mp4", request.lang, timed);
        candidate.score = cer(candidate.entry.text, heard.text);
        candidate.transcript = heard.text;
        candidate.asrModel = heard.model;
        if (timed) {
          const aligned = alignWords(heard.words, sentence.text, candidate.entry.duration_ms / 1000, anchors);
          if (!aligned) candidate.score = Number.POSITIVE_INFINITY;
          else candidate.entry.offsets = aligned.offsets;
        }
        deps.log?.(
          `[verify] ${request.member_no}:${request.lang} ${candidate.entry.slot} ${method} CER=${candidate.score}`,
        );
      }),
    );
    const verified = results.filter(
      (c) => Number.isFinite(c.score) && c.score >= 0 && c.score <= STATEMENT_CER_LIMIT,
    );
    // Each accepted sentence has its own AAC transcription and measured anchors. Keep that verified
    // progress before a different sentence's quota error; failed candidates never enter the manifest.
    if (verified.length && verified.length < results.length) await publish(verified);
    for (const check of checks) if (check.status === "rejected") throw check.reason;
    return results.some((c) => c.score > STATEMENT_CER_LIMIT) ? null : results;
  };
  const recoverable = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof GeminiCallError) || ![408, 500, 502, 503, 504].includes(error.status ?? 0))
        throw error;
      deps.log?.("[verify] bounded ASR service-unavailable attempts spent; candidate not verified");
      return null;
    }
  };
  const timestampCuts = async (take: Take, segments: Segment[]) => {
    const duration = parseWav(take.wav).durationMs / 1000;
    const heard = await listen(deps, take.wav, "audio/wav", request.lang, true);
    let text = "";
    const anchors = segments.map((s, n) => {
      const start = text.length + s.text.length - s.text.trimStart().length;
      text += `${s.text} `;
      return { ref: `segment:${n}`, start, spoken: s.text.trim().split(/\s+/).slice(0, 3).join(" ") };
    });
    const aligned = alignWords(heard.words, text, duration, anchors);
    if (!aligned) return null;
    const onsets = aligned.offsets.map((o) => o.at_ms / 1000);
    if (onsets.some((t, i) => i > 0 && t <= (onsets[i - 1] ?? 0))) return null;
    const cuts = onsets.map((t, i) => ({
      start: Math.max(0, t - 0.08),
      end: Math.min(duration, (onsets[i + 1] ?? duration + 0.08) - 0.08),
    }));
    return { cuts, onsets };
  };
  const tryTake = async (take: Take, segments: Segment[], sentences: PlannedStatement["sentences"]) => {
    const duration = parseWav(take.wav).durationMs / 1000;
    const silences = await detectSilences(take.path, duration);
    const strict = planCuts(duration, silences, segments.length);
    if (strict.ok) {
      const onsets = strict.cuts.map(
        (cut) =>
          silences.find((p) => Math.abs(Math.max(0, p.end - 0.15) - cut.start) < 0.002)?.end ?? cut.start,
      );
      const result = await recoverable(() =>
        prepare(take, strict.cuts, onsets, segments, sentences, "silence"),
      );
      if (result) return result;
    }
    const adaptive = adaptiveCuts(
      take.wav,
      segments.map((s) => s.text),
    );
    if (adaptive) {
      const result = await recoverable(() =>
        prepare(take, adaptive.cuts, adaptive.onsets, segments, sentences, "relative-silence-duration"),
      );
      if (result) return result;
    }
    const aligned = await recoverable(() => timestampCuts(take, segments));
    if (aligned)
      return recoverable(() =>
        prepare(take, aligned.cuts, aligned.onsets, segments, sentences, "asr-timestamps"),
      );
    return null;
  };
  const publish = async (candidates: Candidate[]) => {
    for (const c of candidates) {
      await mkdir(join(deps.mediaRoot, c.entry.file, ".."), { recursive: true });
      await copyFile(c.staged, join(deps.mediaRoot, c.entry.file));
      if (draft)
        target = { ...target, entries: [...target.entries.filter((e) => e.file !== c.entry.file), c.entry] };
      else {
        const superseded = target.entries.filter(
          (e) =>
            e.member_no === c.entry.member_no &&
            e.lang === c.entry.lang &&
            e.slot === c.entry.slot &&
            e.text_sha256 === c.entry.text_sha256 &&
            e.file !== c.entry.file,
        );
        await archiveEntries(superseded);
        target = upsertEntry(target, c.entry);
      }
      evidence.clips = [
        ...evidence.clips.filter((x) => x.file !== c.entry.file),
        {
          file: c.entry.file,
          textSha256: c.entry.text_sha256,
          audioSha256: sha256(await readFile(c.staged)),
          asrModel: c.asrModel,
          cer: c.score,
          transcript: c.transcript,
          threshold: STATEMENT_CER_LIMIT,
          method: c.method,
          verifiedAt: (deps.now?.() ?? new Date()).toISOString(),
          synthetic: true,
        },
      ];
      await writeJson(evidencePath, evidence);
      if (draft) await saveAudioManifest(draftPath, target);
      else await opts.onProgress?.(target);
      deps.log?.(`[published] ${c.entry.file}`);
    }
  };
  const cachedAttempts = new Set<string>();
  const trySentence = async (sentence: PlannedStatement["sentences"][number], retake = false) => {
    const single = await requestOnce(deps, { ...base, text: sentence.text }, { retake });
    const duration = parseWav(single.wav).durationMs / 1000;
    let candidates: Candidate[] | null;
    try {
      candidates = await prepare(
        single,
        [{ start: 0, end: duration }],
        [0],
        [{ sentence: 0, refs: [], text: sentence.text }],
        [sentence],
        "per-sentence-asr",
      );
    } catch (error) {
      if (
        error instanceof GeminiCallError &&
        error.kind === "other" &&
        ([408, 500, 502, 503, 504].includes(error.status ?? 0) ||
          /UNAVAILABLE|overloaded/i.test(error.message))
      )
        throw new AsrUnavailableError([error.message]);
      throw error;
    }
    if (candidates) await publish(candidates);
    return candidates;
  };
  // Recovery takes priority over generating or re-splitting the full statement.
  for (const sentence of request.sentences) {
    if (ready(sentence) || !isRequestCached(deps, { ...base, text: sentence.text })) continue;
    cachedAttempts.add(sentence.textSha256);
    await trySentence(sentence);
  }
  if (request.sentences.every(ready)) return draft ? manifest : target;
  if (!cachedAttempts.size) {
    const take = await requestOnce(deps, { ...base, text: marked.text });
    const full = await tryTake(take, marked.segments, request.sentences);
    if (full) await publish(full);
  }
  if (!request.sentences.every(ready)) {
    deps.log?.(
      `[fallback] ${request.member_no}:${request.lang}: split not verified; one request per sentence`,
    );
    const failed: string[] = [];
    for (const sentence of request.sentences) {
      if (ready(sentence)) continue;
      // New speech is allowed only after the original cached take failed this same strict check.
      if (!(await trySentence(sentence, cachedAttempts.has(sentence.textSha256))))
        failed.push(`${sentence.slot}:${sentence.textSha256.slice(0, 12)}`);
    }
    if (failed.length) throw new StatementVerificationError(failed);
  }
  return draft ? manifest : target;
}
