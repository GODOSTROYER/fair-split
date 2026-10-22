// The typed Payouts tool in the Agent Toolkit `Tool` shape, with PR #107's names and actions
// (adapted from typescript/src/shared/tools.ts at 5cca31b, Apache-2.0; see NOTICE). The model sees
// only the two reads; create and cancel are server-only and reachable solely through
// PayoutsService (register §8).

import type { CallPriority, PayPalHttp } from "@fairsplit/paypal-core";
import type { z } from "zod";
import { AGENT_READ_TOOL_JSON_SCHEMAS } from "./agent-read-schemas.js";
import { getPayoutBatch, getPayoutItem } from "./functions.js";
import {
  type Context,
  cancelUnclaimedPayoutItemParameters,
  createPayoutBatchParameters,
  getPayoutBatchParameters,
  getPayoutItemParameters,
} from "./parameters.js";
import {
  cancelUnclaimedPayoutItemPrompt,
  createPayoutBatchPrompt,
  getPayoutBatchPrompt,
  getPayoutItemPrompt,
} from "./prompts.js";

/**
 * Structurally identical to `Tool` in @paypal/agent-toolkit 1.11.0 (`/mcp`). Copied, not imported:
 * @fairsplit/paypal-toolkit is the only package that imports the toolkit.
 */
export type Tool = {
  method: string;
  name: string;
  description: string;
  parameters: z.AnyZodObject;
  actions: {
    [key: string]: {
      [action: string]: boolean;
    };
  };
};

export type Configuration = {
  actions: { [product: string]: { [action: string]: boolean } };
  context?: Context;
};

/** The toolkit's own gate (shared/configuration.ts), unchanged: any matching enabled action allows the tool. */
export function isToolAllowed(tool: Pick<Tool, "actions">, configuration: Configuration): boolean {
  for (const product in tool.actions) {
    for (const action in tool.actions[product]) {
      if (configuration.actions[product]?.[action]) return true;
    }
  }
  return false;
}

export const payoutTools = (context: Context): Tool[] => [
  {
    method: "create_payout_batch",
    name: "Create Batch Payout",
    description: createPayoutBatchPrompt(context),
    parameters: createPayoutBatchParameters(context),
    actions: {
      payouts: {
        create: true,
      },
    },
  },
  {
    method: "get_payout_batch",
    name: "Get Batch Payout",
    description: getPayoutBatchPrompt(context),
    parameters: getPayoutBatchParameters(context),
    actions: {
      payouts: {
        get: true,
      },
    },
  },
  {
    method: "get_payout_item",
    name: "Get Payout Item",
    description: getPayoutItemPrompt(context),
    parameters: getPayoutItemParameters(context),
    actions: {
      payouts: {
        getItem: true,
      },
    },
  },
  {
    method: "cancel_unclaimed_payout_item",
    name: "Cancel Unclaimed Payout Item",
    description: cancelUnclaimedPayoutItemPrompt(context),
    parameters: cancelUnclaimedPayoutItemParameters(context),
    actions: {
      payouts: {
        cancelItem: true,
      },
    },
  },
];

export const PAYOUT_METHODS = [
  "create_payout_batch",
  "get_payout_batch",
  "get_payout_item",
  "cancel_unclaimed_payout_item",
] as const;
export const AGENT_PAYOUT_METHODS = ["get_payout_batch", "get_payout_item"] as const;
export const SERVER_ONLY_PAYOUT_METHODS = ["create_payout_batch", "cancel_unclaimed_payout_item"] as const;

export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export type AgentPayoutMethod = (typeof AGENT_PAYOUT_METHODS)[number];

/** What the agent may enable: the two reads (S3 §S3.6.4 AGENT_PAYOUT_ACTIONS). */
export const AGENT_PAYOUT_ACTIONS = { payouts: { get: true, getItem: true } } as const;

/**
 * PR #107's ALL_TOOLS_ENABLED.payouts: every payout action except the two that move funds, which
 * must be enabled by name ("an agent that reads untrusted content could be steered into paying an
 * attacker").
 */
const MONEY_MOVING_PAYOUT_ACTIONS: ReadonlySet<string> = new Set(["create", "cancelItem"]);

export const ALL_PAYOUT_TOOLS_ENABLED: { readonly payouts: Readonly<Record<string, boolean>> } = {
  payouts: Object.fromEntries(
    payoutTools({})
      .flatMap((tool) => Object.entries(tool.actions.payouts ?? {}))
      .filter(([action]) => !MONEY_MOVING_PAYOUT_ACTIONS.has(action)),
  ),
};

/** The agent's payout tools: `get_payout_batch` and `get_payout_item`, in that order. */
export function agentPayoutTools(context: Context = { sandbox: true }): Tool[] {
  return payoutTools(context).filter((tool) => isToolAllowed(tool, { actions: AGENT_PAYOUT_ACTIONS }));
}

export interface AgentPayoutToolSchema {
  name: AgentPayoutMethod;
  description: string;
  input_schema: { type: "object"; [keyword: string]: unknown };
}

/**
 * The two read tools as JSON Schema for the Messages API: converted from the zod parameters the same
 * way the toolkit's `/openai` export converts its own tools (zod-to-json-schema, draft-07, inlined),
 * once, at dev time (scripts/gen-read-schemas.ts), and checked in. Each call returns a fresh copy.
 */
export function agentPayoutToolSchemas(): AgentPayoutToolSchema[] {
  return agentPayoutTools().map((tool) => {
    const name = tool.method as AgentPayoutMethod;
    return {
      name,
      description: tool.description,
      input_schema: structuredClone(
        AGENT_READ_TOOL_JSON_SCHEMAS[name],
      ) as AgentPayoutToolSchema["input_schema"],
    };
  });
}

/** The model asked for a payout tool it may not use. Nothing was sent. */
export class PayoutToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`The agent may not call ${tool}; payouts move only through PayoutsService`);
    this.name = "PayoutToolNotAllowedError";
  }
}

/** PayPal answered a read with an error. */
export class PayoutsApiError extends Error {
  constructor(
    readonly method: PayoutMethod,
    readonly status: number,
    readonly paypalName: string,
    readonly debugId: string | null,
    message: string,
  ) {
    super(`${method}: ${status} ${paypalName}: ${message}`);
    this.name = "PayoutsApiError";
  }
}

const AGENT_METHOD_SET: ReadonlySet<string> = new Set(AGENT_PAYOUT_METHODS);

/** Runs one of the agent's two read tools. Create and cancel are refused before anything is sent. */
export async function runAgentPayoutTool(
  http: PayPalHttp,
  tool: string,
  args: unknown,
  options: { priority?: CallPriority } = {},
): Promise<unknown> {
  if (!AGENT_METHOD_SET.has(tool)) throw new PayoutToolNotAllowedError(tool);
  const context: Context = { sandbox: true };
  const result =
    tool === "get_payout_batch"
      ? await getPayoutBatch(http, context, args as never, options)
      : await getPayoutItem(http, context, args as never, options);
  if (result.ok) return result.body;
  throw new PayoutsApiError(
    tool as AgentPayoutMethod,
    result.status,
    result.name,
    result.debugId,
    result.message,
  );
}
