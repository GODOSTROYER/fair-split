/**
 * `llm_calls` (infrastructure group): one row per ClaudeGateway call (S4.1 step 8). The replay cache key is
 * sha256(JCS{imageSha, variant, promptV, schemaV, model, effort}) and is unique across workspaces, because
 * recordings are read across workspaces (S3 deviation 4): a Judge clone replays the showcase's recording.
 */
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { checkProvenance, checkSha, createdAt, id, provenance, tstz } from "./_columns.js";
import { workspaceId } from "./workspace.js";

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    workspaceId: workspaceId(),
    cacheKey: text("cache_key").notNull().unique("llm_calls_cache_key_uq"),
    purpose: text("purpose").notNull(),
    /** daily | eval | session:{id} — spend is metered per budget key per UTC day */
    budgetKey: text("budget_key").notNull(),
    model: text("model").notNull(),
    modelServed: text("model_served"),
    effort: text("effort").notNull(),
    promptV: text("prompt_v").notNull(),
    schemaV: text("schema_v"),
    usage: jsonb("usage"),
    costMicros: bigint("cost_micros", { mode: "bigint" }).notNull(),
    stopReason: text("stop_reason"),
    rawContent: jsonb("raw_content"),
    /** [{ms, delta}] re-emitted at recorded offsets ÷ the caller's speed factor */
    replayTimeline: jsonb("replay_timeline"),
    recordedAt: tstz("recorded_at").notNull().defaultNow(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkSha("llm_calls_cache_key_ck", t.cacheKey),
    check("llm_calls_cost_ck", sql`${t.costMicros} >= 0`),
    checkProvenance("llm_calls", t.provenance),
    index("llm_calls_budget_idx").on(t.budgetKey, t.createdAt),
    index("llm_calls_ws_idx").on(t.workspaceId, t.createdAt),
  ],
);
