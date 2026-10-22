import { GatewayError } from "./errors.js";
import type { ClaudeModel, GatewayCall, OutputFormat } from "./types.js";

/** Server-side fallback beta for the `"default"` scalar form (S4.1 step 5). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Haiku 5.5 has no server-side fallback; with `fallbacks: "default"` a decline would simply stay declined. */
export function supportsServerFallback(model: ClaudeModel): boolean {
  return model === "claude-opus-5-5" || model === "claude-sonnet-5-5";
}

const BODY_KEYS = new Set(["system", "messages", "tools"]);

/** Parameters that never leave the gateway, at any depth of the request. */
const SAMPLING = ["temperature", "top_p", "top_k"] as const;

/**
 * The body a caller hands in may hold only system, messages and tools (S4.1: never model, sampling,
 * thinking or tool_choice). Runs before anything else, so a bad body fails fast even in replay.
 */
export function assertBodyCompliant(body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError("AI_BAD_CALL", "body must be an object");
  }
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) {
      throw new GatewayError(
        "AI_REQUEST_RULE",
        `body may hold only system, messages and tools; got "${key}"`,
      );
    }
  }
  const b = body as { messages?: unknown; tools?: unknown };
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new GatewayError("AI_BAD_CALL", "body.messages must be a non-empty array");
  }
  if (b.tools !== undefined && !Array.isArray(b.tools)) {
    throw new GatewayError("AI_BAD_CALL", "body.tools must be an array");
  }
}

/**
 * The last line of defence, run on the exact parameters about to be sent: effort is always set;
 * no sampling parameters; thinking, when present, is adaptive (never disabled, never a budget);
 * tool_choice, when present, is never forced.
 */
export function assertWireCompliant(params: Record<string, unknown>): void {
  for (const key of SAMPLING) {
    if (key in params) throw new GatewayError("AI_REQUEST_RULE", `sampling parameter "${key}" is never sent`);
  }
  const oc = params.output_config as { effort?: unknown } | undefined;
  if (!oc || (oc.effort !== "low" && oc.effort !== "medium")) {
    throw new GatewayError("AI_REQUEST_RULE", "output_config.effort must always be set (low | medium)");
  }
  if ("thinking" in params) {
    const t = params.thinking as Record<string, unknown> | null | undefined;
    if (t?.type !== "adaptive" || "budget_tokens" in t) {
      throw new GatewayError("AI_REQUEST_RULE", "thinking may only be adaptive; never disabled or budgeted");
    }
  }
  if ("tool_choice" in params) {
    const tc = params.tool_choice as { type?: unknown } | null | undefined;
    if (!tc || (tc.type !== "auto" && tc.type !== "none")) {
      throw new GatewayError("AI_REQUEST_RULE", "a forced tool_choice (any | tool) is never sent");
    }
  }
  if ("budget_tokens" in params) throw new GatewayError("AI_REQUEST_RULE", "budget_tokens is never sent");
}

export interface BuiltRequest {
  params: Record<string, unknown>;
  betas: string[];
}

/** Builds the Messages API parameters for a gateway call. The model and effort come from the call. */
export function buildRequest(call: GatewayCall, format: OutputFormat | undefined): BuiltRequest {
  const betas: string[] = [];
  const params: Record<string, unknown> = {
    model: call.model,
    max_tokens: call.maxTokens,
    system: call.body.system,
    messages: call.body.messages,
    output_config: { effort: call.effort, ...(format ? { format } : {}) },
  };
  if (call.body.tools !== undefined) params.tools = call.body.tools;
  if (supportsServerFallback(call.model)) {
    params.fallbacks = "default";
    betas.push(FALLBACK_BETA);
  }
  assertWireCompliant(params);
  return { params, betas };
}
