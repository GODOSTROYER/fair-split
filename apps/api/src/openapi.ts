// IC-08: the OpenAPI 3.1 document, generated from `API_COMMANDS` (never hand-edited), served at
// `/openapi.json` (and `/v1/openapi.json`), with Scalar at `/docs` (and `/v1/docs`).
//
// Schemas: every zod schema exported by @fairsplit/contracts is named after its export (HoldDTO, Json,
// ResolveHoldRequest, …) in a private registry, converted with zod's own `toJSONSchema` (draft 2020-12, which
// OpenAPI 3.1 uses; recursive `Json` becomes a `$ref`), and hoisted into `components.schemas`. Paths are
// assembled by @hono/zod-openapi's registry from plain JSON Schema refs, so the contracts' zod copy never
// meets zod-to-openapi (two zod instances under the hoisted linker) and the document stays deterministic.
import * as contracts from "@fairsplit/contracts";
import { ERROR_HTTP_STATUS, type ErrorCode } from "@fairsplit/contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { RouteSpec } from "./lib/command.js";
import { pathParamNames } from "./lib/commands.js";
import type { AppEnv } from "./lib/context.js";

type Json = Record<string, unknown>;
type Io = "input" | "output";

const SCHEMA_OPTIONS = { target: "draft-2020-12", unrepresentable: "any", cycles: "ref" } as const;

/** Names every zod schema exported by contracts, converts on demand, and collects the components. */
export class SchemaCatalog {
  readonly #registry = z.registry<{ id: string }>();
  readonly #components = new Map<string, Json>();
  readonly #names = new Map<z.ZodType, string>();

  constructor(extra: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries({ ...contracts, ...extra })) {
      if (!isZod(value) || this.#registry.has(value)) continue;
      this.#registry.add(value, { id: name });
      this.#names.set(value, name);
    }
  }

  nameOf(schema: z.ZodType): string | undefined {
    return this.#names.get(schema);
  }

  /** A `$ref` to `schema` (registering it under `fallbackName` if it has no export name). */
  ref(schema: z.ZodType, io: Io, fallbackName?: string): Json {
    let name = this.#names.get(schema);
    if (!name) {
      if (!fallbackName) return this.inline(schema, io);
      name = fallbackName;
      this.#registry.add(schema, { id: name });
      this.#names.set(schema, name);
    }
    const out = z.toJSONSchema(schema, { ...SCHEMA_OPTIONS, metadata: this.#registry, io }) as Json;
    const defs = (out.$defs ?? {}) as Record<string, Json>;
    let rootName = name;
    for (const [defName, def] of Object.entries(defs)) {
      const target = this.#place(defName, rewriteRefs(def) as Json, io);
      if (defName === name) rootName = target;
    }
    return { $ref: `#/components/schemas/${rootName}` };
  }

  /** The schema inlined (refs to named schemas still hoisted). */
  inline(schema: z.ZodType, io: Io): Json {
    const out = z.toJSONSchema(schema, { ...SCHEMA_OPTIONS, metadata: this.#registry, io }) as Json;
    const { $defs, $schema: _s, ...rest } = out as Json & { $defs?: Record<string, Json> };
    for (const [defName, def] of Object.entries($defs ?? {}))
      this.#place(defName, rewriteRefs(def) as Json, io);
    return rewriteRefs(rest) as Json;
  }

  components(): Record<string, Json> {
    return Object.fromEntries([...this.#components.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  /** Store a component; if the input and output shapes differ, keep both (`Name` and `NameInput`). */
  #place(name: string, def: Json, io: Io): string {
    const existing = this.#components.get(name);
    if (!existing) {
      this.#components.set(name, def);
      return name;
    }
    if (stable(existing) === stable(def)) return name;
    const alt = io === "input" ? `${name}Input` : `${name}Output`;
    this.#components.set(alt, def);
    return alt;
  }
}

function isZod(v: unknown): v is z.ZodType {
  return (
    !!v &&
    typeof v === "object" &&
    "_zod" in v &&
    typeof (v as { safeParse?: unknown }).safeParse === "function"
  );
}

function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema") continue;
    out[k] =
      k === "$ref" && typeof v === "string"
        ? v.replace(/^#\/\$defs\//, "#/components/schemas/")
        : rewriteRefs(v);
  }
  return out;
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Json).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

// ---------------------------------------------------------------- paths

/** `/v1/runs/:runSlug/approvals` → `/v1/runs/{runSlug}/approvals` (and `:runSlug.json` → `{runSlug}.json`). */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

const PARAM_DOCS: Record<string, Json> = {
  runSlug: { type: "string", pattern: "^\\d{4}[A-Z]-r\\d+$", examples: ["2026A-r37"] },
  ws: { type: "string", format: "uuid" },
};

const SECURITY: Record<string, Json[]> = {
  none: [{}, { judgeCookie: [] }],
  public: [{}, { bearerToken: [] }, { judgeCookie: [] }],
  frame_or_session: [{ bearerToken: [] }, { judgeCookie: [] }],
  operator: [{ operatorCookie: [] }],
};

function successDescription(status: number): string {
  return status === 201 ? "Created" : status === 202 ? "Accepted" : status === 204 ? "No Content" : "OK";
}

function errorResponses(spec: RouteSpec, catalog: SchemaCatalog): Record<string, Json> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of spec.errors) {
    const s = ERROR_HTTP_STATUS[code];
    byStatus.set(s, [...(byStatus.get(s) ?? []), code]);
  }
  const out: Record<string, Json> = {};
  for (const [status, codes] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
    const schema =
      codes.length === 1 && codes[0] === "RATE_CARD_RATIFIED"
        ? catalog.ref(contracts.RateCardRatifiedError, "output")
        : status === 409 && codes.includes("RATE_CARD_RATIFIED")
          ? {
              oneOf: [
                catalog.ref(contracts.RateCardRatifiedError, "output"),
                catalog.ref(contracts.ApiError, "output"),
              ],
            }
          : catalog.ref(contracts.ApiError, "output");
    out[String(status)] = {
      description: codes.join(" | "),
      "x-error-codes": codes,
      content: { "application/json": { schema } },
    };
  }
  if (spec.contract && spec.placeholder) {
    out["501"] = {
      description:
        "NOT_IMPLEMENTED while the slice that owns this command is being built (code INTERNAL, details.reason NOT_IMPLEMENTED)",
      content: { "application/json": { schema: catalog.ref(contracts.ApiError, "output") } },
    };
  }
  return out;
}

const HEADER_DOCS: Record<string, string> = {
  "Content-Digest": "RFC 9530 `sha-256=:<base64>:` over the exact request body",
  "Idempotency-Key": "UUIDv7; a retry with the same body replays the stored response (S3.10)",
  "Last-Event-ID": "Resume after this event id (SSE replay)",
};

/** Registers the OpenAPI path for one route (an IC-01 command or a slice route). */
export function documentRoute(app: OpenAPIHono<AppEnv>, catalog: SchemaCatalog, spec: RouteSpec): void {
  const params = pathParamNames(spec.path).map((p) => {
    const custom = spec.params?.[p];
    return {
      name: p,
      in: "path",
      required: true,
      schema:
        PARAM_DOCS[p] ?? (custom ? catalog.inline(custom, "input") : { type: "string", format: "uuid" }),
    };
  });
  const headerParams = spec.headers.map((h) => ({
    name: h,
    in: "header",
    required: h !== "Last-Event-ID",
    schema: { type: "string" },
    description: HEADER_DOCS[h] ?? h,
  }));
  const hasBody = spec.method === "POST" || spec.method === "PUT" || spec.method === "PATCH";
  let queryParams: Json[] = [];
  if (!hasBody && spec.request) {
    const q = catalog.inline(spec.request, "input");
    const required = (q.required ?? []) as string[];
    queryParams = Object.entries((q.properties ?? {}) as Record<string, Json>).map(([name, schema]) => ({
      name,
      in: "query",
      required: required.includes(name),
      schema,
    }));
  }
  const success: Record<string, Json> = {};
  if (spec.sse) {
    success["200"] = {
      description:
        "Server-sent events: IC-01 RunEvent envelopes (`event:` is the type, `id:` the Last-Event-ID)",
      content: { "text/event-stream": { schema: catalog.ref(contracts.RunEvent, "output") } },
    };
  } else {
    for (const status of spec.success) {
      success[String(status)] =
        spec.response && status !== 204
          ? {
              description: successDescription(status),
              content: {
                "application/json": {
                  schema: catalog.ref(spec.response, "output", `${pascal(spec.name)}Response`),
                },
              },
            }
          : { description: successDescription(status) };
    }
  }
  const route = {
    method: spec.method.toLowerCase(),
    path: toOpenApiPath(spec.path),
    operationId: spec.name,
    tags: [spec.tag],
    summary: spec.summary ?? spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    security: SECURITY[spec.auth],
    request: {},
    responses: { ...success, ...errorResponses(spec, catalog) },
    parameters: [...params, ...headerParams, ...queryParams],
    ...(hasBody && spec.request
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: catalog.ref(spec.request, "input", `${pascal(spec.name)}Request`),
              },
            },
          },
        }
      : {}),
  };
  app.openAPIRegistry.registerPath(route as never);
}

function pascal(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export interface DocumentInfo {
  version: string;
  publicOrigin: string;
  railLabel: string;
}

export function buildOpenApiDocument(app: OpenAPIHono<AppEnv>, catalog: SchemaCatalog, info: DocumentInfo) {
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Fair Split API",
      version: info.version,
      description: [
        "Audited co-op payroll on PayPal. Claude reads handwritten slips; code computes every amount; two officers sign; PayPal executes.",
        "",
        `PayPal rail on this server: **${info.railLabel}** (every /v1 response carries \`X-FS-Rail\`). Everything simulated is labelled.`,
        "Errors are IC-01 `ApiError` bodies. Commands are generated from `@fairsplit/contracts` `API_COMMANDS`.",
      ].join("\n"),
      license: { name: "MIT", url: "https://opensource.org/license/mit" },
    },
    servers: [{ url: info.publicOrigin }],
  });
  const components = (doc.components ?? {}) as Json;
  return {
    ...doc,
    components: {
      ...components,
      schemas: { ...((components.schemas ?? {}) as Json), ...catalog.components() },
      securitySchemes: {
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description:
            "`fst_…` frame/console token (2 h), `fsd_…` app device token, `fsm_…` member link or `fsb_…` brand link. Never put one in a URL.",
        },
        judgeCookie: {
          type: "apiKey",
          in: "cookie",
          name: "fs_js",
          description: "Judge session (HMAC-signed, 24 h)",
        },
        operatorCookie: {
          type: "apiKey",
          in: "cookie",
          name: "fs_ops",
          description: "Operator session (8 h)",
        },
      },
    },
  };
}

// ---------------------------------------------------------------- Scalar

/** Pinned Scalar build (published 2026-10-07, ≥ 14 days old) with Subresource Integrity from jsDelivr. */
export const SCALAR = {
  src: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1/dist/browser/standalone.js",
  integrity: "sha256-YsNKDdo4lFhkAR669uf6eBKjMkKRINGJIrNNAcT3zMg=",
} as const;

/**
 * The docs page. It is served with a CSP `sandbox allow-scripts` (an opaque origin: the CDN script can never
 * reach the judge cookie or the API with credentials) and carries the document inline, so it needs no fetch.
 */
export function docsHtml(document: unknown): string {
  const json = JSON.stringify(document).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Fair Split API</title>
</head>
<body>
<noscript>The OpenAPI document is at <a href="/openapi.json">/openapi.json</a>.</noscript>
<script id="api-reference" type="application/json" data-configuration='{"withDefaultFonts":false,"hideClientButton":true}'>${json}</script>
<script src="${SCALAR.src}" integrity="${SCALAR.integrity}" crossorigin="anonymous"></script>
</body>
</html>`;
}

export const DOCS_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  `script-src ${SCALAR.src}`,
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
