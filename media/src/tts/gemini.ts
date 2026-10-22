import { pcmToWav } from "./wav.js";

/** AI-10 models: finals on Flash TTS, drafts on Flash-Lite TTS. */
export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_DRAFT_MODEL = "gemini-3.8-flash-lite-tts";
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
