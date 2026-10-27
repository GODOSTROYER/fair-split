// Dev-time only: converts the agent's two payout read-tool schemas (zod 3, vendored from PR #107) to
// the JSON Schema the toolkit's /openai export would declare for them (draft-07, inlined, closed
// objects), so src/agent-read-schemas.ts can be regenerated and checked for drift without
// zod-to-json-schema, which the architecture pins for the S2 fallback only. It knows exactly the zod
// types those two schemas use and throws on anything else, so a drift test can never pass vacuously.

import { z } from "zod";

export type JsonSchema = { [keyword: string]: unknown };

export class UnsupportedZodError extends Error {
  constructor(what: string) {
    super(`zod-json-schema: ${what} is not supported; extend scripts/zod-json-schema.ts`);
    this.name = "UnsupportedZodError";
  }
}

function withDescription(schema: z.ZodTypeAny, out: JsonSchema): JsonSchema {
  return schema.description === undefined ? out : { ...out, description: schema.description };
}

function stringSchema(schema: z.ZodString): JsonSchema {
  const out: JsonSchema = { type: "string" };
  for (const check of schema._def.checks) {
    if (check.kind === "regex") {
      if (check.regex.flags !== "") throw new UnsupportedZodError(`a regex with flags (${check.regex})`);
      out.pattern = check.regex.source;
    } else if (check.kind === "min") out.minLength = check.value;
    else if (check.kind === "max") out.maxLength = check.value;
    else throw new UnsupportedZodError(`the string check "${check.kind}"`);
  }
  return out;
}

function numberSchema(schema: z.ZodNumber): JsonSchema {
  const out: JsonSchema = { type: "number" };
  for (const check of schema._def.checks) {
    if (check.kind === "int") out.type = "integer";
    else if (check.kind === "min" && check.inclusive) out.minimum = check.value;
    else if (check.kind === "max" && check.inclusive) out.maximum = check.value;
    else throw new UnsupportedZodError(`the number check "${check.kind}"`);
  }
  return out;
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodDefault) {
    return withDescription(schema, {
      ...convert(schema._def.innerType),
      default: schema._def.defaultValue(),
    });
  }
  if (schema instanceof z.ZodString) return withDescription(schema, stringSchema(schema));
  if (schema instanceof z.ZodNumber) return withDescription(schema, numberSchema(schema));
  if (schema instanceof z.ZodBoolean) return withDescription(schema, { type: "boolean" });
  throw new UnsupportedZodError(schema.constructor.name);
}

/** A strip-mode zod object of strings, numbers and booleans (some with defaults), as draft-07. */
export function zodObjectToJsonSchema(schema: z.AnyZodObject): JsonSchema {
  if (schema._def.unknownKeys !== "strip")
    throw new UnsupportedZodError(`unknownKeys "${schema._def.unknownKeys}"`);
  const properties: JsonSchema = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    properties[key] = convert(field);
    if (!(field instanceof z.ZodDefault)) required.push(key);
  }
  return withDescription(schema, {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  });
}
