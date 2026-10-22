// The repo's only import of @anthropic-ai/sdk (S4.1; dependency-cruiser enforces it).
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import sharp from "sharp";
import { budgetKey, capsFromEnv, MemorySpendMeter, type SpendMeter } from "./budget.js";
import { GatewayError, isGatewayError } from "./errors.js";
import { envFlagSource, type FlagSource } from "./flags.js";
import { cacheKey, sha256Hex } from "./key.js";
import { costMicros, estimateMicros, microsFromUsd, visualTokens } from "./pricing.js";
import { assertBodyCompliant, buildRequest } from "./request.js";
import { scrubRecording } from "./scrub.js";
import { processSemaphore, type Semaphore } from "./semaphore.js";
import type { CallLedger, ReplayStore } from "./store.js";
import { realSleep, replayTimeline, type Sleep, TimelineRecorder } from "./timeline.js";
import {
  type BudgetKind,
  CLAUDE_MODELS,
  type ClaudeMessage,
  EFFORTS,
  type GatewayBody,
  type GatewayCall,
  type GatewayResult,
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
  spend?: SpendMeter;
  flags?: FlagSource;
  /** Caps in US$ per budget kind. Defaults: AI_DAILY_CAP_USD (8), eval 3, session 0.75. */
  caps?: Partial<Record<BudgetKind, number>>;
  semaphore?: Semaphore;
  clock?: () => Date;
  sleep?: Sleep;
  /** Upload base64 images once through the Files API and send `file_id` references (S4.2 step 5). */
  filesApi?: boolean;
  /** Scrub recordings before storing them (default true). */
  scrub?: boolean;
}

interface LiveOutcome {
  message: ClaudeMessage;
  timeline: TimelineEntry[];
  latencyMs: number;
  firstDeltaMs: number | null;
  requestId: string | null;
}

type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_VISUAL_TOKENS = 4784;

function validateCall(call: GatewayCall): void {
  const bad = (msg: string) => new GatewayError("AI_BAD_CALL", msg);
  if (!PURPOSES.includes(call.purpose)) throw bad(`unknown purpose "${call.purpose}"`);
  if (!CLAUDE_MODELS.includes(call.model)) throw bad(`model "${call.model}" has no role (register §9)`);
  if (!EFFORTS.includes(call.effort)) throw bad(`effort must be low | medium, got "${call.effort}"`);
  if (!VARIANTS.includes(call.variant)) throw bad(`unknown variant "${call.variant}"`);
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

/** A fallback model served the response when `usage.iterations` holds a `fallback_message` entry. */
export function fallbackServed(usage: UsageSummary): boolean {
  return (usage.iterations ?? []).some((it) => it.type === "fallback_message");
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
  private readonly caps: Record<BudgetKind, number>;
  private readonly semaphore: Semaphore;
  private readonly clock: () => Date;
  private readonly sleep: Sleep;

  constructor(private readonly opts: GatewayOptions) {
    this.store = opts.store;
    this.spend = opts.spend ?? new MemorySpendMeter();
    this.flags = opts.flags ?? envFlagSource();
    this.caps = { ...capsFromEnv(), ...opts.caps };
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
    if (await this.flags.isOn("kill_ai_live")) {
      throw new GatewayError("AI_LIVE_DISABLED", "kill_ai_live is on", {
        cacheKey: key,
        reason: "kill_switch",
      });
    }
    // 4. Budget.
    const at = this.clock();
    const bkey = budgetKey(call.budget, call.budgetScope, at);
    const estimate = estimateMicros(call.model, await measureInput(call.body), call.maxTokens);
    const reservation = await this.spend.reserve(bkey, estimate, microsFromUsd(this.caps[call.budget]));

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
      fallback_served: fallbackServed(usage),
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
    };
    // Only the stored copy is scrubbed: the live caller gets the message exactly as the API sent it
    // (thinking signatures must round-trip unmodified in multi-turn use).
    const recording = this.opts.scrub === false ? raw : scrubRecording(raw);
    // 8. Ledger, then the replay store (insert-if-absent).
    const accepted = accept.includes(raw.stop_reason as StopReason);
    await this.opts.ledger?.append({
      ...this.ledgerRow(call, key, at, recording, null),
      accepted,
      request_id: outcome.requestId,
    });
    if ((call.record ?? "if_absent") === "if_absent") await this.store.put(recording);
    const result = this.resultOf(call, raw, "live", cost);
    this.checkStop(result, accept, key);
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
    await replayTimeline(
      rec.replay_timeline,
      { onSnapshot: call.onSnapshot, onReset: call.onReset },
      { speed: call.replaySpeed, sleep: this.sleep, signal: call.signal },
    );
    const result = this.resultOf(call, rec, "replay", 0);
    this.checkStop(result, accept, rec.cache_key);
    return result;
  }

  private resultOf(
    call: GatewayCall,
    rec: Recording,
    provenance: "live" | "replay",
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
      fallbackServed: rec.fallback_served,
      usage: rec.usage,
      latencyMs: rec.latency_ms,
      recordedCostMicros: rec.cost_micros,
      promptDrift: !!call.promptSha && !!rec.prompt_sha && call.promptSha !== rec.prompt_sha,
    };
  }

  /** S4.1 step 7: any stop_reason other than the accepted ones is a typed failure. */
  private checkStop(result: GatewayResult, accept: readonly StopReason[], key: string): void {
    if (!accept.includes(result.stopReason as StopReason)) {
      throw new GatewayError("AI_STOP_REASON", `stop_reason "${result.stopReason}" is not accepted`, {
        cacheKey: key,
        stopReason: result.stopReason,
        result,
      });
    }
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
      model: call.model,
      model_served: rec?.model_served ?? null,
      effort: call.effort,
      variant: call.variant,
      prompt_v: call.promptV,
      schema_v: call.schemaV,
      input_sha: call.inputSha,
      budget: call.budget,
      budget_scope: call.budgetScope ?? null,
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
    const { params, betas } = buildRequest({ ...call, body }, call.format);
    const request = { ...params, ...(betas.length > 0 ? { betas } : {}) };
    const t0 = performance.now();
    const timeline = new TimelineRecorder(t0);

    if (call.stream) {
      const stream = client.beta.messages.stream(request as unknown as StreamParams, { signal: call.signal });
      for await (const event of stream) {
        if (event.type === "message_start") progress.billed = true;
        if (
          event.type === "content_block_start" &&
          (event.content_block as { type: string }).type === "fallback"
        ) {
          timeline.reset();
          call.onReset?.();
          call.onSnapshot?.("");
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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

    const { data, request_id } = await client.beta.messages
      .create(
        { ...(request as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming), stream: false },
        { signal: call.signal },
      )
      .withResponse();
    const message = toPlainMessage(data);
    const latencyMs = Math.round(performance.now() - t0);
    // A non-streamed answer is recorded as one delta at its arrival time, so replays still drive
    // snapshot consumers the same way.
    const text = message.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    const entries: TimelineEntry[] = text ? [{ ms: latencyMs, d: text }] : [];
    if (text) call.onSnapshot?.(text);
    return {
      message,
      timeline: entries,
      latencyMs,
      firstDeltaMs: text ? latencyMs : null,
      requestId: request_id ?? null,
    };
  }
}
