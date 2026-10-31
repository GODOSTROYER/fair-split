// Boot: parse env (refusals first), connect as fs_app (a ledger-writable role is refused), start the LISTEN
// bus, build the PayPal rail for PP_MODE, assemble deps, build the app, start the outbox dispatcher, listen
// on 0.0.0.0:$PORT, then run the folders' boot hooks. PP_MODE=simulator without PP_SIM_URL runs the PayPal
// simulator in this process first (paypal/simulator.ts, ADR-0010): PP_* default to its committed fs-judge app,
// its webhook is registered to our own /webhooks/paypal, its pages are served at /paypal-sim, and before the
// server listens the previous process's judge sessions end and the simulated balance is read (paypal/boot.ts). SIGTERM drains: SSE streams end (clients replay from
// Last-Event-ID), the dispatcher finishes in-flight tasks, connections close (Render waits up to 60 s).
import { createWebhookTransmissionStore, paypalCoreLimiter } from "@fairsplit/db";
import { type ServerType, serve } from "@hono/node-server";
import type { Logger } from "pino";
import { API_VERSION, createApp, type FairSplitApp } from "./app.js";
import { createCredentialKeys, createCredentialResolver } from "./credentials/verify/index.js";
import { openDataLayer, wireOutbox } from "./db.js";
import { type ApiEnv, BootRefusal, type EnvSource, parseEnv } from "./env.js";
import { systemClock } from "./lib/clock.js";
import type { AppDeps } from "./lib/context.js";
import { appCredentialStore } from "./lib/credential-store.js";
import { dbIdempotencyStore } from "./lib/idempotency.js";
import { createKeyedRateLimiter } from "./lib/rate-limit.js";
import { createLogger } from "./middleware/logger.js";
import { assertPartiesAscii } from "./money/policy.js";
import { bootInProcessSimulator } from "./paypal/boot.js";
import { createPayPalRail } from "./paypal/mode.js";
import {
  type InProcessPayPalSimulator,
  runsInProcessSimulator,
  startInProcessSimulator,
  withSimulatorDefaults,
} from "./paypal/simulator.js";
import { createSseHub } from "./sse/hub.js";

export interface RunningServer {
  env: ApiEnv;
  app: FairSplitApp;
  deps: AppDeps;
  server: ServerType;
  /** Graceful stop (idempotent). */
  stop(reason?: string): Promise<void>;
}

export async function startServer(source: EnvSource = process.env): Promise<RunningServer> {
  const parsed = parseEnv(source);
  const inProcess = runsInProcessSimulator(parsed.paypal);
  const env: ApiEnv = inProcess ? { ...parsed, paypal: withSimulatorDefaults(parsed.paypal) } : parsed;
  try {
    assertPartiesAscii(env);
  } catch (err) {
    throw new BootRefusal([
      err instanceof Error ? err.message : "a PayPal e-mail setting is not plain ASCII",
    ]);
  }
  const logger = createLogger({ level: env.logLevel });
  for (const w of env.warnings) logger.warn(w);
  const data = await openDataLayer(env, logger);

  let sim: InProcessPayPalSimulator | null = null;
  if (inProcess) {
    try {
      sim = await startInProcessSimulator({
        paypal: env.paypal,
        publicOrigin: env.publicOrigin,
        source,
        log: (level, message) => logger[level]({ component: "paypal-sim" }, message),
      });
    } catch (err) {
      await data.close();
      throw new BootRefusal([
        `the in-process PayPal simulator did not start: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  }

  // WS-DATA's adapters: every PayPal attempt takes a slot of the shared Postgres limiter and completes its
  // `paypal_calls` row; a verified webhook's transmission id is claimed in `webhook_transmissions`, so a replayed
  // delivery is refused in every process (the hourly cron purges expired ids).
  const pp = paypalCoreLimiter(data.limiter);
  const paypal = createPayPalRail({
    // in process, the webhook id is the one the simulator minted for our route at this boot
    paypal: sim ? { ...env.paypal, webhookId: sim.webhookId } : env.paypal,
    limiter: pp.limiter,
    recorder: pp.recorder,
    logger,
    webhookTransmissionStore: createWebhookTransmissionStore(data.database.db),
    ...(sim ? { simulator: sim.rail } : {}),
  });
  const keys = createCredentialKeys(env.secrets);
  const store = appCredentialStore(data.database.db);
  const clock = systemClock;
  const deps: AppDeps = {
    env,
    clock,
    logger,
    db: data.database.db,
    sql: data.database.sql,
    sse: createSseHub({ bus: data.bus, logger }),
    paypal,
    credentials: { keys, store, resolver: createCredentialResolver({ store, keys, clock }) },
    idempotency: dbIdempotencyStore(data.database.db),
    rateLimits: createKeyedRateLimiter(clock),
    outbox: null,
  };

  const startedAt = clock.now();
  let outboxWiring: ReturnType<typeof wireOutbox> | null = null;
  const app = createApp({
    deps,
    health: {
      db: async () => {
        await data.database.sql`select 1`;
      },
      listen: () => data.bus.ping(),
      dispatcher: () => ({ running: outboxWiring?.runtime.started ?? false, executor: env.executor.kind }),
      roleMode: data.role.mode,
      version: API_VERSION,
      startedAt,
    },
  });

  // the simulator's deliveries reach our own /webhooks/paypal in process, through the real route
  sim?.deliverTo((request) => app.fetch(request));
  const stopSimulatorBoot = sim ? await bootInProcessSimulator(deps) : null;

  outboxWiring = wireOutbox({
    env,
    data,
    listenUrl: env.database.listenUrl,
    handlers: app.registry.taskHandlers(deps),
    logger,
  });
  deps.outbox = outboxWiring.runtime;
  await outboxWiring.start();

  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host });
  logger.info(
    {
      port: env.port,
      rail: paypal.describe(),
      executor: env.executor.kind,
      pending: app.registry.commands.filter((c) => !c.implemented).map((c) => c.name),
    },
    "fs-api listening",
  );
  if (paypal.mode === "sandbox") {
    // Register §8: the token's scopes are checked at boot. One token fetch; a failure is logged and shows on
    // /readyz, and never stops the server (PayPal steps fall back to labelled replay).
    paypal.core.boot().then(
      (report) => logger.info({ scopes: report }, "PayPal scopes checked"),
      (err: unknown) => logger.warn({ err }, "PayPal scope check failed at boot"),
    );
  }
  void app.registry.onBoot(deps);

  let stopping: Promise<void> | null = null;
  const stop = (reason = "stop") => {
    stopping ??= (async () => {
      logger.info({ reason }, "fs-api stopping");
      await deps.sse.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await outboxWiring?.stop().catch((err) => logger.warn({ err }, "dispatcher stop failed"));
      stopSimulatorBoot?.();
      await sim?.stop().catch((err) => logger.warn({ err }, "simulator stop failed"));
      await data.close();
      logger.info("fs-api stopped");
    })();
    return stopping;
  };
  return { env, app, deps, server, stop };
}

/** Wires SIGTERM/SIGINT to a graceful stop (Render sends SIGTERM and waits maxShutdownDelaySeconds). */
export function handleSignals(running: RunningServer, logger: Logger): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      running
        .stop(signal)
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error({ err }, "shutdown failed");
          process.exit(1);
        });
    });
  }
}
