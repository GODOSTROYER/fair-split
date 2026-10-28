import { z } from "zod";
import {
  type GatewayResult,
  inputShaOf,
  jsonForPrompt,
  jsonOutputFormat,
  parseStructured,
  sha256Hex,
} from "../gateway/index.js";
import type { HoldDraft } from "../read/_shims/contracts.js";
import { normaliseDeduction } from "../read/_shims/domain.js";
import { callOptions, type ReadDeps } from "../read/calls.js";
import { loadPromptFile } from "../read/prompts.js";
import {
  type AmountCheck,
  type AmountContext,
  checkAmount,
  type DeductionRule,
  parseWrittenAmount,
} from "./amount.js";

export const CLASSIFY_PROMPT_V = "classify.v1";
export const CLASSIFY_SCHEMA_BASE = "classify.v1";
export const CLASSIFY_MAX_TOKENS = 1500;
const PROMPTS_DIR = new URL("./prompts/", import.meta.url);

/** A ratified deduction term as the classifier sees it: words only, never a typed value. */
export interface DeductionTerm extends DeductionRule {
  label: string;
  quote: string;
}

export interface ClassifyInput {
  docId: string;
  row: number;
  /** The verbatim (agreed) deduction line. */
  line: string;
  /** Quarantined text never enters a prompt (S4.2 AI-4): the classifier is not called. */
  quarantined: boolean;
  /** The ratified card's deduction terms. */
  terms: readonly DeductionTerm[];
  /** First 8 hex digits of the ratified card's hash: `schemaV` includes it (the enum is the card's). */
  rc8: string;
  amount: AmountContext;
}

export interface ClassifyOutcome {
  status: "MATCH" | "NO_MATCH" | "QUARANTINED";
  ruleId: string | null;
  writtenMinor: number | null;
  amount: AmountCheck | null;
  hold: HoldDraft | null;
  result: GatewayResult | null;
}

/** The label of a ratified term: the words before the colon of its quote ("Hauling: ..." → "Hauling"). */
export function labelOf(quote: string, ruleId: string): string {
  const head = quote.split(":")[0]?.trim() ?? "";
  return head && head.length < 60 && head !== quote.trim() ? head : ruleId;
}

export function classifySchema(ruleIds: readonly string[]) {
  const ids = [...new Set(ruleIds)].sort();
  if (ids.includes("NO_MATCH")) throw new Error("a rule may not be called NO_MATCH");
  const [first, ...rest] = [...ids, "NO_MATCH"] as const;
  return z.strictObject({ rule_id: z.enum([first as string, ...rest]) });
}

/**
 * AI-6 `classifyDeduction(markId)`: claude-sonnet-5-5 at effort low names a ratified rule id or
 * NO_MATCH. NO_MATCH raises NO_RULE; a failed amount check raises RATE_MISMATCH; both RESERVES_LINE.
 */
export async function classifyDeduction(input: ClassifyInput, deps: ReadDeps): Promise<ClassifyOutcome> {
  const writtenMinor = parseWrittenAmount(input.line);
  if (input.quarantined) {
    return {
      status: "QUARANTINED",
      ruleId: null,
      writtenMinor: null,
      amount: null,
      hold: null,
      result: null,
    };
  }
  const terms = [...input.terms].sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  const schema = classifySchema(terms.map((t) => t.rule_id));
  const format = jsonOutputFormat(schema);
  const line = normaliseDeduction(input.line);
  const shown = terms.map((t) => ({ rule_id: t.rule_id, label: t.label, quote: t.quote }));
  const text = loadPromptFile(PROMPTS_DIR, CLASSIFY_PROMPT_V);
  const result = await deps.gateway.call({
    ...callOptions(deps),
    purpose: "classify",
    model: "claude-sonnet-5-5",
    effort: "low",
    variant: "-",
    promptV: CLASSIFY_PROMPT_V,
    promptSha: sha256Hex(text),
    schemaV: `${CLASSIFY_SCHEMA_BASE}+rc:${input.rc8}+${sha256Hex(JSON.stringify(format.schema)).slice(0, 8)}`,
    inputSha: inputShaOf({ line, terms: shown }),
    stream: false,
    maxTokens: CLASSIFY_MAX_TOKENS,
    body: {
      system: [{ type: "text", text }],
      messages: [
        {
          role: "user",
          // Both blocks through jsonForPrompt: a line (or a quote) cannot close its block (S4.7 layer 5).
          content: `<terms>${jsonForPrompt(shown)}</terms>\n<line>${jsonForPrompt(line)}</line>`,
        },
      ],
    },
    format,
  });
  const { rule_id } = parseStructured(result.message, schema, format);
  if (rule_id === "NO_MATCH") {
    return {
      status: "NO_MATCH",
      ruleId: null,
      writtenMinor,
      amount: null,
      hold: {
        kind: "NO_RULE",
        gate: "RESERVES_LINE",
        docId: input.docId,
        row: input.row,
        field: "deductions",
        reason: "No ratified rule names this deduction",
      },
      result,
    };
  }
  const rule = terms.find((t) => t.rule_id === rule_id) as DeductionTerm;
  const amount = checkAmount(rule, input.line, writtenMinor, input.amount);
  return {
    status: "MATCH",
    ruleId: rule_id,
    writtenMinor,
    amount,
    hold: amount.ok
      ? null
      : {
          kind: "RATE_MISMATCH",
          gate: "RESERVES_LINE",
          docId: input.docId,
          row: input.row,
          field: "deductions",
          reason: amount.reason,
        },
    result,
  };
}
