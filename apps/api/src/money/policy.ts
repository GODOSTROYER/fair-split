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
import {
  type AutoCancelRuleArgs,
  type CanonicalInvoice,
  type CanonicalSend,
  canonicalInvoice,
  canonicalInvoiceCall,
  decide,
  type ItemLabels,
  invoiceMemo,
  invoiceNumber,
  invoiceReference,
  jcs,
  quoteInvoice,
  requireAsciiEmail,
} from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import type { ApiEnv } from "../env.js";
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

/** The brands a run may invoice (`recipientInBrandAllowlist`): the payer alone. */
export function brandAllowlistOf(parties: Parties): string[] {
  return [parties.payer.email];
}

/**
 * Boot (S3.13, I1): the invoicer, the payer and every brand allowlist entry the lattice will compare are strict
 * printable-ASCII e-mails (domain `requireAsciiEmail`), so a misconfigured address stops the boot instead of
 * denying every run later. Throws a RangeError naming the setting, never the value. A sandbox rail without the
 * two addresses boots; its invoice steps refuse with a 500 until they are set.
 */
export function assertPartiesAscii(env: ApiEnv): void {
  let parties: Parties;
  try {
    parties = partiesOf({ env });
  } catch {
    return;
  }
  requireAsciiEmail("PP_BUSINESS_EMAIL", parties.businessEmail);
  requireAsciiEmail("PP_PAYER_EMAIL", parties.payer.email);
  for (const entry of brandAllowlistOf(parties)) requireAsciiEmail("the brand allowlist", entry);
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
      brandAllowlist: brandAllowlistOf(parties),
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
  deps: Pick<AppDeps, "db" | "env"> & Partial<Pick<AppDeps, "paypal">>,
  w: InvoiceWorld,
  o: { today: string; budget?: Budget },
): Promise<PolicyCtx> {
  const read = await readKill(deps, scope.workspaceId, db);
  // On Judge Mode's replay rail (paypal/replay.ts) no call reaches PayPal: kill_paypal_live is why the step is
  // replayed (S3.11), not a reason to refuse it. Every other policy, and every other switch, decides as ever.
  const flags = deps.paypal?.provenance === "replay" ? { ...read, killPaypalLive: false } : read;
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

export type InvoiceMethod = "create_invoice" | "send_invoice" | "create_conditional_rules_for_invoice";

/** The exact toolkit arguments IC-02 `canonicalInvoiceCall` builds for each invoice call. */
export interface InvoiceCallArgs {
  create_invoice: CanonicalInvoice;
  send_invoice: CanonicalSend;
  create_conditional_rules_for_invoice: AutoCancelRuleArgs;
}

export interface DecidedInvoiceCall<M extends InvoiceMethod> {
  decision: Decision;
  /**
   * The arguments to send, the very object the lattice decided, when code built them (`canonicalInvoiceCall`) and
   * they are what was asked for; null otherwise: then nothing is ever sent. Sent only if the verdict allows it.
   */
  args: InvoiceCallArgs[M] | null;
  /** Why there are no arguments to send (core's refusal, or the asker named something else); null otherwise. */
  reason: string | null;
}

const sameJson = (a: unknown, b: unknown): boolean => {
  try {
    return jcs(a) === jcs(b);
  } catch {
    return false;
  }
};

/**
 * What a create the code cannot build asked for, as the lattice reads it: the canonical body with the asked
 * labels as the item names, unchecked. Decided only so the refusal is recorded; it is never sent.
 */
function askedCreate(expected: PolicyCtx["expected"], labels: readonly string[] | ItemLabels | undefined) {
  const base = canonicalInvoice(expected);
  if (labels === undefined) return base;
  const keyed = Array.isArray(labels) ? null : (labels as ItemLabels as unknown as Record<string, unknown>);
  const names = keyed
    ? expected.quote.items.map((it) => keyed[it.key.toLowerCase()])
    : (labels as readonly unknown[]);
  return { ...base, items: base.items.map((item, i) => ({ ...item, name: names[i] })) };
}

/**
 * I1 at the money edge, the one way an invoice call is decided (the server chain and the agent's port alike):
 * IC-02 `canonicalInvoiceCall` builds the exact arguments from the run (the agent's three item labels are its only
 * input), the policy lattice decides THOSE arguments (`decide`, recorded as a `policy.verdict`), and the caller
 * sends `args`, the same object, and nothing else. When code cannot build the call (core refuses the labels, or
 * there is no invoice or no PayPal date yet), or the asker named something else (`asked`: the model's own draft,
 * another invoice id), the asked call is decided and recorded instead, `args` is null and nothing is sent.
 */
export async function decideInvoiceCall<M extends InvoiceMethod>(
  tx: DbOrTx,
  scope: WorkspaceScope,
  deps: Pick<AppDeps, "db" | "env"> & Partial<Pick<AppDeps, "paypal">>,
  w: InvoiceWorld,
  o: {
    method: M;
    labels?: readonly string[] | ItemLabels;
    /** PayPal's invoice date when the world does not carry it yet (read by a GET just before). */
    invoiceDate?: string | null;
    /** What the asker sent, when it may not be this run's call: decided as given unless it is the built args. */
    asked?: unknown;
    today: string;
    budget?: Budget;
    record: Parameters<typeof decideAndRecord>[4];
  },
): Promise<DecidedInvoiceCall<M>> {
  const expected = { ...w.expected, invoiceDate: w.expected.invoiceDate ?? o.invoiceDate ?? null };
  const built = canonicalInvoiceCall(o.method, expected, o.labels);
  // the lattice reads the same expectation the call was built from (PayPal's date included)
  const ctx = await policyContext(
    tx,
    scope,
    deps,
    { ...w, expected },
    {
      today: o.today,
      ...(o.budget ? { budget: o.budget } : {}),
    },
  );
  const send = built.ok && (o.asked === undefined || sameJson(o.asked, built.args)) ? built.args : null;
  const asked =
    send ??
    o.asked ??
    (o.method === "create_invoice"
      ? askedCreate(expected, o.labels)
      : { invoice_id: expected.invoiceId ?? "" });
  const decision = await decideAndRecord(tx, scope, { name: o.method, args: asked }, ctx, o.record);
  return {
    decision,
    args: send as InvoiceCallArgs[M] | null,
    reason: send ? null : built.ok ? "Only the code-built call is ever sent." : built.reason,
  };
}
