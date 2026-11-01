import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { MEDIA_ROOT, REPO_ROOT } from "../util/env.js";
import { sha256 } from "../util/hash.js";
import { readJsonOr, writeJson } from "../util/json.js";
import { STATEMENT_CER_LIMIT } from "./alignment.js";
import { ASR_MODEL, cer, type GenerateContentClient, transcribe } from "./asr.js";
import { hasFfmpeg } from "./ffmpeg.js";
import {
  buildTtsParams,
  DEFAULT_VOICE,
  type InteractionsClient,
  TTS_DRAFT_MODEL,
  TTS_MODEL,
} from "./gemini.js";
import {
  checkKeys,
  describeError,
  formatKeyChecks,
  formatPoolStatus,
  GeminiCallError,
  KeyPool,
  keyId,
  keysForScrubbing,
  keysFromEnv,
  listModels,
  PoolExhaustedError,
  poolDisclosure,
  scrubSecrets,
} from "./keys.js";
import { loadAudioManifest, saveAudioManifest } from "./manifest.js";
import { type StatementResult, synthesizeStatement } from "./pipeline.js";
import { requestPlan } from "./plan.js";
import { pacificDay, QuotaLedger, SELF_IMPOSED_DAILY_CAP } from "./quota.js";
import { joinForRequest, LANGS, type Lang, m014SpikeStatement, STYLE_NOTE } from "./statement.js";
import {
  loadStatementPlans,
  StatementSplitError,
  StatementVerificationError,
  selectRequests,
  synthesizePlannedStatement,
} from "./statements.js";

const USAGE = `tools/tts.ts — Gemini TTS for member statements (AI-10). Every clip is a synthetic voice.
Requests go out on the user's Gemini keys from .env (GEMINI_API_KEY, then GEMINI_API_KEYS_FALLBACK), round
robin, each within its own free-tier limits (user decision, 1 Nov; ADR-0014).

  tts keys                        check every key with the free models.list call (no generation request);
                                  prints each key's id (first 8 hex of its sha256) and status
  tts models                      list the TTS models the first key can see, with the same free models.list
                                  call (no TTS quota used)
  tts quota                       today's requests (Pacific day) per key id and model, and the pool total;
                                  caps and recorded daily limits
  tts set-limit <model> <n> --source "<where you read it>"
                                  record the free-tier daily limit you read at aistudio.google.com/rate-limit;
                                  each key is capped there
  tts plan [--keys <count>]        S10 request plan: requests needed, days they take at the pool's capacity,
                                  verdict (no API call); written into media/audio/spike-s10.json
  tts asr                         listening proxy: transcribe the spike requests with ${ASR_MODEL} and score them
  tts statements [--dry-run] [--only M-014:ceb] [--draft]
                                  exact exported API sentences, one pooled request per member/language;
                                  verifies each clip and falls back to per-sentence requests;
                                  drafts have a separate, unserved manifest
  tts spike [--voice Sulafat] [--langs ceb,fil,en] [--draft-langs ceb]
                                  S10: M-014's greeting and pay sentences, one request per language on
                                  ${TTS_MODEL}, plus drafts on ${TTS_DRAFT_MODEL}; writes
                                  media/audio/{member}/{lang}/{slot}.m4a, media/audio/manifest.json and
                                  media/audio/spike-s10.json`;

/** What the ASR self-check can and cannot show (S10). */
export const ASR_LIMITS =
  "A proxy only: Gemini transcribing Gemini shows the words came out in order, nothing about Cebuano pronunciation or naturalness. The S10 verdict waits on a person's listening test (OD-2).";

/** One `@google/genai` client per key covers both calls this tool makes. */
type GeminiClient = InteractionsClient & GenerateContentClient;

/** Test seams: planted keys instead of `.env`, and a fake fetch for `tts keys` and `tts models`. */
export interface CliDeps {
  keys?: readonly string[];
  fetch?: typeof fetch;
}

/**
 * Runs one tts command and never rethrows: a failure is printed as one line scrubbed of every key, and the
 * exit code is 1. A rethrown error would reach Node's handler, which prints the raw message and stack, and
 * an SDK error can name a key.
 */
export async function main(
  argv: readonly string[],
  mediaRoot = MEDIA_ROOT,
  deps: CliDeps = {},
): Promise<number> {
  delete process.env.GOOGLE_GENAI_DEBUG;
  console.error("tts: SDK debug logging is off because it prints keys");
  try {
    return await command(argv, mediaRoot, deps);
  } catch (e) {
    console.error(`tts: ${describeError(e, deps.keys ?? keysForScrubbing())}`);
    return 1;
  }
}

async function command(argv: readonly string[], mediaRoot: string, deps: CliDeps): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      voice: { type: "string" },
      langs: { type: "string" },
      "draft-langs": { type: "string" },
      source: { type: "string" },
      keys: { type: "string" },
      only: { type: "string" },
      "dry-run": { type: "boolean" },
      draft: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd] = positionals;
  if (!cmd || values.help) {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const ledger = new QuotaLedger(join(mediaRoot, "audio", ".quota.json"));
  // Key values stay in this process's memory: read from .env, handed to the pool, never printed.
  const keys = () => [...(deps.keys ?? keysFromEnv())];
  const pool = () =>
    new KeyPool<GeminiClient>(keys(), {
      ledger,
      makeClient: (apiKey) => new GoogleGenAI({ apiKey }) as unknown as GeminiClient,
      log: (l) => console.log(l),
    });
  const models = [...new Set([TTS_MODEL, TTS_DRAFT_MODEL, ASR_MODEL])];
  switch (cmd) {
    case "statements": {
      const plans = await loadStatementPlans(mediaRoot);
      const selected = selectRequests(plans.requests, values.only);
      console.log(`${selected.length} planned request(s), ${TTS_MODEL}, ${values.draft ? "draft" : "final"}`);
      for (const r of selected) console.log(`${r.member_no}:${r.lang} ${r.sentences.length} sentences`);
      if (values["dry-run"]) return 0;
      if (!hasFfmpeg()) throw new Error("ffmpeg is required for statement splitting");
      const p = pool();
      const manifestPath = join(mediaRoot, "audio", "manifest.json");
      let manifest = await loadAudioManifest(manifestPath);
      const failures: { request: string; failed: string[]; detail: string }[] = [];
      const plannedStatus = async (quotaRefused: boolean) => {
        const evidence = await readJsonOr<{ clips: Record<string, unknown>[] }>(
          join(mediaRoot, "audio", "statement-verification.json"),
          { clips: [] },
        );
        return Promise.all(
          plans.requests.map(async (request) => ({
            request: `${request.member_no}:${request.lang}`,
            sentences: await Promise.all(
              request.sentences.map(async (sentence) => {
                let verified = false;
                for (const entry of manifest.entries) {
                  if (
                    entry.draft ||
                    entry.member_no !== request.member_no ||
                    entry.lang !== request.lang ||
                    entry.slot !== sentence.slot ||
                    entry.text !== sentence.text ||
                    entry.text_sha256 !== sentence.textSha256
                  )
                    continue;
                  const record =
                    Array.isArray(evidence.clips) &&
                    evidence.clips.find(
                      (clip) =>
                        clip.file === entry.file &&
                        clip.textSha256 === sentence.textSha256 &&
                        clip.asrModel === ASR_MODEL &&
                        clip.threshold === STATEMENT_CER_LIMIT &&
                        typeof clip.cer === "number" &&
                        Number.isFinite(clip.cer) &&
                        clip.cer >= 0 &&
                        clip.cer <= STATEMENT_CER_LIMIT,
                    );
                  if (!record) continue;
                  try {
                    if (record.audioSha256 === sha256(await readFile(join(mediaRoot, entry.file))))
                      verified = true;
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                  }
                  if (verified) break;
                }
                return {
                  textSha256: sentence.textSha256,
                  status: verified ? "published" : quotaRefused ? "waiting_on_quota" : "not_verified",
                };
              }),
            ),
          })),
        );
      };
      for (const request of selected) {
        try {
          manifest = await synthesizePlannedStatement(
            request,
            {
              pool: p,
              asrPool: p,
              mediaRoot,
              cacheDir: join(mediaRoot, ".cache", "tts"),
              log: (line) => console.log(line),
            },
            manifest,
            {
              ...(values.voice === undefined ? {} : { voice: values.voice }),
              draft: values.draft ?? false,
              onProgress: async (next) => {
                if (!values.draft) await saveAudioManifest(manifestPath, next);
              },
            },
          );
          if (!values.draft) await saveAudioManifest(manifestPath, manifest);
        } catch (error) {
          const detail = describeError(error, keys());
          manifest = await loadAudioManifest(manifestPath);
          if (error instanceof StatementVerificationError) {
            failures.push({ request: `${request.member_no}:${request.lang}`, failed: error.failed, detail });
            console.error(detail);
            continue;
          }
          const status = await p.status([TTS_MODEL, ASR_MODEL]);
          const quotaRefused =
            error instanceof PoolExhaustedError ||
            (error instanceof GeminiCallError && error.kind === "rate");
          const report = {
            outcome:
              error instanceof StatementSplitError
                ? "split_refused"
                : quotaRefused
                  ? "quota_refused"
                  : "generation_failed",
            quotaRefused,
            ...(error instanceof StatementSplitError
              ? {
                  expectedSegments: error.expectedSegments,
                  detectedInteriorPauses: error.detectedInteriorPauses,
                }
              : {}),
            request: `${request.member_no}:${request.lang}`,
            model: error instanceof PoolExhaustedError ? error.model : TTS_MODEL,
            at: new Date().toISOString(),
            detail,
            dailyResetsAt: status.resetsAt,
            keyResets: status.keys.map((key) => ({
              keyId: key.id,
              dropped: key.dropped,
              models: Object.fromEntries(
                status.models.map((model) => [
                  model,
                  { ...key.models[model], resetsAt: key.models[model]?.cooling?.until ?? status.resetsAt },
                ]),
              ),
            })),
            planned: await plannedStatus(quotaRefused),
            failures,
            cooling: status.keys.flatMap((k) =>
              k.models[TTS_MODEL]?.cooling ? [{ keyId: k.id, ...k.models[TTS_MODEL]?.cooling }] : [],
            ),
            synthetic: true,
            notice:
              "Generation stopped. Missing clips use labelled device voice. Requests used the key pool within each key's free limits.",
          };
          await writeJson(join(mediaRoot, "audio", "statement-validation.json"), report);
          console.error(`${detail}${quotaRefused ? `; daily cap reset ${status.resetsAt}` : ""}`);
          return 2;
        }
      }
      await writeJson(join(mediaRoot, "audio", "statement-validation.json"), {
        outcome: failures.length ? "verification_refused" : "complete",
        quotaRefused: false,
        at: new Date().toISOString(),
        selected: selected.map((r) => `${r.member_no}:${r.lang}`),
        failures,
        planned: await plannedStatus(false),
        synthetic: true,
        notice: failures.length
          ? "Unverified clips use labelled device voice. Other planned requests continued. Native pronunciation review remains pending."
          : "Published clips passed independent AAC ASR verification. Native pronunciation review remains pending.",
      });
      return failures.length ? 2 : 0;
    }
    case "keys": {
      const results = await checkKeys(keys(), deps.fetch ?? fetch);
      console.log(formatKeyChecks(results));
      return results.every((r) => r.ok) ? 0 : 2;
    }
    case "models": {
      // The same free REST call as `tts keys`, key in the header, failures scrubbed (not the SDK's pager,
      // whose errors carry Google's raw body).
      const all = keys();
      const first = all[0] as string;
      const listed = await listModels(first, all, deps.fetch ?? fetch);
      if (!listed.ok) {
        console.error(
          `models.list failed on key ${keyId(first)}: ${listed.detail}; check every key with tts keys`,
        );
        return 2;
      }
      const names = listed.models
        .filter((m) => /tts|speech|audio/i.test(m.name))
        .map((m) => `${m.name}  ${m.displayName}`);
      console.log(names.sort().join("\n") || "no TTS models listed");
      return 0;
    }
    case "quota": {
      const p = pool();
      const q = await ledger.read();
      const day = pacificDay(new Date());
      const seen = Object.keys(q.days[day] ?? {});
      console.log(formatPoolStatus(await p.status([...new Set([...models, ...seen])])));
      console.log(`totals per model today: ${JSON.stringify(q.days[day] ?? {})}`);
      console.log(
        `caps per key: ${JSON.stringify(q.caps)} (${q.capsSource}); default ${SELF_IMPOSED_DAILY_CAP} a day per key`,
      );
      console.log(`daily limits read in AI Studio: ${JSON.stringify(q.dailyLimits ?? {})}`);
      return 0;
    }
    case "set-limit": {
      const [, model, n] = positionals;
      if (!model || !n || !values.source) {
        console.error(
          'usage: tts set-limit <model> <requests per day> --source "<where you read it, and when>"',
        );
        return 1;
      }
      // The ledger never holds a key, even one pasted into --source by mistake.
      const secrets = deps.keys ?? keysForScrubbing();
      const name = scrubSecrets(model, secrets);
      await ledger.setDailyLimit(name, Number(n), scrubSecrets(values.source, secrets));
      console.log(`${name}: daily limit ${n} recorded; the ledger caps each key there for this model`);
      return 0;
    }
    case "plan": {
      const q = await ledger.read();
      const limitOf = (model: string) => {
        const read = q.dailyLimits?.[model];
        return read
          ? { value: read.value, source: `${read.source} (recorded ${read.at})` }
          : {
              value: null,
              source:
                "not read yet: a person reads it at https://aistudio.google.com/rate-limit (tts set-limit)",
            };
      };
      // Drafts and finals share one model, so one plan covers both, at the pool's capacity.
      // An offline plan needs a capacity, not a credential. Default to one assumed key when unset.
      const configuredKeys = values.keys === undefined ? (deps.keys ?? keysForScrubbing()).length : 0;
      const poolKeys = values.keys === undefined ? Math.max(1, configuredKeys) : Number(values.keys);
      if (values.keys === undefined && configuredKeys === 0)
        console.log("No Gemini keys configured: assuming 1 key; use --keys <count> to plan capacity.");
      const plans = Object.fromEntries(
        [...new Set([TTS_MODEL, TTS_DRAFT_MODEL])].map((m) => [
          m,
          requestPlan(limitOf(m), q.caps[m] ?? SELF_IMPOSED_DAILY_CAP, { keys: poolKeys }),
        ]),
      );
      const reportPath = join(mediaRoot, "audio", "spike-s10.json");
      const report = await readJsonOr<Record<string, unknown>>(reportPath, {});
      const finalPlan = plans[TTS_MODEL];
      const asr = report.asrCheck as Record<string, unknown> | undefined;
      await writeJson(reportPath, {
        ...report,
        ...(asr ? { asrCheck: { ...asr, proxyOnly: true, limits: ASR_LIMITS } } : {}),
        requestPlan: { computedAt: new Date().toISOString(), byModel: plans },
        verdict: s10Verdict(finalPlan?.dailyLimit.value ?? null),
      });
      console.log(finalPlan?.verdict);
      return 0;
    }
    case "asr": {
      // Listening proxy: transcribe each cached spike request with another Gemini model and score it.
      const voice = values.voice ?? DEFAULT_VOICE;
      const p = pool();
      // Drafts now use the finals' model, so the Cebuano draft is the same request as the final.
      const jobs = [
        ...LANGS.map((lang) => ({ lang, model: TTS_MODEL })),
        { lang: "ceb" as Lang, model: TTS_DRAFT_MODEL },
      ].filter((j, i, all) => all.findIndex((x) => x.lang === j.lang && x.model === j.model) === i);
      type AsrResult = {
        lang: Lang;
        ttsModel: string;
        asrModel: string;
        cer: number;
        transcript: string;
        latencyMs: number;
      };
      const reportPath = join(mediaRoot, "audio", "spike-s10.json");
      const report = await readJsonOr<Record<string, unknown> & { asrCheck?: { results?: AsrResult[] } }>(
        reportPath,
        {},
      );
      // Keep earlier scores; only request what is still missing (a 503 or a new language).
      const results: AsrResult[] = (report.asrCheck?.results ?? []).map((r) => ({
        ...r,
        // Re-score stored transcripts with the current normaliser; no request needed.
        cer: cer(joinForRequest(m014SpikeStatement(r.lang)), r.transcript),
      }));
      for (const j of jobs) {
        if (results.some((r) => r.lang === j.lang && r.ttsModel === j.model)) continue;
        const text = joinForRequest(m014SpikeStatement(j.lang));
        const key = sha256(
          JSON.stringify(buildTtsParams({ model: j.model, voice, style: STYLE_NOTE, text })),
        );
        const wavPath = join(mediaRoot, ".cache", "tts", `${key}.wav`);
        if (!existsSync(wavPath)) {
          console.error(`[${j.lang}/${j.model}] no cached request; run tts spike first`);
          continue;
        }
        const wav = await readFile(wavPath);
        try {
          const r = await p.run(ASR_MODEL, (client) => transcribe(client, wav, j.lang), {
            latencyMs: (x) => x.latencyMs,
          });
          const score = cer(text, r.text);
          results.push({
            lang: j.lang,
            ttsModel: j.model,
            asrModel: ASR_MODEL,
            cer: score,
            transcript: r.text,
            latencyMs: r.latencyMs,
          });
          console.log(`[${j.lang}/${j.model}] CER ${score} in ${r.latencyMs} ms: ${r.text}`);
        } catch (e) {
          // The pool has settled the request and scrubbed the message; scrub again before shortening it.
          console.error(
            `[${j.lang}/${j.model}] ${p.scrub(String((e as Error)?.message ?? e)).slice(0, 300)}`,
          );
          if (e instanceof PoolExhaustedError) break;
        }
      }
      await writeJson(reportPath, {
        ...report,
        asrCheck: {
          proxyOnly: true,
          method: `Each spike request transcribed by ${ASR_MODEL}; character error rate against the text sent (lower case, no punctuation).`,
          limits: ASR_LIMITS,
          ranAt: new Date().toISOString(),
          results,
        },
      });
      return jobs.every((j) => results.some((r) => r.lang === j.lang && r.ttsModel === j.model)) ? 0 : 2;
    }
    case "spike": {
      if (!hasFfmpeg()) {
        console.error("ffmpeg is required on PATH for the silence split and AAC encode");
        return 1;
      }
      const voice = values.voice ?? DEFAULT_VOICE;
      const langs = (values.langs ?? LANGS.join(",")).split(",").filter(Boolean) as Lang[];
      const draftLangs = (values["draft-langs"] ?? "ceb").split(",").filter(Boolean) as Lang[];
      const p = pool();
      const ttsDeps = {
        pool: p,
        mediaRoot,
        cacheDir: join(mediaRoot, ".cache", "tts"),
        log: (l: string) => console.log(l),
      };
      const manifestPath = join(mediaRoot, "audio", "manifest.json");
      let manifest = await loadAudioManifest(manifestPath);
      const results: StatementResult[] = [];
      const errors: { lang: Lang; model: string; error: string }[] = [];
      const jobs = [
        ...langs.map((lang) => ({ lang, model: TTS_MODEL, draft: false })),
        ...draftLangs.map((lang) => ({ lang, model: TTS_DRAFT_MODEL, draft: true })),
      ];
      for (const j of jobs) {
        try {
          const { result, manifest: next } = await synthesizeStatement(
            {
              member_no: "M-014",
              lang: j.lang,
              sentences: m014SpikeStatement(j.lang),
              model: j.model,
              voice,
              draft: j.draft,
            },
            ttsDeps,
            manifest,
          );
          manifest = next;
          results.push(result);
          await saveAudioManifest(manifestPath, manifest);
        } catch (e) {
          // Errors from a Gemini call are scrubbed by the pool; scrub again in case one came from elsewhere.
          const msg = p.scrub(String((e as Error)?.message ?? e));
          errors.push({ lang: j.lang, model: j.model, error: msg.slice(0, 500) });
          console.error(`[M-014/${j.lang}/${j.model}] ${msg}`);
          // Every key is exhausted: stop here; statements without a clip use the labelled device voice.
          if (e instanceof PoolExhaustedError) break;
        }
      }
      const after = await ledger.read();
      const sent = Object.entries(after.days).reduce(
        (n, [, models]) => n + Object.values(models).reduce((m, c) => m + c.requests, 0),
        0,
      );
      const reportPath = join(mediaRoot, "audio", "spike-s10.json");
      const prev = await readJsonOr<
        { runs?: unknown[]; requestsSentTotal?: number } & Record<string, unknown>
      >(reportPath, {});
      const run = {
        ranAt: new Date().toISOString(),
        pacificDay: pacificDay(new Date()),
        voice,
        keyPool: { keys: p.size, ids: p.ids(), dropped: p.dropped() },
        results,
        errors,
      };
      const latencies = Object.values(after.days).flatMap((models) =>
        Object.values(models).flatMap((c) => c.latencyMs),
      );
      const report = {
        ...(prev as Record<string, unknown>),
        spike: "S10 Voice",
        project: poolDisclosure(p.size),
        models: { final: TTS_MODEL, draft: TTS_DRAFT_MODEL },
        requestsSentTotal: sent,
        latencyMs: {
          n: latencies.length,
          min: latencies.length ? Math.min(...latencies) : null,
          max: latencies.length ? Math.max(...latencies) : null,
          mean: latencies.length ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : null,
        },
        observedLimits: after.observed,
        ledgerDays: after.days,
        runs: [...(prev.runs ?? []), run],
        notes: [
          "Free-tier daily TTS limits are not published (ai.google.dev rate-limits page, read 22 Oct 2026); read them at https://aistudio.google.com/rate-limit and record them with tts set-limit (it caps media/audio/.quota.json).",
          "The SDK's automatic retries are off (maxRetries 0), so a 429 is counted once on its key; the key cools and the request moves to the next ready key. Requests on the same key to the same model are paced 21 s apart, and each key has its own daily cap (ADR-0014).",
          "Cebuano and Filipino wording is machine-translated, pending native review (OD-2); pronunciation needs a person's listening test.",
        ],
      };
      await writeJson(reportPath, report);
      console.log(
        `wrote media/audio/spike-s10.json (${sent} request(s) sent in total, ${errors.length} error(s) this run)`,
      );
      return errors.length ? 2 : 0;
    }
    default:
      console.error(`unknown command\n\n${USAGE}`);
      return 1;
  }
}

/**
 * The S10 verdict as far as code can say it: Cebuano audio comes back on the free tier, but the spike
 * passes only after a person has listened (OD-2) and someone has read the daily limit in AI Studio.
 */
export function s10Verdict(dailyLimit: number | null) {
  return {
    status: "PENDING",
    shown:
      "gemini-3.8-flash-tts returned Cebuano, Filipino and English audio on the free tier (22 Oct); 3 requests a minute (from a 429)",
    waitsOn: [
      "the user's listening test of voice Sulafat in Cebuano, Filipino and English (OD-2)",
      ...(dailyLimit === null
        ? [
            "the free-tier daily limit, read at https://aistudio.google.com/rate-limit and recorded with tts set-limit",
          ]
        : []),
    ],
    asrCheck: "a proxy only; it does not decide S10",
    fallback: "Filipino audio with Cebuano text, labelled (S10 fallback)",
  };
}

export { REPO_ROOT };
