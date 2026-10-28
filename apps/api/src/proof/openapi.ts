// OpenAPI entries for the slice's raw (non-JSON) routes, so /openapi.json and Scalar describe every path this
// slice serves: the public Proof stream (text/event-stream), the brand CSV (text/csv) and the archived-photo
// tile (image/svg+xml). JSON routes are documented by the shell from their zod specs.
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";

type Json = Record<string, unknown>;

const SECURITY: Readonly<Record<"none" | "public", Json[]>> = {
  none: [{}],
  public: [{}, { bearerToken: [] }, { judgeCookie: [] }],
};

const API_ERROR = { $ref: "#/components/schemas/ApiError" };

export interface RawRouteDoc {
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  auth: "none" | "public";
  contentType: string;
  /** The body: a zod schema (converted here) or a plain JSON Schema. */
  body: z.ZodType | Json;
  params: readonly { name: string; schema: Json; description?: string }[];
  headers?: readonly { name: string; description: string }[];
  /** Error statuses this route answers with (bodies are IC-01 ApiError). */
  errors: readonly { status: number; codes: readonly string[] }[];
}

function jsonSchemaOf(body: z.ZodType | Json): Json {
  if (body && typeof body === "object" && "_zod" in body) {
    const { $schema: _s, ...rest } = z.toJSONSchema(body as z.ZodType, {
      target: "draft-2020-12",
      unrepresentable: "any",
    }) as Json;
    return rest;
  }
  return body as Json;
}

export function documentRawRoute(app: OpenAPIHono<AppEnv>, d: RawRouteDoc): void {
  const responses: Record<string, Json> = {
    "200": { description: "OK", content: { [d.contentType]: { schema: jsonSchemaOf(d.body) } } },
  };
  for (const e of d.errors) {
    responses[String(e.status)] = {
      description: e.codes.join(" | "),
      "x-error-codes": [...e.codes],
      content: { "application/json": { schema: API_ERROR } },
    };
  }
  app.openAPIRegistry.registerPath({
    method: "get",
    path: d.path,
    operationId: d.operationId,
    tags: [d.tag],
    summary: d.summary,
    description: d.description,
    security: SECURITY[d.auth],
    request: {},
    parameters: [
      ...d.params.map((p) => ({
        name: p.name,
        in: "path",
        required: true,
        schema: p.schema,
        ...(p.description ? { description: p.description } : {}),
      })),
      ...(d.headers ?? []).map((h) => ({
        name: h.name,
        in: "header",
        required: false,
        schema: { type: "string" },
        description: h.description,
      })),
    ],
    responses,
  } as never);
}

export const RUN_SLUG_PARAM = {
  name: "runSlug",
  schema: { type: "string", pattern: "^\\d{4}[A-Z]-r\\d+$", examples: ["2026A-r37"] },
} as const;
