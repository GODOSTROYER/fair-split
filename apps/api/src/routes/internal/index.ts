// src/routes/internal: service endpoints only fs-cron calls (never the console, the app or a judge).
//
//   POST /internal/cron/tick   fs-cron's hourly trigger (tools/cron-tick.mjs): `Authorization: Bearer <CRON_SECRET>`
//                              202 {at, nextTickFrom, tasks: [{task, dedupeKey, created}], skipped: [{task,
//                                  dedupeKey, reason: "no handler"}]} the hour's plan enqueued, except the jobs
//                                  this process has no handler for (skipped and labelled, never enqueued)
//                              401 a missing or wrong secret (no detail, nothing read or written)
//                              404 CRON_SECRET unset or shorter than 16 characters: the route is not there
//                              429 a tick was taken less than 30 minutes ago (Retry-After); nothing enqueued
//
// Raw Hono, not the command builder: the secret is checked before anything else runs (no credential resolution,
// no body read, no database), and the route stays out of the public OpenAPI document.

import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import {
  CRON_TASK_NAMES,
  CRON_TICK_PATH,
  configuredCronSecret,
  cronSecretMatches,
  TICK_MIN_INTERVAL_MS,
  takeCronTick,
} from "./cron.js";

export default defineRouteFolder({
  folder: "internal",
  commands: {},
  routes: (r) => {
    r.app.post(CRON_TICK_PATH, async (c) => {
      const deps = c.get("deps");
      const log = c.get("log");
      const secret = configuredCronSecret(deps.env.secrets.cronSecret);
      if (!secret) {
        log.debug("cron tick refused: CRON_SECRET is unset or too short, so the route answers 404");
        throw problem.notFound(`No route for ${c.req.method} ${c.req.path}`);
      }
      if (!cronSecretMatches(secret, c.req.header("authorization"))) {
        log.debug("cron tick refused: missing or wrong secret");
        throw problem.unauthenticated("Unauthenticated.");
      }
      c.header("Cache-Control", "no-store");
      // a row no handler here would run only goes dead: such a job is skipped and labelled instead
      const runtime = deps.outbox;
      const out = await takeCronTick(deps.db, deps.clock.now(), (task) => runtime?.handles(task) ?? false);
      if (out.kind === "refused") {
        log.info(
          { lastAt: out.lastAt.toISOString(), retryAfterMs: out.retryAfterMs },
          "cron tick refused: too soon",
        );
        throw problem.rateLimited(
          out.retryAfterMs,
          "A cron tick was taken less than 30 minutes ago; nothing was enqueued.",
        );
      }
      log.info({ tasks: out.tasks }, "cron tick taken");
      if (out.skipped.length > 0) {
        log.warn(
          { skipped: out.skipped },
          "cron tick: no handler is registered here for these jobs, so they were skipped (labelled), not enqueued",
        );
      }
      return c.json(
        {
          at: out.at.toISOString(),
          nextTickFrom: new Date(out.at.getTime() + TICK_MIN_INTERVAL_MS).toISOString(),
          tasks: out.tasks,
          skipped: out.skipped,
        },
        202,
      );
    });
  },
  onBoot: async (deps) => {
    if (!configuredCronSecret(deps.env.secrets.cronSecret)) {
      deps.logger.warn(
        "CRON_SECRET is unset or shorter than 16 characters: POST /internal/cron/tick answers 404, so no hourly judgeReset pass runs",
      );
    }
    const unhandled = CRON_TASK_NAMES.filter((task) => !deps.outbox?.handles(task));
    if (unhandled.length > 0) {
      deps.logger.warn(
        { unhandled },
        "cron tick: no handler is registered for these tasks, so every tick skips them (labelled 'no handler')",
      );
    }
  },
});
