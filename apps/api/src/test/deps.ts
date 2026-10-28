// AppDeps without a server: the test harness and `openapi.cli.ts` build the real app from these.
// No vitest import here (the CLI uses it). With `data`, everything is backed by Postgres; without it the
// database handles throw a clear error when touched, credentials and idempotency live in memory, and SSE
// runs on the in-memory bus.
import type { Database, Db } from "@fairsplit/db";
import { createMemoryLimiter, type FetchLike } from "@fairsplit/paypal-core";
import type { Logger } from "pino";
import type { Sql } from "postgres";
import {
  createCredentialKeys,
  createCredentialResolver,
  memoryCredentialStore,
} from "../credentials/verify/index.js";
import { type EnvSource, parseEnv } from "../env.js";
import type { Clock } from "../lib/clock.js";
import type { AppDeps } from "../lib/context.js";
import { appCredentialStore } from "../lib/credential-store.js";
import { dbIdempotencyStore, memoryIdempotencyStore } from "../lib/idempotency.js";
import { createKeyedRateLimiter } from "../lib/rate-limit.js";
import { silentLogger } from "../middleware/logger.js";
import { createPayPalRail, type InProcessSimulator } from "../paypal/mode.js";
import { type BusLike, createSseHub } from "../sse/hub.js";
import { createMemoryBus, type MemoryBus } from "./memory-bus.js";

/** Env every test app starts from (override per test). Fixed keys keep cookies and links deterministic. */
export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  PP_ENV: "sandbox",
  PP_MODE: "simulator",
  LOG_LEVEL: "silent",
  PUBLIC_ORIGIN: "http://localhost:8787",
  FS_COOKIE_SECRET: "test-cookie-secret-0123456789abcdef-not-a-real-secret",
  FS_LINK_SIGNING_KEY: "1f".repeat(32),
  // As deployed (Cloudflare's edge in front of Render's proxy): a test names a client's network with the edge's
  // CF-Connecting-IP header, or with the rightmost X-Forwarded-For entry (the hop Render's proxy appends).
  FS_TRUSTED_EDGE: "render",
};

function noDatabase<T>(what: string): T {
  const fail = () => {
    throw new Error(`${what}: this test app has no database; use createTestApp({ db: "postgres" })`);
  };
  return new Proxy(fail, {
    get: (_t, prop) => (prop === "then" ? undefined : fail()),
    apply: fail,
  }) as unknown as T;
}

export interface TestDepsOptions {
  clock: Clock;
  env?: EnvSource;
  logger?: Logger;
  /** Postgres-backed deps: the fs_app pool and a started LISTEN bus. */
  data?: { database: Database; bus: BusLike };
  simulator?: InProcessSimulator;
  paypalFetch?: FetchLike;
  webhookTrustAnchors?: readonly string[];
  /** SSE hub options (a short ping makes stream re-checks observable in a test). */
  sse?: { pingMs?: number };
}

export interface TestDeps {
  deps: AppDeps;
  /** The in-memory bus (no-database mode only). */
  bus: MemoryBus | null;
  /** The in-memory credential store (no-database mode only). */
  memoryStore: ReturnType<typeof memoryCredentialStore> | null;
}

export function createTestDeps(o: TestDepsOptions): TestDeps {
  const env = parseEnv({ ...TEST_ENV, ...(o.env ?? {}) });
  const logger = o.logger ?? silentLogger();
  const keys = createCredentialKeys(env.secrets);
  const memoryStore = o.data ? null : memoryCredentialStore();
  const store = o.data
    ? appCredentialStore(o.data.database.db)
    : (memoryStore as ReturnType<typeof memoryCredentialStore>);
  const bus = o.data ? null : createMemoryBus();
  const paypal = createPayPalRail({
    paypal: env.paypal,
    limiter: createMemoryLimiter({ now: () => o.clock.nowMs() }),
    logger,
    now: () => o.clock.nowMs(),
    sleep: async () => undefined,
    ...(o.simulator ? { simulator: o.simulator } : {}),
    ...(o.paypalFetch ? { fetch: o.paypalFetch } : {}),
    ...(o.webhookTrustAnchors ? { webhookTrustAnchors: o.webhookTrustAnchors } : {}),
  });
  const deps: AppDeps = {
    env,
    clock: o.clock,
    logger,
    db: o.data ? o.data.database.db : noDatabase<Db>("deps.db"),
    sql: o.data ? o.data.database.sql : noDatabase<Sql>("deps.sql"),
    sse: createSseHub({
      bus: o.data ? o.data.bus : (bus as MemoryBus),
      logger,
      ...(o.sse?.pingMs !== undefined ? { pingMs: o.sse.pingMs } : {}),
    }),
    paypal,
    credentials: { keys, store, resolver: createCredentialResolver({ store, keys, clock: o.clock }) },
    idempotency: o.data ? dbIdempotencyStore(o.data.database.db) : memoryIdempotencyStore(),
    rateLimits: createKeyedRateLimiter(o.clock),
    outbox: null,
  };
  return { deps, bus, memoryStore };
}
