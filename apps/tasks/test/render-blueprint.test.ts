import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_DEPLOY_TRIGGER,
  type Blueprint,
  checkBuildFilters,
  checkDatabaseRoles,
  checkIgnoredPaths,
  checkPolicy,
  checkSecrets,
  commandFiles,
  DEPLOY_BRANCH,
  dependencyClosure,
  globToRegExp,
  isSecretName,
  isTestOrReadme,
  MEDIA_PUBLIC_DIR,
  matchesAny,
  OWNER_URL_KEY,
  PINNED_NODE_VERSION,
  PP_MODES,
  pathsCover,
  pathsCoverFile,
  pinnedNodeVersion,
  REPO_ROOT,
  RUNTIME_ASSETS,
  readBlueprint,
  readWorkspace,
  SANDBOX_SYNC_FALSE,
  SECRETS_BY_SERVICE,
  type ServiceEntry,
  serviceRoots,
  simulatorPayPalValues,
  startCommandSource,
  trackedFiles,
  validateAgainstSchema,
  watches,
} from "../../../tools/lib/blueprint.js";

const bp = readBlueprint();
const svc = (name: string) => bp.services?.find((s) => s.name === name);
const clone = (): Blueprint => structuredClone(bp);
const svcIn = (b: Blueprint, name: string) => b.services?.find((s) => s.name === name) as ServiceEntry;
const keys = (s: ServiceEntry | undefined) => (s?.envVars ?? []).map((v) => v.key);
const envIn = (s: ServiceEntry, key: string) => s.envVars?.find((v) => v.key === key);

/** A workflow, for the schema's workflow rules and the database-parts rule (render.yaml no longer has one). */
const workflow = (): ServiceEntry => ({
  type: "workflow",
  name: "fs-extra",
  runtime: "node",
  region: "virginia",
  branch: "main",
  buildCommand: "true",
  startCommand: "node x.js",
});

/** The variable names fs-api's env.ts parses (its zod `Raw` object, one `NAME:` per line). */
const ENV_TS_NAMES = new Set(
  [...readFileSync(join(REPO_ROOT, "apps/api/src/env.ts"), "utf8").matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(
    (m) => m[1] as string,
  ),
);

describe("render.yaml against Render's published Blueprint schema", () => {
  it("is valid", () => {
    expect(validateAgainstSchema(bp)).toEqual([]);
  });

  it("the schema catches what Render would reject (workflow plan, preDeployCommand, health check)", () => {
    const ok = clone();
    ok.services?.push(workflow());
    expect(validateAgainstSchema(ok)).toEqual([]);
    for (const key of ["plan", "preDeployCommand", "healthCheckPath"] as const) {
      const bad = clone();
      const wf = workflow();
      wf[key] = key === "plan" ? "flex" : "/x";
      bad.services?.push(wf);
      expect(validateAgainstSchema(bad).length, key).toBeGreaterThan(0);
    }
  });

  it("the schema rejects an unknown region, a typo'd field, an unknown database property and a trigger", () => {
    const a = clone();
    if (a.databases?.[0]) a.databases[0].region = "mumbai";
    expect(validateAgainstSchema(a).length).toBeGreaterThan(0);
    const b = clone() as Blueprint & { services: Record<string, unknown>[] };
    (b.services[0] as Record<string, unknown>).healthcheckPath = "/healthz";
    expect(validateAgainstSchema(b).length).toBeGreaterThan(0);
    const c = clone();
    const owner = envIn(svcIn(c, "fs-api"), OWNER_URL_KEY);
    if (owner?.fromDatabase) owner.fromDatabase.property = "hostname";
    expect(validateAgainstSchema(c).length).toBeGreaterThan(0);
    const d = clone();
    svcIn(d, "fs-cron").autoDeployTrigger = "manual";
    expect(validateAgainstSchema(d).length).toBeGreaterThan(0);
  });

  it("states autoDeployTrigger as the string off (YAML 1.1 parsers would read a bare off as false)", () => {
    const text = readFileSync(join(REPO_ROOT, "render.yaml"), "utf8");
    expect(text.match(/autoDeployTrigger: .*/g)).toEqual([
      'autoDeployTrigger: "off"',
      'autoDeployTrigger: "off"',
    ]);
  });
});

describe("render.yaml against Fair Split's deployment rules (approved S3.3, S3.13, S3.14; D6)", () => {
  it("passes every rule", () => {
    expect(checkPolicy(bp)).toEqual([]);
  });

  it("declares exactly fs-api, fs-cron and fs-db, in virginia, following main with automatic deploys off", () => {
    expect(bp.services?.map((s) => `${s.type}:${s.name}`)).toEqual(["web:fs-api", "cron:fs-cron"]);
    expect(bp.databases?.map((d) => d.name)).toEqual(["fs-db"]);
    const regions = new Set([
      ...(bp.services ?? []).map((s) => s.region),
      ...(bp.databases ?? []).map((d) => d.region),
    ]);
    expect([...regions]).toEqual(["virginia"]);
    expect([DEPLOY_BRANCH, AUTO_DEPLOY_TRIGGER]).toEqual(["main", "off"]);
    for (const s of bp.services ?? [])
      expect([s.branch, s.autoDeployTrigger], s.name).toEqual(["main", "off"]);
  });

  it("fs-api is paid and always on, checks /healthz, migrates before deploy, assembles /media, ends with the dist scan", () => {
    const api = svcIn(bp, "fs-api");
    expect(api.plan).toBe("0.5c-512mb");
    expect(api.healthCheckPath).toBe("/healthz");
    expect(api.preDeployCommand).toBe("corepack pnpm --filter @fairsplit/db migrate");
    expect(api.startCommand).toBe(
      "node --max-old-space-size=192 --max-semi-space-size=8 apps/api/dist/index.js",
    );
    expect(api.buildCommand).toMatch(
      /corepack pnpm exec tsx tools\/assemble-media\.ts && corepack pnpm exec tsx tools\/scan-dist\.ts$/,
    );
    expect(envIn(api, "STATIC_MEDIA_DIR")?.value).toBe(MEDIA_PUBLIC_DIR);
    expect(MEDIA_PUBLIC_DIR).toBe("apps/api/dist/media");
    for (const f of ["tools/scan-dist.ts", "tools/assemble-media.ts"])
      expect(existsSync(join(REPO_ROOT, f)), f).toBe(true);
  });

  it("every task runs inline in fs-api (EXECUTOR=inline): no fs-tasks, no workflow slug, no Render API key", () => {
    const api = svcIn(bp, "fs-api");
    expect(envIn(api, "EXECUTOR")?.value).toBe("inline");
    expect(keys(api)).not.toContain("FS_TASKS_SLUG");
    expect(keys(api)).not.toContain("RENDER_API_KEY");
    const bad = clone();
    const exec = envIn(svcIn(bad, "fs-api"), "EXECUTOR");
    if (exec) exec.value = "workflow";
    bad.services?.push(workflow());
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-api must set EXECUTOR=inline/);
    expect(problems).toMatch(/unexpected service fs-extra \(every task runs inline in fs-api\)/);
  });

  it("the policy refuses a build that skips assemble-media, runs it after the scan, or serves another folder", () => {
    for (const [build, dir] of [
      ["corepack pnpm turbo run build && corepack pnpm exec tsx tools/scan-dist.ts", MEDIA_PUBLIC_DIR],
      [
        "corepack pnpm exec tsx tools/scan-dist.ts && corepack pnpm exec tsx tools/assemble-media.ts",
        MEDIA_PUBLIC_DIR,
      ],
      [svcIn(bp, "fs-api").buildCommand as string, "media"],
    ] as const) {
      const bad = clone();
      const api = svcIn(bad, "fs-api");
      api.buildCommand = build;
      const media = envIn(api, "STATIC_MEDIA_DIR");
      if (media) media.value = dir;
      const problems = checkPolicy(bad).join("\n");
      if (dir === "media")
        expect(problems).toMatch(/fs-api must set STATIC_MEDIA_DIR=apps\/api\/dist\/media/);
      else expect(problems).toMatch(/must run tools\/assemble-media\.ts before tools\/scan-dist\.ts/);
    }
  });

  it("fs-db is paid Postgres 18", () => {
    expect(bp.databases?.[0]).toMatchObject({ plan: "0.1c-256mb", postgresMajorVersion: "18" });
  });

  it("fs-api starts the entry apps/api builds; fs-cron is a thin trigger with nothing to build", () => {
    const api = svcIn(bp, "fs-api");
    expect(api.buildCommand).toContain("--filter=@fairsplit/api...");
    expect(api.buildCommand).toContain("--frozen-lockfile");
    expect(existsSync(join(REPO_ROOT, "apps/api/src/index.ts"))).toBe(true);
    const cron = svc("fs-cron");
    expect([cron?.buildCommand, cron?.startCommand]).toEqual(["true", "node tools/cron-tick.mjs"]);
    expect(existsSync(join(REPO_ROOT, "tools/cron-tick.mjs"))).toBe(true);
    expect(svcIn(bp, "fs-cron").envVars).toContainEqual({
      key: "FS_API_HOSTPORT",
      fromService: { type: "web", name: "fs-api", property: "hostport" },
    });
  });

  it("every service carries the Node pin itself (there is no group to share it)", () => {
    // 24.22.1 was published on 20 Oct 2026, under the 14-day rule; CI and docs/versions.md pin 24.19.0.
    expect(PINNED_NODE_VERSION).toBe("24.19.0");
    for (const s of bp.services ?? [])
      expect(s.envVars?.find((v) => v.key === "NODE_VERSION")?.value, s.name).toBe(pinnedNodeVersion());
    const bad = clone();
    const v = svcIn(bad, "fs-cron").envVars?.find((e) => e.key === "NODE_VERSION");
    if (v) v.value = "24.22.1";
    expect(checkPolicy(bad).join("\n")).toMatch(/fs-cron: NODE_VERSION must equal the 24\.19\.0 pin/);
  });

  it("the policy flags a free plan, a second region, a wrong schedule, a fat cron, another branch and auto-deploy", () => {
    const bad = clone();
    svcIn(bad, "fs-api").plan = "free";
    svcIn(bad, "fs-api").autoDeployTrigger = "checksPass";
    const cron = svcIn(bad, "fs-cron");
    cron.region = "oregon";
    cron.schedule = "0 * * * *";
    cron.buildCommand = "corepack pnpm install --frozen-lockfile";
    cron.branch = "deploy";
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/paid, always-on/);
    expect(problems).toMatch(/one explicit region/);
    expect(problems).toMatch(/hourly at :07/);
    expect(problems).toMatch(/fs-cron must be the thin trigger/);
    expect(problems).toMatch(/fs-cron must follow the main branch/);
    expect(problems).toMatch(/fs-api must set autoDeployTrigger: off \(deploys are manual\)/);
  });

  it("K1a: /app targets same-origin fs-api; the runtime waits for an IC-12 token before switching frames", () => {
    for (const s of bp.services ?? []) {
      expect(
        keys(s).filter((k) => k?.startsWith("EXPO_PUBLIC_")),
        s.name,
      ).toEqual([]);
      expect(s.buildCommand ?? "", s.name).not.toContain("EXPO_PUBLIC_API_ORIGIN");
    }
    const exporter = readFileSync(join(REPO_ROOT, "apps/mobile/scripts/export-web.mjs"), "utf8");
    expect(exporter).toMatch(/EXPO_PUBLIC_API_ORIGIN:\s*"same-origin"/);
  });

  it("fs-api's public origin is the one Render gives it (RENDER_EXTERNAL_URL): no PUBLIC_ORIGIN is pinned", () => {
    expect(keys(svc("fs-api"))).not.toContain("PUBLIC_ORIGIN");
    expect(ENV_TS_NAMES.has("RENDER_EXTERNAL_URL")).toBe(true);
  });
});

describe("render.yaml: secrets (S3.13)", () => {
  it("H1: Render prompts for exactly the links and ledger seeds, the operator hash, the judge code and FS_KILL", () => {
    const prompted = (bp.services ?? []).flatMap((s) =>
      (s.envVars ?? []).filter((v) => v.sync === false).map((v) => v.key),
    );
    expect(new Set(prompted)).toEqual(
      new Set([
        "FS_LINK_SIGNING_KEY",
        "FS_LEDGER_SIGNING_KEY",
        "FS_OPERATOR_PASSWORD_SCRYPT",
        "JUDGE_CODE_SHA256",
        "FS_KILL",
      ]),
    );
    expect(prompted).toHaveLength(5);
  });

  it("fs-api generates its cookie secret, the cron secret and fs_app's password; fs-cron shares CRON_SECRET", () => {
    expect(SECRETS_BY_SERVICE["fs-api"]?.generated).toEqual([
      "FS_APP_DB_PASSWORD",
      "FS_COOKIE_SECRET",
      "CRON_SECRET",
    ]);
    const api = svcIn(bp, "fs-api");
    for (const key of ["FS_APP_DB_PASSWORD", "FS_COOKIE_SECRET", "CRON_SECRET"])
      expect(envIn(api, key), key).toEqual({ key, generateValue: true });
    expect(keys(svc("fs-cron"))).toEqual(["NODE_VERSION", "FS_API_HOSTPORT", "CRON_SECRET"]);
    expect(checkSecrets(bp)).toEqual([]);
    for (const s of bp.services ?? [])
      for (const v of s.envVars ?? [])
        if (v.sync === false) expect(v.value, `${s.name}.${v.key}`).toBeUndefined();
  });

  it("H1: fs-api's names are the ones env.ts reads; the WS-OPS names and the unneeded keys are gone", () => {
    // Read by the platform, the entry's useAppDatabaseUrl or migrate, not by env.ts.
    const notEnvTs = new Set([
      "NODE_VERSION",
      "COREPACK_ENABLE_DOWNLOAD_PROMPT",
      "TZ",
      OWNER_URL_KEY,
      "FS_APP_DB_PASSWORD",
    ]);
    for (const key of keys(svc("fs-api")))
      if (key && !notEnvTs.has(key))
        expect(ENV_TS_NAMES.has(key), `${key} is not read by apps/api/src/env.ts`).toBe(true);
    for (const gone of [
      "COOKIE_KEY",
      "STATEMENT_SIGNING_KEY",
      "OPS_PASSWORD_SCRYPT",
      "ANTHROPIC_API_KEY",
      "RENDER_API_KEY",
      "EXPO_PUSH_TOKEN",
      "FS_TASKS_SLUG",
    ])
      for (const s of bp.services ?? []) expect(keys(s), `${s.name}.${gone}`).not.toContain(gone);
  });

  it("there is no environment group, and the policy refuses one", () => {
    expect(bp.envVarGroups).toBeUndefined();
    const bad = clone();
    bad.envVarGroups = [{ name: "fs-config", envVars: [{ key: "LOG_LEVEL", value: "info" }] }];
    svcIn(bad, "fs-api").envVars?.push({ fromGroup: "fs-config" });
    const problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/no envVarGroups/);
    expect(problems).toMatch(/fs-api: fromGroup fs-config/);
  });

  it("the YAML lint refuses a literal value for KEY, SECRET, TOKEN, PASSWORD or PP_ names (PP_ENV and PP_MODE excepted)", () => {
    expect(
      ["ANTHROPIC_API_KEY", "CRON_SECRET", "EXPO_PUSH_TOKEN", "FS_APP_DB_PASSWORD", "PP_RECEIVERS"].every(
        isSecretName,
      ),
    ).toBe(true);
    expect(
      ["PP_ENV", "PP_MODE", "NODE_VERSION", "STATIC_MEDIA_DIR", "LOG_LEVEL", "FS_KILL"].some(isSecretName),
    ).toBe(false);
    const bad = clone();
    svcIn(bad, "fs-api").envVars?.push({ key: "PP_WEBHOOK_ID", value: "WH-not-a-simulator-value" });
    svcIn(bad, "fs-cron").envVars?.push({ key: "ANTHROPIC_API_KEY", value: "sk-test-not-real" });
    const link = envIn(svcIn(bad, "fs-api"), "FS_LINK_SIGNING_KEY");
    if (link) Object.assign(link, { sync: undefined, value: "ab".repeat(32) });
    const problems = checkSecrets(bad).join("\n");
    expect(problems).toMatch(/fs-api: PP_WEBHOOK_ID must not have a literal value/);
    expect(problems).toMatch(/fs-cron: ANTHROPIC_API_KEY must not have a literal value/);
    expect(problems).toMatch(/fs-api: FS_LINK_SIGNING_KEY must not have a literal value/);
  });

  it("on the simulated rail fs-api's PP_* are the simulator's committed fs-judge values, each checked (ADR-0002)", () => {
    const sim = simulatorPayPalValues();
    expect(Object.keys(sim)).toEqual([
      "PP_CLIENT_ID",
      "PP_CLIENT_SECRET",
      "PP_BUSINESS_EMAIL",
      "PP_PAYER_EMAIL",
      "PP_RECEIVERS",
      "PP_UNCLAIMED_RECEIVER",
    ]);
    expect(sim.PP_CLIENT_ID).toBe("SIM-fs-judge-client");
    expect(sim.PP_RECEIVERS?.split(",").map((p) => p.split("=")[0])).toEqual([
      "M-002",
      "M-007",
      "M-014",
      "M-018",
      "M-022",
      "M-039",
      "M-060",
    ]);
    for (const value of Object.values(sim).flatMap((v) => v.split(/[,=]/)))
      if (value.includes("@")) expect(value, "the simulator's reserved domain").toMatch(/@example\.org$/);
    const api = svcIn(bp, "fs-api");
    for (const [key, value] of Object.entries(sim)) expect(envIn(api, key), key).toEqual({ key, value });
    expect(keys(api).filter((k) => k?.startsWith("PP_"))).toEqual(["PP_ENV", "PP_MODE", ...Object.keys(sim)]);

    const changed = clone();
    const id = envIn(svcIn(changed, "fs-api"), "PP_CLIENT_ID");
    if (id) id.value = "SIM-fs-dev-client";
    const prompted = envIn(svcIn(changed, "fs-api"), "PP_CLIENT_SECRET");
    if (prompted) Object.assign(prompted, { value: undefined, sync: false });
    const gone = svcIn(changed, "fs-api");
    gone.envVars = gone.envVars?.filter((v) => v.key !== "PP_UNCLAIMED_RECEIVER");
    const problems = checkSecrets(changed).join("\n");
    expect(problems).toMatch(/fs-api: PP_CLIENT_ID must be the simulator's committed value \(fs-judge/);
    expect(problems).toMatch(/fs-api: PP_CLIENT_SECRET must be the simulator's committed value/);
    expect(problems).toMatch(/fs-api: PP_MODE=simulator needs PP_UNCLAIMED_RECEIVER/);
  });

  it("inv.i8.rail-in-repo: fs-api states its PayPal rail (ADR-0002), and only fs-api has one", () => {
    expect(svc("fs-api")?.envVars).toContainEqual({ key: "PP_MODE", value: "simulator" });
    expect(PP_MODES).toEqual(["simulator", "sandbox"]);
    const bad = clone();
    const api = svcIn(bad, "fs-api");
    const mode = api.envVars?.find((v) => v.key === "PP_MODE");
    if (mode) mode.value = "live";
    svcIn(bad, "fs-cron").envVars?.push({ key: "PP_MODE", value: "simulator" });
    let problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-api must set PP_MODE to simulator or sandbox \(ADR-0002\)/);
    expect(problems).toMatch(/fs-cron: makes no PayPal calls, so has no PP_MODE/);
    api.envVars = api.envVars?.filter((v) => v.key !== "PP_MODE");
    problems = checkPolicy(bad).join("\n");
    expect(problems).toMatch(/fs-api must set PP_MODE/);
  });

  it("PP_MODE=sandbox (untested) needs the real app's values prompted for, never the simulator's literals", () => {
    const flipped = clone();
    const mode = envIn(svcIn(flipped, "fs-api"), "PP_MODE");
    if (mode) mode.value = "sandbox";
    const problems = checkSecrets(flipped).join("\n");
    expect(problems).toMatch(/fs-api: PP_CLIENT_SECRET must not have a literal value/);
    expect(problems).toMatch(
      /fs-api: sync: false secrets must be exactly .*PP_CLIENT_ID, PP_CLIENT_SECRET, PP_WEBHOOK_ID/,
    );
    const sandbox = svcIn(flipped, "fs-api");
    sandbox.envVars = [
      ...(sandbox.envVars ?? []).filter(
        (v) => !v.key?.startsWith("PP_") || v.key === "PP_ENV" || v.key === "PP_MODE",
      ),
      ...SANDBOX_SYNC_FALSE.map((key) => ({ key, sync: false })),
    ];
    expect(checkSecrets(flipped)).toEqual([]);
  });

  it("the policy flags a PayPal secret or a prompt on fs-cron", () => {
    const bad = clone();
    svcIn(bad, "fs-cron").envVars?.push({ key: "PP_CLIENT_SECRET", sync: false });
    svcIn(bad, "fs-cron").envVars?.push({ key: "RENDER_API_KEY", sync: false });
    expect(checkSecrets(bad).join("\n")).toMatch(/fs-cron: sync: false secrets must be exactly none/);
  });

  it("FS_KILL is sync: false on fs-api, the one executor, and absent from fs-cron (S3.11)", () => {
    expect(svc("fs-api")?.envVars).toContainEqual({ key: "FS_KILL", sync: false });
    expect(keys(svc("fs-cron"))).not.toContain("FS_KILL");
    const bad = clone();
    const api = svcIn(bad, "fs-api");
    api.envVars = api.envVars?.filter((v) => v.key !== "FS_KILL");
    svcIn(bad, "fs-cron").envVars?.push({ key: "FS_KILL", sync: false });
    const problems = checkSecrets(bad).join("\n");
    expect(problems).toMatch(/fs-api: FS_KILL must be declared with sync: false on every executor/);
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
    // packages/db's migrate refuses DATABASE_URL on Render; fs-api's entry builds fs_app's (useAppDatabaseUrl).
    for (const s of bp.services ?? []) expect(keys(s), s.name).not.toContain("DATABASE_URL");
    expect((svc("fs-cron")?.envVars ?? []).some((v) => v.fromDatabase || v.key === "DATABASE_URL")).toBe(
      false,
    );
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

  it("another service with database access would get only fs-db's host, port and name plus fs_app's password", () => {
    const ok = clone();
    const extra = workflow();
    extra.envVars = [
      { key: "FS_DB_HOST", fromDatabase: { name: "fs-db", property: "host" } },
      { key: "FS_DB_PORT", fromDatabase: { name: "fs-db", property: "port" } },
      { key: "FS_DB_NAME", fromDatabase: { name: "fs-db", property: "database" } },
      {
        key: "FS_APP_DB_PASSWORD",
        fromService: { type: "web", name: "fs-api", envVarKey: "FS_APP_DB_PASSWORD" },
      },
    ];
    ok.services?.push(extra);
    expect(checkDatabaseRoles(ok)).toEqual([]);
    expect(validateAgainstSchema(ok)).toEqual([]);
  });

  it("the policy fails when a non-migrating service could connect as the owner", () => {
    const bad = clone();
    const cron = svcIn(bad, "fs-cron");
    cron.envVars?.push({
      key: "DATABASE_URL",
      fromDatabase: { name: "fs-db", property: "connectionString" },
    });
    cron.envVars?.push({ key: "PGPASSWORD", fromDatabase: { name: "fs-db", property: "password" } });
    cron.envVars?.push({ key: OWNER_URL_KEY, sync: false });
    const api = svcIn(bad, "fs-api");
    api.envVars = api.envVars?.filter((v) => v.key !== "FS_APP_DB_PASSWORD");
    const problems = checkDatabaseRoles(bad).join("\n");
    expect(problems).toMatch(/fs-cron: DATABASE_URL carries the owner's connectionString; only fs-api may/);
    expect(problems).toMatch(/fs-cron: PGPASSWORD carries the owner's password/);
    expect(problems).toMatch(/fs-cron: no DATABASE_URL/);
    expect(problems).toMatch(
      /fs-cron: no DATABASE_OWNER_URL; only the migrating service holds the owner's URL/,
    );
    expect(problems).toMatch(/fs-cron: FS_DB_HOST must come from fs-db's host/);
    expect(problems).toMatch(/fs-api: FS_APP_DB_PASSWORD must be generated here/);
  });

  it("fs-db accepts no external connection, so an owner URL read back from fs-api's environment is useless outside Render (ADR-0005)", () => {
    expect(bp.databases?.find((d) => d.name === "fs-db")?.ipAllowList).toEqual([]);
    expect(validateAgainstSchema(bp)).toEqual([]);
    const RULE = "fs-db must set ipAllowList: [] (private network only; ADR-0005)";
    const omitted = clone();
    const db = omitted.databases?.find((d) => d.name === "fs-db");
    if (db) delete db.ipAllowList;
    expect(checkPolicy(omitted)).toContain(RULE);
    const opened = clone();
    for (const d of opened.databases ?? [])
      d.ipAllowList = [{ source: "0.0.0.0/0", description: "anywhere" }];
    expect(validateAgainstSchema(opened)).toEqual([]);
    expect(checkPolicy(opened)).toContain(RULE);
  });
});

describe("render.yaml: build filters", () => {
  it("cover each service's dependency closure and every file its commands run", () => {
    expect(checkBuildFilters(bp)).toEqual([]);
    expect(commandFiles(svcIn(bp, "fs-api"))).toEqual(["tools/assemble-media.ts", "tools/scan-dist.ts"]);
    expect(commandFiles(svcIn(bp, "fs-cron"))).toEqual(["tools/cron-tick.mjs"]);
  });

  it("derives each service's roots from its turbo filter and walks workspace: dependencies", () => {
    expect(serviceRoots(svcIn(bp, "fs-api"))).toEqual([
      "@fairsplit/api",
      "@fairsplit/console",
      "@fairsplit/mobile",
    ]);
    const closure = dependencyClosure(["@fairsplit/api"], readWorkspace());
    expect(closure).toContain("apps/api");
    expect(closure).toContain("packages/db");
  });

  it("flags a path the closure needs but the filter misses (outbox → db → domain), and an unwatched script", () => {
    const ws = new Map([
      ["@fairsplit/api", { name: "@fairsplit/api", dir: "apps/api", deps: ["@fairsplit/outbox"] }],
      ["@fairsplit/outbox", { name: "@fairsplit/outbox", dir: "packages/outbox", deps: ["@fairsplit/db"] }],
      ["@fairsplit/db", { name: "@fairsplit/db", dir: "packages/db", deps: ["@fairsplit/domain"] }],
      ["@fairsplit/domain", { name: "@fairsplit/domain", dir: "packages/domain", deps: [] }],
    ]);
    const bad = clone();
    const api = svcIn(bad, "fs-api");
    if (api.buildFilter)
      api.buildFilter.paths = ["apps/api/**", "packages/outbox/**", "packages/db/**", "tools/scan-dist.ts"];
    svcIn(bad, "fs-cron").buildFilter = { paths: ["render.yaml"] };
    const problems = checkBuildFilters(bad, ws);
    expect(problems).toContain("fs-api: buildFilter misses packages/domain/** (dependency closure)");
    expect(problems).toContain("fs-api: buildFilter misses tools/assemble-media.ts (run by its commands)");
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
    expect(startCommandSource("node apps/api/dist/index.js")).toBe("apps/api/src/index.ts");
    expect(
      startCommandSource("node --max-old-space-size=128 --max-semi-space-size=8 apps/api/dist/index.js"),
    ).toBe("apps/api/src/index.ts");
    expect(startCommandSource("node apps/tasks/dist/cron.js")).toBe("apps/tasks/src/cron.ts");
    expect(startCommandSource("pnpm start")).toBeUndefined();
  });
});

describe("render.yaml: ignoredPaths never skip what a service reads at runtime", () => {
  const PROMPT = "packages/ai/src/read/prompts/a.v1.md";

  it("a commit that changes only a prompt, a migration or the seed snapshot redeploys fs-api", () => {
    expect(checkIgnoredPaths(bp)).toEqual([]);
    for (const asset of RUNTIME_ASSETS) expect(watches(svcIn(bp, "fs-api"), asset), asset).toBe(true);
  });

  it("no runtime asset path under packages/** is matched by any service's ignoredPaths", () => {
    expect(RUNTIME_ASSETS.every((a) => a.startsWith("packages/"))).toBe(true);
    for (const s of bp.services ?? [])
      for (const asset of RUNTIME_ASSETS)
        expect(matchesAny(s.buildFilter?.ignoredPaths ?? [], asset), `${s.name} ignores ${asset}`).toBe(
          false,
        );
  });

  it("tests and READMEs still don't redeploy anything", () => {
    for (const file of ["apps/api/README.md", "apps/api/src/env.test.ts", "packages/db/test/x.test.ts"])
      expect(watches(svcIn(bp, "fs-api"), file), file).toBe(false);
  });

  it("the policy refuses the old `**/*.md` filter, and globs over migrations or the snapshot", () => {
    const bad = clone();
    svcIn(bad, "fs-api").buildFilter?.ignoredPaths?.push("**/*.md", "packages/db/migrations/**", "**/*.json");
    const problems = checkPolicy(bad);
    expect(problems).toContain(`fs-api: ignoredPaths skips ${PROMPT}, a file read at runtime`);
    expect(problems).toContain(
      "fs-api: ignoredPaths skips packages/db/migrations/0001_schema.sql, a file read at runtime",
    );
    expect(problems).toContain(
      "fs-api: ignoredPaths skips packages/seed/snapshot/season-2026A.json, a file read at runtime",
    );
  });

  it("inside a service's dependency closure, ignoredPaths may skip only tests and READMEs", () => {
    const ws = new Map([
      ["@fairsplit/api", { name: "@fairsplit/api", dir: "apps/api", deps: ["@fairsplit/ai"] }],
      ["@fairsplit/ai", { name: "@fairsplit/ai", dir: "packages/ai", deps: [] }],
    ]);
    const files = [
      "apps/api/README.md",
      "apps/api/src/env.test.ts",
      "packages/ai/README.md",
      "packages/ai/src/read/prompts.ts",
      "packages/ai/src/read/prompts/b.v1.md",
      "packages/ai/src/read/schema.test.ts",
      "packages/eval/src/run.ts",
    ];
    const listed: string[][] = [];
    const list = (dirs: readonly string[]) => {
      listed.push([...dirs]);
      return files.filter((f) => dirs.some((d) => f.startsWith(`${d}/`)));
    };
    expect(checkIgnoredPaths(bp, ws, list)).toEqual([]);
    expect(listed).toContainEqual(["apps/api", "packages/ai"]);
    const bad = clone();
    svcIn(bad, "fs-api").buildFilter?.ignoredPaths?.push("packages/ai/src/read/**");
    expect(checkIgnoredPaths(bad, ws, list)).toEqual([
      `fs-api: ignoredPaths skips ${PROMPT}, a file read at runtime`,
      "fs-api: ignoredPaths skips packages/ai/src/read/prompts.ts, which is neither a test nor a README",
      "fs-api: ignoredPaths skips packages/ai/src/read/prompts/b.v1.md, which is neither a test nor a README",
    ]);
  });

  it("reads the committed tree from git", () => {
    const files = trackedFiles(["apps/tasks"]);
    expect(files).toContain("apps/tasks/README.md");
    expect(files).toContain("apps/tasks/tsdown.config.ts");
    expect(files.every((f) => f.startsWith("apps/tasks/") && !f.includes("\\"))).toBe(true);
    expect(trackedFiles([])).toEqual([]);
  });

  it("tells tests and READMEs from files a service runs or reads", () => {
    for (const f of [
      "apps/tasks/README.md",
      "packages/ai/readme.md",
      "apps/tasks/test/helpers.ts",
      "packages/db/src/migrate.test.ts",
      "packages/ui-web/src/x.spec.tsx",
      "packages/paypal-core/src/webhook/__fixtures__/paypal-sandbox-cert-ab66f33d.pem",
    ])
      expect(isTestOrReadme(f), f).toBe(true);
    for (const f of [
      ...RUNTIME_ASSETS,
      "packages/i18n/REVIEW.md",
      "packages/seed/CONFLICTS.md",
      "apps/tasks/src/index.ts",
      "packages/testing/src/x.ts",
      "packages/ai/src/read/latest.test.json",
    ])
      expect(isTestOrReadme(f), f).toBe(false);
  });

  it("matches globs the way Render's build filters do", () => {
    const cases: [string, string, boolean][] = [
      ["**/*.md", "README.md", true],
      ["**/*.md", PROMPT, true],
      ["**/README.md", PROMPT, false],
      ["**/README.md", "apps/tasks/README.md", true],
      ["**/test/**", "apps/tasks/test/bundle.test.ts", true],
      ["**/test/**", "apps/tasks/testing/x.ts", false],
      ["packages/**", "packages/db/migrations/0001_schema.sql", true],
      ["packages/db/**", "packages/dbx/a.ts", false],
      ["apps/*/src/*.ts", "apps/tasks/src/index.ts", true],
      ["apps/*/src/*.ts", "apps/tasks/src/handoff/dispatcher.ts", false],
      ["**/*.test.{ts,tsx}", "a/b.test.tsx", true],
      ["**/*.test.{ts,tsx}", "a/b.test.js", false],
      ["tools/cron-tick.mjs", "tools/cron-tick.mjs", true],
      ["tools/cron-tick.mjs", "tools/cron-tick.mjsx", false],
      ["a?c", "abc", true],
      ["a?c", "a/c", false],
    ];
    for (const [glob, file, expected] of cases)
      expect(matchesAny([glob], file), `${glob} ~ ${file}`).toBe(expected);
    expect(() => globToRegExp("{a,b")).toThrow(/unclosed brace/);
  });
});
