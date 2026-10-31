// Database and outbox wiring for fs-api (IC-04 from WS-DATA).
//
// - The pool connects as `fs_app` (login role in production, or the owner assuming fs_app locally) and boot
//   refuses a connection that could rewrite history (UPDATE/DELETE on run_events, ledger_entries,
//   agent_sessions) unless FS_ALLOW_OWNER_ROLE records the S6 fallback.
// - One dedicated LISTEN connection feeds the SSE bus.
// - The outbox dispatcher claims `task_outbox` rows (SKIP LOCKED) and runs them inline two at a time, or hands
//   the three Workflow tasks to Render with EXECUTOR=workflow (20 s inline fallback).
import { hostname } from "node:os";
import {
  AppRoleError,
  type AppRoleReport,
  assertAppRole,
  type Bus,
  createBus,
  createDb,
  createLimiter,
  type Database,
  detectAppRole,
  type Limiter,
} from "@fairsplit/db";
import { createOutbox, type Outbox, type TaskHandlers } from "@fairsplit/outbox";
import { Render } from "@renderinc/sdk";
import type { Logger } from "pino";
import { type ApiEnv, BootRefusal } from "./env.js";
import type { OutboxRuntime } from "./lib/context.js";

export interface DataLayer {
  database: Database;
  bus: Bus;
  limiter: Limiter;
  role: AppRoleReport;
  close(): Promise<void>;
}

export async function openDataLayer(env: ApiEnv, logger: Logger): Promise<DataLayer> {
  const url = env.database.url;
  if (!url) throw new BootRefusal(["DATABASE_URL is not set"]);
  const role = await detectAppRole(url);
  const database = createDb(url, { role, applicationName: "fs-api", max: env.database.poolMax });
  let report: AppRoleReport;
  try {
    report = await assertAppRole(database.db, {
      allow: env.database.allowOwnerRole ? ["login", "assumed", "owner"] : ["login", "assumed"],
    });
  } catch (err) {
    await database.close();
    if (err instanceof AppRoleError) {
      throw new BootRefusal([
        `database role refused (${err.problems.join("; ")}): the app must not be able to rewrite the ledger`,
      ]);
    }
    throw err;
  }
  logger.info({ mode: report.mode, user: report.currentUser }, "database role checked");
  const bus = createBus({
    url: env.database.listenUrl ?? url,
    db: database.db,
    onError: (err) => logger.warn({ err }, "LISTEN bus error"),
  });
  await bus.start();
  const limiter = createLimiter(database.db);
  return {
    database,
    bus,
    limiter,
    role: report,
    async close() {
      await bus.close().catch(() => undefined);
      await database.close().catch(() => undefined);
    },
  };
}

export interface OutboxWiring {
  outbox: Outbox;
  runtime: OutboxRuntime;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function wireOutbox(o: {
  env: ApiEnv;
  data: Pick<DataLayer, "database">;
  listenUrl?: string | undefined;
  handlers: TaskHandlers;
  logger: Logger;
}): OutboxWiring {
  const log = o.logger.child({ component: "outbox" });
  const workflowClient =
    o.env.executor.kind === "workflow"
      ? new Render(o.env.executor.renderApiKey ? { token: o.env.executor.renderApiKey } : {}).workflows
      : undefined;
  const outbox = createOutbox({
    db: o.data.database.db,
    handlers: o.handlers,
    workerId: `fs-api:${hostname()}:${process.pid}`,
    executor: o.env.executor.kind,
    ...(workflowClient
      ? {
          workflowClient: {
            startTask: (slug: string, args: unknown[]) =>
              workflowClient.startTask(
                slug.replace(/^fs-tasks\//, `${o.env.executor.tasksSlug}/`) as never,
                args as never,
              ),
          },
        }
      : {}),
    ...(o.listenUrl ? { listenUrl: o.listenUrl } : {}),
    onEvent: (e) => {
      if (e.type === "dead" || e.type === "retry") log.warn(e, "outbox task");
      else log.debug(e, "outbox task");
    },
    dispatcher: {
      onEvent: (e) => {
        if (e.type === "tick_failed" || e.type === "dispatch_failed") log.warn(e, "outbox dispatcher");
        else log.debug(e, "outbox dispatcher");
      },
    },
  });
  let started = false;
  return {
    outbox,
    runtime: {
      runTask: (id) => outbox.runTask(id, "inline"),
      idle: () => outbox.inline.idle(),
      get started() {
        return started;
      },
      handles: (task) => typeof o.handlers[task] === "function",
    },
    async start() {
      await outbox.dispatcher.start();
      started = true;
    },
    async stop() {
      if (!started) return;
      started = false;
      await outbox.dispatcher.stop({ drain: true });
    },
  };
}
