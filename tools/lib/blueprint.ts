// Offline checks for render.yaml:
//  1. structural validation against Render's published Blueprint JSON Schema
//     (vendored from https://render.com/schema/render.yaml.json, retrieved 2026-10-22,
//     Last-Modified Thu, 22 Oct 2026 00:45:41 GMT; refresh with `tsx tools/spike-s6.ts --refresh-schema`);
//  2. Fair Split's own deployment rules: register §6, approved S3.3, S3.4, S3.11, S3.13 and S3.14.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";

export const SCHEMA_URL = "https://render.com/schema/render.yaml.json";
export const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "render-blueprint.schema.json");
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BLUEPRINT_PATH = join(REPO_ROOT, "render.yaml");

export interface EnvVarEntry {
  key?: string;
  value?: string | number;
  sync?: boolean;
  generateValue?: boolean;
  fromGroup?: string;
  fromDatabase?: { name: string; property: string };
  fromService?: { type: string; name: string; property?: string; envVarKey?: string };
}

export interface ServiceEntry {
  type: string;
  name: string;
  runtime?: string;
  region?: string;
  branch?: string;
  plan?: string;
  schedule?: string;
  buildCommand?: string;
  startCommand?: string;
  preDeployCommand?: string;
  healthCheckPath?: string;
  autoDeployTrigger?: string;
  buildFilter?: { paths?: string[]; ignoredPaths?: string[] };
  envVars?: EnvVarEntry[];
}

export interface DatabaseEntry {
  name: string;
  region?: string;
  plan?: string;
  postgresMajorVersion?: string;
}

export interface Blueprint {
  version?: string;
  envVarGroups?: { name: string; envVars: EnvVarEntry[] }[];
  services?: ServiceEntry[];
  databases?: DatabaseEntry[];
}

export function readBlueprint(path: string = BLUEPRINT_PATH): Blueprint {
  return parse(readFileSync(path, "utf8")) as Blueprint;
}

export function loadSchema(path: string = SCHEMA_PATH): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

/** JSON-Schema errors as `instancePath: message` strings; empty when valid. */
export function validateAgainstSchema(doc: unknown, schema: object = loadSchema()): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  if (validate(doc)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`);
}

/** The Node pin (S3 §1 `.node-version`, architecture's pinned stack, eas.json). */
export const PINNED_NODE_VERSION = "24.22.1";

/** `.node-version` once WS-QA adds it, otherwise the spec pin. */
export function pinnedNodeVersion(root: string = REPO_ROOT): string {
  const file = join(root, ".node-version");
  return existsSync(file) ? readFileSync(file, "utf8").trim().replace(/^v/, "") : PINNED_NODE_VERSION;
}

/** S3.14: "The Blueprint is created from the deploy branch, which every service follows." */
export const DEPLOY_BRANCH = "deploy";

/** fs-db properties that carry the owner's credentials; only the migrating service may reference them. */
export const OWNER_DB_PROPERTIES: ReadonlySet<string> = new Set([
  "connectionString",
  "connectionPoolString",
  "user",
  "password",
]);

/** The services that execute tasks, so they read the kill flags (S3.11) and must both carry FS_KILL. */
export const EXECUTOR_SERVICES: readonly string[] = ["fs-api", "fs-tasks"];

/**
 * S3.13's per-service secrets, split by need. `syncFalse`: prompted once at Blueprint creation.
 * `generated`: `generateValue` on this service. `shared`: `fromService … envVarKey` from fs-api.
 * FS_KILL (an operator flag, not a secret) is checked separately.
 */
export const SECRETS_BY_SERVICE: Readonly<
  Record<string, { syncFalse: readonly string[]; generated: readonly string[]; shared: readonly string[] }>
> = {
  "fs-api": {
    syncFalse: [
      "PP_CLIENT_ID",
      "PP_CLIENT_SECRET",
      "PP_WEBHOOK_ID",
      "PP_BUSINESS_EMAIL",
      "PP_PAYER_EMAIL",
      "PP_RECEIVERS",
      "PP_UNCLAIMED_RECEIVER",
      "ANTHROPIC_API_KEY",
      "RENDER_API_KEY",
      "EXPO_PUSH_TOKEN",
      "OPS_PASSWORD_SCRYPT",
      "JUDGE_CODE_SHA256",
    ],
    generated: ["FS_APP_DB_PASSWORD", "STATEMENT_SIGNING_KEY", "COOKIE_KEY", "CRON_SECRET"],
    shared: [],
  },
  "fs-tasks": { syncFalse: ["ANTHROPIC_API_KEY"], generated: [], shared: ["FS_APP_DB_PASSWORD"] },
  "fs-cron": { syncFalse: [], generated: [], shared: ["CRON_SECRET"] },
};

/**
 * `PP_` names that are switches, not secrets: S3.13's PP_ENV, and ADR-0002's PP_MODE (the PayPal rail:
 * the contract-faithful simulator or the real sandbox).
 */
export const PP_SWITCHES: ReadonlySet<string> = new Set(["PP_ENV", "PP_MODE"]);

/** ADR-0002: `PP_MODE=simulator` (the default until sandbox credentials exist) or `PP_MODE=sandbox`. */
export const PP_MODES: readonly string[] = ["simulator", "sandbox"];

/** S3.13's YAML lint: these names never carry a literal `value:` (the PP_SWITCHES excepted). */
export function isSecretName(key: string): boolean {
  return (
    /KEY|SECRET|TOKEN|PASSWORD|SCRYPT|SHA256/.test(key) || (key.startsWith("PP_") && !PP_SWITCHES.has(key))
  );
}

const glob = (dir: string) => `${dir}/**`;

/** True when a buildFilter path list covers everything under `dir` (e.g. `packages/**` covers `packages/db`). */
export function pathsCover(paths: readonly string[], dir: string): boolean {
  return paths.some((p) => p.endsWith("/**") && (dir === p.slice(0, -3) || dir.startsWith(p.slice(0, -2))));
}

/** True when a buildFilter path list covers one file, exactly or through a `dir/**` glob. */
export function pathsCoverFile(paths: readonly string[], file: string): boolean {
  return paths.includes(file) || pathsCover(paths, dirname(file).replaceAll("\\", "/"));
}

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly deps: string[];
}

/** Every workspace package (apps/*, packages/*) with its `workspace:` dependencies. */
export function readWorkspace(root: string = REPO_ROOT): Map<string, WorkspacePackage> {
  const out = new Map<string, WorkspacePackage>();
  for (const parent of ["apps", "packages"]) {
    const base = join(root, parent);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const pj = join(base, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(pj)) continue;
      const json = JSON.parse(readFileSync(pj, "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (!json.name) continue;
      const all = { ...json.dependencies, ...json.devDependencies };
      const deps = Object.entries(all)
        .filter(([, v]) => v.startsWith("workspace:"))
        .map(([k]) => k);
      out.set(json.name, { name: json.name, dir: `${parent}/${entry.name}`, deps });
    }
  }
  return out;
}

/** Directories of `roots` and every workspace package they depend on, transitively. */
export function dependencyClosure(
  roots: readonly string[],
  workspace: Map<string, WorkspacePackage> = readWorkspace(),
): string[] {
  const seen = new Set<string>();
  const dirs = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const pkg = workspace.get(name);
    if (!pkg) return;
    dirs.add(pkg.dir);
    for (const d of pkg.deps) visit(d);
  };
  for (const r of roots) visit(r);
  return [...dirs].sort();
}

/** The workspace packages each service builds (its turbo `--filter=<pkg>...` roots). */
export function serviceRoots(service: ServiceEntry): string[] {
  const cmd = service.buildCommand ?? "";
  return [...cmd.matchAll(/--filter=(@fairsplit\/[a-z0-9-]+)/g)].map((m) => m[1] as string);
}

/** Repo files a service's commands run directly, e.g. `tools/scan-dist.ts`. */
export function commandFiles(service: ServiceEntry): string[] {
  const cmds = [service.buildCommand, service.preDeployCommand, service.startCommand].join(" ");
  return [...new Set([...cmds.matchAll(/\btools\/[\w./-]+\.(?:ts|mts|mjs|js)\b/g)].map((m) => m[0]))];
}

/**
 * Build filters must cover each service's workspace dependency closure and every repo file its
 * commands run (a change anywhere in either must redeploy the service), and fs-api must rebuild on
 * apps/tasks (the executor lanes must match fs-api's dispatcher).
 */
export function checkBuildFilters(
  bp: Blueprint,
  workspace: Map<string, WorkspacePackage> = readWorkspace(),
): string[] {
  const out: string[] = [];
  const services = bp.services ?? [];
  for (const s of services) {
    const paths = s.buildFilter?.paths ?? [];
    for (const dir of dependencyClosure(serviceRoots(s), workspace))
      if (!pathsCover(paths, dir))
        out.push(`${s.name}: buildFilter misses ${glob(dir)} (dependency closure)`);
    for (const file of commandFiles(s))
      if (!pathsCoverFile(paths, file))
        out.push(`${s.name}: buildFilter misses ${file} (run by its commands)`);
  }
  const api = services.find((s) => s.name === "fs-api");
  if (api && !pathsCover(api.buildFilter?.paths ?? [], "apps/tasks"))
    out.push("fs-api: buildFilter must include apps/tasks/** (executor lanes)");
  return out;
}

const FREE_PLANS = new Set(["free"]);

const envOf = (s: ServiceEntry | undefined, key: string): EnvVarEntry | undefined =>
  s?.envVars?.find((v) => v.key === key);

/** Fair Split's deployment rules. Returns human-readable violations; empty when compliant. */
export function checkPolicy(bp: Blueprint, opts: { nodeVersion?: string } = {}): string[] {
  const out: string[] = [];
  const services = bp.services ?? [];
  const byName = new Map(services.map((s) => [s.name, s]));
  const db = (bp.databases ?? []).find((d) => d.name === "fs-db");

  const api = byName.get("fs-api");
  const tasks = byName.get("fs-tasks");
  const cron = byName.get("fs-cron");
  if (api?.type !== "web") out.push("fs-api must be a web service");
  if (tasks?.type !== "workflow") out.push("fs-tasks must be a workflow");
  if (cron?.type !== "cron") out.push("fs-cron must be a cron job");
  if (!db) out.push("fs-db must be declared");
  for (const s of services)
    if (!["fs-api", "fs-tasks", "fs-cron"].includes(s.name)) out.push(`unexpected service ${s.name}`);

  const regions = new Set([...services.map((s) => s.region), ...(bp.databases ?? []).map((d) => d.region)]);
  if (regions.size !== 1 || regions.has(undefined))
    out.push(`all resources must share one explicit region (got ${[...regions].join(", ")})`);

  // S3.13: no environment group, and so no `fromGroup`.
  if ((bp.envVarGroups ?? []).length > 0)
    out.push("no envVarGroups: Render ignores sync: false keys in groups (S3.13)");

  if (api) {
    if (!api.plan || FREE_PLANS.has(api.plan)) out.push("fs-api must be on a paid, always-on plan");
    if (api.healthCheckPath !== "/healthz") out.push("fs-api healthCheckPath must be /healthz");
    if (!api.preDeployCommand?.includes("migrate"))
      out.push("fs-api must run migrations in preDeployCommand");
    if (!/tools\/scan-dist\.ts\s*$/.test(api.buildCommand ?? ""))
      out.push("fs-api's build must end with tools/scan-dist.ts (S3.13)");
    if (envOf(api, "EXECUTOR")?.value !== "workflow") out.push("fs-api must set EXECUTOR=workflow");
    // ADR-0002: the rail is stated in the Blueprint, so what a deploy runs against is in the repo.
    const mode = envOf(api, "PP_MODE");
    if (mode?.value === undefined || !PP_MODES.includes(String(mode.value)))
      out.push(`fs-api must set PP_MODE to ${PP_MODES.join(" or ")} (ADR-0002)`);
  }
  for (const s of services)
    if (s.name !== "fs-api" && envOf(s, "PP_MODE"))
      out.push(`${s.name}: makes no PayPal calls, so has no PP_MODE`);
  if (cron) {
    if (cron.schedule !== "7 * * * *") out.push("fs-cron must run hourly at :07");
    if (cron.plan && FREE_PLANS.has(cron.plan)) out.push("fs-cron must not be on a free plan");
    if (cron.buildCommand !== "true" || cron.startCommand !== "node tools/cron-tick.mjs")
      out.push("fs-cron must be the thin trigger: buildCommand true, startCommand node tools/cron-tick.mjs");
    const hostport = envOf(cron, "FS_API_HOSTPORT")?.fromService;
    if (hostport?.name !== "fs-api" || hostport.property !== "hostport")
      out.push("fs-cron: FS_API_HOSTPORT must come from fs-api's hostport");
  }
  if (db && (!db.plan || FREE_PLANS.has(db.plan))) out.push("fs-db must be on a paid plan");
  if (db && db.postgresMajorVersion !== "18") out.push("fs-db must be Postgres 18");

  const nodePin = opts.nodeVersion ?? pinnedNodeVersion();
  for (const s of services) {
    const node = envOf(s, "NODE_VERSION");
    if (String(node?.value) !== nodePin)
      out.push(`${s.name}: NODE_VERSION must equal the ${nodePin} pin (got ${node?.value})`);
    if (s.runtime !== "node") out.push(`${s.name} must use the node runtime`);
    if (s.branch !== DEPLOY_BRANCH) out.push(`${s.name} must follow the ${DEPLOY_BRANCH} branch (S3.14)`);
    if (s.autoDeployTrigger !== "checksPass") out.push(`${s.name} must deploy on checksPass`);
    if (!s.buildFilter?.paths?.length) out.push(`${s.name} needs a buildFilter with paths`);
  }
  for (const name of EXECUTOR_SERVICES)
    if (envOf(byName.get(name), "PP_ENV")?.value !== "sandbox")
      out.push(`${name}: PP_ENV must be sandbox (boot check)`);

  out.push(...checkSecrets(bp), ...checkDatabaseRoles(bp), ...checkBuildFilters(bp));
  return out;
}

/** S3.13 secrets: split by need, never literal, the kill flag on every executor. */
export function checkSecrets(bp: Blueprint): string[] {
  const out: string[] = [];
  for (const s of bp.services ?? []) {
    const env = s.envVars ?? [];
    for (const v of env) {
      if (v.fromGroup) out.push(`${s.name}: fromGroup ${v.fromGroup} (no environment groups, S3.13)`);
      if (!v.key) continue;
      if (isSecretName(v.key) && v.value !== undefined)
        out.push(`${s.name}: ${v.key} must not have a literal value`);
      if (/^(VITE|EXPO)_PUBLIC_/.test(v.key) && /KEY|SECRET|TOKEN/.test(v.key))
        out.push(`${s.name}: ${v.key} is a public secret name`);
    }
    const spec = SECRETS_BY_SERVICE[s.name];
    if (!spec) continue;
    const syncFalse = env.filter((v) => v.sync === false && v.key !== "FS_KILL").map((v) => v.key ?? "");
    const generated = env.filter((v) => v.generateValue).map((v) => v.key ?? "");
    const shared = env.filter((v) => v.fromService?.envVarKey).map((v) => v.key ?? "");
    const same = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && [...a].sort().every((k, i) => k === [...b].sort()[i]);
    if (!same(syncFalse, spec.syncFalse))
      out.push(
        `${s.name}: sync: false secrets must be exactly ${spec.syncFalse.join(", ") || "none"} (S3.13)`,
      );
    if (!same(generated, spec.generated))
      out.push(`${s.name}: generated secrets must be exactly ${spec.generated.join(", ") || "none"} (S3.13)`);
    if (!same(shared, spec.shared))
      out.push(
        `${s.name}: secrets shared from fs-api must be exactly ${spec.shared.join(", ") || "none"} (S3.13)`,
      );
    for (const v of env.filter((e) => e.fromService?.envVarKey)) {
      const from = v.fromService;
      if (from?.name !== "fs-api" || from.envVarKey !== v.key)
        out.push(`${s.name}: ${v.key} must be shared from fs-api's ${v.key}`);
    }
    const kill = env.find((v) => v.key === "FS_KILL");
    if (EXECUTOR_SERVICES.includes(s.name) && kill?.sync !== false)
      out.push(`${s.name}: FS_KILL must be declared with sync: false on every executor (S3.11)`);
    if (!EXECUTOR_SERVICES.includes(s.name) && kill)
      out.push(`${s.name}: runs no tasks, so holds no FS_KILL`);
  }
  return out;
}

/**
 * The variable that carries the owner's URL to `@fairsplit/db migrate`. packages/db's env contract:
 * on Render, migrate reads only DATABASE_OWNER_URL and never DATABASE_URL, which is fs_app's there.
 */
export const OWNER_URL_KEY = "DATABASE_OWNER_URL";

/**
 * S3.4 and register §7: only the migrating service may see the owner's credentials, and only as
 * DATABASE_OWNER_URL, which its boot deletes after building fs_app's DATABASE_URL from it
 * (apps/tasks/src/db-env.ts). No service declares DATABASE_URL: Render cannot compose fs_app's URL,
 * so every process builds it at boot. Every other service connects as fs_app from fs-db's host,
 * port and name plus the password fs-api generates.
 */
export function checkDatabaseRoles(bp: Blueprint): string[] {
  const out: string[] = [];
  const services = bp.services ?? [];
  const migrating = services.filter((s) => s.preDeployCommand?.includes("migrate"));
  if (migrating.length !== 1 || migrating[0]?.name !== "fs-api") out.push("only fs-api runs migrations");
  for (const s of services) {
    const env = s.envVars ?? [];
    const owner = env.filter((v) => v.fromDatabase && OWNER_DB_PROPERTIES.has(v.fromDatabase.property));
    if (env.some((v) => v.key === "DATABASE_URL"))
      out.push(`${s.name}: no DATABASE_URL in the Blueprint; the boot builds fs_app's (db-env.ts)`);
    if (s.preDeployCommand?.includes("migrate")) {
      if (envOf(s, OWNER_URL_KEY)?.fromDatabase?.property !== "connectionString")
        out.push(`${s.name}: migrations read the owner's ${OWNER_URL_KEY} (fromDatabase connectionString)`);
      if (!env.some((v) => v.key === "FS_APP_DB_PASSWORD" && v.generateValue))
        out.push(`${s.name}: FS_APP_DB_PASSWORD must be generated here, for CREATE/ALTER ROLE fs_app`);
      if (owner.some((v) => v.key !== OWNER_URL_KEY))
        out.push(`${s.name}: the owner's credentials only as ${OWNER_URL_KEY}`);
      continue;
    }
    for (const v of owner)
      out.push(`${s.name}: ${v.key} carries the owner's ${v.fromDatabase?.property}; only fs-api may`);
    if (env.some((v) => v.key === OWNER_URL_KEY))
      out.push(`${s.name}: no ${OWNER_URL_KEY}; only the migrating service holds the owner's URL`);
    const usesDb = env.some((v) => v.fromDatabase);
    if (usesDb) {
      for (const [key, property] of [
        ["FS_DB_HOST", "host"],
        ["FS_DB_PORT", "port"],
        ["FS_DB_NAME", "database"],
      ] as const) {
        if (envOf(s, key)?.fromDatabase?.property !== property)
          out.push(`${s.name}: ${key} must come from fs-db's ${property}`);
      }
      if (envOf(s, "FS_APP_DB_PASSWORD")?.fromService?.envVarKey !== "FS_APP_DB_PASSWORD")
        out.push(`${s.name}: FS_APP_DB_PASSWORD must be shared from fs-api`);
    }
  }
  return out;
}

/** `node apps/tasks/dist/cron.js` -> `apps/tasks/src/cron.ts`, for checking start commands resolve. */
export function startCommandSource(startCommand: string): string | undefined {
  const m = /^node\s+(\S+)\/dist\/(\S+)\.js$/.exec(startCommand.trim());
  return m ? `${m[1]}/src/${m[2]}.ts` : undefined;
}
