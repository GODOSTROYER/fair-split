import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Blueprint,
  checkBuildFilters,
  checkPolicy,
  dependencyClosure,
  PINNED_NODE_VERSION,
  pathsCover,
  pinnedNodeVersion,
  REPO_ROOT,
  readBlueprint,
  readWorkspace,
  serviceRoots,
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

describe("render.yaml: Node pin", () => {
  it("NODE_VERSION is the repo pin (24.22.1; .node-version once WS-QA adds it)", () => {
    expect(PINNED_NODE_VERSION).toBe("24.22.1");
    const group = bp.envVarGroups?.find((g) => g.name === "fs-config");
    expect(group?.envVars.find((v) => v.key === "NODE_VERSION")?.value).toBe(pinnedNodeVersion());
  });

  it("the policy rejects the stale dev-machine version", () => {
    const bad = clone();
    const v = bad.envVarGroups?.[0]?.envVars.find((e) => e.key === "NODE_VERSION");
    if (v) v.value = "24.19.0";
    expect(checkPolicy(bad).join("\n")).toMatch(/NODE_VERSION must equal the 24\.22\.1 pin/);
  });
});

describe("render.yaml: database roles (S3.4, register §7)", () => {
  it("only the migrating service holds the owner connection, as DATABASE_OWNER_URL", () => {
    for (const s of bp.services ?? []) {
      const owner = s.envVars?.find((v) => v.key === "DATABASE_OWNER_URL");
      if (s.name === "fs-api")
        expect(owner?.fromDatabase).toEqual({ name: "fs-db", property: "connectionString" });
      else expect(owner, s.name).toBeUndefined();
    }
  });

  it("every running process connects as fs_app: DATABASE_URL is sync:false, never fromDatabase", () => {
    for (const name of ["fs-api", "fs-tasks", "fs-cron"]) {
      const url = svc(name)?.envVars?.find((v) => v.key === "DATABASE_URL");
      expect(url, name).toEqual({ key: "DATABASE_URL", sync: false });
    }
  });

  it("the policy fails when the app's DATABASE_URL is the owner connection string", () => {
    const bad = clone();
    const tasks = bad.services?.find((s) => s.name === "fs-tasks");
    const url = tasks?.envVars?.find((v) => v.key === "DATABASE_URL");
    if (url) {
      delete url.sync;
      url.fromDatabase = { name: "fs-db", property: "connectionString" };
    }
    const cron = bad.services?.find((s) => s.name === "fs-cron");
    cron?.envVars?.push({
      key: "DATABASE_OWNER_URL",
      fromDatabase: { name: "fs-db", property: "connectionString" },
    });
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-tasks: DATABASE_URL must be the fs_app role/);
    expect(problems).toMatch(/fs-cron: only a service that migrates may hold DATABASE_OWNER_URL/);
  });
});

describe("render.yaml: build filters follow the dependency closure", () => {
  it("passes the closure, cron-equals-tasks and fs-api rules", () => {
    expect(checkBuildFilters(bp)).toEqual([]);
  });

  it("derives each service's roots from its turbo filter and walks workspace: dependencies", () => {
    expect(serviceRoots(svc("fs-tasks") ?? { type: "", name: "" })).toEqual(["@fairsplit/tasks"]);
    const closure = dependencyClosure(["@fairsplit/tasks"], readWorkspace());
    expect(closure).toContain("apps/tasks");
    expect(closure).toContain("packages/contracts");
  });

  it("fs-cron rebuilds on everything fs-tasks does, including packages/domain and packages/seed", () => {
    const cron = svc("fs-cron")?.buildFilter?.paths ?? [];
    for (const p of svc("fs-tasks")?.buildFilter?.paths ?? []) expect(cron).toContain(p);
    expect(cron).toEqual(expect.arrayContaining(["packages/domain/**", "packages/seed/**"]));
  });

  it("fs-api rebuilds on apps/tasks (shared task policy until it moves to packages/outbox)", () => {
    expect(svc("fs-api")?.buildFilter?.paths).toContain("apps/tasks/**");
  });

  it("flags a path the closure needs but the filter misses (outbox → db → domain)", () => {
    const ws = new Map([
      ["@fairsplit/tasks", { name: "@fairsplit/tasks", dir: "apps/tasks", deps: ["@fairsplit/outbox"] }],
      ["@fairsplit/outbox", { name: "@fairsplit/outbox", dir: "packages/outbox", deps: ["@fairsplit/db"] }],
      ["@fairsplit/db", { name: "@fairsplit/db", dir: "packages/db", deps: ["@fairsplit/domain"] }],
      ["@fairsplit/domain", { name: "@fairsplit/domain", dir: "packages/domain", deps: [] }],
    ]);
    const bad = clone();
    for (const s of bad.services ?? []) {
      if (s.buildFilter?.paths)
        s.buildFilter.paths = s.buildFilter.paths.filter((p) => p !== "packages/domain/**");
    }
    const problems = checkBuildFilters(bad, ws);
    expect(problems).toContain("fs-tasks: buildFilter misses packages/domain/** (dependency closure)");
    expect(problems).toContain("fs-cron: buildFilter misses packages/domain/** (dependency closure)");
  });

  it("pathsCover understands nested globs", () => {
    expect(pathsCover(["packages/**"], "packages/db")).toBe(true);
    expect(pathsCover(["packages/db/**"], "packages/db")).toBe(true);
    expect(pathsCover(["packages/db/**"], "packages/dbx")).toBe(false);
    expect(pathsCover(["apps/api/**"], "apps/tasks")).toBe(false);
  });
});
