// The policy lattice at the money edge (register §9, S4.4). When an agent's tool call reaches the
// invoice chain, the executor runs WS-CORE's `decide(call, ctx)` again, on exactly the arguments it
// is about to send: core's `canonicalInvoiceCall` body, never the model's. The executor knows the
// invoice part of the context itself (the code's expectation, PayPal's invoice id and date, whether
// the invoice exists, PayPal's today); the caller supplies the rest, read fresh for every call.

import type { Decision, PolicyCtx, ToolCall } from "@fairsplit/contracts";

/**
 * What the lattice reads besides the invoice, as the agent runner read it for the model's call:
 * the kill flags (fresh), the environment, the run's state and holds, the agent session's budget and
 * the brand allowlist. `toolkitSandbox` is not here: tk() always runs the toolkit in its sandbox mode.
 */
export type InvoicePolicyEnv = Pick<PolicyCtx, "flags" | "ppEnv" | "runState" | "budget"> & {
  holds: readonly PolicyCtx["holds"][number][];
  brandAllowlist: readonly string[];
};

/** The agent turn's lattice: required for every call the agent's tools cause (agent.ts). */
export interface InvoicePolicy {
  /** Read before every call the chain is about to send (S4.4: flags read fresh each call). */
  env(): Promise<InvoicePolicyEnv>;
  /**
   * Told every decision with the exact call it was made on, before anything is sent (the ledger's
   * policy verdict). If it throws, nothing is sent.
   */
  onDecision?(call: ToolCall, decision: Decision): void | Promise<void>;
}

/** The lattice did not allow the call the chain was about to send. Nothing was sent. */
export class InvoicePolicyDeniedError extends Error {
  constructor(
    readonly call: ToolCall,
    readonly decision: Decision,
  ) {
    super(`${call.name}: ${decision.verdict} (${policyReasons(decision).join("; ")})`);
    this.name = "InvoicePolicyDeniedError";
  }

  /** `policy: reason` for each policy that set the verdict. */
  get reasons(): string[] {
    return policyReasons(this.decision);
  }
}

function policyReasons(decision: Decision): string[] {
  const deciding = new Set<string>(decision.decidedBy);
  return decision.results
    .filter((r) => deciding.has(r.policy))
    .map((r) => `${r.policy}: ${r.reason ?? r.verdict}`);
}
