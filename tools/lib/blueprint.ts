// Offline checks for render.yaml:
//  1. structural validation against Render's published Blueprint JSON Schema
//     (vendored from https://render.com/schema/render.yaml.json, retrieved 2026-10-22,
//     Last-Modified Thu, 22 Oct 2026 00:45:41 GMT; refresh with `tsx tools/spike-s6.ts --refresh-schema`);
//  2. Fair Split's own deployment rules (register §6, S3.3, S3.13).
import { readFileSync } from "node:fs";
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
]);

const FREE_PLANS = new Set(["free"]);
const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD/;

/** Fair Split's deployment rules. Returns human-readable violations; empty when compliant. */
export function checkPolicy(bp: Blueprint): string[] {
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

  for (const s of services) {
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
