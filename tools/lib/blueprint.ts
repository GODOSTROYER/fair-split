// Offline checks for render.yaml:
//  1. structural validation against Render's published Blueprint JSON Schema
//     (vendored from https://render.com/schema/render.yaml.json, retrieved 2026-10-22,
//     Last-Modified Thu, 22 Oct 2026 00:45:41 GMT; refresh with `tsx tools/spike-s6.ts --refresh-schema`);
//  2. Fair Split's own deployment rules: register §6, approved S3.3, S3.4, S3.11, S3.13 and S3.14.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { MEDIA_PUBLIC_DIR } from "../assemble-media.js";

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
  /** Omitted: Render accepts external connections from any IP. Empty: from none (private network only). */
  ipAllowList?: { source: string; description?: string }[];
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

/**
 * The Node pin: CI's and docs/versions.md's 24.19.0 (published 3 Aug 2026). The spec's 24.22.1 was published on
 * 20 Oct 2026 (nodejs.org/dist/index.json), under the 14-day age rule when the Blueprint is created (2 Nov).
 */
export const PINNED_NODE_VERSION = "24.19.0";

/** `.node-version` once WS-QA adds it, otherwise the pin above. */
export function pinnedNodeVersion(root: string = REPO_ROOT): string {
  const file = join(root, ".node-version");
  return existsSync(file) ? readFileSync(file, "utf8").trim().replace(/^v/, "") : PINNED_NODE_VERSION;
}

/**
 * Deploys are made by hand from `main` (revised schedule 31 Oct, decision D6), replacing S3.14's `deploy` branch
 * that promote.yml would fast-forward on green CI: neither exists, and CI has not yet passed on Linux.
 */
export const DEPLOY_BRANCH = "main";
/** Render never deploys on its own: each deploy of `main` is a manual one, between judging sessions. */
export const AUTO_DEPLOY_TRIGGER = "off";

/** The services and their types: fs-tasks is gone, every task runs inline in fs-api (EXECUTOR=inline, D6). */
export const SERVICE_TYPES: Readonly<Record<string, string>> = { "fs-api": "web", "fs-cron": "cron" };

/** Where `tools/assemble-media.ts` writes the curated /media folder, and so fs-api's STATIC_MEDIA_DIR. */
export { MEDIA_PUBLIC_DIR };

/** fs-db properties that carry the owner's credentials; only the migrating service may reference them. */
export const OWNER_DB_PROPERTIES: ReadonlySet<string> = new Set([
  "connectionString",
  "connectionPoolString",
  "user",
  "password",
]);

/** The services that execute tasks, so they read the kill flags (S3.11) and carry FS_KILL. */
export const EXECUTOR_SERVICES: readonly string[] = ["fs-api"];

/**
 * S3.13's per-service secrets, split by need, with the names fs-api's env.ts reads. `syncFalse`: prompted once at
 * Blueprint creation, so these are exactly what the person creating it pastes (apps/tasks/README.md, "Deploying").
 * `generated`: `generateValue` (a base64 256-bit value) on this service. `shared`: `fromService … envVarKey` from
 * fs-api. FS_KILL (an operator flag, not a secret, left blank) is checked separately. fs-api needs no Anthropic
 * key (Judge Mode replays the reads, C-06), no Render key (no fs-tasks) and no push token (push is cut).
 */
export const SECRETS_BY_SERVICE: Readonly<
  Record<string, { syncFalse: readonly string[]; generated: readonly string[]; shared: readonly string[] }>
> = {
  "fs-api": {
    // Two Ed25519 seeds (64 lowercase hex), the operator's scrypt hash, and the optional judge code's sha256.
    syncFalse: [
      "FS_LINK_SIGNING_KEY",
      "FS_LEDGER_SIGNING_KEY",
      "FS_OPERATOR_PASSWORD_SCRYPT",
      "JUDGE_CODE_SHA256",
    ],
    generated: ["FS_APP_DB_PASSWORD", "FS_COOKIE_SECRET", "CRON_SECRET"],
    shared: [],
  },
  "fs-cron": { syncFalse: [], generated: [], shared: ["CRON_SECRET"] },
};

/**
 * PP_MODE=sandbox (untested, ADR-0002): the real sandbox app's credentials and account addresses are then secrets,
 * prompted for like the others, and the simulator's committed values must go.
 */
export const SANDBOX_SYNC_FALSE: readonly string[] = [
  "PP_CLIENT_ID",
  "PP_CLIENT_SECRET",
  "PP_WEBHOOK_ID",
  "PP_BUSINESS_EMAIL",
  "PP_PAYER_EMAIL",
  "PP_RECEIVERS",
  "PP_UNCLAIMED_RECEIVER",
];

/** The simulator's seed registry: fictional accounts and the public app credentials only it accepts (ADR-0002). */
export const SIMULATOR_ACCOUNTS_PATH = join(REPO_ROOT, "packages", "paypal-sim", "data", "accounts.json");
/** The simulator REST app the hosted demo runs on (`fs-dev` is for local runs). */
export const SIMULATOR_APP = "fs-judge";

interface SimulatorRegistry {
  accounts: { key: string; role: string; email: string }[];
  apps: { name: string; account: string; client_id: string; client_secret: string }[];
  unregistered_receivers: { member_no: string; email: string }[];
}

/**
 * The PP_* values fs-api runs on with PP_MODE=simulator, read from the simulator's committed registry: the
 * fs-judge app, the co-op's business account, Lantern Bay's payer account, the seven member receivers
 * (`M-002=…,M-007=…`, fs-api's PP_RECEIVERS pair form) and Rhea's address with no account (her item parks
 * UNCLAIMED). They are fake values the simulator alone accepts, never PayPal credentials, so render.yaml commits
 * them as plain values; the policy below checks each one against this file.
 */
export function simulatorPayPalValues(path: string = SIMULATOR_ACCOUNTS_PATH): Record<string, string> {
  const reg = JSON.parse(readFileSync(path, "utf8")) as SimulatorRegistry;
  const app = reg.apps.find((a) => a.name === SIMULATOR_APP);
  const business = reg.accounts.find((a) => a.key === app?.account);
  const payer = reg.accounts.find((a) => a.role === "payer");
  const unclaimed = reg.unregistered_receivers[0];
  if (!app || !business || !payer || !unclaimed)
    throw new Error(`${path}: no ${SIMULATOR_APP} app, business, payer or unregistered receiver`);
  const receivers = reg.accounts
    .filter((a) => a.role === "payout_receiver")
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((a) => `${a.key}=${a.email}`);
  return {
    PP_CLIENT_ID: app.client_id,
    PP_CLIENT_SECRET: app.client_secret,
    PP_BUSINESS_EMAIL: business.email,
    PP_PAYER_EMAIL: payer.email,
    PP_RECEIVERS: receivers.join(","),
    PP_UNCLAIMED_RECEIVER: unclaimed.email,
  };
}

/** The secrets a service must declare, by kind; fs-api's depend on its PayPal rail. */
export function expectedSecrets(
  service: ServiceEntry,
): { syncFalse: readonly string[]; generated: readonly string[]; shared: readonly string[] } | undefined {
  const spec = SECRETS_BY_SERVICE[service.name];
  if (!spec || service.name !== "fs-api" || envOf(service, "PP_MODE")?.value !== "sandbox") return spec;
  return { ...spec, syncFalse: [...spec.syncFalse, ...SANDBOX_SYNC_FALSE] };
}

/**
 * `PP_` names that are switches, not secrets: S3.13's PP_ENV, and ADR-0002's PP_MODE (the PayPal rail:
 * the contract-faithful simulator or the real sandbox).
 */
export const PP_SWITCHES: ReadonlySet<string> = new Set(["PP_ENV", "PP_MODE"]);

/** ADR-0002: `PP_MODE=simulator` (the default until sandbox credentials exist) or `PP_MODE=sandbox`. */
export const PP_MODES: readonly string[] = ["simulator", "sandbox"];

/**
 * S3.13's YAML lint: these names never carry a literal `value:`. Excepted: the PP_SWITCHES, and on the simulated
 * rail the simulator's committed PP_* values (`simulatorPayPalValues`), which `checkSecrets` compares one by one.
 */
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

/**
 * A build-filter glob as an anchored RegExp over repo-relative POSIX paths, with Render's syntax:
 * `**` spans directories (`**` + `/` also matches none), `*` and `?` stay inside one segment, `{a,b}` is a choice.
 */
export function globToRegExp(glob: string): RegExp {
  const source = (g: string): string => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i] as string;
      if (c === "*" && g[i + 1] === "*") {
        const slash = g[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else if (c === "{") {
        const end = g.indexOf("}", i);
        if (end === -1) throw new Error(`unclosed brace in glob ${glob}`);
        re += `(?:${g
          .slice(i + 1, end)
          .split(",")
          .map(source)
          .join("|")})`;
        i = end;
      } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
    return re;
  };
  return new RegExp(`^${source(glob)}$`);
}

const GLOBS = new Map<string, RegExp>();

/** True when `file` (repo-relative, POSIX) matches one of `globs`. */
export function matchesAny(globs: readonly string[], file: string): boolean {
  return globs.some((g) => {
    const re = GLOBS.get(g) ?? globToRegExp(g);
    GLOBS.set(g, re);
    return re.test(file);
  });
}

/** True when a commit that changes only `file` deploys `service`: a `paths` glob matches it and no `ignoredPaths` glob does. */
export function watches(service: ServiceEntry, file: string): boolean {
  const filter = service.buildFilter;
  return matchesAny(filter?.paths ?? [], file) && !matchesAny(filter?.ignoredPaths ?? [], file);
}

const TEST_DIRS: ReadonlySet<string> = new Set(["test", "tests", "__tests__", "__fixtures__", "__mocks__"]);

/** Tests and READMEs: the only files a build filter may skip inside a service's dependency closure. */
export function isTestOrReadme(file: string): boolean {
  const parts = file.split("/");
  const base = parts.at(-1) ?? "";
  return (
    /^readme\.md$/i.test(base) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    parts.slice(0, -1).some((p) => TEST_DIRS.has(p))
  );
}

/**
 * Non-code files that packages read at runtime, one representative path per kind (most live on other
 * workstreams' branches): the frozen prompts whose file name is `promptV` and whose sha256 the replay
 * key and Proof cite (S4.2), the migrations fs-api's preDeployCommand runs, and the seed snapshot
 * (IC-03). A commit that changes only one of them must redeploy every service that watches it.
 */
export const RUNTIME_ASSETS: readonly string[] = [
  "packages/ai/src/read/prompts/a.v1.md",
  "packages/ai/src/ratecard/prompts/ratecard.v1.md",
  "packages/ai/src/classify/prompts/classify.v1.md",
  "packages/db/migrations/0001_schema.sql",
  "packages/db/migrations/meta/_journal.json",
  "packages/seed/snapshot/season-2026A.json",
];

const TRACKED = new Map<string, string[]>();

/** Files git tracks under `dirs` (repo-relative POSIX paths). */
export function trackedFiles(dirs: readonly string[], root: string = REPO_ROOT): string[] {
  if (dirs.length === 0) return [];
  const key = `${root}\0${dirs.join("\0")}`;
  const cached = TRACKED.get(key);
  if (cached) return cached;
  const out = execFileSync("git", ["ls-files", "-z", "--", ...dirs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = out.split("\0").filter(Boolean);
  TRACKED.set(key, files);
  return files;
}

/**
 * Build filters never skip what a service runs or reads. Render deploys only for commits that touch
 * a watched file, so an ignored prompt, migration or snapshot leaves production on the old one while
 * the eval, the replay cache and Proof already cite the new one.
 *  1. No service ignores a RUNTIME_ASSETS path that its `paths` watch.
 *  2. Inside a service's workspace dependency closure, `ignoredPaths` skips only tests and READMEs.
 */
export function checkIgnoredPaths(
  bp: Blueprint,
  workspace: Map<string, WorkspacePackage> = readWorkspace(),
  listFiles: (dirs: readonly string[]) => readonly string[] = trackedFiles,
): string[] {
  const out: string[] = [];
  for (const s of bp.services ?? []) {
    const paths = s.buildFilter?.paths ?? [];
    const ignored = s.buildFilter?.ignoredPaths ?? [];
    if (ignored.length === 0) continue;
    for (const asset of RUNTIME_ASSETS)
      if (matchesAny(paths, asset) && matchesAny(ignored, asset))
        out.push(`${s.name}: ignoredPaths skips ${asset}, a file read at runtime`);
    for (const file of listFiles(dependencyClosure(serviceRoots(s), workspace)))
      if (matchesAny(paths, file) && matchesAny(ignored, file) && !isTestOrReadme(file))
        out.push(`${s.name}: ignoredPaths skips ${file}, which is neither a test nor a README`);
  }
  return out;
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
 * commands run (a change anywhere in either must redeploy the service). They decide nothing while
 * deploys are manual (AUTO_DEPLOY_TRIGGER), and are kept right for the day auto-deploy is turned on.
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
  const cron = byName.get("fs-cron");
  if (api?.type !== "web") out.push("fs-api must be a web service");
  if (cron?.type !== "cron") out.push("fs-cron must be a cron job");
  if (!db) out.push("fs-db must be declared");
  for (const s of services)
    if (SERVICE_TYPES[s.name] === undefined)
      out.push(`unexpected service ${s.name} (every task runs inline in fs-api)`);

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
    const build = api.buildCommand ?? "";
    if (!/tools\/scan-dist\.ts\s*$/.test(build))
      out.push("fs-api's build must end with tools/scan-dist.ts (S3.13)");
    // /media serves only what the allowlist assembles (never media/ wholesale), and the dist scan covers it.
    const assemble = build.indexOf("tools/assemble-media.ts");
    if (assemble < 0 || assemble > build.lastIndexOf("tools/scan-dist.ts"))
      out.push("fs-api's build must run tools/assemble-media.ts before tools/scan-dist.ts");
    if (envOf(api, "STATIC_MEDIA_DIR")?.value !== MEDIA_PUBLIC_DIR)
      out.push(`fs-api must set STATIC_MEDIA_DIR=${MEDIA_PUBLIC_DIR}, the folder assemble-media writes`);
    if (envOf(api, "EXECUTOR")?.value !== "inline") out.push("fs-api must set EXECUTOR=inline");
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
  // ADR-0005: the owner's URL can be read back from fs-api's initial environment, so it must be
  // useless outside Render's private network. Omitting the list would allow every IP.
  if (db && !(Array.isArray(db.ipAllowList) && db.ipAllowList.length === 0))
    out.push("fs-db must set ipAllowList: [] (private network only; ADR-0005)");

  const nodePin = opts.nodeVersion ?? pinnedNodeVersion();
  for (const s of services) {
    const node = envOf(s, "NODE_VERSION");
    if (String(node?.value) !== nodePin)
      out.push(`${s.name}: NODE_VERSION must equal the ${nodePin} pin (got ${node?.value})`);
    if (s.runtime !== "node") out.push(`${s.name} must use the node runtime`);
    if (s.branch !== DEPLOY_BRANCH) out.push(`${s.name} must follow the ${DEPLOY_BRANCH} branch`);
    if (s.autoDeployTrigger !== AUTO_DEPLOY_TRIGGER)
      out.push(`${s.name} must set autoDeployTrigger: ${AUTO_DEPLOY_TRIGGER} (deploys are manual)`);
    if (!s.buildFilter?.paths?.length) out.push(`${s.name} needs a buildFilter with paths`);
  }
  for (const name of EXECUTOR_SERVICES)
    if (envOf(byName.get(name), "PP_ENV")?.value !== "sandbox")
      out.push(`${name}: PP_ENV must be sandbox (boot check)`);

  out.push(
    ...checkSecrets(bp),
    ...checkDatabaseRoles(bp),
    ...checkBuildFilters(bp),
    ...checkIgnoredPaths(bp),
  );
  return out;
}

/**
 * S3.13 secrets: split by need, never literal, the kill flag on every executor. On the simulated rail fs-api
 * carries exactly the simulator's committed PP_* values as plain values, each equal to the registry's.
 */
export function checkSecrets(
  bp: Blueprint,
  simulator: Record<string, string> = simulatorPayPalValues(),
): string[] {
  const out: string[] = [];
  for (const s of bp.services ?? []) {
    const env = s.envVars ?? [];
    const simulated = s.name === "fs-api" && envOf(s, "PP_MODE")?.value === "simulator";
    for (const v of env) {
      if (v.fromGroup) out.push(`${s.name}: fromGroup ${v.fromGroup} (no environment groups, S3.13)`);
      if (!v.key) continue;
      const simValue = simulated ? simulator[v.key] : undefined;
      if (simValue !== undefined) {
        if (v.value !== simValue)
          out.push(
            `${s.name}: ${v.key} must be the simulator's committed value (${SIMULATOR_APP}, accounts.json)`,
          );
      } else if (isSecretName(v.key) && v.value !== undefined)
        out.push(`${s.name}: ${v.key} must not have a literal value`);
      if (/^(VITE|EXPO)_PUBLIC_/.test(v.key) && /KEY|SECRET|TOKEN/.test(v.key))
        out.push(`${s.name}: ${v.key} is a public secret name`);
    }
    if (simulated)
      for (const key of Object.keys(simulator))
        if (!envOf(s, key)) out.push(`${s.name}: PP_MODE=simulator needs ${key} (the simulator's value)`);
    const spec = expectedSecrets(s);
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
 * (`useAppDatabaseUrl`, packages/db/src/cli/app-url.ts). No service declares DATABASE_URL: Render cannot compose fs_app's URL,
 * so every process builds it at boot. Every other service connects as fs_app from fs-db's host,
 * port and name plus the password fs-api generates (render.yaml has no such service today).
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
      out.push(`${s.name}: no DATABASE_URL in the Blueprint; the boot builds fs_app's (useAppDatabaseUrl)`);
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
  const m = /^node(?:\s+--(?:max-old-space-size|max-semi-space-size)=\d+)*\s+(\S+)\/dist\/(\S+)\.js$/.exec(
    startCommand.trim(),
  );
  return m ? `${m[1]}/src/${m[2]}.ts` : undefined;
}
