import { z } from "zod";
import {
  type ClaudeGateway,
  type GatewayCall,
  GatewayError,
  type GatewayMode,
  type GatewayResult,
  inputShaOf,
  isGatewayError,
  jsonOutputFormat,
  type Lane,
  type OutputFormat,
  parseStructured,
  type WarmTarget,
} from "../gateway/index.js";
import { imageIdentity, type ModelCrop } from "./prep.js";
import { prompt } from "./prompts.js";
import { EXTRACTION_SCHEMA_V, Extraction, ZOOM_SCHEMA_V, ZoomRead } from "./schema.js";

/** How a pipeline reaches the gateway: mode, spend lane and pacing are the caller's. */
export interface ReadDeps {
  gateway: ClaudeGateway;
  mode: GatewayMode;
  /** S4.9: `judge_read` for "Read a slip live", `eval` for the eval, `dev` on the dev machine. */
  lane: Lane;
  /** The eval run id (the `eval` lane is capped per run). */
  laneScope?: string;
  /** Replay pacing (×k); default Infinity. */
  replaySpeed?: number;
  signal?: AbortSignal;
  /** "never" for the Judge live lane: a live read must not become the recording. Default "if_absent". */
  record?: "if_absent" | "never";
  /** The workspace whose `kill_ai_live` applies (S3.11). */
  workspaceId?: string;
}

/** The gateway fields every stage takes from its deps. */
export function callOptions(
  deps: ReadDeps,
): Pick<GatewayCall, "mode" | "lane" | "laneScope" | "replaySpeed" | "signal" | "record" | "workspaceId"> {
  return {
    mode: deps.mode,
    lane: deps.lane,
    laneScope: deps.laneScope,
    replaySpeed: deps.replaySpeed,
    signal: deps.signal,
    record: deps.record,
    workspaceId: deps.workspaceId,
  };
}

/**
 * Parses a structured answer; a schema failure keeps the call's result on the error, so a caller
 * that recovers from it still accounts for the call's cost.
 */
export function parseWithResult<T>(result: GatewayResult, schema: z.ZodType<T>, format: OutputFormat): T {
  try {
    return parseStructured(result.message, schema, format);
  } catch (err) {
    if (isGatewayError(err) && !err.details.result) {
      throw new GatewayError(
        err.code,
        err.message.replace(/^[A-Z_]+: /, ""),
        { ...err.details, result },
        err.cause,
      );
    }
    throw err;
  }
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

/**
 * An image block. Reads and zooms mark it `oversized_image: "error"`: returned boxes must map 1:1
 * onto the image sent, so the server may never resize it (S4.2 step 5). The screen returns no
 * coordinates, so it leaves the server free to fit the image.
 */
const imageBlock = (jpeg: Buffer, opts: { boxes: boolean }) => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
  ...(opts.boxes ? { transformations: { oversized_image: "error" } } : {}),
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
}

/** AI-1 (variant A) and AI-2 (variant B): claude-opus-5-5 at effort low, streamed, `Extraction`. */
export async function readVariant(
  input: VariantReadInput,
  deps: ReadDeps,
): Promise<{ extraction: Extraction; result: GatewayResult }> {
  const p = prompt(input.variant === "A" ? "a.v1" : "b.v1");
  const result = await deps.gateway.call({
    ...callOptions(deps),
    purpose: "read",
    model: READ_MODEL,
    effort: "low",
    variant: input.variant,
    promptV: p.promptV,
    promptSha: p.sha256,
    schemaV: EXTRACTION_SCHEMA_V,
    inputSha: input.identity,
    sentSha: input.sentSha,
    stream: true,
    maxTokens: input.kind === "photo" ? MAX_TOKENS.photo : MAX_TOKENS.page,
    body: {
      system: systemOf(p.text),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Image 0:" },
            imageBlock(input.jpeg, { boxes: true }),
            { type: "text", text: `${input.seasonLabel}. Read every slip in this image.` },
          ],
        },
      ],
    },
    format: EXTRACTION_FORMAT,
    onSnapshot: input.onSnapshot,
  });
  return { extraction: parseStructured(result.message, Extraction, EXTRACTION_FORMAT), result };
}

export interface ZoomInput {
  documentSha256: string;
  rotation: number;
  /** A crop from `sanitizeForModel` (S4.2): the only kind of crop a model may see. */
  crop: Pick<ModelCrop, "image" | "rect" | "recipe">;
  label: string;
}

/**
 * AI-3: one field re-read on a tighter crop, claude-opus-5-5 at effort medium. Box in crop pixels.
 * The crop comes from a reviewed rectangle (C-10) through `sanitizeForModel`; its replay identity
 * names everything that decided its bytes (window, sanitiser version, slip, quarantined boxes).
 */
export async function zoomRead(
  input: ZoomInput,
  deps: ReadDeps,
): Promise<{ read: ZoomRead; result: GatewayResult }> {
  const p = prompt("zoom.v2");
  const result = await deps.gateway.call({
    ...callOptions(deps),
    purpose: "zoom",
    model: READ_MODEL,
    effort: "medium",
    variant: "ZOOM",
    promptV: p.promptV,
    promptSha: p.sha256,
    schemaV: ZOOM_SCHEMA_V,
    inputSha: imageIdentity(input.documentSha256, {
      zoom: input.crop.rect,
      sanitized: input.crop.recipe,
      label: input.label,
      rotation: input.rotation,
    }),
    stream: false,
    maxTokens: MAX_TOKENS.zoom,
    body: {
      system: systemOf(p.text),
      messages: [
        {
          role: "user",
          content: [imageBlock(input.crop.image, { boxes: true }), { type: "text", text: input.label }],
        },
      ],
    },
    format: ZOOM_FORMAT,
  });
  return { read: parseWithResult(result, ZoomRead, ZOOM_FORMAT), result };
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

async function screenCall(content: unknown[], inputSha: string, deps: ReadDeps): Promise<ScreenOutcome> {
  const p = prompt("screen.v1");
  try {
    const result = await deps.gateway.call({
      ...callOptions(deps),
      purpose: "screen",
      model: SCREEN_MODEL,
      effort: "low",
      variant: "-",
      promptV: p.promptV,
      promptSha: p.sha256,
      schemaV: SCREEN_SCHEMA_V,
      inputSha,
      stream: false,
      maxTokens: MAX_TOKENS.screen,
      acceptStopReasons: ["end_turn", "refusal"],
      body: { system: systemOf(p.text), messages: [{ role: "user", content }] },
      format: SCREEN_FORMAT,
    });
    if (result.stopReason === "refusal") return { suspected: true, refusal: true, failed: null, result };
    // An answer that does not parse fails closed below, its cost still counted.
    const verdict = parseWithResult(result, ScreenVerdict, SCREEN_FORMAT);
    return { suspected: verdict.injection_suspected, refusal: false, failed: null, result };
  } catch (err) {
    // Replay misses are a configuration error, not a verdict: surface them.
    if (isGatewayError(err, "AI_LIVE_DISABLED") && err.details.reason === "replay_only") throw err;
    if (deps.signal?.aborted) throw err;
    return {
      suspected: true,
      refusal: false,
      failed: err instanceof Error ? err.message : String(err),
      result: isGatewayError(err) ? (err.details.result ?? null) : null,
    };
  }
}

/**
 * AI-4: claude-haiku-5-5 (effort low — the gateway always sets effort; register deviation 1), the
 * variant-A image plus every transcribed string JSON-encoded inside <transcription>.
 */
export async function injectionScreen(input: ScreenInput, deps: ReadDeps): Promise<ScreenOutcome> {
  return screenCall(
    [
      { type: "text", text: "Image 0:" },
      imageBlock(input.jpegA, { boxes: false }),
      { type: "text", text: `<transcription>${JSON.stringify(input.transcription)}</transcription>` },
    ],
    imageIdentity(input.documentSha256, {
      screen: "A",
      rotation: input.rotation,
      transcription: inputShaOf(input.transcription),
    }),
    deps,
  );
}

export interface RescreenInput {
  documentSha256: string;
  rotation: number;
  /** The transcribed strings the located instruction-like text does not explain. */
  strings: readonly string[];
}

/**
 * AI-4 again, text only, when the screen fired and the reads located some instruction-like text: are
 * the remaining strings clean? If they are not, a second injection hides in ordinary-looking text
 * (say, a box-13 line) and the document is handled as unlocated (S4.7 layer 4).
 */
export async function rescreenStrings(input: RescreenInput, deps: ReadDeps): Promise<ScreenOutcome> {
  return screenCall(
    [
      {
        type: "text",
        text: "Transcription only (no image): every remaining string two readers copied from the document.",
      },
      { type: "text", text: `<transcription>${JSON.stringify(input.strings)}</transcription>` },
    ],
    imageIdentity(input.documentSha256, {
      screen: "remaining",
      rotation: input.rotation,
      transcription: inputShaOf(input.strings),
    }),
    deps,
  );
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
