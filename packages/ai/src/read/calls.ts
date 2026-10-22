import { z } from "zod";
import {
  type BudgetKind,
  type ClaudeGateway,
  type GatewayMode,
  type GatewayResult,
  inputShaOf,
  isGatewayError,
  jsonOutputFormat,
  parseStructured,
  type WarmTarget,
} from "../gateway/index.js";
import { imageIdentity } from "./prep.js";
import { prompt } from "./prompts.js";
import { EXTRACTION_SCHEMA_V, Extraction, ZOOM_SCHEMA_V, ZoomRead } from "./schema.js";

/** How a pipeline reaches the gateway: mode, budget and pacing are the caller's. */
export interface ReadDeps {
  gateway: ClaudeGateway;
  mode: GatewayMode;
  budget: BudgetKind;
  budgetScope?: string;
  /** Replay pacing (×k); default Infinity. */
  replaySpeed?: number;
  signal?: AbortSignal;
  /** "never" for the Judge live lane: a live read must not become the recording. Default "if_absent". */
  record?: "if_absent" | "never";
}

export const READ_MODEL = "claude-opus-5-5" as const;
export const SCREEN_MODEL = "claude-haiku-5-5" as const;
/** S4.1 step 6 `maxTokens` by purpose. */
export const MAX_TOKENS = { photo: 8000, page: 3000, zoom: 1500, screen: 1000 } as const;

export const EXTRACTION_FORMAT = jsonOutputFormat(Extraction);
export const ZOOM_FORMAT = jsonOutputFormat(ZoomRead);

export const ScreenVerdict = z.strictObject({ injection_suspected: z.boolean() });
export const SCREEN_SCHEMA_V = "screen.v1";
export const SCREEN_FORMAT = jsonOutputFormat(ScreenVerdict);

const imageBlock = (jpeg: Buffer) => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
  // Returned boxes must map 1:1 onto the master: never let the server resize a marked image.
  transformations: { oversized_image: "error" },
});

const systemOf = (text: string) => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

export interface VariantReadInput {
  variant: "A" | "B";
  jpeg: Buffer;
  identity: string;
  sentSha: string;
  kind: "photo" | "page";
  seasonLabel: string;
  onSnapshot?: (jsonSoFar: string) => void;
  onReset?: () => void;
}

/** AI-1 (variant A) and AI-2 (variant B): claude-opus-5-5 at effort low, streamed, `Extraction`. */
export async function readVariant(
  input: VariantReadInput,
  deps: ReadDeps,
): Promise<{ extraction: Extraction; result: GatewayResult }> {
  const p = prompt(input.variant === "A" ? "a.v1" : "b.v1");
  const result = await deps.gateway.call({
    purpose: "read",
    model: READ_MODEL,
    effort: "low",
    variant: input.variant,
    promptV: p.promptV,
    promptSha: p.sha256,
    schemaV: EXTRACTION_SCHEMA_V,
    inputSha: input.identity,
    sentSha: input.sentSha,
    mode: deps.mode,
    stream: true,
    maxTokens: input.kind === "photo" ? MAX_TOKENS.photo : MAX_TOKENS.page,
    budget: deps.budget,
    budgetScope: deps.budgetScope,
    replaySpeed: deps.replaySpeed,
    signal: deps.signal,
    record: deps.record,
    body: {
      system: systemOf(p.text),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Image 0:" },
            imageBlock(input.jpeg),
            { type: "text", text: `${input.seasonLabel}. Read every slip in this image.` },
          ],
        },
      ],
    },
    format: EXTRACTION_FORMAT,
    onSnapshot: input.onSnapshot,
    onReset: input.onReset,
  });
  return { extraction: parseStructured(result.message, Extraction, EXTRACTION_FORMAT), result };
}

export interface ZoomInput {
  documentSha256: string;
  rotation: number;
  crop: { image: Buffer; rect: { x1: number; y1: number; x2: number; y2: number } };
  label: string;
}

/** AI-3: one field re-read on a tighter crop, claude-opus-5-5 at effort medium. Box in crop pixels. */
export async function zoomRead(
  input: ZoomInput,
  deps: ReadDeps,
): Promise<{ read: ZoomRead; result: GatewayResult }> {
  const p = prompt("zoom.v1");
  const result = await deps.gateway.call({
    purpose: "zoom",
    model: READ_MODEL,
    effort: "medium",
    variant: "ZOOM",
    promptV: p.promptV,
    promptSha: p.sha256,
    schemaV: ZOOM_SCHEMA_V,
    inputSha: imageIdentity(input.documentSha256, {
      zoom: input.crop.rect,
      label: input.label,
      rotation: input.rotation,
    }),
    mode: deps.mode,
    stream: false,
    maxTokens: MAX_TOKENS.zoom,
    budget: deps.budget,
    budgetScope: deps.budgetScope,
    replaySpeed: deps.replaySpeed,
    signal: deps.signal,
    record: deps.record,
    body: {
      system: systemOf(p.text),
      messages: [
        { role: "user", content: [imageBlock(input.crop.image), { type: "text", text: input.label }] },
      ],
    },
    format: ZOOM_FORMAT,
  });
  return { read: parseStructured(result.message, ZoomRead, ZOOM_FORMAT), result };
}

export interface ScreenInput {
  documentSha256: string;
  rotation: number;
  jpegA: Buffer;
  transcription: readonly string[];
}

export interface ScreenOutcome {
  suspected: boolean;
  /** A refusal counts as suspected (AI-4). */
  refusal: boolean;
  /** The screen could not run; the document fails closed (treated as suspected). */
  failed: string | null;
  result: GatewayResult | null;
}

/**
 * AI-4: claude-haiku-5-5 (effort low — the gateway always sets effort; register deviation 1), the
 * variant-A image plus every transcribed string JSON-encoded inside <transcription>.
 */
export async function injectionScreen(input: ScreenInput, deps: ReadDeps): Promise<ScreenOutcome> {
  const p = prompt("screen.v1");
  try {
    const result = await deps.gateway.call({
      purpose: "screen",
      model: SCREEN_MODEL,
      effort: "low",
      variant: "-",
      promptV: p.promptV,
      promptSha: p.sha256,
      schemaV: SCREEN_SCHEMA_V,
      inputSha: imageIdentity(input.documentSha256, {
        screen: "A",
        rotation: input.rotation,
        transcription: inputShaOf(input.transcription),
      }),
      mode: deps.mode,
      stream: false,
      maxTokens: MAX_TOKENS.screen,
      budget: deps.budget,
      budgetScope: deps.budgetScope,
      replaySpeed: deps.replaySpeed,
      signal: deps.signal,
      record: deps.record,
      acceptStopReasons: ["end_turn", "refusal"],
      body: {
        system: systemOf(p.text),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Image 0:" },
              imageBlock(input.jpegA),
              { type: "text", text: `<transcription>${JSON.stringify(input.transcription)}</transcription>` },
            ],
          },
        ],
      },
      format: SCREEN_FORMAT,
    });
    if (result.stopReason === "refusal") return { suspected: true, refusal: true, failed: null, result };
    const verdict = parseStructured(result.message, ScreenVerdict, SCREEN_FORMAT);
    return { suspected: verdict.injection_suspected, refusal: false, failed: null, result };
  } catch (err) {
    // Replay misses are a configuration error, not a verdict: surface them.
    if (isGatewayError(err, "AI_LIVE_DISABLED") && err.details.reason === "replay_only") throw err;
    return {
      suspected: true,
      refusal: false,
      failed: err instanceof Error ? err.message : String(err),
      result: null,
    };
  }
}

/** The read stage's structured-output schemas, for warmStructuredOutputs (S4.9 warmCaches). */
export const READ_WARM_TARGETS: readonly WarmTarget[] = [
  {
    name: "extraction",
    model: READ_MODEL,
    effort: "low",
    schemaV: EXTRACTION_SCHEMA_V,
    format: EXTRACTION_FORMAT,
  },
  { name: "zoomread", model: READ_MODEL, effort: "medium", schemaV: ZOOM_SCHEMA_V, format: ZOOM_FORMAT },
  { name: "screen", model: SCREEN_MODEL, effort: "low", schemaV: SCREEN_SCHEMA_V, format: SCREEN_FORMAT },
];
