import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PayPalMCPToolkit, type Tool } from "@paypal/agent-toolkit/mcp";
import { ALL_TOOLS_ENABLED, PayPalAgentToolkit as OpenAIToolkit } from "@paypal/agent-toolkit/openai";
import type { z } from "zod";
import {
  AGENT_ACTIONS,
  AGENT_TOOL_METHODS,
  type AgentToolMethod,
  SERVER_ACTIONS,
  TOOLKIT_METHODS,
  type ToolkitMethod,
} from "./actions.js";

/** Pinned in the catalog; the contract test fails if the installed package drifts. */
export const PINNED_TOOLKIT_VERSION = "1.11.0";

/** A tool as declared to Claude (Messages API `tools[]` entry). */
export interface AgentToolSchema {
  name: AgentToolMethod;
  description: string;
  input_schema: { type: "object"; [keyword: string]: unknown };
}

export class ToolkitAllowlistError extends Error {
  constructor(
    readonly set: "agent" | "server",
    readonly missing: string[],
    readonly unexpected: string[],
  ) {
    super(
      `@paypal/agent-toolkit ${set} allowlist drifted: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
    );
    this.name = "ToolkitAllowlistError";
  }
}

// The toolkit makes no network call while building tool lists: the placeholder credentials below
// are never sent anywhere (handleToolCall, which would use them, is never called).
const PLACEHOLDER = "-";
const CONTEXT = { sandbox: true } as const;

function assertExactly(set: "agent" | "server", got: Iterable<string>, want: readonly string[]): void {
  const gotSet = new Set(got);
  const missing = want.filter((m) => !gotSet.has(m));
  const unexpected = [...gotSet].filter((m) => !want.includes(m));
  if (missing.length > 0 || unexpected.length > 0) throw new ToolkitAllowlistError(set, missing, unexpected);
}

let agentSchemas: readonly AgentToolSchema[] | undefined;
let zodByMethod: ReadonlyMap<ToolkitMethod, z.AnyZodObject> | undefined;

/**
 * The four Invoicing tools declared to the audit agent, as JSON Schema from the toolkit's
 * `/openai` export (graft G1), in a fixed order so the prompt cache stays valid. Each call returns
 * a fresh copy.
 */
export function agentToolSchemas(): AgentToolSchema[] {
  if (!agentSchemas) {
    const kit = new OpenAIToolkit({
      clientId: PLACEHOLDER,
      clientSecret: PLACEHOLDER,
      configuration: { actions: AGENT_ACTIONS, context: { ...CONTEXT } },
    });
    const byName = new Map(kit.getTools().map((t) => [t.function.name, t.function] as const));
    assertExactly("agent", byName.keys(), AGENT_TOOL_METHODS);
    agentSchemas = AGENT_TOOL_METHODS.map((name) => {
      const fn = byName.get(name);
      const parameters = fn?.parameters as AgentToolSchema["input_schema"] | undefined;
      if (!fn || parameters?.type !== "object") throw new ToolkitAllowlistError("agent", [name], []);
      return { name, description: fn.description ?? "", input_schema: parameters };
    });
  }
  return structuredClone(agentSchemas) as AgentToolSchema[];
}

/**
 * The toolkit's own zod schemas (from `/mcp`) for every method we execute. `tk()` validates
 * arguments with these before anything is sent.
 */
export function toolkitZodSchemas(): ReadonlyMap<ToolkitMethod, z.AnyZodObject> {
  if (!zodByMethod) {
    const kit = new PayPalMCPToolkit({
      accessToken: PLACEHOLDER,
      configuration: { actions: SERVER_ACTIONS, context: { ...CONTEXT } },
    });
    const tools: Tool[] = kit.getTools();
    assertExactly(
      "server",
      tools.map((t) => t.method),
      TOOLKIT_METHODS,
    );
    zodByMethod = new Map(tools.map((t) => [t.method as ToolkitMethod, t.parameters]));
  }
  return zodByMethod;
}

/** Boot assertion: both allowlists resolve to exactly our method sets in the installed toolkit. */
export function assertToolkitAllowlists(): void {
  agentToolSchemas();
  toolkitZodSchemas();
}

/** Every action key the installed toolkit knows, per product (used by the contract test). */
export function toolkitActionKeys(): Readonly<Record<string, Readonly<Record<string, boolean>>>> {
  return ALL_TOOLS_ENABLED;
}

/** The installed toolkit version (its exports map hides package.json, so read it from disk). */
export function toolkitVersion(): string {
  const entry = createRequire(import.meta.url).resolve("@paypal/agent-toolkit/mcp");
  const pkg = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "unknown";
}
