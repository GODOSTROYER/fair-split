// The repo's only import of @anthropic-ai/sdk (S4.1; dependency-cruiser enforces it).
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import sharp from "sharp";
import {
  budgetKey,
  laneCapsFromEnv,
  reserveAll,
  type SpendMeter,
  totalDailyCapFromEnv,
  totalKey,
} from "./budget.js";
import { GatewayError, isGatewayError } from "./errors.js";
import type { FlagSource } from "./flags.js";
import { cacheKey, sha256Hex } from "./key.js";
import { costMicros, estimateMicros, microsFromUsd, visualTokens } from "./pricing.js";
import { assertBodyCompliant, buildRequest } from "./request.js";
import { scrubRecording } from "./scrub.js";
import { processSemaphore, type Semaphore } from "./semaphore.js";
import type { CallLedger, ReplayStore } from "./store.js";
import { realSleep, replayTimeline, type Sleep, TimelineRecorder } from "./timeline.js";
import {
  CLAUDE_MODELS,
  type ClaudeMessage,
  EFFORTS,
  type GatewayBody,
  type GatewayCall,
  type GatewayResult,
  LANES,
  type Lane,
  type LlmCallRow,
  PURPOSES,
  type Recording,
  type StopReason,
  type TimelineEntry,
  type UsageSummary,
  VARIANTS,
} from "./types.js";

export interface GatewayOptions {
  store: ReplayStore;
  /** Defaults to process.env.ANTHROPIC_API_KEY, read lazily at the first live call. */
  apiKey?: string;
  baseURL?: string;
  /** SDK retries (S4.1 step 6: 4). */
  maxRetries?: number;
  timeoutMs?: number;
  ledger?: CallLedger;
  /**
   * Required: the daily cap is a register §9 control, so there is no silent in-process default.
   * fs-api and fs-tasks pass WS-DATA's `llm_calls`-backed meter (reserve and settle inside a
   * transaction, shared by every process, surviving restarts); tests and one-off runs pass
   * MemorySpendMeter or FileSpendMeter explicitly. Process-local meters are refused in production.
   */
  spend: SpendMeter;
  /**
   * Required: `kill_ai_live` is a register §9 control. fs-api and fs-tasks pass WS-DATA's
   * `system_flags` source (per workspace, read fresh), usually `anyFlagSource(db, envFlagSource())`;
   * tests pass `staticFlags`. Process-local sources are refused in production.
   */
  flags: FlagSource;
  /** Lane caps in US$ (S4.9), over the defaults and `AI_LANE_CAPS_USD`. */
  caps?: Partial<Record<Lane, number>>;
  /**
   * The overall daily cap across every lane in US$ (register §9 "a daily spend cap"); null for lane
   * caps only. Default: `AI_DAILY_SPEND_CAP_USD`, else null.
   */
  totalDailyCapUsd?: number | null;
  semaphore?: Semaphore;
  clock?: () => Date;
  sleep?: Sleep;
  /** Upload base64 images once through the Files API and send `file_id` references (S4.2 step 5). */
  filesApi?: boolean;
  /** Scrub recordings before storing them (default true). */
  scrub?: boolean;
  /** The deployment environment; defaults to process.env.NODE_ENV. "production" refuses process-local controls. */
  nodeEnv?: string;
}

interface LiveOutcome {
  message: ClaudeMessage;
  timeline: TimelineEntry[];
  latencyMs: number;
  firstDeltaMs: number | null;
  requestId: string | null;
}

type StreamParams = Parameters<Anthropic["messages"]["stream"]>[0];
type CreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_VISUAL_TOKENS = 4784;

function validateCall(call: GatewayCall): void {
  const bad = (msg: string) => new GatewayError("AI_BAD_CALL", msg);
  if (!PURPOSES.includes(call.purpose)) throw bad(`unknown purpose "${call.purpose}"`);
  if (!CLAUDE_MODELS.includes(call.model)) throw bad(`model "${call.model}" has no role (register §9)`);
  if (!EFFORTS.includes(call.effort)) throw bad(`effort must be low | medium, got "${call.effort}"`);
  if (!VARIANTS.includes(call.variant)) throw bad(`unknown variant "${call.variant}"`);
  if (!LANES.includes(call.lane)) throw bad(`unknown lane "${call.lane}"`);
  if (!call.promptV || !call.schemaV) throw bad("promptV and schemaV are required");
  if (!HEX64.test(call.inputSha)) throw bad("inputSha must be a lowercase sha256 hex digest");
  if (!Number.isInteger(call.maxTokens) || call.maxTokens < 1 || call.maxTokens > 128_000) {
    throw bad("maxTokens must be an integer in [1, 128000]");
  }
  if (call.mode !== "auto" && call.mode !== "replay_only" && call.mode !== "live_only") {
    throw bad(`unknown mode "${call.mode}"`);
  }
  assertBodyCompliant(call.body);
}

/** Copies the SDK message into plain JSON, dropping the SDK's local `parsed_output` decorations. */
function toPlainMessage(message: unknown): ClaudeMessage {
  const plain = JSON.parse(JSON.stringify(message)) as ClaudeMessage;
  plain.content = plain.content.map((b) => {
    const { parsed_output: _drop, ...rest } = b as Record<string, unknown>;
    return rest as ClaudeMessage["content"][number];
  });
  delete (plain as Record<string, unknown>).parsed_output;
  return plain;
}

export function usageSummary(message: ClaudeMessage): UsageSummary {
  const u = message.usage as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const details = u.output_tokens_details as { thinking_tokens?: unknown } | null | undefined;
  const iterations = Array.isArray(u.iterations)
    ? (u.iterations as Array<Record<string, unknown>>).map((it) => ({
        type: String(it.type),
        model: typeof it.model === "string" ? it.model : null,
        input_tokens: n(it.input_tokens),
        output_tokens: n(it.output_tokens),
        cache_read_input_tokens: n(it.cache_read_input_tokens),
        cache_creation_input_tokens: n(it.cache_creation_input_tokens),
      }))
    : null;
  return {
    input_tokens: n(u.input_tokens),
    output_tokens: n(u.output_tokens),
    cache_read_input_tokens: n(u.cache_read_input_tokens),
    cache_creation_input_tokens: n(u.cache_creation_input_tokens),
    thinking_tokens: typeof details?.thinking_tokens === "number" ? details.thinking_tokens : null,
    iterations,
  };
}

/** Characters and visual tokens of a request body, for the budget estimate (S4.1 step 4). */
export async function measureInput(body: GatewayBody): Promise<{ visualTokens: number; characters: number }> {
  let characters = 0;
  let tokens = 0;
  const visit = async (block: unknown): Promise<void> => {
    if (typeof block === "string") {
      characters += block.length;
      return;
    }
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") characters += b.text.length;
    else if (b.type === "image") {
      const src = b.source as { type?: string; data?: string } | undefined;
      if (src?.type === "base64" && typeof src.data === "string") {
        const meta = await sharp(Buffer.from(src.data, "base64")).metadata();
        tokens += Math.min(visualTokens(meta.width ?? 0, meta.height ?? 0), MAX_VISUAL_TOKENS);
      } else tokens += MAX_VISUAL_TOKENS;
    } else if (Array.isArray(b.content)) for (const inner of b.content) await visit(inner);
    else if (typeof b.content === "string") characters += b.content.length;
  };
  const system = body.system;
  if (typeof system === "string") characters += system.length;
  else if (Array.isArray(system)) for (const block of system) await visit(block);
  for (const message of body.messages) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") characters += content.length;
    else if (Array.isArray(content)) for (const block of content) await visit(block);
  }
  if (body.tools) characters += JSON.stringify(body.tools).length;
  return { visualTokens: tokens, characters };
}

export class ClaudeGateway {
  private client: Anthropic | undefined;
  private readonly uploads = new Map<string, Promise<string>>();
  private readonly store: ReplayStore;
  private readonly spend: SpendMeter;
  private readonly flags: FlagSource;
  private readonly caps: Record<Lane, number>;
  private readonly totalCapMicros: number | null;
  private readonly semaphore: Semaphore;
  private readonly clock: () => Date;
  private readonly sleep: Sleep;

  constructor(private readonly opts: GatewayOptions) {
    // The register §9 controls never fall back to in-process defaults: a per-process cap resets on
    // every restart and per-workspace kill flags would be ignored.
    if (!opts.spend || !opts.flags) {
      throw new GatewayError(
        "AI_CONFIG",
        "ClaudeGateway needs an explicit spend meter and flag source (daily cap and kill_ai_live)",
      );
    }
    if ((opts.nodeEnv ?? process.env.NODE_ENV) === "production") {
      const local = [
        ...(opts.spend.processLocal ? ["spend meter (use the llm_calls-backed meter)"] : []),
        ...(opts.flags.processLocal ? ["flag source (use the system_flags source)"] : []),
      ];
      if (local.length > 0) {
        throw new GatewayError(
          "AI_CONFIG",
          `production needs controls shared across processes; process-local: ${local.join(", ")}`,
        );
      }
    }
    this.store = opts.store;
    this.spend = opts.spend;
    this.flags = opts.flags;
    this.caps = { ...laneCapsFromEnv(), ...opts.caps };
    const total = opts.totalDailyCapUsd === undefined ? totalDailyCapFromEnv() : opts.totalDailyCapUsd;
    this.totalCapMicros = total === null ? null : microsFromUsd(total);
    this.semaphore = opts.semaphore ?? processSemaphore;
    this.clock = opts.clock ?? (() => new Date());
    this.sleep = opts.sleep ?? realSleep;
  }

  /** The replay cache key of a call (register §9). */
  static keyOf(
    call: Pick<GatewayCall, "inputSha" | "variant" | "promptV" | "schemaV" | "model" | "effort">,
  ): string {
    return cacheKey({
      imageSha: call.inputSha,
      variant: call.variant,
      promptV: call.promptV,
      schemaV: call.schemaV,
      model: call.model,
      effort: call.effort,
    });
  }

  async call(call: GatewayCall): Promise<GatewayResult> {
    validateCall(call);
    const key = ClaudeGateway.keyOf(call);
    const accept: readonly StopReason[] =
      call.acceptStopReasons ?? (call.purpose === "agent" ? ["end_turn", "tool_use"] : ["end_turn"]);

    // 2. Replay.
    if (call.mode !== "live_only") {
      const rec = await this.store.get(key);
      if (rec) return this.replay(call, rec, accept);
    }
    // 3. Kill switch.
    if (call.mode === "replay_only") {
      throw new GatewayError("AI_LIVE_DISABLED", `no recording for ${key} and the call is replay_only`, {
        cacheKey: key,
        reason: "replay_only",
      });
    }
    if (await this.flags.isOn("kill_ai_live", { workspaceId: call.workspaceId ?? null })) {
      throw new GatewayError("AI_LIVE_DISABLED", "kill_ai_live is on", {
        cacheKey: key,
        reason: "kill_switch",
      });
    }
    // 4. Budget: the lane's cap (today's, or the eval run's), then the overall daily cap if one is set.
    const at = this.clock();
    const estimate = estimateMicros(call.model, await measureInput(call.body), call.maxTokens);
    const reservation = await reserveAll(this.spend, estimate, [
      { key: budgetKey(call.lane, call.laneScope, at), capMicros: microsFromUsd(this.caps[call.lane]) },
      ...(this.totalCapMicros === null ? [] : [{ key: totalKey(at), capMicros: this.totalCapMicros }]),
    ]);

    // 5-6. Request, at most N in flight.
    let release: (() => void) | undefined;
    let outcome: LiveOutcome;
    const progress = { billed: false };
    try {
      release = await this.semaphore.acquire(call.signal);
      outcome = await this.send(call, progress);
    } catch (err) {
      // A stream that broke after the API started generating may have been billed: keep the
      // estimate on the meter rather than under-count.
      if (progress.billed) await reservation.settle(estimate);
      else await reservation.release();
      const mapped = this.mapError(err, key);
      await this.opts.ledger?.append(this.ledgerRow(call, key, at, null, mapped));
      throw mapped;
    } finally {
      release?.();
    }

    // 7. Result.
    const usage = usageSummary(outcome.message);
    const cost = costMicros(usage, outcome.message.model);
    await reservation.settle(cost);
    const raw: Recording = {
      v: 1,
      cache_key: key,
      purpose: call.purpose,
      model: call.model,
      model_served: outcome.message.model,
      effort: call.effort,
      variant: call.variant,
      prompt_v: call.promptV,
      schema_v: call.schemaV,
      input_sha: call.inputSha,
      sent_sha: call.sentSha ?? null,
      prompt_sha: call.promptSha ?? null,
      usage,
      cost_micros: cost,
      stop_reason: outcome.message.stop_reason,
      message: outcome.message,
      replay_timeline: outcome.timeline,
      recorded_at: at.toISOString(),
      latency_ms: outcome.latencyMs,
      first_delta_ms: outcome.firstDeltaMs,
      provenance: "live",
    };
    // Only the stored copy is scrubbed: the live caller gets the message exactly as the API sent it
    // (thinking signatures must round-trip unmodified in multi-turn use).
    const recording = this.opts.scrub === false ? raw : scrubRecording(raw);
    // 8. Ledger, then the replay store (insert-if-absent). A failed answer is recorded too, so a
    // replay reproduces the failure instead of hiding it.
    const result = this.resultOf(call, raw, "live", cost);
    const failure = this.failureOf(result, accept, key);
    await this.opts.ledger?.append({
      ...this.ledgerRow(call, key, at, recording, failure),
      accepted: failure === null,
      request_id: outcome.requestId,
    });
    if ((call.record ?? "if_absent") === "if_absent") await this.store.put(recording);
    if (failure) throw failure;
    return result;
  }

  /** Deletes every file this instance uploaded through the Files API. */
  async deleteUploadedFiles(): Promise<number> {
    const client = this.getClient();
    let n = 0;
    for (const pending of this.uploads.values()) {
      const id = await pending.catch(() => null);
      if (!id) continue;
      await client.files.delete(id);
      n++;
    }
    this.uploads.clear();
    return n;
  }

  private async replay(
    call: GatewayCall,
    rec: Recording,
    accept: readonly StopReason[],
  ): Promise<GatewayResult> {
    await replayTimeline(rec.replay_timeline, call.onSnapshot, {
      speed: call.replaySpeed,
      sleep: this.sleep,
      signal: call.signal,
    });
    // inv.i8: a replay says so; a placeholder written from the seed says that instead.
    const result = this.resultOf(
      call,
      rec,
      rec.provenance === "seed_synthetic" ? "seed_synthetic" : "replay",
      0,
    );
    const failure = this.failureOf(result, accept, rec.cache_key);
    if (failure) throw failure;
    return result;
  }

  private resultOf(
    call: GatewayCall,
    rec: Recording,
    provenance: GatewayResult["provenance"],
    cost: number,
  ): GatewayResult {
    return {
      message: rec.message,
      provenance,
      recordedAt: rec.recorded_at,
      modelServed: rec.model_served,
      costMicros: cost,
      cacheKey: rec.cache_key,
      stopReason: rec.stop_reason,
      requestedModel: call.model,
      usage: rec.usage,
      latencyMs: rec.latency_ms,
      recordedCostMicros: rec.cost_micros,
      promptDrift: !!call.promptSha && !!rec.prompt_sha && call.promptSha !== rec.prompt_sha,
    };
  }

  /**
   * S4.1 step 7: the model that answered must be the model asked (`model_served` is printed in
   * footers), and any stop_reason other than the accepted ones is a typed failure: a person handles
   * the item, or a Judge lane plays its recording. A partial streamed before the failure is
   * discarded: nothing is parsed from it.
   */
  private failureOf(result: GatewayResult, accept: readonly StopReason[], key: string): GatewayError | null {
    if (result.modelServed !== result.requestedModel) {
      return new GatewayError(
        "AI_MODEL_MISMATCH",
        `requested ${result.requestedModel} but ${result.modelServed} answered`,
        { cacheKey: key, modelServed: result.modelServed, stopReason: result.stopReason, result },
      );
    }
    if (!accept.includes(result.stopReason as StopReason)) {
      return new GatewayError("AI_STOP_REASON", `stop_reason "${result.stopReason}" is not accepted`, {
        cacheKey: key,
        stopReason: result.stopReason,
        result,
      });
    }
    return null;
  }

  private ledgerRow(
    call: GatewayCall,
    key: string,
    at: Date,
    rec: Recording | null,
    error: GatewayError | Error | null,
  ): LlmCallRow {
    return {
      cache_key: key,
      purpose: call.purpose,
      lane: call.lane,
      lane_scope: call.laneScope ?? null,
      model: call.model,
      model_served: rec?.model_served ?? null,
      effort: call.effort,
      variant: call.variant,
      prompt_v: call.promptV,
      schema_v: call.schemaV,
      input_sha: call.inputSha,
      sent_sha: call.sentSha ?? null,
      usage: rec?.usage ?? null,
      cost_micros: rec?.cost_micros ?? 0,
      stop_reason: rec?.stop_reason ?? null,
      accepted: false,
      error: error ? error.message : null,
      at: at.toISOString(),
      latency_ms: rec?.latency_ms ?? 0,
      request_id: null,
    };
  }

  private mapError(err: unknown, key: string): Error {
    if (isGatewayError(err)) return err;
    if (err instanceof Anthropic.APIUserAbortError) return err;
    if (err instanceof Anthropic.APIError) {
      return new GatewayError(
        "AI_UPSTREAM",
        `Anthropic API error ${err.status ?? "(no status)"}: ${err.message}`,
        { cacheKey: key, status: err.status },
        err,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey)
        throw new GatewayError("AI_LIVE_DISABLED", "ANTHROPIC_API_KEY is not set", { reason: "no_key" });
      this.client = new Anthropic({
        apiKey,
        maxRetries: this.opts.maxRetries ?? 4,
        ...(this.opts.baseURL ? { baseURL: this.opts.baseURL } : {}),
        ...(this.opts.timeoutMs ? { timeout: this.opts.timeoutMs } : {}),
      });
    }
    return this.client;
  }

  /** Replaces base64 image sources with Files API references, uploading each distinct image once. */
  private async withFileRefs(body: GatewayBody): Promise<GatewayBody> {
    const client = this.getClient();
    const rewrite = async (block: unknown): Promise<unknown> => {
      if (!block || typeof block !== "object") return block;
      const b = block as Record<string, unknown>;
      const src = b.source as { type?: string; data?: string; media_type?: string } | undefined;
      if (b.type !== "image" || src?.type !== "base64" || typeof src.data !== "string") return block;
      const bytes = Buffer.from(src.data, "base64");
      const sha = sha256Hex(bytes);
      let pending = this.uploads.get(sha);
      if (!pending) {
        const type = src.media_type ?? "image/jpeg";
        pending = toFile(bytes, `fs-${sha.slice(0, 16)}.${type.split("/")[1] ?? "bin"}`, { type })
          .then((file) => client.files.upload({ file }))
          .then((meta) => meta.id);
        this.uploads.set(sha, pending);
        pending.catch(() => this.uploads.delete(sha));
      }
      return { ...b, source: { type: "file", file_id: await pending } };
    };
    const messages = await Promise.all(
      body.messages.map(async (m) => {
        const msg = m as { content?: unknown };
        if (!Array.isArray(msg.content)) return m;
        return { ...msg, content: await Promise.all(msg.content.map(rewrite)) };
      }),
    );
    return { ...body, messages };
  }

  private async send(call: GatewayCall, progress: { billed: boolean }): Promise<LiveOutcome> {
    const client = this.getClient();
    const body = this.opts.filesApi ? await this.withFileRefs(call.body) : call.body;
    // No beta is needed: output_config (effort, format), image transformations and Files API
    // references are all in the stable Messages API, and fallbacks are never requested.
    const params = buildRequest({ ...call, body }, call.format);
    const t0 = performance.now();
    const timeline = new TimelineRecorder(t0);

    if (call.stream) {
      const stream = client.messages.stream(params as unknown as StreamParams, { signal: call.signal });
      for await (const event of stream) {
        if (event.type === "message_start") progress.billed = true;
        else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          // Recorded whether or not anyone watches live: a replay may drive a view later. (Inside
          // `onSnapshot?.(…)` the argument would not even be evaluated without a consumer.)
          const snapshot = timeline.delta(event.delta.text);
          call.onSnapshot?.(snapshot);
        }
      }
      const final = await stream.finalMessage();
      return {
        message: toPlainMessage(final),
        timeline: timeline.entries,
        latencyMs: Math.round(performance.now() - t0),
        firstDeltaMs: timeline.firstDeltaMs,
        requestId: stream.request_id ?? null,
      };
    }

    const { data, request_id } = await client.messages
      .create({ ...(params as unknown as CreateParams), stream: false }, { signal: call.signal })
      .withResponse();
    const message = toPlainMessage(data);
    const latencyMs = Math.round(performance.now() - t0);
    // A non-streamed answer is recorded as one delta at its arrival time, so replays still drive
    // snapshot consumers the same way.
    const text = message.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text) call.onSnapshot?.(text);
    return {
      message,
      timeline: text ? [{ ms: latencyMs, d: text }] : [],
      latencyMs,
      firstDeltaMs: text ? latencyMs : null,
      requestId: request_id ?? null,
    };
  }
}
