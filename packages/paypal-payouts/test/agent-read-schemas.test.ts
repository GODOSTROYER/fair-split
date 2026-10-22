// The agent's two payout read tools are declared from a checked-in JSON Schema, so the runtime needs
// no zod-to-json-schema (the architecture pins it for the S2 fallback only). This test keeps the file
// honest: it must equal what the converter makes from the vendored PR #107 zod schemas today.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readToolJsonSchemas } from "../scripts/gen-read-schemas.js";
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

  it("leave zod-to-json-schema out of the runtime: not a dependency, never imported by src", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("zod-to-json-schema");
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
