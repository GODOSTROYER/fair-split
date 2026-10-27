// The AgentMoneyPort (plan, "Repo, services and data"): the only way the audit agent (AI-7, WS-AGENT) reaches
// PayPal. The agent never imports paypal-* code; it calls this port, which apps/api implements over
// @fairsplit/paypal-toolkit and @fairsplit/paypal-payouts (agent/executor.ts).
//
// Defined here until IC-01 `contracts` carries it (SPLIT.md "Gaps in the base"): the shape follows S4.4's
// wrapper tools. No method takes an amount, quantity, date, number, reference, note or recipient (I1): the
// executor builds every body PayPal sees, and the policy lattice decides on that body before it is sent.
// No method moves money: creating and cancelling payouts are never agent tools (I6).
import type {
  AgentPurpose,
  InvoiceStatus,
  PayoutItemStatus,
  PolicyName,
  Verdict,
} from "@fairsplit/contracts";

export interface ItemLabels {
  premium: string;
  bonus: string;
  disbursement: string;
}

export type PortError = "POLICY_DENIED" | "APPROVAL_REQUIRED" | "PAYPAL_REJECTED" | "PAYPAL_UNAVAILABLE";

export type PortResult<T> =
  | { ok: true; verdict: Verdict; value: T }
  | { ok: false; verdict: Verdict; error: PortError; reason: string; decidedBy: PolicyName[] };

export interface InvoiceRead {
  invoiceId: string;
  invoiceNumber: string | null;
  status: InvoiceStatus | null;
  totalCents: number | null;
  dueCents: number | null;
  invoiceDate: string | null;
}

export interface PayoutBatchRead {
  payoutBatchId: string;
  batchStatus: string | null;
  items: { senderItemId: string; status: PayoutItemStatus | null }[];
}

export interface AgentMoneyPort {
  /** S4.4 tool 10 `create_run_invoice`: the agent chooses only the three item labels. */
  createRunInvoice(req: {
    runId: string;
    itemLabels: ItemLabels;
    draft?: unknown;
  }): Promise<PortResult<{ invoiceId: string; adopted: boolean }>>;
  /** Tool 11 `add_auto_cancel_rule`: SPECIFIC_DATE at PayPal's invoice date + 25 days (C-27). */
  addAutoCancelRule(req: { runId: string; invoiceId: string }): Promise<PortResult<{ autoCancelOn: string }>>;
  /** Tool 12 `send_run_invoice`: REQUIRE_APPROVAL; sent only under the treasurer's approval. */
  sendRunInvoice(req: { runId: string; invoiceId: string }): Promise<PortResult<{ sent: boolean }>>;
  /** Tool 13 `get_invoice`: this run's own invoice only. */
  getInvoice(req: { runId: string }): Promise<PortResult<InvoiceRead>>;
  /** Tools 14 and 15: payout reads, after the batch is posted. */
  getPayoutBatch(req: { runId: string }): Promise<PortResult<PayoutBatchRead>>;
  getPayoutItem(req: {
    runId: string;
    payoutItemId: string;
  }): Promise<PortResult<{ status: PayoutItemStatus | null }>>;
  /** Tool 17 `request_payout_batch`: opens an approval request; code alone enables the Approve slab. */
  requestPayoutBatch(req: { runId: string }): Promise<PortResult<{ opened: boolean }>>;
}

/** Who is calling the port: one agent session, its purpose and spend (budgetCap). */
export interface AgentSession {
  sessionId: string;
  purpose: AgentPurpose;
  /** "replay" when Judge Mode replays a recording (C-06); "live" in dev and the nightly eval. */
  mode: "replay" | "live";
  spentMicros: number;
  capMicros: number;
  iteration: number;
  maxIterations: number;
}

/** S4.4 purpose caps (US$ → micros) and iteration limits. */
export const PURPOSE_LIMITS: Readonly<Record<AgentPurpose, { capMicros: number; maxIterations: number }>> = {
  DRAFT_INVOICE: { capMicros: 250_000, maxIterations: 6 },
  INVESTIGATE_HOLD: { capMicros: 400_000, maxIterations: 10 },
  REQUEST_BATCH: { capMicros: 150_000, maxIterations: 4 },
};
