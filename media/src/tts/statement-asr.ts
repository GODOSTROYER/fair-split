import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../util/hash.js";
import { ASR_MODEL, asrPrompt, type GenerateContentClient } from "./asr.js";
import { GeminiCallError, type KeyPool } from "./keys.js";

const Words = z.array(
  z.object({ text: z.string().min(1), start: z.number().nonnegative(), end: z.number().positive() }),
);
export interface ListeningDeps {
  asrPool: KeyPool<GenerateContentClient>;
  cacheDir: string;
}
/** Never send the reference text to the recogniser: an independent check of the actual bytes. */
export async function listen(deps: ListeningDeps, audio: Buffer, mime: string, lang: string, timed = false) {
  const prompt = timed
    ? `Transcribe this ${lang} audio verbatim in its original language. Return JSON only: {"words":[{"text":"word","start":0.0,"end":0.3}]}. One spoken word per item, with its start and end in seconds from the audio beginning. Include every word, no translation or commentary. Do not infer unspoken words.`
    : asrPrompt(lang);
  const cache = join(
    deps.cacheDir,
    `asr-${sha256(JSON.stringify([ASR_MODEL, prompt, mime, sha256(audio)]))}.json`,
  );
  const Schema = z.object({ text: z.string(), words: Words });
  try {
    return Schema.parse(JSON.parse(await readFile(cache, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const recognise = () =>
    deps.asrPool.run(ASR_MODEL, (client) =>
      client.models.generateContent({
        model: ASR_MODEL,
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
  let response: { text?: string | undefined } | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await recognise();
      break;
    } catch (error) {
      if (
        !(error instanceof GeminiCallError) ||
        ![408, 500, 502, 503, 504].includes(error.status ?? 0) ||
        attempt === 2
      )
        throw error;
    }
  }
  if (!response) throw new Error("ASR returned no response");
  const text = (response.text ?? "").trim();
  let words: z.infer<typeof Words> = [];
  if (timed) {
    try {
      words = Words.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")).words);
    } catch {
      return { text: "", words: [] };
    } // A malformed answer never supplies a guessed boundary.
  }
  const result = { text: timed ? words.map((w) => w.text).join(" ") : text, words };
  await mkdir(deps.cacheDir, { recursive: true });
  await writeFile(cache, `${JSON.stringify(result)}\n`);
  return result;
}
