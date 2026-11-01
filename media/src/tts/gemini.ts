import { pcmToWav } from "./wav.js";

/**
 * "Always use the highest-end model" (user, 1 Nov), on the free tier only: the highest-end model whose
 * Free Tier column reads "Free of charge" on https://ai.google.dev/gemini-api/docs/pricing, read
 * 1 Nov 2026 (page last updated 30 Oct 2026). TTS: gemini-3.8-flash-tts is free and above Flash-Lite TTS
 * (higher paid output price, same input), 3.1 Flash TTS Preview and 2.5 Flash Preview TTS;
 * gemini-2.5-pro-preview-tts is "Not available" on the free tier. Speech check (asr.ts): gemini-3.8-flash
 * ("our most intelligent Flash model"; inputs text, image, video, audio and PDF on its model page) is free;
 * gemini-4-argon and gemini-3.1-pro-preview are "Not available"; gemini-2.5-pro is free but two
 * generations older.
 */
export const MODEL_CHOICE = {
  source: "https://ai.google.dev/gemini-api/docs/pricing",
  read: "2026-11-01",
  pageLastUpdated: "2026-10-30",
  tts: "gemini-3.8-flash-tts",
  asr: "gemini-3.8-flash",
  notFree: ["gemini-2.5-pro-preview-tts", "gemini-4-argon", "gemini-3.1-pro-preview"],
} as const;

/** AI-10 models: finals and drafts on the same top free TTS model, so drafts share its per-key daily caps. */
export const TTS_MODEL = MODEL_CHOICE.tts;
export const TTS_DRAFT_MODEL: string = TTS_MODEL;
/** Shortlist from S4.6; Sulafat ("warm") is the spike default until a person runs the listening test. */
export const VOICE_SHORTLIST = ["Sulafat", "Achird", "Vindemiatrix", "Gacrux"] as const;
export const DEFAULT_VOICE = "Sulafat";

export interface TtsRequest {
  model: string;
  voice: string;
  style: string;
  text: string;
}

export interface TtsResult {
  wav: Buffer;
  mimeType: string;
  latencyMs: number;
  interactionId: string | null;
}

interface AudioBlock {
  type?: string;
  data?: string;
  mime_type?: string;
  sample_rate?: number;
}

/** The slice of `@google/genai`'s client this module uses, so tests can inject a fake or an msw-backed client. */
export interface InteractionsClient {
  interactions: {
    create(
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<{ id?: string; output_audio?: AudioBlock; steps?: unknown[] } & Record<string, unknown>>;
  };
}

export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly rateLimited: boolean,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

/** The request body sent to the Interactions API (single speaker, style as speech metadata). */
export function buildTtsParams(req: TtsRequest): Record<string, unknown> {
  return {
    model: req.model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: req.text,
            annotations: [{ type: "speech_metadata", style: req.style }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: req.voice }] },
  };
}

function findAudio(res: { output_audio?: AudioBlock; steps?: unknown[] }): AudioBlock | undefined {
  if (res.output_audio?.data) return res.output_audio;
  for (const step of [...(res.steps ?? [])].reverse()) {
    const content = (step as { content?: AudioBlock[] }).content ?? [];
    for (const c of [...content].reverse()) if (c.type === "audio" && c.data) return c;
  }
  return undefined;
}

/**
 * One TTS request. The SDK's own retries are switched off (`maxRetries: 0`) so every request is
 * counted against the daily ledger exactly once and a 429 surfaces instead of being retried.
 */
export async function synthesize(
  client: InteractionsClient,
  req: TtsRequest,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<TtsResult> {
  const now = opts.now ?? Date.now;
  const t0 = now();
  let res: Awaited<ReturnType<InteractionsClient["interactions"]["create"]>>;
  try {
    res = await client.interactions.create(buildTtsParams(req), {
      maxRetries: 0,
      timeout: opts.timeoutMs ?? 120_000,
    });
  } catch (e) {
    const err = e as { status?: number; statusCode?: number; code?: number; message?: string };
    const status = err.status ?? err.statusCode ?? (typeof err.code === "number" ? err.code : null);
    const msg = String(err.message ?? e);
    const rateLimited = status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg);
    throw new TtsError(
      `TTS request failed (${status ?? "no status"}): ${msg.slice(0, 400)}`,
      status ?? null,
      rateLimited,
    );
  }
  const latencyMs = now() - t0;
  const audio = findAudio(res);
  if (!audio?.data) throw new TtsError("TTS response carried no audio", null, false);
  const bytes = Buffer.from(audio.data, "base64");
  const mime = audio.mime_type ?? "audio/wav";
  const isRiff = bytes.subarray(0, 4).toString("ascii") === "RIFF";
  const wav = isRiff ? bytes : pcmToWav(bytes, audio.sample_rate ?? 24_000);
  return { wav, mimeType: mime, latencyMs, interactionId: typeof res.id === "string" ? res.id : null };
}
