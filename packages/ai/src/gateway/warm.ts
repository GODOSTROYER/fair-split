import { GatewayError } from "./errors.js";
import type { ClaudeGateway } from "./gateway.js";
import { inputShaOf } from "./key.js";
import type { BudgetKind, ClaudeModel, Effort, OutputFormat } from "./types.js";

/**
 * Grammar warm-up for `warmCaches` (S4.9): compiled structured-output grammars expire 24 hours after
 * last use, and a cold grammar adds seconds to the first token (the S3 smoke run measured ~10 s
 * cold vs ~2.5 s warm). One minimal live call per schema every 23 hours keeps them compiled.
 * Never replayed and never recorded; about US$0.002 per Opus schema.
 */
export interface WarmTarget {
  name: string;
  model: ClaudeModel;
  effort: Effort;
  schemaV: string;
  format: OutputFormat;
}

export interface WarmOutcome {
  name: string;
  ok: boolean;
  error: string | null;
  costMicros: number;
  latencyMs: number;
}

export const WARM_PROMPT =
  "You are a warm-up probe for a structured-output schema. Return the smallest valid output: empty arrays, empty strings, zeros and the first value of each list of choices.";

export async function warmStructuredOutputs(
  gateway: ClaudeGateway,
  targets: readonly WarmTarget[],
  opts: { budget?: BudgetKind; budgetScope?: string; now?: Date } = {},
): Promise<WarmOutcome[]> {
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return Promise.all(
    targets.map(async (t): Promise<WarmOutcome> => {
      try {
        const r = await gateway.call({
          purpose: "warm",
          model: t.model,
          effort: t.effort,
          variant: "-",
          promptV: "warm.v1",
          schemaV: t.schemaV,
          inputSha: inputShaOf({ warm: t.name, day }),
          mode: "live_only",
          record: "never",
          stream: false,
          maxTokens: 400,
          budget: opts.budget ?? "daily",
          budgetScope: opts.budgetScope,
          acceptStopReasons: ["end_turn", "max_tokens"],
          body: { system: WARM_PROMPT, messages: [{ role: "user", content: "Warm-up." }] },
          format: t.format,
        });
        return { name: t.name, ok: true, error: null, costMicros: r.costMicros, latencyMs: r.latencyMs };
      } catch (err) {
        const message = err instanceof GatewayError || err instanceof Error ? err.message : String(err);
        return { name: t.name, ok: false, error: message, costMicros: 0, latencyMs: 0 };
      }
    }),
  );
}
