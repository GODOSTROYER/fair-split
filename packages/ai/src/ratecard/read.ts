import {
  type GatewayResult,
  inputShaOf,
  jsonOutputFormat,
  parseStructured,
  sha256Hex,
  type WarmTarget,
} from "../gateway/index.js";
import type { ReadDeps } from "../read/calls.js";
import { PREP_V, prepareImage } from "../read/prep.js";
import { loadPromptFile } from "../read/prompts.js";
import { checkRateCard, type RateCardDraft } from "./check.js";
import { RATECARD_SCHEMA_V, RateCardRead, type TextLayer } from "./schema.js";

export const RATECARD_PROMPT_V = "ratecard.v1";
export const RATECARD_MAX_TOKENS = 16000;
const PROMPTS_DIR = new URL("./prompts/", import.meta.url);
export const RATECARD_FORMAT = jsonOutputFormat(RateCardRead);

export function ratecardPrompt(): { promptV: string; text: string; sha256: string } {
  const text = loadPromptFile(PROMPTS_DIR, RATECARD_PROMPT_V);
  return { promptV: RATECARD_PROMPT_V, text, sha256: sha256Hex(text) };
}

export interface RateCardInput {
  documentId: string;
  /** Page images in page order (page 1 first). */
  pages: Buffer[];
  /** The human-verified text layer: used only to check what Claude read, never sent to Claude. */
  textLayer: TextLayer;
}

export interface RateCardOutcome {
  documentId: string;
  read: RateCardRead;
  draft: RateCardDraft;
  result: GatewayResult;
  pageShas: string[];
}

/**
 * AI-5 `readRateCard(documentId)` (S4.3): claude-opus-5-5 at effort medium, streamed, max_tokens
 * 16,000, both pages in one request, the same untrusted-content rules as the slip reads. Claude reads
 * only the images; each term is then checked against the text layer and its values re-parsed by code.
 */
export async function readRateCard(input: RateCardInput, deps: ReadDeps): Promise<RateCardOutcome> {
  if (input.pages.length === 0) throw new Error("readRateCard: no pages");
  const prepared = await Promise.all(input.pages.map((p) => prepareImage(p)));
  const pageShas = prepared.map((p) => p.documentSha256);
  const p = ratecardPrompt();
  const content: unknown[] = [];
  prepared.forEach((page, i) => {
    content.push({ type: "text", text: `Page ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: page.A.toString("base64") },
      transformations: { oversized_image: "error" },
    });
  });
  content.push({ type: "text", text: "Read every rule of the rate card on these pages." });
  const result = await deps.gateway.call({
    purpose: "ratecard",
    model: "claude-opus-5-5",
    effort: "medium",
    variant: "-",
    promptV: p.promptV,
    promptSha: p.sha256,
    schemaV: RATECARD_SCHEMA_V,
    inputSha: inputShaOf({ pages: pageShas, prep: PREP_V }),
    mode: deps.mode,
    stream: true,
    maxTokens: RATECARD_MAX_TOKENS,
    budget: deps.budget,
    budgetScope: deps.budgetScope,
    replaySpeed: deps.replaySpeed,
    signal: deps.signal,
    record: deps.record,
    body: {
      system: [{ type: "text", text: p.text, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    },
    format: RATECARD_FORMAT,
  });
  const read = parseStructured(result.message, RateCardRead, RATECARD_FORMAT);
  return {
    documentId: input.documentId,
    read,
    draft: checkRateCard(read, input.textLayer),
    result,
    pageShas,
  };
}

export const RATECARD_WARM_TARGET: WarmTarget = {
  name: "ratecard",
  model: "claude-opus-5-5",
  effort: "medium",
  schemaV: RATECARD_SCHEMA_V,
  format: RATECARD_FORMAT,
};
