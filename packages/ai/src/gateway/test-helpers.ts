// Test-only helpers: Anthropic-shaped messages and SSE bodies for msw handlers. Not exported from the
// package entry points.
import type { ClaudeMessage, RecordedBlock } from "./types.js";

export interface FakeMessageOptions {
  text: string;
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  usageExtra?: Record<string, unknown>;
  leadingBlocks?: RecordedBlock[];
}

export function fakeMessage(o: FakeMessageOptions): ClaudeMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: o.model ?? "claude-opus-5-5",
    content: [...(o.leadingBlocks ?? []), { type: "text", text: o.text }],
    stop_reason: o.stopReason ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: o.inputTokens ?? 1000,
      output_tokens: o.outputTokens ?? 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      ...o.usageExtra,
    },
  };
}

/** Splits `text` into deltas of `size` characters. */
export function chunks(text: string, size = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export interface SseOptions {
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Emits a `fallback` block (from → to) before the text block when set. With `partialText`, the
   * declined model's partial streams first (mid-stream case) and `text` is the fallback model's
   * continuation of it; without it the fallback is pre-output and `text` is the whole answer.
   */
  fallback?: { from: string; to: string; partialText?: string };
  usageExtra?: Record<string, unknown>;
}

/** An SSE body for a streamed structured answer. */
export function sseBody(text: string, o: SseOptions = {}): string {
  const events: Array<[string, unknown]> = [];
  const model = o.model ?? "claude-opus-5-5";
  events.push([
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_stream",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: o.inputTokens ?? 1000, output_tokens: 1 },
      },
    },
  ]);
  let index = 0;
  if (o.fallback) {
    if (o.fallback.partialText) {
      events.push([
        "content_block_start",
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      ]);
      for (const piece of chunks(o.fallback.partialText)) {
        events.push([
          "content_block_delta",
          { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } },
        ]);
      }
      events.push(["content_block_stop", { type: "content_block_stop", index }]);
      index++;
    }
    events.push([
      "content_block_start",
      {
        type: "content_block_start",
        index,
        content_block: {
          type: "fallback",
          from: { model: o.fallback.from },
          to: { model: o.fallback.to },
          trigger: { type: "refusal", category: null },
        },
      },
    ]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
    index++;
  }
  events.push([
    "content_block_start",
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ]);
  for (const piece of chunks(text)) {
    events.push([
      "content_block_delta",
      { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } },
    ]);
  }
  events.push(["content_block_stop", { type: "content_block_stop", index }]);
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: o.stopReason ?? "end_turn", stop_sequence: null },
      usage: { output_tokens: o.outputTokens ?? 200, ...o.usageExtra },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

export const SSE_HEADERS = { "Content-Type": "text/event-stream", "request-id": "req_test" } as const;
export const JSON_HEADERS = { "Content-Type": "application/json", "request-id": "req_test" } as const;
