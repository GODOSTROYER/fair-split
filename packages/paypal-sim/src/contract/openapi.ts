// Loads PayPal's vendored OpenAPI 3.0 specs (plus two hand-written supplements), converts their component
// schemas to JSON Schema draft-07 and validates simulator traffic with ajv. Two variants of every schema
// are compiled: "req" (readOnly properties are not required) and "res" (writeOnly properties are not
// required), which is how OpenAPI 3.0 defines readOnly/writeOnly in combination with `required`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

export type SpecName = "invoicing" | "payouts" | "webhooks" | "reporting" | "conditional_rules" | "oauth";
type Mode = "req" | "res";
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

export const SPEC_FILES: Record<SpecName, string> = {
  invoicing: "invoicing_v2.json",
  payouts: "payments_payouts_batch_v1.json",
  webhooks: "notifications_webhooks_v1.json",
  reporting: "reporting_transactions_v1.json",
  conditional_rules: "supplements/invoicing_conditional_rules.json",
  oauth: "supplements/oauth2_token.json",
};

/** One documented operation: request schema definition and response definitions by status. */
export interface Operation {
  key: string;
  spec: SpecName;
  operationId: string;
  method: string;
  path: string;
  request: string | null;
  responses: Record<string, string | null>;
}

export interface ValidationIssue {
  field: string;
  value?: string;
  location: "body" | "query" | "path";
  issue: string;
  description: string;
}

const NUMERIC_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minProperties",
  "maxProperties",
]);
const DROPPED_KEYWORDS = new Set([
  "example",
  "examples",
  "xml",
  "externalDocs",
  "discriminator",
  "deprecated",
  "default",
  "nullable",
]);

/** Java-style `(?i)` prefixes are not valid ECMAScript; expand them into per-letter character classes. */
export function ecmaPattern(pattern: string): string {
  if (!pattern.startsWith("(?i)")) return pattern;
  let out = "";
  let inClass = false;
  const body = pattern.slice(4);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "\\") {
      out += ch + (body[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "[") inClass = true;
    if (ch === "]") inClass = false;
    if (!inClass && /[a-z]/i.test(ch)) out += `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
    else out += ch;
  }
  return out;
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class SpecConverter {
  constructor(private readonly schemas: JsonObject) {}

  private flag(prop: Json | undefined, key: "readOnly" | "writeOnly"): boolean {
    if (!isObject(prop)) return false;
    if (prop[key] === true) return true;
    if (typeof prop.$ref === "string") {
      const target = this.schemas[refName(prop.$ref)];
      return isObject(target) && target[key] === true;
    }
    return false;
  }

  convert(node: Json, mode: Mode): Json {
    if (Array.isArray(node)) return node.map((n) => this.convert(n, mode));
    if (!isObject(node)) return node;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROPPED_KEYWORDS.has(k) || k.startsWith("x-")) continue;
      if (k === "$ref" && typeof v === "string") {
        out.$ref = `#/definitions/${refName(v)}`;
        continue;
      }
      if (NUMERIC_KEYWORDS.has(k) && typeof v === "string") {
        out[k] = Number(v);
        continue;
      }
      if (k === "pattern" && typeof v === "string") {
        out.pattern = ecmaPattern(v);
        continue;
      }
      if (k === "properties" && isObject(v)) {
        const props: JsonObject = {};
        for (const [pk, pv] of Object.entries(v)) props[pk] = this.convert(pv, mode);
        out.properties = props;
        continue;
      }
      out[k] = this.convert(v, mode);
    }
    if (node.nullable === true && typeof out.type === "string") out.type = [out.type, "null"];
    if (Array.isArray(out.required) && isObject(node.properties)) {
      const props = node.properties;
      const hidden = mode === "req" ? "readOnly" : "writeOnly";
      const kept = out.required.filter((n) => typeof n !== "string" || !this.flag(props[n], hidden));
      if (kept.length > 0) out.required = kept;
      else delete out.required;
    }
    return out;
  }
}

/** Maps an ajv error to PayPal's documented `details[]` issue vocabulary. */
export function toIssue(e: ErrorObject, location: ValidationIssue["location"] = "body"): ValidationIssue {
  const base = e.instancePath === "" ? "" : e.instancePath;
  const params = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "required":
      return {
        field: `${base}/${String(params.missingProperty)}`,
        location,
        issue: "MISSING_REQUIRED_PARAMETER",
        description: "A required field is missing.",
      };
    case "maxLength":
      return {
        field: base || "/",
        location,
        issue: "INVALID_STRING_MAX_LENGTH",
        description: `The value of a field is too long (maximum ${String(params.limit)}).`,
      };
    case "minLength":
      return {
        field: base || "/",
        location,
        issue: "INVALID_STRING_LENGTH",
        description: `The value of a field is either too short or too long (minimum ${String(params.limit)}).`,
      };
    case "maxItems":
      return {
        field: base || "/",
        location,
        issue: "INVALID_ARRAY_MAX_ITEMS",
        description: `The number of items in an array parameter is too large (maximum ${String(params.limit)}).`,
      };
    case "minItems":
      return {
        field: base || "/",
        location,
        issue: "INVALID_ARRAY_MIN_ITEMS",
        description: `The number of items in an array parameter is too small (minimum ${String(params.limit)}).`,
      };
    case "maximum":
      return {
        field: base || "/",
        location,
        issue: "INVALID_INTEGER_MAX_VALUE",
        description: `Value exceeds max value (${String(params.limit)}).`,
      };
    case "minimum":
      return {
        field: base || "/",
        location,
        issue: "INVALID_INTEGER_MIN_VALUE",
        description: `Value less than minimum value (${String(params.limit)}).`,
      };
    case "enum":
      return {
        field: base || "/",
        location,
        issue: "INVALID_PARAMETER_VALUE",
        description: "The value of a field is invalid.",
      };
    default:
      return {
        field: base || "/",
        location,
        issue: "INVALID_PARAMETER_SYNTAX",
        description: `The value of a field does not conform to the expected format (${e.keyword}).`,
      };
  }
}

export interface ContractOptions {
  specDir: string;
}

/** Error-body schema per spec, used for every non-2xx response (op-specific issue enums are not exhaustive). */
const ERROR_SCHEMA: Record<SpecName, (status: number, has: (n: string) => boolean) => string> = {
  invoicing: (s, has) => (has(`error_${s}`) ? `error_${s}` : s >= 500 ? "error_500" : "__generic_error"),
  reporting: (s, has) => (has(`error_${s}`) ? `error_${s}` : s >= 500 ? "error_500" : "__generic_error"),
  payouts: () => "error",
  webhooks: () => "error-2",
  conditional_rules: () => "error",
  oauth: () => "oauth_error",
};

const GENERIC_ERROR: JsonObject = {
  type: "object",
  required: ["name", "message", "debug_id"],
  properties: { name: { type: "string" }, message: { type: "string" }, debug_id: { type: "string" } },
};

export class Contract {
  private readonly ajv: Ajv;
  private readonly ops = new Map<string, Operation>();
  private readonly defs = new Map<SpecName, Set<string>>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly seenRequests = new Set<string>();
  private readonly seenResponses = new Map<string, Set<number>>();
  readonly specs: Record<SpecName, { title: string; version: string }>;

  constructor(opts: ContractOptions) {
    this.ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false, validateFormats: true });
    const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
      addFormatsModule) as unknown as (ajv: Ajv) => Ajv;
    addFormats(this.ajv);
    for (const f of [
      "ppaas_common_country_code_v2",
      "ppaas_date_notime_v2",
      "ppaas_date_time_v3",
      "ppaas_common_email_address_v2",
      "ppaas_common_language_v3",
      "ppaas_common_percentage_v2",
      "ppaas_common_currency_code_v2",
      "ppaas_payer_id_v3",
    ]) {
      // PayPal-internal format names; every one of them is paired with a `pattern` in the spec.
      this.ajv.addFormat(f, true);
    }
    const specs = {} as Record<SpecName, { title: string; version: string }>;
    for (const [name, file] of Object.entries(SPEC_FILES) as [SpecName, string][]) {
      const doc = JSON.parse(readFileSync(join(opts.specDir, file), "utf8")) as JsonObject;
      const info = isObject(doc.info) ? doc.info : {};
      specs[name] = { title: String(info.title ?? name), version: String(info.version ?? "?") };
      this.load(name, doc);
    }
    this.specs = specs;
  }

  private load(spec: SpecName, doc: JsonObject): void {
    const components = isObject(doc.components) ? doc.components : {};
    const schemas = isObject(components.schemas) ? components.schemas : {};
    const responses = isObject(components.responses) ? components.responses : {};
    const converter = new SpecConverter(schemas);
    const definitions: Record<Mode, JsonObject> = { req: {}, res: {} };
    const names = new Set<string>(Object.keys(schemas));
    for (const mode of ["req", "res"] as const) {
      for (const [n, s] of Object.entries(schemas)) definitions[mode][n] = converter.convert(s, mode);
      definitions[mode].__generic_error = GENERIC_ERROR;
    }
    names.add("__generic_error");

    const schemaOf = (content: Json | undefined): Json | undefined => {
      if (!isObject(content)) return undefined;
      const media = content["application/json"] ?? content["application/x-www-form-urlencoded"];
      return isObject(media) ? media.schema : undefined;
    };
    const paths = isObject(doc.paths) ? doc.paths : {};
    for (const [path, item] of Object.entries(paths)) {
      if (!isObject(item)) continue;
      for (const [method, op] of Object.entries(item)) {
        if (!isObject(op) || typeof op.operationId !== "string") continue;
        const key = `${spec}:${op.operationId}`;
        const entry: Operation = {
          key,
          spec,
          operationId: op.operationId,
          method: method.toUpperCase(),
          path,
          request: null,
          responses: {},
        };
        const reqBody = isObject(op.requestBody) ? op.requestBody : undefined;
        const reqSchema = reqBody ? schemaOf(reqBody.content) : undefined;
        if (reqSchema !== undefined) {
          const n = `__req:${op.operationId}`;
          for (const mode of ["req", "res"] as const)
            definitions[mode][n] = converter.convert(reqSchema as Json, "req");
          names.add(n);
          entry.request = n;
        }
        const resps = isObject(op.responses) ? op.responses : {};
        for (const [status, r0] of Object.entries(resps)) {
          let r = r0;
          if (isObject(r) && typeof r.$ref === "string") r = responses[refName(r.$ref)] ?? r;
          const rs = isObject(r) ? schemaOf(r.content) : undefined;
          if (rs === undefined) {
            entry.responses[status] = null;
            continue;
          }
          const n = `__res:${op.operationId}:${status}`;
          for (const mode of ["req", "res"] as const)
            definitions[mode][n] = converter.convert(rs as Json, "res");
          names.add(n);
          entry.responses[status] = n;
        }
        this.ops.set(key, entry);
      }
    }
    for (const mode of ["req", "res"] as const) {
      this.ajv.addSchema({ $id: `fs-sim:${spec}:${mode}`, definitions: definitions[mode] });
    }
    this.defs.set(spec, names);
  }

  operations(): Operation[] {
    return [...this.ops.values()];
  }

  op(key: string): Operation {
    const o = this.ops.get(key);
    if (!o) throw new Error(`unknown operation ${key}`);
    return o;
  }

  has(spec: SpecName, def: string): boolean {
    return this.defs.get(spec)?.has(def) ?? false;
  }

  private validator(spec: SpecName, mode: Mode, def: string): ValidateFunction {
    const id = `fs-sim:${spec}:${mode}#/definitions/${def}`;
    let v = this.validators.get(id);
    if (!v) {
      const got = this.ajv.getSchema(id);
      if (!got) throw new Error(`no schema ${id}`);
      v = got;
      this.validators.set(id, v);
    }
    return v;
  }

  /** Validates a value against a named component schema (request or response flavour). */
  check(spec: SpecName, def: string, value: unknown, mode: Mode = "res"): ValidationIssue[] {
    const v = this.validator(spec, mode, def);
    if (v(value)) return [];
    return (v.errors ?? []).map((e) => toIssue(e));
  }

  validateRequest(key: string, body: unknown): ValidationIssue[] {
    const o = this.op(key);
    this.seenRequests.add(key);
    if (!o.request) return [];
    return this.check(o.spec, o.request, body, "req");
  }

  /**
   * Validates a response body. 2xx bodies use the operation's documented schema (or `override`, for the
   * documented `Prefer: return=minimal` link body); error bodies use the spec's error schema for that status.
   */
  validateResponse(key: string, status: number, body: unknown, override?: string): ValidationIssue[] {
    const o = this.op(key);
    let seen = this.seenResponses.get(key);
    if (!seen) {
      seen = new Set();
      this.seenResponses.set(key, seen);
    }
    seen.add(status);
    let def: string | null | undefined;
    if (override) def = override;
    else if (status >= 400) def = ERROR_SCHEMA[o.spec](status, (n) => this.has(o.spec, n));
    else def = o.responses[String(status)] ?? (status === 204 ? null : o.responses.default);
    if (!def) {
      if (body === undefined || body === null || body === "") return [];
      return [
        {
          field: "/",
          location: "body",
          issue: "UNDOCUMENTED_RESPONSE_BODY",
          description: `No schema for ${status}`,
        },
      ];
    }
    return this.check(o.spec, def, body, "res");
  }

  coverage(): { requests: string[]; responses: Record<string, number[]> } {
    const responses: Record<string, number[]> = {};
    for (const [k, v] of this.seenResponses) responses[k] = [...v].sort();
    return { requests: [...this.seenRequests].sort(), responses };
  }
}

/** Resolves the package's spec directory from this module's location (src/contract → ../../spec). */
export function defaultSpecDir(): string {
  return fileURLToPath(new URL("../../spec/", import.meta.url));
}
