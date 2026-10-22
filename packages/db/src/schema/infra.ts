/**
 * Infrastructure group (register §7): task_outbox, run_events, ledger_entries, ledger_heads, agent_sessions,
 * idempotency_keys, system_flags (llm_calls lives in ./llm.ts).
 *
 * - `run_events`, `ledger_entries` and `agent_sessions` are append-only: the app role has no UPDATE, DELETE
 *   or TRUNCATE grant, and BEFORE UPDATE/DELETE/TRUNCATE triggers refuse everyone unless `fs.purge` is set by
 *   `fs_purge_workspace()` (migrations/0002).
 * - Every insert into `run_events` sends `pg_notify('run_events', '<ws>:<id>')`, delivered on commit; every
 *   insert into `task_outbox` sends `pg_notify('fs_outbox', '<id>')`.
 * - The ledger chain is linked in SQL too: an insert must carry seq = head.seq + 1 and prev_hash = head.hash,
 *   and the trigger advances `ledger_heads` (`FS409 LEDGER_FORK` otherwise).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ACTOR_KINDS, SYSTEM_FLAGS } from "../_shims/contracts.js";
import {
  checkIn,
  checkProvenance,
  checkSha,
  createdAt,
  id,
  provenance,
  sha256,
  tstz,
  updatedAt,
  wsFk,
  wsIdUnique,
} from "./_columns.js";
import { memberLines, payRuns } from "./runs.js";
import { workspaceId, workspaceIdNullable, workspaces } from "./workspace.js";

export const TASK_STATES = ["queued", "dispatched", "running", "done", "dead"] as const;
export const EXECUTOR_KINDS = ["inline", "workflow", "worker"] as const;

export const taskOutbox = pgTable(
  "task_outbox",
  {
    id: id(),
    /** null for system tasks enqueued by cron (reconcile, judgeReset, warmCaches) */
    workspaceId: workspaceIdNullable(),
    name: text("name").notNull(),
    /** ids only: Render Workflows caps arguments at 4 MB, we cap at 8 KB */
    args: jsonb("args").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique("task_outbox_dedupe_key_uq"),
    state: text("state", { enum: TASK_STATES }).notNull().default("queued"),
    /** number of dispatches so far; the row goes dead after max_attempts */
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAfter: tstz("run_after").notNull().defaultNow(),
    executor: text("executor", { enum: EXECUTOR_KINDS }),
    claimedBy: text("claimed_by"),
    workflowRunId: text("workflow_run_id"),
    dispatchedAt: tstz("dispatched_at"),
    startedAt: tstz("started_at"),
    heartbeatAt: tstz("heartbeat_at"),
    finishedAt: tstz("finished_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("task_outbox_state_ck", t.state, TASK_STATES),
    checkIn("task_outbox_executor_ck", t.executor, EXECUTOR_KINDS),
    check("task_outbox_args_size_ck", sql`octet_length(${t.args}::text) <= 8192`),
    check("task_outbox_attempts_ck", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
    index("task_outbox_queued_idx").on(t.runAfter).where(sql`state = 'queued'`),
    index("task_outbox_inflight_idx").on(t.state, t.updatedAt).where(sql`state in ('dispatched', 'running')`),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    /** monotonic; SSE Last-Event-ID */
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: workspaceId(),
    runId: uuid("run_id"),
    /** set for line-scoped events (line.state, item.updated, statements): feeds /v1/lines/:lineId/events */
    lineId: uuid("line_id"),
    type: text("type").notNull(),
    at: tstz("at").notNull().default(sql`clock_timestamp()`),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorId: text("actor_id").notNull(),
    impersonatedBy: text("impersonated_by"),
    provenance: provenance(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    checkIn("run_events_actor_kind_ck", t.actorKind, ACTOR_KINDS),
    checkProvenance("run_events", t.provenance),
    check("run_events_payload_size_ck", sql`octet_length(${t.payload}::text) <= 65536`),
    index("run_events_ws_idx").on(t.workspaceId, t.id),
    index("run_events_run_idx").on(t.runId, t.id),
    index("run_events_line_idx").on(t.lineId, t.id),
    wsFk("run_events_run_fk", t, t.runId, payRuns),
    wsFk("run_events_line_fk", t, t.lineId, memberLines),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    workspaceId: workspaceId(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    actorKind: text("actor_kind", { enum: ACTOR_KINDS }).notNull(),
    actorId: text("actor_id").notNull(),
    impersonatedBy: text("impersonated_by"),
    payload: jsonb("payload").notNull(),
    /** hashed as ISO-8601 with milliseconds; written by the app, never defaulted */
    at: tstz("at").notNull(),
    prevHash: sha256("prev_hash").notNull(),
    entryHash: sha256("entry_hash").notNull(),
    /** not hashed; an index for a run's proof segment (put runId in the payload to bind it) */
    runId: uuid("run_id"),
  },
  (t) => [
    checkIn("ledger_entries_actor_kind_ck", t.actorKind, ACTOR_KINDS),
    check("ledger_entries_seq_ck", sql`${t.seq} >= 1`),
    checkSha("ledger_entries_prev_hash_ck", t.prevHash),
    checkSha("ledger_entries_entry_hash_ck", t.entryHash),
    unique("ledger_entries_seq_uq").on(t.workspaceId, t.seq),
    unique("ledger_entries_hash_uq").on(t.workspaceId, t.entryHash),
    index("ledger_entries_run_idx").on(t.runId, t.seq),
    wsFk("ledger_entries_run_fk", t, t.runId, payRuns),
  ],
);

export const ledgerHeads = pgTable(
  "ledger_heads",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    entryHash: sha256("entry_hash").notNull().default(sql`repeat('0', 64)`),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("ledger_heads_seq_ck", sql`${t.seq} >= 0`),
    checkSha("ledger_heads_entry_hash_ck", t.entryHash),
  ],
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: id(),
    workspaceId: workspaceId(),
    sessionId: uuid("session_id").notNull(),
    /** position of this raw block in the session; history is never edited (preserved-thinking check) */
    seq: integer("seq").notNull(),
    runId: uuid("run_id"),
    role: text("role").notNull(),
    rawMessage: jsonb("raw_message").notNull(),
    modelServed: text("model_served"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("agent_sessions_seq_ck", sql`${t.seq} >= 0`),
    checkProvenance("agent_sessions", t.provenance),
    unique("agent_sessions_seq_uq").on(t.sessionId, t.seq),
    index("agent_sessions_ws_idx").on(t.workspaceId, t.sessionId),
    wsIdUnique("agent_sessions", t),
    wsFk("agent_sessions_run_fk", t, t.runId, payRuns),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    workspaceId: workspaceId(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    requestSha256: sha256("request_sha256").notNull(),
    /** null while the first request is still in flight */
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
    expiresAt: tstz("expires_at").notNull().default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    primaryKey({ name: "idempotency_keys_pk", columns: [t.workspaceId, t.key] }),
    checkSha("idempotency_keys_request_sha256_ck", t.requestSha256),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ],
);

export const systemFlags = pgTable(
  "system_flags",
  {
    workspaceId: workspaceId(),
    flag: text("flag", { enum: SYSTEM_FLAGS }).notNull(),
    on: boolean("on").notNull().default(false),
    setBy: text("set_by"),
    reason: text("reason"),
    setAt: tstz("set_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "system_flags_pk", columns: [t.workspaceId, t.flag] }),
    checkIn("system_flags_flag_ck", t.flag, SYSTEM_FLAGS),
  ],
);
