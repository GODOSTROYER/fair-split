import type { ClaudeModel, UsageSummary } from "./types.js";

/** US$ per million tokens, which is the same number as micro-dollars per token. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
}

/**
 * S4.9 prices (Batch halves them; the gateway never batches). Cache-read and cache-write rates for
 * Sonnet and Haiku come from the published rate cards (0.1x and 1.25x input), which S4.9 leaves blank.
 * Two models without a role are priced too: an answer from any model but the one asked is a typed
 * failure (AI_MODEL_MISMATCH), and its cost must still be counted.
 */
export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25 },
};

/** Unknown models are priced at the most expensive known rate, so a surprise never under-counts. */
const CEILING: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25 };

export function priceOf(model: string | null | undefined): ModelPrice {
  return (model && PRICES[model]) || CEILING;
}

interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

function microsFor(price: ModelPrice, t: TokenCounts): number {
  return (
    t.input_tokens * price.input +
    t.output_tokens * price.output +
    t.cache_read_input_tokens * price.cacheRead +
    t.cache_creation_input_tokens * price.cacheWrite5m
  );
}

/**
 * Cost in integer micro-dollars, rounded up. When the API reports per-attempt `iterations`, each
 * attempt is priced at the model that ran it (`servedModel` when it names none); otherwise the whole
 * usage is priced at `servedModel`.
 */
export function costMicros(usage: UsageSummary, servedModel: string): number {
  if (usage.iterations && usage.iterations.length > 0) {
    let total = 0;
    for (const it of usage.iterations) total += microsFor(priceOf(it.model ?? servedModel), it);
    return Math.ceil(total);
  }
  return Math.ceil(microsFor(priceOf(servedModel), usage));
}

/** One visual token per 28x28 patch (vision docs). */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/**
 * S4.1 step 4: estimate = (visual tokens + characters/4) x input price + maxTokens x output price.
 * Returned in integer micro-dollars, rounded up.
 */
export function estimateMicros(
  model: ClaudeModel,
  input: { visualTokens: number; characters: number },
  maxTokens: number,
): number {
  const p = priceOf(model);
  return Math.ceil((input.visualTokens + input.characters / 4) * p.input + maxTokens * p.output);
}

export const usd = (micros: number): number => micros / 1_000_000;
export const microsFromUsd = (dollars: number): number => Math.round(dollars * 1_000_000);
