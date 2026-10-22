import { z } from "zod";
import { GatewayError } from "./errors.js";
import type { ClaudeMessage, OutputFormat } from "./types.js";

/**
 * zod 4 → structured-output JSON Schema.
 *
 * We do not use the SDK's `betaZodOutputFormat`: in @anthropic-ai/sdk 0.137.0 its transform moves
 * every keyword it does not know (including `enum`) into the description, so enum constraints would
 * never reach constrained decoding. This sanitiser keeps every keyword structured outputs support
 * (type, properties, required, additionalProperties:false, items, enum, const, anyOf, allOf,
 * $ref/$defs, supported string formats, minItems 0|1, description, title, default) and drops the
 * rest, moving meaningful constraints into the description as guidance.
 */
const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);
const PASS_THROUGH = new Set(["type", "enum", "const", "description", "title", "default"]);
const SAFE_INT = Number.MAX_SAFE_INTEGER;

type Json = Record<string, unknown>;

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};
  const guidance: string[] = [];
  for (const [key, value] of Object.entries(src)) {
    if (PASS_THROUGH.has(key)) out[key] = value;
    else if (key === "$ref") out.$ref = value;
    else if (key === "$defs" || key === "definitions") {
      out[key] = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, sanitize(v)]));
    } else if (key === "properties") {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, sanitize(v)]));
    } else if (key === "items" || key === "anyOf" || key === "allOf") out[key] = sanitize(value);
    else if (key === "oneOf") out.anyOf = sanitize(value);
    else if (key === "required") out.required = value;
    else if (key === "additionalProperties") {
      /* forced to false below for objects */
    } else if (key === "format") {
      if (SUPPORTED_FORMATS.has(String(value))) out.format = value;
      else guidance.push(`format: ${JSON.stringify(value)}`);
    } else if (key === "minItems") {
      if (value === 0 || value === 1) out.minItems = value;
      else guidance.push(`minItems: ${JSON.stringify(value)}`);
    } else if ((key === "minimum" || key === "maximum") && Math.abs(Number(value)) >= SAFE_INT) {
      /* zod's z.int() safe-integer bounds carry no information */
    } else if (key === "$schema" || key === "$id") {
      /* dropped */
    } else guidance.push(`${key}: ${JSON.stringify(value)}`);
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    if (!out.properties) out.properties = {};
  }
  if (guidance.length > 0) {
    const desc = typeof out.description === "string" ? `${out.description}\n\n` : "";
    out.description = `${desc}{${guidance.join(", ")}}`;
  }
  return out;
}

export function jsonSchemaOf(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", reused: "ref", io: "output" });
  return sanitize(raw) as Json;
}

/** The `output_config.format` for a zod schema. */
export function jsonOutputFormat(schema: z.ZodType): OutputFormat {
  return { type: "json_schema", schema: jsonSchemaOf(schema) };
}

/**
 * Structured outputs do not guarantee the capitalisation of enum values (structured-outputs docs).
 * Walks schema and value together and snaps each enum string to its declared spelling.
 */
export function coerceEnumCase(schema: Json, value: unknown): unknown {
  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<string, Json>;
  const resolve = (node: Json): Json => {
    const ref = node.$ref;
    if (typeof ref === "string") {
      const name = ref.replace(/^#\/(\$defs|definitions)\//, "");
      const target = defs[name];
      return target ? resolve(target) : node;
    }
    return node;
  };
  const walk = (nodeIn: Json, v: unknown): unknown => {
    const node = resolve(nodeIn);
    if (Array.isArray(node.enum) && typeof v === "string") {
      const hit = (node.enum as unknown[]).find(
        (e) => typeof e === "string" && e.toLowerCase() === v.toLowerCase(),
      );
      return hit ?? v;
    }
    if (Array.isArray(v) && node.items && typeof node.items === "object") {
      return v.map((item) => walk(node.items as Json, item));
    }
    if (v && typeof v === "object" && !Array.isArray(v) && node.properties) {
      const props = node.properties as Record<string, Json>;
      return Object.fromEntries(
        Object.entries(v as Json).map(([k, item]) => [k, props[k] ? walk(props[k], item) : item]),
      );
    }
    return v;
  };
  return walk(schema, value);
}

/**
 * The JSON text of a structured response: its text blocks, in order (thinking blocks are skipped).
 * No server-side fallback is ever requested (S4.1 step 5), so the text is one model's answer.
 */
export function structuredText(message: ClaudeMessage): string {
  return message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** Parses a structured response against `schema` (enum case snapped first). Throws AI_SCHEMA. */
export function parseStructured<T>(message: ClaudeMessage, schema: z.ZodType<T>, format?: OutputFormat): T {
  const text = structuredText(message);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new GatewayError("AI_SCHEMA", "structured output is not valid JSON", {}, err);
  }
  const wire = format?.schema ?? jsonSchemaOf(schema);
  const result = schema.safeParse(coerceEnumCase(wire, json));
  if (!result.success) {
    throw new GatewayError("AI_SCHEMA", `structured output failed the schema: ${result.error.message}`);
  }
  return result.data;
}
