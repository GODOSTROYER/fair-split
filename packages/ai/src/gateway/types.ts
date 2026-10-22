// IC-07: the ClaudeGateway call shape (S4.1). WS-READ and WS-AGENT own this contract jointly.
// Every field of the S4.1 shape is kept verbatim; fields marked "extension" are additive and optional.

export const PURPOSES = [
  "read",
  "zoom",
  "screen",
  "ratecard",
  "classify",
  "agent",
  "draft_statement",
  "langid",
  "warm",
] as const;
export type Purpose = (typeof PURPOSES)[number];

/** The only three model IDs with a role (register §9). claude-fable-5-1 has no role. */
export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const EFFORTS = ["low", "medium"] as const;
export type Effort = (typeof EFFORTS)[number];

export const VARIANTS = ["A", "B", "ZOOM", "-"] as const;
export type Variant = (typeof VARIANTS)[number];

/**
 * Spend lanes (S4.1, S4.9). Each has its own cap: per UTC day, except `eval`, which is per run.
 * A capped lane plays its labelled recording.
 */
export const LANES = ["dev", "judge_invoice", "judge_read", "judge_ask", "eval", "offline"] as const;
export type Lane = (typeof LANES)[number];

export type GatewayMode = "auto" | "replay_only" | "live_only";
/** `seed_synthetic`: a placeholder recording written from the seed (S4.9), never a real model answer. */
export type Provenance = "live" | "replay" | "seed_synthetic";

/** `stop_reason` values the Messages API returns. */
export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded"
  | "compaction";

/** The request body a caller may set. Never model, sampling, thinking, tool_choice or fallbacks (S4.1). */
export interface GatewayBody {
  system: unknown;
  messages: unknown[];
  tools?: unknown[];
}

/** A structured-output format as it goes on the wire (`output_config.format`). */
export interface OutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

export interface GatewayCall {
  purpose: Purpose;
  model: ClaudeModel;
  effort: Effort;
  variant: Variant;
  promptV: string;
  schemaV: string;
  /**
   * Fills the register's `imageSha` slot. For image calls it is the derivation identity of the image
   * sent (see read/prep.ts `imageIdentity`, ADR 0003); for text calls it is sha256(JCS(input)).
   */
  inputSha: string;
  mode: GatewayMode;
  lane: Lane;
  stream: boolean;
  maxTokens: number;
  signal?: AbortSignal;
  format?: OutputFormat;
  body: GatewayBody;
  onSnapshot?: (jsonSoFar: string) => void;
  /** Extension: the eval run id. The `eval` lane is capped per run (S4.9), so it requires one. */
  laneScope?: string;
  /** Extension: stop reasons treated as success. Default `end_turn` (plus `tool_use` for purpose `agent`). */
  acceptStopReasons?: readonly StopReason[];
  /** Extension: replay pacing. Recorded offsets are divided by this factor. Default Infinity (no waits). */
  replaySpeed?: number;
  /**
   * Extension: the workspace whose `system_flags.kill_ai_live` applies (S3.11: a judge can only stop
   * their own demo). Passed to the FlagSource; a call without it sees deployment-wide flags only.
   */
  workspaceId?: string;
  /** Extension: whether a live result is stored as the replay recording (insert-if-absent). Default "if_absent". */
  record?: "if_absent" | "never";
  /** Extension: sha256 of the exact bytes sent, kept for audit when `inputSha` is a derivation identity. */
  sentSha?: string;
  /** Extension: sha256 of the frozen prompt text, stored with the recording to detect in-place prompt edits. */
  promptSha?: string;
}

export interface UsageSummary {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  thinking_tokens: number | null;
  /** Per-attempt usage when the API reports it; each entry is priced at its own model. */
  iterations: Array<{
    type: string;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  }> | null;
}

/** A content block as recorded. Structural on purpose: recordings are plain JSON. */
export interface RecordedBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

/** The message as recorded (a structural subset of the SDK's Message). */
export interface ClaudeMessage {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: RecordedBlock[];
  stop_reason: string | null;
  stop_details?: unknown;
  usage: Record<string, unknown>;
  [k: string]: unknown;
}

/** One `replay_timeline` entry: a text delta `d` at `ms` since the request started. */
export interface TimelineEntry {
  ms: number;
  d: string;
}

export interface GatewayResult {
  message: ClaudeMessage;
  provenance: Provenance;
  recordedAt: string;
  modelServed: string;
  /** Cost incurred by this call: 0 for a replay. */
  costMicros: number;
  cacheKey: string;
  /** Extensions. */
  stopReason: string | null;
  requestedModel: ClaudeModel;
  usage: UsageSummary;
  latencyMs: number;
  /** The cost the recording originally incurred (equal to costMicros for a live call). */
  recordedCostMicros: number;
  /** The recording was made with a different prompt text under the same promptV (a frozen prompt was edited). */
  promptDrift: boolean;
}

/** A replay recording: the `llm_calls` row shape (S4.1 step 8) minus the database bookkeeping. */
export interface Recording {
  v: 1;
  cache_key: string;
  purpose: Purpose;
  model: ClaudeModel;
  model_served: string;
  effort: Effort;
  variant: Variant;
  prompt_v: string;
  schema_v: string;
  input_sha: string;
  sent_sha: string | null;
  usage: UsageSummary;
  cost_micros: number;
  stop_reason: string | null;
  message: ClaudeMessage;
  replay_timeline: TimelineEntry[];
  recorded_at: string;
  latency_ms: number;
  first_delta_ms: number | null;
  /** sha256 of the prompt text the recording was made with (null when unknown). */
  prompt_sha?: string | null;
  /** Where the recording came from. Absent means `live` (every recording made before seeds existed). */
  provenance?: "live" | "seed_synthetic";
}

/** One ledger row per live call (S4.1 step 8), including failed ones. */
export interface LlmCallRow {
  cache_key: string;
  purpose: Purpose;
  lane: Lane;
  /** The eval run id for the `eval` lane; null otherwise. */
  lane_scope: string | null;
  model: ClaudeModel;
  model_served: string | null;
  effort: Effort;
  variant: Variant;
  prompt_v: string;
  schema_v: string;
  input_sha: string;
  /**
   * sha256 of the exact bytes sent when `input_sha` is a derivation identity (S4.1 says image bytes;
   * libvips output differs across machines, so the key uses the identity: ADR 0003).
   */
  sent_sha: string | null;
  usage: UsageSummary | null;
  cost_micros: number;
  stop_reason: string | null;
  accepted: boolean;
  error: string | null;
  at: string;
  latency_ms: number;
  request_id: string | null;
}
