import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaRelative } from "../imagegen/manifest.js";
import { sha256 } from "../util/hash.js";
import { type Cut, detectSilences, encodeAac, planCuts, probeAudio } from "./ffmpeg.js";
import { buildTtsParams, type InteractionsClient, synthesize, type TtsRequest } from "./gemini.js";
import type { KeyPool } from "./keys.js";
import { type AudioEntry, type AudioManifest, upsertEntry, voiceLabel } from "./manifest.js";
import { hasNoDigits } from "./spoken.js";
import { joinForRequest, type Lang, type SpokenSentence, STYLE_NOTE } from "./statement.js";
import { parseWav } from "./wav.js";

export interface StatementJob {
  member_no: string;
  lang: Lang;
  sentences: readonly SpokenSentence[];
  model: string;
  voice: string;
  draft: boolean;
}

export interface TtsDeps {
  /** The user's Gemini keys, round robin, each within its own free-tier limits (ADR-0014). */
  pool: KeyPool<InteractionsClient>;
  mediaRoot: string;
  cacheDir: string;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface RequestMeasure {
  model: string;
  lang: Lang;
  sentences: number;
  textChars: number;
  fromCache: boolean;
  latencyMs: number;
  audioMs: number;
  /** Audio seconds per wall-clock second of the request. */
  realtimeFactor: number;
  wavBytes: number;
  interactionId: string | null;
}

export interface StatementResult {
  job: Omit<StatementJob, "sentences">;
  requests: RequestMeasure[];
  split: { ok: boolean; reason?: string; fallback: boolean };
  clips: AudioEntry[];
}

interface CachedWav {
  wav: Buffer;
  latencyMs: number;
  interactionId: string | null;
  fromCache: boolean;
  path: string;
}

/** One TTS request, served from `.cache/tts/` when the exact request was made before (no quota spent). */
async function requestOnce(deps: TtsDeps, req: TtsRequest): Promise<CachedWav> {
  const key = sha256(JSON.stringify(buildTtsParams(req)));
  const wavPath = join(deps.cacheDir, `${key}.wav`);
  const metaPath = join(deps.cacheDir, `${key}.json`);
  if (existsSync(wavPath) && existsSync(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
      latencyMs: number;
      interactionId: string | null;
    };
    return { wav: await readFile(wavPath), ...meta, fromCache: true, path: wavPath };
  }
  if (!hasNoDigits(req.text)) throw new Error(`TTS text must not contain digits: ${req.text}`);
  // The pool counts the request on its key, settles it, and moves it to the next key on a 429.
  const r = await deps.pool.run(req.model, (client) => synthesize(client, req), {
    latencyMs: (x) => x.latencyMs,
  });
  await mkdir(deps.cacheDir, { recursive: true });
  await writeFile(wavPath, r.wav);
  await writeFile(
    metaPath,
    `${JSON.stringify({ latencyMs: r.latencyMs, interactionId: r.interactionId, model: req.model, voice: req.voice, at: (deps.now ?? (() => new Date()))().toISOString() }, null, 2)}\n`,
  );
  return {
    wav: r.wav,
    latencyMs: r.latencyMs,
    interactionId: r.interactionId,
    fromCache: false,
    path: wavPath,
  };
}

function measure(job: StatementJob, text: string, sentences: number, r: CachedWav): RequestMeasure {
  const info = parseWav(r.wav);
  return {
    model: job.model,
    lang: job.lang,
    sentences,
    textChars: text.length,
    fromCache: r.fromCache,
    latencyMs: r.latencyMs,
    audioMs: info.durationMs,
    realtimeFactor: r.latencyMs > 0 ? Math.round((info.durationMs / r.latencyMs) * 100) / 100 : 0,
    wavBytes: r.wav.length,
    interactionId: r.interactionId,
  };
}

export function clipPath(
  mediaRoot: string,
  job: Pick<StatementJob, "member_no" | "lang" | "draft" | "model">,
  slot: string,
): string {
  return job.draft
    ? join(mediaRoot, "audio", "drafts", job.member_no, job.lang, `${slot}.m4a`)
    : join(mediaRoot, "audio", job.member_no, job.lang, `${slot}.m4a`);
}

/**
 * One request per member and language with `<long pause>` between sentences, cut on silence into one
 * AAC clip per sentence (S4.6). If the pauses do not give exactly one clip per sentence, the statement
 * is re-requested one sentence at a time.
 */
export async function synthesizeStatement(job: StatementJob, deps: TtsDeps, manifest: AudioManifest) {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const text = joinForRequest(job.sentences);
  const base: TtsRequest = { model: job.model, voice: job.voice, style: STYLE_NOTE, text };
  const first = await requestOnce(deps, base);
  const requests = [measure(job, text, job.sentences.length, first)];
  log(
    `[${job.member_no}/${job.lang}/${job.model}] ${first.fromCache ? "cache" : `${first.latencyMs} ms`}, ${requests[0]?.audioMs} ms audio`,
  );

  const info = parseWav(first.wav);
  const silences = await detectSilences(first.path, info.durationMs / 1000);
  const plan = planCuts(info.durationMs / 1000, silences, job.sentences.length);
  const pieces: { sentence: SpokenSentence; wavPath: string; cut?: Cut; request: RequestMeasure }[] = [];
  let fallback = false;
  if (plan.ok) {
    job.sentences.forEach((s, i) => {
      const cut = plan.cuts[i];
      pieces.push({
        sentence: s,
        wavPath: first.path,
        ...(cut ? { cut } : {}),
        request: requests[0] as RequestMeasure,
      });
    });
  } else {
    fallback = true;
    log(`[${job.member_no}/${job.lang}] split failed (${plan.reason}); re-requesting one sentence at a time`);
    for (const s of job.sentences) {
      const r = await requestOnce(deps, { ...base, text: s.text });
      const m = measure(job, s.text, 1, r);
      requests.push(m);
      pieces.push({ sentence: s, wavPath: r.path, request: m });
    }
  }

  let next = manifest;
  const clips: AudioEntry[] = [];
  for (const p of pieces) {
    const out = clipPath(deps.mediaRoot, job, p.sentence.slot);
    await encodeAac(p.wavPath, out, p.cut);
    const probe = await probeAudio(out);
    const entry: AudioEntry = {
      member_no: job.member_no,
      lang: job.lang,
      slot: p.sentence.slot,
      file: mediaRelative(out, deps.mediaRoot),
      duration_ms: probe.durationMs,
      text: p.sentence.text,
      text_sha256: sha256(p.sentence.text),
      model: job.model,
      voice: job.voice,
      style: STYLE_NOTE,
      codec: { codec: "aac", bit_rate_kbps: 32, channels: 1 },
      created_at: now().toISOString(),
      synthetic: true,
      label: voiceLabel(job.lang),
      draft: job.draft,
      review: "machine-translated, pending native review",
      request: {
        id: p.request.interactionId ?? `cache-${sha256(p.wavPath).slice(0, 8)}`,
        latency_ms: p.request.latencyMs,
        sentences: p.request.sentences,
      },
    };
    next = upsertEntry(next, entry);
    clips.push(entry);
  }
  const result: StatementResult = {
    job: { member_no: job.member_no, lang: job.lang, model: job.model, voice: job.voice, draft: job.draft },
    requests,
    split: { ok: plan.ok, ...(plan.ok ? {} : { reason: plan.reason }), fallback },
    clips,
  };
  return { result, manifest: next };
}
