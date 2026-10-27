// The agent's two payout read tools are declared from a checked-in JSON Schema, so nothing converts
// zod at runtime and zod-to-json-schema (pinned for the S2 fallback only) is not a dependency at all.
// This test keeps the file honest: it must equal what scripts/zod-json-schema.ts makes from the
// vendored PR #107 zod schemas today.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readToolJsonSchemas } from "../scripts/gen-read-schemas.js";
import { UnsupportedZodError, zodObjectToJsonSchema } from "../scripts/zod-json-schema.js";
import { AGENT_READ_TOOL_JSON_SCHEMAS } from "../src/agent-read-schemas.js";
import { agentPayoutToolSchemas } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("checked-in agent read-tool schemas", () => {
  it("equal the conversion of parameters.ts (on drift run `corepack pnpm --filter @fairsplit/paypal-payouts gen:read-schemas`)", () => {
    expect(JSON.parse(JSON.stringify(AGENT_READ_TOOL_JSON_SCHEMAS))).toEqual(readToolJsonSchemas());
  });

  it("are what the agent is declared, as copies a caller cannot edit", () => {
    const first = agentPayoutToolSchemas();
    expect(first.map((t) => t.input_schema)).toEqual(Object.values(readToolJsonSchemas()));
    const declared = first[0]?.input_schema as { required: string[] } | undefined;
    declared?.required.push("tampered");
    expect(agentPayoutToolSchemas()[0]?.input_schema).toMatchObject({ required: ["payout_batch_id"] });
  });

  it("the converter refuses zod it does not know, so the drift check cannot pass vacuously", () => {
    expect(() => zodObjectToJsonSchema(z.object({ ids: z.array(z.string()) }))).toThrow(UnsupportedZodError);
    expect(() => zodObjectToJsonSchema(z.object({ id: z.string().email() }))).toThrow(UnsupportedZodError);
    expect(() => zodObjectToJsonSchema(z.object({ n: z.number().positive() }))).toThrow(UnsupportedZodError);
    expect(() => zodObjectToJsonSchema(z.object({ id: z.string() }).strict())).toThrow(UnsupportedZodError);
  });

  it("leave zod-to-json-schema out entirely: no dependency of any kind, never imported", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("zod-to-json-schema");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("zod-to-json-schema");
    const sources = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      expect(readFileSync(join(root, "src", file), "utf8"), file).not.toMatch(
        /from\s+["']zod-to-json-schema["']/,
      );
    }
  });
});
