import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { MEDIA_ROOT, REPO_ROOT, requireEnv } from "../util/env.js";
import { sha256 } from "../util/hash.js";
import { readJsonOr, writeJson } from "../util/json.js";
import { ASR_MODEL, cer, type GenerateContentClient, transcribe } from "./asr.js";
import { hasFfmpeg } from "./ffmpeg.js";
import {
  buildTtsParams,
  DEFAULT_VOICE,
  type InteractionsClient,
  TTS_DRAFT_MODEL,
  TTS_MODEL,
} from "./gemini.js";
import { loadAudioManifest, saveAudioManifest } from "./manifest.js";
import { type StatementResult, synthesizeStatement } from "./pipeline.js";
import { requestPlan } from "./plan.js";
import { pacificDay, QuotaLedger, SELF_IMPOSED_DAILY_CAP } from "./quota.js";
import { joinForRequest, LANGS, type Lang, m014SpikeStatement, STYLE_NOTE } from "./statement.js";

const USAGE = `tools/tts.ts — Gemini TTS for member statements (AI-10). Every clip is a synthetic voice.

  tts models                      list the TTS models this key can see (no TTS quota used)
  tts quota                       today's request counts (Pacific day), caps and recorded daily limits
  tts set-limit <model> <n> --source "<where you read it>"
                                  record the free-tier daily limit you read at aistudio.google.com/rate-limit
  tts plan                        S10 request plan: requests needed, days they take, verdict (no API call);
                                  written into media/audio/spike-s10.json
  tts asr                         listening proxy: transcribe the spike requests with ${ASR_MODEL} and score them
  tts spike [--voice Sulafat] [--langs ceb,fil,en] [--draft-langs ceb]
                                  S10: M-014's greeting and pay sentences, one request per language on
                                  ${TTS_MODEL}, plus drafts on ${TTS_DRAFT_MODEL}; writes
                                  media/audio/{member}/{lang}/{slot}.m4a, media/audio/manifest.json and
                                  media/audio/spike-s10.json`;

/** What the ASR self-check can and cannot show (S10). */
export const ASR_LIMITS =
  "A proxy only: Gemini transcribing Gemini shows the words came out in order, nothing about Cebuano pronunciation or naturalness. The S10 verdict waits on a person's listening test (OD-2).";

function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
}

export async function main(argv: readonly string[], mediaRoot = MEDIA_ROOT): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      voice: { type: "string" },
      langs: { type: "string" },
      "draft-langs": { type: "string" },
      source: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd] = positionals;
  if (!cmd || values.help) {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const ledger = new QuotaLedger(join(mediaRoot, "audio", ".quota.json"));
  switch (cmd) {
    case "models": {
      const pager = await client().models.list();
      const names: string[] = [];
      for await (const m of pager) {
        const name = m.name ?? "";
        if (/tts|speech|audio/i.test(name)) names.push(`${name}  ${m.displayName ?? ""}`);
      }
      console.log(names.sort().join("\n") || "no TTS models listed");
      return 0;
    }
    case "quota": {
      const q = await ledger.read();
      const day = pacificDay(new Date());
      console.log(`Pacific day ${day}`);
      console.log(JSON.stringify(q.days[day] ?? {}, null, 2));
      console.log(
        `caps: ${JSON.stringify(q.caps)} (${q.capsSource}); default ${SELF_IMPOSED_DAILY_CAP} a day`,
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
      await ledger.setDailyLimit(model, Number(n), values.source);
      console.log(`${model}: daily limit ${n} recorded; the ledger caps the model there`);
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
      const plans = {
        [TTS_MODEL]: requestPlan(limitOf(TTS_MODEL), q.caps[TTS_MODEL] ?? SELF_IMPOSED_DAILY_CAP),
        [TTS_DRAFT_MODEL]: requestPlan(
          limitOf(TTS_DRAFT_MODEL),
          q.caps[TTS_DRAFT_MODEL] ?? SELF_IMPOSED_DAILY_CAP,
        ),
      };
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
      const ai = client() as unknown as GenerateContentClient;
      const jobs = [
        ...LANGS.map((lang) => ({ lang, model: TTS_MODEL })),
        { lang: "ceb" as Lang, model: TTS_DRAFT_MODEL },
      ];
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
        await ledger.reserve(ASR_MODEL);
        try {
          const r = await transcribe(ai, await readFile(wavPath), j.lang);
          await ledger.settle(ASR_MODEL, { ok: true, latencyMs: r.latencyMs });
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
          await ledger.settle(ASR_MODEL, { ok: false, message: (e as Error).message });
          console.error(`[${j.lang}/${j.model}] ${(e as Error).message.slice(0, 300)}`);
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
      return results.length === jobs.length ? 0 : 2;
    }
    case "spike": {
      if (!hasFfmpeg()) {
        console.error("ffmpeg is required on PATH for the silence split and AAC encode");
        return 1;
      }
      const voice = values.voice ?? DEFAULT_VOICE;
      const langs = (values.langs ?? LANGS.join(",")).split(",").filter(Boolean) as Lang[];
      const draftLangs = (values["draft-langs"] ?? "ceb").split(",").filter(Boolean) as Lang[];
      const ai = client() as unknown as InteractionsClient;
      const deps = {
        client: ai,
        ledger,
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
            deps,
            manifest,
          );
          manifest = next;
          results.push(result);
          await saveAudioManifest(manifestPath, manifest);
        } catch (e) {
          const msg = (e as Error).message;
          errors.push({ lang: j.lang, model: j.model, error: msg.slice(0, 500) });
          console.error(`[M-014/${j.lang}/${j.model}] ${msg}`);
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
        results,
        errors,
      };
      const latencies = Object.values(after.days).flatMap((models) =>
        Object.values(models).flatMap((c) => c.latencyMs),
      );
      const report = {
        ...(prev as Record<string, unknown>),
        spike: "S10 Voice",
        project: "one Google project, one key (GEMINI_API_KEY), never rotated",
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
          "The SDK's automatic retries are off (maxRetries 0), so a 429 is counted once and surfaces instead of being retried; requests to one model are paced 21 s apart.",
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
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
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
