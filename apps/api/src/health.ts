// /healthz (liveness, Render's health check) and /readyz (readiness, watched by tools/health-check.ts and the
// uptime workflow). /healthz checks only the process and `select 1` within 1 s, so a PayPal outage never
// restarts a healthy instance. /readyz adds the LISTEN round-trip, the dispatcher, the database role, kill
// flags forced by env, SSE load and the PayPal rail, without calling PayPal (we never poll; the token's
// cached state is reported as is).
import { envKills } from "@fairsplit/db";
import type { Hono } from "hono";
import { killEnv } from "./env.js";
import type { AppEnv } from "./lib/context.js";

export interface HealthProbes {
  /** `select 1`. */
  db(): Promise<void>;
  /** LISTEN round-trip in ms (bus.ping); absent when the bus is not running. */
  listen?(): Promise<number>;
  /** Dispatcher state; absent when no dispatcher runs in this process. */
  dispatcher?(): { running: boolean; executor: string };
  /** The database role mode found at boot (login | assumed | owner). */
  roleMode?: string | null;
  version: string;
  startedAt: Date;
}

const HEALTH_TIMEOUT_MS = 1_000;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function mountHealth(app: Hono<AppEnv>, probes: HealthProbes): void {
  app.get("/healthz", async (c) => {
    const deps = c.get("deps");
    try {
      await within(probes.db(), HEALTH_TIMEOUT_MS);
      return c.json({
        status: "ok",
        service: "fs-api",
        version: probes.version,
        rail: deps.paypal.label,
        uptimeS: Math.round((deps.clock.nowMs() - probes.startedAt.getTime()) / 1000),
      });
    } catch {
      return c.json({ status: "fail", service: "fs-api", checks: { db: "unreachable" } }, 503);
    }
  });

  app.get("/readyz", async (c) => {
    const deps = c.get("deps");
    const checks: Record<string, unknown> = {};
    let ready = true;
    try {
      await within(probes.db(), HEALTH_TIMEOUT_MS);
      checks.db = { ok: true, role: probes.roleMode ?? null };
    } catch (e) {
      ready = false;
      checks.db = { ok: false, error: (e as Error).message };
    }
    if (probes.listen) {
      try {
        const ms = await within(probes.listen(), 2_000);
        checks.listen = { ok: true, roundTripMs: Math.round(ms) };
      } catch (e) {
        ready = false;
        checks.listen = { ok: false, error: (e as Error).message };
      }
    } else {
      checks.listen = { ok: false, error: "no LISTEN bus in this process" };
      ready = false;
    }
    if (probes.dispatcher) {
      const d = probes.dispatcher();
      checks.dispatcher = { ok: d.running, executor: d.executor };
      if (!d.running) ready = false;
    } else {
      checks.dispatcher = { ok: false, error: "dispatcher not started" };
      ready = false;
    }
    const forced = [...envKills(killEnv(deps.env))];
    checks.flags = { forcedByEnv: forced };
    checks.sse = deps.sse.stats();
    const auth = deps.paypal.core.auth.status();
    checks.paypal = {
      ...deps.paypal.describe(),
      token: { cached: auth.hasToken, failures: auth.failures, lastError: auth.lastError },
      webhooks: deps.paypal.core.verifier.health().status,
    };
    return c.json(
      {
        status: ready ? "ready" : "not_ready",
        service: "fs-api",
        version: probes.version,
        rail: deps.paypal.label,
        checks,
      },
      ready ? 200 : 503,
    );
  });
}
