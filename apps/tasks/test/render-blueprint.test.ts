import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Blueprint,
  checkBuildFilters,
  checkDatabaseRoles,
  checkPolicy,
  checkSecrets,
  commandFiles,
  dependencyClosure,
  isSecretName,
  OWNER_URL_KEY,
  PINNED_NODE_VERSION,
  PP_MODES,
  pathsCover,
  pathsCoverFile,
  pinnedNodeVersion,
  REPO_ROOT,
  readBlueprint,
  readWorkspace,
  SECRETS_BY_SERVICE,
  type ServiceEntry,
  serviceRoots,
  startCommandSource,
  validateAgainstSchema,
} from "../../../tools/lib/blueprint.js";

const bp = readBlueprint();
const svc = (name: string) => bp.services?.find((s) => s.name === name);
const clone = (): Blueprint => structuredClone(bp);
const svcIn = (b: Blueprint, name: string) => b.services?.find((s) => s.name === name) as ServiceEntry;
const keys = (s: ServiceEntry | undefined) => (s?.envVars ?? []).map((v) => v.key);

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

  it("the schema rejects an unknown region, a typo'd field and an unknown database property", () => {
    const a = clone();
    if (a.databases?.[0]) a.databases[0].region = "mumbai";
    expect(validateAgainstSchema(a).length).toBeGreaterThan(0);
    const b = clone() as Blueprint & { services: Record<string, unknown>[] };
    (b.services[0] as Record<string, unknown>).healthcheckPath = "/healthz";
    expect(validateAgainstSchema(b).length).toBeGreaterThan(0);
    const c = clone();
    const host = svcIn(c, "fs-tasks").envVars?.find((v) => v.key === "FS_DB_HOST");
    if (host?.fromDatabase) host.fromDatabase.property = "hostname";
    expect(validateAgainstSchema(c).length).toBeGreaterThan(0);
  });
});

describe("render.yaml against Fair Split's deployment rules (approved S3.3, S3.13, S3.14)", () => {
  it("passes every rule", () => {
    expect(checkPolicy(bp)).toEqual([]);
  });

  it("declares exactly fs-api, fs-tasks, fs-cron and fs-db, in virginia, following the deploy branch", () => {
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
    expect(new Set(bp.services?.map((s) => s.branch))).toEqual(new Set(["deploy"]));
  });

  it("fs-api is paid and always on, checks /healthz, migrates before deploy and ends its build with the dist scan", () => {
    const api = svc("fs-api");
    expect(api?.plan).toBe("0.5c-512mb");
    expect(api?.healthCheckPath).toBe("/healthz");
    expect(api?.preDeployCommand).toBe("corepack pnpm --filter @fairsplit/db migrate");
    expect(api?.buildCommand).toMatch(/tools\/scan-dist\.ts$/);
    expect(api?.autoDeployTrigger).toBe("checksPass");
    expect(existsSync(join(REPO_ROOT, "tools/scan-dist.ts"))).toBe(true);
  });

  it("fs-db is paid Postgres 18", () => {
    expect(bp.databases?.[0]).toMatchObject({ plan: "0.1c-256mb", postgresMajorVersion: "18" });
  });

  it("fs-tasks starts the entry apps/tasks builds; fs-cron is a thin trigger with nothing to build", () => {
    const tasks = svc("fs-tasks");
    const src = startCommandSource(tasks?.startCommand ?? "");
    expect(src).toBe("apps/tasks/src/index.ts");
    expect(existsSync(join(REPO_ROOT, src as string))).toBe(true);
    expect(tasks?.buildCommand).toContain("--filter=@fairsplit/tasks...");
    expect(tasks?.buildCommand).toContain("--frozen-lockfile");
    const cron = svc("fs-cron");
    expect([cron?.buildCommand, cron?.startCommand]).toEqual(["true", "node tools/cron-tick.mjs"]);
    expect(existsSync(join(REPO_ROOT, "tools/cron-tick.mjs"))).toBe(true);
    expect(svcIn(bp, "fs-cron").envVars).toContainEqual({
      key: "FS_API_HOSTPORT",
      fromService: { type: "web", name: "fs-api", property: "hostport" },
    });
  });

  it("fs-api learns the workflow slug from Render instead of hard-coding it", () => {
    expect(svc("fs-api")?.envVars).toContainEqual({
      key: "FS_TASKS_SLUG",
      fromService: { type: "workflow", name: "fs-tasks", property: "slug" },
    });
  });

  it("every service carries the Node pin itself (there is no group to share it)", () => {
    expect(PINNED_NODE_VERSION).toBe("24.22.1");
    for (const s of bp.services ?? [])
      expect(s.envVars?.find((v) => v.key === "NODE_VERSION")?.value, s.name).toBe(pinnedNodeVersion());
    const bad = clone();
    const v = svcIn(bad, "fs-cron").envVars?.find((e) => e.key === "NODE_VERSION");
    if (v) v.value = "24.19.0";
    expect(checkPolicy(bad).join("\n")).toMatch(/fs-cron: NODE_VERSION must equal the 24\.22\.1 pin/);
  });

  it("the policy flags a free plan, a second region, a wrong schedule, a fat cron and another branch", () => {
    const bad = clone();
    svcIn(bad, "fs-api").plan = "free";
    const cron = svcIn(bad, "fs-cron");
    cron.region = "oregon";
    cron.schedule = "0 * * * *";
    cron.buildCommand = "corepack pnpm install --frozen-lockfile";
    svcIn(bad, "fs-tasks").branch = "main";
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/paid, always-on/);
    expect(problems).toMatch(/one explicit region/);
    expect(problems).toMatch(/hourly at :07/);
    expect(problems).toMatch(/fs-cron must be the thin trigger/);
    expect(problems).toMatch(/fs-tasks must follow the deploy branch/);
  });
});

describe("render.yaml: secrets (S3.13)", () => {
  it("there is no environment group, and the policy refuses one", () => {
    expect(bp.envVarGroups).toBeUndefined();
    const bad = clone();
    bad.envVarGroups = [{ name: "fs-config", envVars: [{ key: "LOG_LEVEL", value: "info" }] }];
    svcIn(bad, "fs-api").envVars?.push({ fromGroup: "fs-config" });
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/no envVarGroups/);
    expect(problems).toMatch(/fs-api: fromGroup fs-config/);
  });

  it("each service holds exactly the secrets S3.13 assigns it; fs-tasks holds no PayPal secret, fs-cron only CRON_SECRET", () => {
    expect(checkSecrets(bp)).toEqual([]);
    expect(keys(svc("fs-tasks")).filter((k) => k?.startsWith("PP_") && k !== "PP_ENV")).toEqual([]);
    expect(keys(svc("fs-cron"))).toEqual(["NODE_VERSION", "FS_API_HOSTPORT", "CRON_SECRET"]);
    expect(SECRETS_BY_SERVICE["fs-api"]?.generated).toEqual([
      "FS_APP_DB_PASSWORD",
      "STATEMENT_SIGNING_KEY",
      "COOKIE_KEY",
      "CRON_SECRET",
    ]);
    for (const s of bp.services ?? [])
      for (const v of s.envVars ?? [])
        if (v.sync === false) expect(v.value, `${s.name}.${v.key}`).toBeUndefined();
  });

  it("the YAML lint refuses a literal value for KEY, SECRET, TOKEN, PASSWORD or PP_ names (PP_ENV and PP_MODE excepted)", () => {
    expect(
      ["ANTHROPIC_API_KEY", "CRON_SECRET", "EXPO_PUSH_TOKEN", "FS_APP_DB_PASSWORD", "PP_RECEIVERS"].every(
        isSecretName,
      ),
    ).toBe(true);
    expect(
      ["PP_ENV", "PP_MODE", "NODE_VERSION", "FS_DB_HOST", "LOG_LEVEL", "FS_KILL"].some(isSecretName),
    ).toBe(false);
    const bad = clone();
    svcIn(bad, "fs-api").envVars?.push({ key: "PP_PAYER_EMAIL", value: "payer@example.test" });
    svcIn(bad, "fs-tasks").envVars?.push({ key: "ANTHROPIC_API_KEY", value: "sk-test-not-real" });
    const problems = checkSecrets(bad).join("\n");
    expect(problems).toMatch(/fs-api: PP_PAYER_EMAIL must not have a literal value/);
    expect(problems).toMatch(/fs-tasks: ANTHROPIC_API_KEY must not have a literal value/);
  });

  it("inv.i8.rail-in-repo: fs-api states its PayPal rail (ADR-0002), and only fs-api has one", () => {
    expect(svc("fs-api")?.envVars).toContainEqual({ key: "PP_MODE", value: "simulator" });
    expect(PP_MODES).toEqual(["simulator", "sandbox"]);
    for (const value of ["sandbox", "simulator"]) {
      const ok = clone();
      const mode = svcIn(ok, "fs-api").envVars?.find((v) => v.key === "PP_MODE");
      if (mode) mode.value = value;
      expect(checkPolicy(ok), value).toEqual([]);
    }
    const bad = clone();
    const api = svcIn(bad, "fs-api");
    const mode = api.envVars?.find((v) => v.key === "PP_MODE");
    if (mode) mode.value = "live";
    svcIn(bad, "fs-tasks").envVars?.push({ key: "PP_MODE", value: "simulator" });
    let problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-api must set PP_MODE to simulator or sandbox \(ADR-0002\)/);
    expect(problems).toMatch(/fs-tasks: makes no PayPal calls, so has no PP_MODE/);
    api.envVars = api.envVars?.filter((v) => v.key !== "PP_MODE");
    problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-api must set PP_MODE/);
  });

  it("the policy flags a PayPal secret on fs-tasks and a database credential on fs-cron", () => {
    const bad = clone();
    svcIn(bad, "fs-tasks").envVars?.push({ key: "PP_CLIENT_SECRET", sync: false });
    svcIn(bad, "fs-cron").envVars?.push({ key: "RENDER_API_KEY", sync: false });
    const problems = checkSecrets(bad).join("\n");
    expect(problems).toMatch(/fs-tasks: sync: false secrets must be exactly ANTHROPIC_API_KEY/);
    expect(problems).toMatch(/fs-cron: sync: false secrets must be exactly none/);
  });

  it("FS_KILL is sync: false on both executors, so one can't be left on while the other runs (S3.11)", () => {
    for (const name of ["fs-api", "fs-tasks"])
      expect(svc(name)?.envVars).toContainEqual({ key: "FS_KILL", sync: false });
    expect(keys(svc("fs-cron"))).not.toContain("FS_KILL");
    const bad = clone();
    const tasks = svcIn(bad, "fs-tasks");
    tasks.envVars = tasks.envVars?.filter((v) => v.key !== "FS_KILL");
    svcIn(bad, "fs-cron").envVars?.push({ key: "FS_KILL", sync: false });
    const problems = checkSecrets(bad).join("\n");
    expect(problems).toMatch(/fs-tasks: FS_KILL must be declared with sync: false on every executor/);
    expect(problems).toMatch(/fs-cron: runs no tasks, so holds no FS_KILL/);
  });
});

describe("render.yaml: database roles (S3.4, register §7)", () => {
  it("only fs-api sees the owner's credentials, as DATABASE_OWNER_URL for migrate, and generates fs_app's password", () => {
    expect(checkDatabaseRoles(bp)).toEqual([]);
    const api = svc("fs-api")?.envVars ?? [];
    expect(api).toContainEqual({
      key: OWNER_URL_KEY,
      fromDatabase: { name: "fs-db", property: "connectionString" },
    });
    expect(api).toContainEqual({ key: "FS_APP_DB_PASSWORD", generateValue: true });
    // packages/db's migrate refuses DATABASE_URL on Render; every boot builds fs_app's (db-env.ts).
    for (const s of bp.services ?? []) expect(keys(s), s.name).not.toContain("DATABASE_URL");
  });

  it("the policy fails when the migrating service exposes the owner as DATABASE_URL, or loses its owner URL", () => {
    const bad = clone();
    const api = svcIn(bad, "fs-api");
    api.envVars = api.envVars?.map((v) => (v.key === OWNER_URL_KEY ? { ...v, key: "DATABASE_URL" } : v));
    const problems = checkDatabaseRoles(bad).join("\n");
    expect(problems).toMatch(/fs-api: no DATABASE_URL in the Blueprint/);
    expect(problems).toMatch(/fs-api: migrations read the owner's DATABASE_OWNER_URL/);
    expect(problems).toMatch(/fs-api: the owner's credentials only as DATABASE_OWNER_URL/);
  });

  it("fs-tasks gets only the host, port and name plus fs_app's password from fs-api; fs-cron no database at all", () => {
    const tasks = svc("fs-tasks")?.envVars ?? [];
    for (const [key, property] of [
      ["FS_DB_HOST", "host"],
      ["FS_DB_PORT", "port"],
      ["FS_DB_NAME", "database"],
    ])
      expect(tasks).toContainEqual({ key, fromDatabase: { name: "fs-db", property } });
    expect(tasks).toContainEqual({
      key: "FS_APP_DB_PASSWORD",
      fromService: { type: "web", name: "fs-api", envVarKey: "FS_APP_DB_PASSWORD" },
    });
    expect(tasks.some((v) => v.key === "DATABASE_URL")).toBe(false);
    expect((svc("fs-cron")?.envVars ?? []).some((v) => v.fromDatabase || v.key === "DATABASE_URL")).toBe(
      false,
    );
  });

  it("the policy fails when a non-migrating service could connect as the owner", () => {
    const bad = clone();
    const tasks = svcIn(bad, "fs-tasks");
    tasks.envVars?.push({
      key: "DATABASE_URL",
      fromDatabase: { name: "fs-db", property: "connectionString" },
    });
    tasks.envVars?.push({ key: "PGPASSWORD", fromDatabase: { name: "fs-db", property: "password" } });
    tasks.envVars?.push({ key: OWNER_URL_KEY, sync: false });
    const api = svcIn(bad, "fs-api");
    api.envVars = api.envVars?.filter((v) => v.key !== "FS_APP_DB_PASSWORD");
    const problems = checkDatabaseRoles(bad).join("\n");
    expect(problems).toMatch(/fs-tasks: DATABASE_URL carries the owner's connectionString; only fs-api may/);
    expect(problems).toMatch(/fs-tasks: PGPASSWORD carries the owner's password/);
    expect(problems).toMatch(/fs-tasks: no DATABASE_URL/);
    expect(problems).toMatch(
      /fs-tasks: no DATABASE_OWNER_URL; only the migrating service holds the owner's URL/,
    );
    expect(problems).toMatch(/fs-api: FS_APP_DB_PASSWORD must be generated here/);
  });
});

describe("render.yaml: build filters", () => {
  it("cover each service's dependency closure and every file its commands run", () => {
    expect(checkBuildFilters(bp)).toEqual([]);
    expect(commandFiles(svcIn(bp, "fs-api"))).toEqual(["tools/scan-dist.ts"]);
    expect(commandFiles(svcIn(bp, "fs-cron"))).toEqual(["tools/cron-tick.mjs"]);
  });

  it("derives each service's roots from its turbo filter and walks workspace: dependencies", () => {
    expect(serviceRoots(svcIn(bp, "fs-tasks"))).toEqual(["@fairsplit/tasks"]);
    const closure = dependencyClosure(["@fairsplit/tasks"], readWorkspace());
    expect(closure).toContain("apps/tasks");
    expect(closure).toContain("packages/contracts");
  });

  it("fs-api rebuilds on apps/tasks (the executor lanes must match its dispatcher)", () => {
    expect(svc("fs-api")?.buildFilter?.paths).toContain("apps/tasks/**");
  });

  it("flags a path the closure needs but the filter misses (outbox → db → domain), and an unwatched script", () => {
    const ws = new Map([
      ["@fairsplit/tasks", { name: "@fairsplit/tasks", dir: "apps/tasks", deps: ["@fairsplit/outbox"] }],
      ["@fairsplit/outbox", { name: "@fairsplit/outbox", dir: "packages/outbox", deps: ["@fairsplit/db"] }],
      ["@fairsplit/db", { name: "@fairsplit/db", dir: "packages/db", deps: ["@fairsplit/domain"] }],
      ["@fairsplit/domain", { name: "@fairsplit/domain", dir: "packages/domain", deps: [] }],
    ]);
    const bad = clone();
    for (const s of bad.services ?? []) {
      if (s.buildFilter?.paths)
        s.buildFilter.paths = s.buildFilter.paths.filter(
          (p) => p !== "packages/domain/**" && p !== "tools/cron-tick.mjs",
        );
    }
    svcIn(bad, "fs-cron").buildFilter = { paths: ["render.yaml"] };
    const problems = checkBuildFilters(bad, ws);
    expect(problems).toContain("fs-tasks: buildFilter misses packages/domain/** (dependency closure)");
    expect(problems).toContain("fs-cron: buildFilter misses tools/cron-tick.mjs (run by its commands)");
  });

  it("pathsCover and pathsCoverFile understand nested globs and single files", () => {
    expect(pathsCover(["packages/**"], "packages/db")).toBe(true);
    expect(pathsCover(["packages/db/**"], "packages/db")).toBe(true);
    expect(pathsCover(["packages/db/**"], "packages/dbx")).toBe(false);
    expect(pathsCover(["apps/api/**"], "apps/tasks")).toBe(false);
    expect(pathsCoverFile(["tools/cron-tick.mjs"], "tools/cron-tick.mjs")).toBe(true);
    expect(pathsCoverFile(["tools/**"], "tools/cron-tick.mjs")).toBe(true);
    expect(pathsCoverFile(["tools/lib/**"], "tools/cron-tick.mjs")).toBe(false);
  });

  it("maps start commands to their sources", () => {
    expect(startCommandSource("node apps/tasks/dist/cron.js")).toBe("apps/tasks/src/cron.ts");
    expect(startCommandSource("pnpm start")).toBeUndefined();
  });
});
