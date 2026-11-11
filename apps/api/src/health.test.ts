import { describe, expect, it, vi } from "vitest";
import { API_VERSION, createApp } from "./app.js";
import { createFakeClock } from "./lib/clock.js";
import { createTestDeps } from "./test/deps.js";
import { createMemoryBus } from "./test/memory-bus.js";

function build(probes: Partial<Parameters<typeof createApp>[0]["health"]>) {
  const clock = createFakeClock();
  const { deps } = createTestDeps({ clock, env: { FS_KILL: "payouts" } });
  const app = createApp({
    deps,
    static: false,
    health: { db: async () => undefined, version: API_VERSION, startedAt: clock.now(), ...probes },
  });
  return { app, clock };
}

describe("health", () => {
  it("HD6-O2 shares one readiness probe across concurrent readers and caches it for three seconds", async () => {
    const db = vi.fn(async () => undefined);
    const { app, clock } = build({
      db,
      listen: async () => 1,
      dispatcher: () => ({ running: true, executor: "inline" }),
    });
    const responses = await Promise.all(Array.from({ length: 20 }, () => app.app.request("/readyz")));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(db).toHaveBeenCalledTimes(1);
    await app.app.request("/readyz");
    expect(db).toHaveBeenCalledTimes(1);
    clock.advance(3001);
    await app.app.request("/readyz");
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("HD6-O2 replaces database connection details with a fixed unreachable code", async () => {
    const { app } = build({
      db: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    });
    const response = await app.app.request("/readyz");
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain("10.0.0.5");
    expect(JSON.parse(body)).toMatchObject({ checks: { db: { ok: false, error: "unreachable" } } });
  });

  it("/healthz is liveness only: the process and `select 1` within a second", async () => {
    const ok = build({});
    const r = await ok.app.app.request("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      status: "ok",
      service: "fs-api",
      rail: "simulated",
      version: API_VERSION,
    });
    const slow = build({ db: () => new Promise(() => undefined) });
    const s = await slow.app.app.request("/healthz");
    expect(s.status).toBe(503);
  });

  it("/readyz reports each check and is not ready without the LISTEN bus or the dispatcher", async () => {
    const half = build({});
    const r = await half.app.app.request("/readyz");
    expect(r.status).toBe(503);
    const body = (await r.json()) as { checks: Record<string, unknown> };
    expect(body.checks.listen).toMatchObject({ ok: false });
    expect(body.checks.dispatcher).toMatchObject({ ok: false });
    expect(body.checks.flags).toEqual({ forcedByEnv: ["kill_payouts"] });
    expect(body.checks.paypal).toMatchObject({
      mode: "simulator",
      label: "simulated",
      credentials: "placeholder",
    });

    const ready = build({
      listen: async () => 3,
      dispatcher: () => ({ running: true, executor: "inline" }),
      roleMode: "assumed",
    });
    const ok = await ready.app.app.request("/readyz");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      status: "ready",
      checks: { db: { ok: true, role: "assumed" }, listen: { ok: true } },
    });
  });

  it("never leaks a secret in its report", async () => {
    const { app } = build({
      listen: async () => 1,
      dispatcher: () => ({ running: true, executor: "inline" }),
    });
    const text = await (await app.app.request("/readyz")).text();
    expect(text).not.toContain("test-cookie-secret");
    expect(text).not.toContain("fs-sim-secret");
    expect(createMemoryBus().subscribers).toBe(0);
  });
});
