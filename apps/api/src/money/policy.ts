// The policy lattice at the money edge (register §9, S4.4). Every Invoicing call, the agent's or the server's,
// is decided with IC-02 `decide(call, ctx)` on the exact toolkit arguments about to be sent (the code-built
// canonical body), with flags read fresh; the verdict is a `policy.verdict` event and a ledger entry. What
// the lattice compares against (`ctx.expected`) is built here from the database alone: the quote from the
// ratified card and the lot, `FS-{runSlug}`, `rc:{sha16}`, the memo, the invoicer and the one recipient.
import type {
  Decision,
  InvoiceQuote,
  Lot,
  PolicyCtx,
  RatifiedRateCard,
  ToolCall,
} from "@fairsplit/contracts";
import { type Actor, type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { decide, invoiceMemo, invoiceNumber, invoiceReference, quoteInvoice } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { emit, factLedger } from "../runs/events.js";
import { readKill } from "../runs/flags.js";
import {
  cardById,
  type InvoiceRow,
  invoiceOfRun,
  lotById,
  lotOf,
  ratifiedCard,
  type SeasonRow,
  seasonById,
} from "../runs/load.js";
import type { RunRow } from "../runs/machine.js";

/** The invoicer and the payer. Sandbox mode reads env; the simulated rail falls back to labelled aliases. */
export interface Parties {
  businessEmail: string;
  payer: { email: string; businessName: string };
  source: "env" | "seeded_alias";
}

export function partiesOf(deps: Pick<AppDeps, "env">): Parties {
  const p = deps.env.paypal;
  const payerName = getSnapshot().payer.name;
  if (p.businessEmail && p.payerEmail) {
    return {
      businessEmail: p.businessEmail,
      payer: { email: p.payerEmail, businessName: payerName },
      source: "env",
    };
  }
  if (p.mode === "simulator") {
    return {
      businessEmail: p.businessEmail ?? "coop@business.fairsplit.example",
      payer: { email: p.payerEmail ?? "lantern-bay@brand.fairsplit.example", businessName: payerName },
      source: "seeded_alias",
    };
  }
  throw problem.internal("PP_BUSINESS_EMAIL and PP_PAYER_EMAIL are required on the sandbox rail.");
}

export interface InvoiceWorld {
  run: RunRow;
  season: SeasonRow;
  card: RatifiedRateCard;
  lot: Lot;
  quote: InvoiceQuote;
  invoice: InvoiceRow | null;
  expected: PolicyCtx["expected"];
}

/** Everything the canonical invoice and its policies are built from, for one run. */
export async function invoiceWorld(
  db: DbOrTx,
  scope: WorkspaceScope,
  deps: Pick<AppDeps, "env">,
  run: RunRow,
): Promise<InvoiceWorld> {
  const season = await seasonById(db, scope, run.seasonId);
  const cardRow = await cardById(db, scope, run.rateCardId);
  const card = await ratifiedCard(db, scope, cardRow);
  if (!card)
    throw problem.validation(
      "The run's rate card is not a ratified Schedule A; there is nothing to invoice.",
    );
  const lotRow = await lotById(db, scope, run.lotId);
  if (!lotRow) throw problem.validation("The run has no lot; the quote cannot be computed.");
  const lot = lotOf(lotRow);
  const quote = quoteInvoice(card, lot);
  const invoice = await invoiceOfRun(db, scope, run.id);
  const parties = partiesOf(deps);
  return {
    run,
    season,
    card,
    lot,
    quote,
    invoice,
    expected: {
      quote,
      invoiceNumber: invoiceNumber(run.runSlug),
      reference: invoiceReference(card.sha256),
      memo: invoiceMemo(season.label, card.sha256, lot.lotCode),
      businessEmail: parties.businessEmail,
      payer: parties.payer,
      brandAllowlist: [parties.payer.email],
      invoiceId: invoice?.paypalInvoiceId ?? null,
      invoiceDate: invoice?.createdAtPaypal ? invoice.createdAtPaypal.toISOString().slice(0, 10) : null,
    },
  };
}

export interface Budget {
  spentMicros: number;
  capMicros: number;
  iteration: number;
  maxIterations: number;
}

/** Server-side calls carry no model spend: one iteration under a nominal cap. */
export const SERVER_BUDGET: Budget = { spentMicros: 0, capMicros: 1, iteration: 0, maxIterations: 1 };

export async function policyContext(
  db: DbOrTx,
  scope: WorkspaceScope,
  deps: Pick<AppDeps, "db" | "env">,
  w: InvoiceWorld,
  o: { today: string; budget?: Budget },
): Promise<PolicyCtx> {
  const flags = await readKill(deps, scope.workspaceId, db);
  const holds = await db
    .select({ id: schema.holds.id, state: schema.holds.state, gate: schema.holds.gate })
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, scope.workspaceId), eq(schema.holds.runId, w.run.id)));
  return {
    flags,
    ppEnv: deps.env.paypal.env,
    toolkitSandbox: true,
    runState: w.run.state as PolicyCtx["runState"],
    invoiceExists: w.invoice?.paypalInvoiceId != null,
    holds: holds.map((h) => ({
      holdId: h.id,
      state: h.state as PolicyCtx["holds"][number]["state"],
      gate: h.gate,
    })),
    budget: o.budget ?? SERVER_BUDGET,
    expected: w.expected,
    today: o.today,
  };
}

export interface VerdictRecord {
  decision: Decision;
  sessionId: string | null;
}

/** IC-02 `decide`, recorded: a `policy.verdict` event and ledger entry (S4.4), in the caller's transaction. */
export async function decideAndRecord(
  tx: DbOrTx,
  scope: WorkspaceScope,
  call: ToolCall,
  ctx: PolicyCtx,
  o: {
    runId: string;
    sessionId: string | null;
    actor: Actor;
    at: Date;
    provenance: "live" | "replay" | "simulated_rail";
  },
): Promise<Decision> {
  const decision = decide(call, ctx);
  const reasons = decision.results
    .filter((r) => r.reason !== null && r.verdict !== "ALLOW")
    .map((r) => `${r.policy}: ${r.reason}`);
  await emit(
    tx,
    scope,
    "policy.verdict",
    {
      tool: call.name,
      verdict: decision.verdict,
      decidedBy: decision.decidedBy,
      reasons,
      sessionId: o.sessionId,
    },
    { runId: o.runId, provenance: o.provenance, actor: o.actor },
  );
  await factLedger(
    tx,
    scope,
    "policy.verdict",
    {
      runId: o.runId,
      tool: call.name,
      verdict: decision.verdict,
      decidedBy: decision.decidedBy,
      sessionId: o.sessionId,
    },
    { runId: o.runId, at: o.at, actor: o.actor },
  );
  return decision;
}

export const todayOf = (d: Date): string => d.toISOString().slice(0, 10);
