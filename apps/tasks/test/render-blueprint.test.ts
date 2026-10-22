import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Blueprint,
  checkPolicy,
  REPO_ROOT,
  readBlueprint,
  startCommandSource,
  validateAgainstSchema,
} from "../../../tools/lib/blueprint.js";

const bp = readBlueprint();
const svc = (name: string) => bp.services?.find((s) => s.name === name);
const clone = (): Blueprint => structuredClone(bp);

describe("render.yaml against Render's published Blueprint schema", () => {
  it("is valid", () => {
    expect(validateAgainstSchema(bp)).toEqual([]);
  });

  it("the schema catches what Render would reject (workflow plan, preDeployCommand, health check)", () => {
    for (const key of ["plan", "preDeployCommand", "healthCheckPath"] as const) {
      const bad = clone();
      const wf = bad.services?.find((s) => s.type === "workflow");
      if (wf) wf[key] = key === "plan" ? "flex" : "/x";
      expect(validateAgainstSchema(bad).length, key).toBeGreaterThan(0);
    }
  });

  it("the schema rejects an unknown region and a typo'd field", () => {
    const a = clone();
    if (a.databases?.[0]) a.databases[0].region = "mumbai";
    expect(validateAgainstSchema(a).length).toBeGreaterThan(0);
    const b = clone() as Blueprint & { services: Record<string, unknown>[] };
    (b.services[0] as Record<string, unknown>).healthcheckPath = "/healthz";
    expect(validateAgainstSchema(b).length).toBeGreaterThan(0);
  });
});

describe("render.yaml against Fair Split's deployment rules", () => {
  it("passes every rule", () => {
    expect(checkPolicy(bp)).toEqual([]);
  });

  it("declares exactly fs-api, fs-tasks, fs-cron and fs-db, all in virginia", () => {
    expect(bp.services?.map((s) => `${s.type}:${s.name}`)).toEqual([
      "web:fs-api",
      "workflow:fs-tasks",
      "cron:fs-cron",
    ]);
    expect(bp.databases?.map((d) => d.name)).toEqual(["fs-db"]);
    const regions = new Set([
      ...(bp.services ?? []).map((s) => s.region),
      ...(bp.databases ?? []).map((d) => d.region),
    ]);
    expect([...regions]).toEqual(["virginia"]);
  });

  it("fs-api is paid and always on, checks /healthz and migrates before deploy", () => {
    const api = svc("fs-api");
    expect(api?.plan).toBe("0.5c-512mb");
    expect(api?.healthCheckPath).toBe("/healthz");
    expect(api?.preDeployCommand).toBe("corepack pnpm --filter @fairsplit/db migrate");
    expect(api?.autoDeployTrigger).toBe("checksPass");
  });

  it("fs-db is paid Postgres 18", () => {
    expect(bp.databases?.[0]).toMatchObject({ plan: "0.1c-256mb", postgresMajorVersion: "18" });
  });

  it("fs-tasks and fs-cron start the entries apps/tasks builds", () => {
    for (const name of ["fs-tasks", "fs-cron"]) {
      const s = svc(name);
      const src = startCommandSource(s?.startCommand ?? "");
      expect(src, name).toBeDefined();
      expect(existsSync(join(REPO_ROOT, src as string)), src).toBe(true);
      expect(s?.buildCommand).toContain("--filter=@fairsplit/tasks...");
      expect(s?.buildCommand).toContain("--frozen-lockfile");
    }
  });

  it("fs-api learns the workflow slug from Render instead of hard-coding it", () => {
    expect(svc("fs-api")?.envVars).toContainEqual({
      key: "FS_TASKS_SLUG",
      fromService: { type: "workflow", name: "fs-tasks", property: "slug" },
    });
  });

  it("every secret is sync:false with no value; the cron holds no credentials", () => {
    for (const s of bp.services ?? []) {
      for (const v of s.envVars ?? [])
        if (v.sync === false) expect(v.value, `${s.name}.${v.key}`).toBeUndefined();
    }
    const cronKeys = (svc("fs-cron")?.envVars ?? []).map((v) => v.key ?? `group:${v.fromGroup}`);
    expect(cronKeys).toEqual(["group:fs-config", "DATABASE_URL"]);
  });

  it("the policy check flags a leaked secret, a free plan, a second region and a wrong schedule", () => {
    const bad = clone();
    const api = bad.services?.find((s) => s.name === "fs-api");
    api?.envVars?.push({ key: "ANTHROPIC_API_KEY", value: "sk-test-not-real" });
    if (api) api.plan = "free";
    const cron = bad.services?.find((s) => s.name === "fs-cron");
    if (cron) {
      cron.region = "oregon";
      cron.schedule = "0 * * * *";
    }
    bad.envVarGroups?.[0]?.envVars.push({ key: "PP_CLIENT_SECRET", value: "x" });
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/ANTHROPIC_API_KEY must not have a literal value/);
    expect(problems).toMatch(/paid, always-on/);
    expect(problems).toMatch(/one explicit region/);
    expect(problems).toMatch(/hourly at :07/);
    expect(problems).toMatch(/cannot live in a group/);
  });

  it("maps start commands to their sources", () => {
    expect(startCommandSource("node apps/tasks/dist/cron.js")).toBe("apps/tasks/src/cron.ts");
    expect(startCommandSource("pnpm start")).toBeUndefined();
  });
});
