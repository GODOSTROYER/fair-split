import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.js";
import { ASR_MODELS, asrPrompt, type GenerateContentClient } from "./asr.js";
import { GeminiCallError, type KeyPool } from "./keys.js";

const Words = z.array(
  z.object({ text: z.string().min(1), start: z.number().nonnegative(), end: z.number().positive() }),
);
export interface ListeningDeps {
  asrPool: KeyPool<GenerateContentClient>;
  cacheDir: string;
  asrModels?: readonly string[];
  asrSleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}
// Shared across every candidate in this run. Already in-flight calls still settle in the ledger.
const outages = new WeakMap<
  ListeningDeps["asrPool"],
  Map<string, { failures: number; detail: string; recent: boolean[] }>
>();
/** Six failures in eight calls also catches a partial outage with occasional successful replies.
 * Alternating healthy/recovered calls remain eligible. Lower models keep their own service history.
 */
function unavailable(state: { failures: number; recent: boolean[] } | undefined): boolean {
  return !!state && (state.failures >= 6 || state.recent.filter(Boolean).length >= 6);
}
export class AsrUnavailableError extends Error {
  constructor(details: string[] = []) {
    super(
      "ASR service unavailable after bounded backoff; stopped to preserve free quota. Cached takes retained." +
        (details.length ? ` ${details.join("; ")}` : ""),
    );
    this.name = "AsrUnavailableError";
  }
}
/** Never send the reference text to the recogniser: an independent check of the actual bytes. */
export async function listen(deps: ListeningDeps, audio: Buffer, mime: string, lang: string, timed = false) {
  const prompt = timed
    ? `Transcribe this ${lang} audio verbatim in its original language. Return JSON only: {"words":[{"text":"word","start":0.0,"end":0.3}]}. One spoken word per item, with its start and end in seconds from the audio beginning. Include every word, no translation or commentary. Write numbers and currency amounts as spoken words, never symbols or digits. Do not infer unspoken words.`
    : asrPrompt(lang);
  const models = deps.asrModels ?? ASR_MODELS;
  if (!models.length || models.some((model) => !ASR_MODELS.includes(model)))
    throw new Error("ASR requires an approved free audio model");
  const cacheFor = (model: string) =>
    join(deps.cacheDir, `asr-${sha256(JSON.stringify([model, prompt, mime, sha256(audio)]))}.json`);
  const Schema = z.object({ text: z.string(), words: Words });
  // Cached evidence keeps the actual recogniser even while a higher model is unavailable.
  for (const model of models) {
    try {
      return { ...Schema.parse(JSON.parse(await readFile(cacheFor(model), "utf8"))), model };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let outage = outages.get(deps.asrPool);
  if (!outage) {
    outage = new Map();
    outages.set(deps.asrPool, outage);
  }
  let response: { text?: string | undefined } | undefined;
  let verifiedModel = "";
  let lastError: unknown;
  const sleep = deps.asrSleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3 && !response; attempt++) {
    for (const model of models) {
      const state = outage.get(model) ?? { failures: 0, detail: "", recent: [] };
      outage.set(model, state);
      if (unavailable(state)) continue;
      try {
        response = await deps.asrPool.run(model, (client) =>
          client.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [{ inlineData: { mimeType: mime, data: audio.toString("base64") } }, { text: prompt }],
              },
            ],
            config: {
              httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } },
              ...(timed ? { responseMimeType: "application/json" } : {}),
            },
          }),
        );
        state.failures = 0;
        state.recent = [...state.recent, false].slice(-8);
        verifiedModel = model;
        break;
      } catch (error) {
        // models.list can still advertise a model that generation refuses for this account.
        if (
          error instanceof GeminiCallError &&
          error.status === 404 &&
          /no longer available|not found|not supported/i.test(error.message)
        ) {
          state.failures++;
          state.recent = [...state.recent, true].slice(-8);
          state.detail = `${model}: HTTP 404 ${error.message}`;
          lastError = error;
          deps.log?.(
            `[asr] ${state.detail}; account refused this model; retry through the next pool key after higher models`,
          );
          continue;
        }
        if (
          !(error instanceof GeminiCallError) ||
          error.kind !== "other" ||
          !(
            [408, 500, 502, 503, 504].includes(error.status ?? 0) ||
            /UNAVAILABLE|overloaded/i.test(error.message)
          )
        )
          throw error;
        state.failures++;
        state.recent = [...state.recent, true].slice(-8);
        state.detail = `${model}: HTTP ${error.status ?? "unknown"} ${error.message}`;
        lastError = error;
        deps.log?.(`[asr] ${state.detail}; trying next approved free audio model (SDK retries off)`);
      }
    }
    if (response) break;
    if (models.every((model) => unavailable(outage.get(model))))
      throw new AsrUnavailableError(models.map((model) => outage.get(model)?.detail ?? model));
    if (attempt === 2) throw lastError;
    await sleep(attempt === 0 ? 5_000 : 15_000);
  }
  if (!response) throw new Error("ASR returned no response");
  const text = (response.text ?? "").trim();
  let words: z.infer<typeof Words> = [];
  if (timed) {
    try {
      words = Words.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")).words);
    } catch {
      return { text: "", words: [], model: verifiedModel };
    } // A malformed answer never supplies a guessed boundary.
  }
  const result = { model: verifiedModel, text: timed ? words.map((w) => w.text).join(" ") : text, words };
  await mkdir(deps.cacheDir, { recursive: true });
  await writeFile(cacheFor(verifiedModel), `${JSON.stringify(result)}\n`);
  return result;
}
