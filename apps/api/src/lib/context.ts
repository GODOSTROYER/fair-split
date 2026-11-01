// What every handler can reach: `AppDeps` (built once at boot, or by the test harness) and the per-request
// variables the shell's middleware sets on the Hono context.
import type { TaskName } from "@fairsplit/contracts";
import type { Db } from "@fairsplit/db";
import type { Context } from "hono";
import type { Logger } from "pino";
import type { Sql } from "postgres";
import type {
  CredentialKeys,
  CredentialResolver,
  CredentialStore,
  ResolveResult,
} from "../credentials/verify/index.js";
import type { ApiEnv } from "../env.js";
import type { PayPalRail } from "../paypal/mode.js";
import type { SseHub } from "../sse/hub.js";
import type { Clock } from "./clock.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { KeyedRateLimiter } from "./rate-limit.js";

/** Outbox runtime as handlers see it: run a task now (tests, judge resets) and the dispatcher's state. */
export interface OutboxRuntime {
  /** Run one outbox row in this process (what the dispatcher does; also handy in tests). */
  runTask(outboxId: string): Promise<{ outcome: string }>;
  /** Resolves when no inline task is queued or running. */
  idle(): Promise<void>;
  readonly started: boolean;
  /**
   * True when this process's outbox has a handler registered for `task`. A row without one fails `no handler
   * registered` on every attempt and goes dead, so a scheduler (the cron tick) asks first and labels the job instead.
   */
  handles(task: TaskName): boolean;
}

export interface AppDeps {
  env: ApiEnv;
  clock: Clock;
  logger: Logger;
  /** Drizzle over the pooled `fs_app` connection. */
  db: Db;
  /** The raw postgres.js handle behind `db` (advisory locks, COPY). */
  sql: Sql;
  /** SSE hub over the one LISTEN connection. */
  sse: SseHub;
  /** PayPal transport and core for the configured mode (simulator | sandbox). */
  paypal: PayPalRail;
  credentials: {
    keys: CredentialKeys;
    store: CredentialStore;
    resolver: CredentialResolver;
  };
  /** Idempotency-Key store (S3.10): `idempotency_keys` in the app, memory in the no-database harness. */
  idempotency: IdempotencyStore;
  /** In-memory throttles (presence 1 Hz, pairing claims, session starts per hashed IP). */
  rateLimits: KeyedRateLimiter;
  /** Null until the dispatcher is wired (server.ts) or in tests that do not need it. */
  outbox: OutboxRuntime | null;
}

export interface AppVariables {
  requestId: string;
  log: Logger;
  deps: AppDeps;
  /** Memoised credential resolution for this request (see middleware/credential.ts). */
  credentialResult?: Promise<ResolveResult>;
}

export type AppEnv = { Variables: AppVariables };
export type AppContext = Context<AppEnv>;
