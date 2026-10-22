// Contract tests against the real, installed @paypal/agent-toolkit 1.11.0 (S3.16 "Allowlists
// against the real 1.11.0"). No network: building tool lists never calls PayPal.

import { PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AGENT_ACTIONS,
  AGENT_TOOL_METHODS,
  agentToolSchemas,
  assertToolkitAllowlists,
  MONEY_MOVING_TOOLKIT_METHODS,
  PINNED_TOOLKIT_VERSION,
  SERVER_ACTIONS,
  SERVER_ONLY_METHODS,
  TOOLKIT_METHODS,
  toolkitActionKeys,
  toolkitVersion,
  toolkitZodSchemas,
} from "../src/index.js";

describe("allowlist contract: @paypal/agent-toolkit 1.11.0", () => {
  it("is the pinned version", () => {
    expect(toolkitVersion()).toBe(PINNED_TOOLKIT_VERSION);
  });

  it("knows every action key we enable (isToolAllowed would silently drop an unknown one)", () => {
    const known = toolkitActionKeys();
    for (const actions of [AGENT_ACTIONS, SERVER_ACTIONS]) {
      for (const [product, keys] of Object.entries(actions)) {
        for (const key of Object.keys(keys)) expect(known[product]?.[key], `${product}.${key}`).toBe(true);
      }
    }
  });

  it("declares exactly the four Invoicing tools to the agent, in a fixed order", () => {
    expect(agentToolSchemas().map((t) => t.name)).toEqual([
      "create_invoice",
      "send_invoice",
      "create_conditional_rules_for_invoice",
      "get_invoice",
    ]);
    expect(AGENT_TOOL_METHODS).toHaveLength(4);
  });

  it("never declares a server-only or money-moving method to the agent", () => {
    const names = new Set<string>(agentToolSchemas().map((t) => t.name));
    for (const m of [...SERVER_ONLY_METHODS, ...MONEY_MOVING_TOOLKIT_METHODS])
      expect(names.has(m), m).toBe(false);
    // Register §8: generateQRC is dropped, because no screen shows an invoice QR.
    expect(names.has("generate_invoice_qr_code")).toBe(false);
    expect(JSON.stringify(AGENT_ACTIONS)).not.toContain("generateQRC");
  });

  it("serves JSON Schema objects (draft-07, inlined, closed) straight from the /openai export", () => {
    for (const tool of agentToolSchemas()) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(JSON.stringify(tool.input_schema)).not.toContain("$ref");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("hands out copies, so a caller cannot edit what the next session declares", () => {
    const first = agentToolSchemas();
    (first[0] as { description: string }).description = "tampered";
    expect(agentToolSchemas()[0]?.description).not.toBe("tampered");
  });

  it("validates with the toolkit's own zod for exactly the six server methods", () => {
    expect([...toolkitZodSchemas().keys()].sort()).toEqual([...TOOLKIT_METHODS].sort());
    expect(() => assertToolkitAllowlists()).not.toThrow();
  });

  it("documents the S2 fallback: converting the /mcp zod schemas gives the same JSON Schema", () => {
    const mcp = new PayPalMCPToolkit({
      accessToken: "-",
      configuration: { actions: AGENT_ACTIONS, context: { sandbox: true } },
    });
    const converted = new Map(mcp.getTools().map((t) => [t.method, zodToJsonSchema(t.parameters)]));
    for (const tool of agentToolSchemas()) expect(converted.get(tool.name)).toEqual(tool.input_schema);
  });
});
