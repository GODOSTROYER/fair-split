// Offline checks for render.yaml:
//  1. structural validation against Render's published Blueprint JSON Schema
//     (vendored from https://render.com/schema/render.yaml.json, retrieved 2026-10-22,
//     Last-Modified Thu, 22 Oct 2026 00:45:41 GMT; refresh with `tsx tools/spike-s6.ts --refresh-schema`);
//  2. Fair Split's own deployment rules (register §6, S3.3, S3.13).
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

/** Names that must never carry a literal value in the Blueprint. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  "PP_CLIENT_ID",
  "PP_CLIENT_SECRET",
  "PP_WEBHOOK_ID",
  "PP_BUSINESS_EMAIL",
  "PP_PAYER_EMAIL",
  "PP_RECEIVERS",
  "ANTHROPIC_API_KEY",
  "RENDER_API_KEY",
  "BETTER_AUTH_SECRET",
  "STATEMENT_SIGNING_KEY",
  "EXPO_ACCESS_TOKEN",
  "FS_KILL",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "DATABASE_OWNER_URL",
]);

/** The Node pin (S3 §1 `.node-version`, architecture's pinned stack, eas.json). */
export const PINNED_NODE_VERSION = "24.22.1";

/** `.node-version` once WS-QA adds it, otherwise the spec pin. */
export function pinnedNodeVersion(root: string = REPO_ROOT): string {
  const file = join(root, ".node-version");
  return existsSync(file) ? readFileSync(file, "utf8").trim().replace(/^v/, "") : PINNED_NODE_VERSION;
}

/** The env var the migration (preDeployCommand) reads; the only owner-role connection allowed. */
export const OWNER_URL_KEY = "DATABASE_OWNER_URL";

const glob = (dir: string) => `${dir}/**`;

/** True when a buildFilter path list covers everything under `dir` (e.g. `packages/**` covers `packages/db`). */
export function pathsCover(paths: readonly string[], dir: string): boolean {
  return paths.some((p) => p.endsWith("/**") && (dir === p.slice(0, -3) || dir.startsWith(p.slice(0, -2))));
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

const FREE_PLANS = new Set(["free"]);
const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD/;

/** Fair Split's deployment rules. Returns human-readable violations; empty when compliant. */
/**
 * Build filters must cover each service's workspace dependency closure (a change anywhere in it must
 * redeploy the service), fs-cron must rebuild whenever fs-tasks does (same bundle), and fs-api must
 * rebuild on apps/tasks (shared task policy).
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
  }
  const byName = new Map(services.map((s) => [s.name, s]));
  const tasksPaths = byName.get("fs-tasks")?.buildFilter?.paths ?? [];
  const cronPaths = byName.get("fs-cron")?.buildFilter?.paths ?? [];
  for (const p of tasksPaths)
    if (!cronPaths.includes(p)) out.push(`fs-cron: buildFilter misses ${p} (fs-tasks has it)`);
  const apiPaths = byName.get("fs-api")?.buildFilter?.paths ?? [];
  if (byName.has("fs-api") && !pathsCover(apiPaths, "apps/tasks"))
    out.push("fs-api: buildFilter must include apps/tasks/** (shared task policy)");
  return out;
}

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

  const regions = new Set([...services.map((s) => s.region), ...(bp.databases ?? []).map((d) => d.region)]);
  if (regions.size !== 1 || regions.has(undefined))
    out.push(`all resources must share one explicit region (got ${[...regions].join(", ")})`);

  if (api) {
    if (!api.plan || FREE_PLANS.has(api.plan)) out.push("fs-api must be on a paid, always-on plan");
    if (api.healthCheckPath !== "/healthz") out.push("fs-api healthCheckPath must be /healthz");
    if (!api.preDeployCommand?.includes("migrate"))
      out.push("fs-api must run migrations in preDeployCommand");
  }
  if (cron && cron.schedule !== "7 * * * *") out.push("fs-cron must run hourly at :07");
  if (cron?.plan && FREE_PLANS.has(cron.plan)) out.push("fs-cron must not be on a free plan");
  if (db && (!db.plan || FREE_PLANS.has(db.plan))) out.push("fs-db must be on a paid plan");
  if (db && db.postgresMajorVersion !== "18") out.push("fs-db must be Postgres 18");

  const nodePin = opts.nodeVersion ?? pinnedNodeVersion();
  const nodeVersions = [
    ...(bp.envVarGroups ?? []).flatMap((g) => g.envVars),
    ...services.flatMap((s) => s.envVars ?? []),
  ].filter((v) => v.key === "NODE_VERSION");
  if (nodeVersions.length === 0) out.push(`NODE_VERSION must be set to the ${nodePin} pin`);
  for (const v of nodeVersions)
    if (String(v.value) !== nodePin) out.push(`NODE_VERSION must equal the ${nodePin} pin (got ${v.value})`);

  for (const s of services) {
    const env = s.envVars ?? [];
    const dbUrl = env.find((v) => v.key === "DATABASE_URL");
    const ownerUrl = env.find((v) => v.key === OWNER_URL_KEY);
    if (dbUrl?.fromDatabase)
      out.push(`${s.name}: DATABASE_URL must be the fs_app role (sync: false), not the owner connection`);
    if (dbUrl && dbUrl.sync !== false) out.push(`${s.name}: DATABASE_URL must be declared with sync: false`);
    if (s.preDeployCommand && !ownerUrl?.fromDatabase)
      out.push(`${s.name}: migrations need ${OWNER_URL_KEY} from fromDatabase`);
    if (!s.preDeployCommand && ownerUrl)
      out.push(`${s.name}: only a service that migrates may hold ${OWNER_URL_KEY}`);
    for (const v of env)
      if (v.fromDatabase && v.key !== OWNER_URL_KEY)
        out.push(`${s.name}: ${v.key} must not carry the owner connection string`);

    if (!s.buildFilter?.paths?.length) out.push(`${s.name} needs a buildFilter with paths`);
    if (s.runtime !== "node") out.push(`${s.name} must use the node runtime`);
    for (const v of s.envVars ?? []) {
      if (!v.key) continue;
      const secret = SECRET_KEYS.has(v.key) || SECRETISH.test(v.key);
      if (secret && v.value !== undefined) out.push(`${s.name}: ${v.key} must not have a literal value`);
      if (secret && v.sync !== false && !v.generateValue && !v.fromDatabase && !v.fromService) {
        out.push(`${s.name}: ${v.key} must be declared with sync: false`);
      }
      if (/^(VITE|EXPO)_PUBLIC_/.test(v.key) && SECRETISH.test(v.key))
        out.push(`${s.name}: ${v.key} is a public secret name`);
    }
    for (const g of (s.envVars ?? []).filter((v) => v.fromGroup)) {
      if (!(bp.envVarGroups ?? []).some((eg) => eg.name === g.fromGroup))
        out.push(`${s.name}: unknown group ${g.fromGroup}`);
    }
  }
  out.push(...checkBuildFilters(bp));
  for (const g of bp.envVarGroups ?? []) {
    for (const v of g.envVars) {
      if (v.key && (SECRET_KEYS.has(v.key) || SECRETISH.test(v.key)))
        out.push(`group ${g.name}: secret ${v.key} cannot live in a group`);
    }
  }
  return out;
}

/** `node apps/tasks/dist/cron.js` -> `apps/tasks/src/cron.ts`, for checking start commands resolve. */
export function startCommandSource(startCommand: string): string | undefined {
  const m = /^node\s+(\S+)\/dist\/(\S+)\.js$/.exec(startCommand.trim());
  return m ? `${m[1]}/src/${m[2]}.ts` : undefined;
}
