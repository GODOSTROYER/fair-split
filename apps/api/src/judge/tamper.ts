// "Try to break it" (plan, S4 "Tamper the draft", S5 E-03), every control labelled as a simulation:
//
//   amount      Claude's draft overcharges Lantern Bay: premium + US$1,000.00
//   offsetting  shipping 50.00 and a 50.00 item discount (the total is unchanged)
//   recipient   an extra recipient gets a copy of the invoice
//     → the server mutates the CODE-BUILT canonical create arguments, runs the real policy lattice
//       (`decide`) and records the verdict (a `policy.verdict` event and ledger entry). No model call and
//       no PayPal call is made, and nothing is sent.
//   change_payout  armed before the second key: once both keys are in and just before the POST, one
//       payout changes by one cent behind the signatures' back. `PayoutsService.executeApproved` re-hashes
//       the batch from the database (I4), refuses, sends nothing and voids both approvals. The run slice's
//       `postPayoutBatch` calls `applyArmedTamper()` first; arming and applying are both ledger entries.
import type { PolicyCtx, ToolCall } from "@fairsplit/contracts";
import { PAY_RUN_RANK, type PayRunState, type PolicyName, type Verdict } from "@fairsplit/contracts";
import {
  appendEvent,
  appendLedger,
  type DbOrTx,
  readFlags,
  schema,
  type WorkspaceScope,
  withWorkspaceTx,
  workspaceScope,
} from "@fairsplit/db";
import {
  canonicalInvoice,
  decide,
  invoiceMemo,
  invoiceNumber,
  invoiceReference,
  jcs,
  minorToDecimal,
  parseDecimalMinor,
  quoteInvoice,
  seasonLabelOf,
  sha256Hex,
} from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { JudgeSessionCredential } from "../credentials/verify/index.js";
import { killEnv } from "../env.js";
import type { AppDeps } from "../lib/context.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { latestRun } from "./session.js";

export const DRAFT_TAMPERS = ["amount", "offsetting", "recipient"] as const;
export const TAMPER_KINDS = [...DRAFT_TAMPERS, "change_payout"] as const;
export type DraftTamper = (typeof DRAFT_TAMPERS)[number];
export type TamperKind = (typeof TAMPER_KINDS)[number];

/** One US$1,000.00 overcharge, in cents. */
export const OVERCHARGE_CENTS = 100_000;
/** The offsetting pair: shipping and an item discount of the same size. */
export const OFFSET_VALUE = "50.00";
/** A recipient no brand allowlist will ever hold (.example is reserved). */
export const EXTRA_RECIPIENT = "invoice-copy@attacker.example";
/** Placeholders when the sandbox addresses are not configured (simulator mode): the lattice compares shapes. */
const DEMO_BUSINESS_EMAIL = "co-op-business@sandbox.fairsplit.example";
const DEMO_PAYER_EMAIL = "lantern-bay@sandbox.fairsplit.example";

export const TAMPER_LABEL: Readonly<Record<TamperKind, string>> = {
  amount: "Simulated tamper: Claude's draft overcharges Lantern Bay by US$1,000.00",
  offsetting: "Simulated tamper: shipping 50.00 offset by a 50.00 discount (same total)",
  recipient: "Simulated tamper: an extra recipient gets a copy of the invoice",
  change_payout: "Simulated tamper: one payout changes by 1 cent after both keys",
};

export interface TamperOutcome {
  kind: TamperKind;
  label: string;
  simulated: true;
  runSlug: string;
  verdict: Verdict | null;
  decidedBy: PolicyName[];
  reasons: string[];
  armed: boolean;
  paypalCalls: 0;
  modelCalls: 0;
}

type Draft = ReturnType<typeof canonicalInvoice>;

/** The canonical draft with one attack applied (a deep copy; the canonical form is never touched). */
export function tamperedDraft(canonical: Draft, kind: DraftTamper): Record<string, unknown> {
  const d = JSON.parse(JSON.stringify(canonical)) as Record<string, unknown> & {
    items: { unit_amount: { value: string }; [k: string]: unknown }[];
  };
  const premium = d.items[0];
  if (!premium) throw new RangeError("the canonical invoice has no premium line");
  if (kind === "amount") {
    const cents = parseDecimalMinor(premium.unit_amount.value);
    if (cents === null) throw new RangeError("the canonical premium is not a decimal amount");
    premium.unit_amount.value = minorToDecimal(cents + OVERCHARGE_CENTS);
  } else if (kind === "offsetting") {
    d.shipping_cost = OFFSET_VALUE;
    premium.discount = { amount: { currency_code: "USD", value: OFFSET_VALUE } };
  } else {
    d.additional_recipients = [EXTRA_RECIPIENT];
  }
  return d;
}

function scopeFor(cred: JudgeSessionCredential, actorId = "judge"): WorkspaceScope {
  return workspaceScope({
    workspaceId: cred.workspaceId,
    actor: { kind: "human", id: actorId, impersonatedBy: `judge_session:${cred.sessionId}` },
    via: "session",
  });
}

/** The policy context of this run, as code expects it (the same inputs Claude's real turn is judged on). */
export async function policyContext(
  deps: AppDeps,
  db: DbOrTx,
  o: { workspaceId: string; runSlug: string; runState: PayRunState; rateCardSha256: string },
): Promise<PolicyCtx> {
  const s = getSnapshot();
  if (o.rateCardSha256 !== s.rateCard.sha256) {
    throw problem.internal("This workspace's rate card is not the seed's; it cannot be tampered with here.");
  }
  const quote = quoteInvoice(s.rateCard, s.lot);
  const [invoice] = await db
    .select({ id: schema.invoices.paypalInvoiceId })
    .from(schema.invoices)
    .innerJoin(schema.payRuns, eq(schema.payRuns.id, schema.invoices.runId))
    .where(and(eq(schema.invoices.workspaceId, o.workspaceId), eq(schema.payRuns.runSlug, o.runSlug)))
    .limit(1);
  const flags = await readFlags(db, o.workspaceId, killEnv(deps.env));
  const payerEmail = deps.env.paypal.payerEmail ?? DEMO_PAYER_EMAIL;
  return {
    flags: {
      killPayouts: flags.kill_payouts.on,
      killPaypalLive: flags.kill_paypal_live.on,
      killAiLive: flags.kill_ai_live.on,
    },
    ppEnv: deps.env.paypal.env,
    toolkitSandbox: true,
    runState: o.runState,
    invoiceExists: !!invoice,
    holds: [],
    // DRAFT_INVOICE's purpose cap (S4.4: US$0.25), nothing spent: the tamper makes no model call
    budget: { spentMicros: 0, capMicros: 250_000, iteration: 0, maxIterations: 8 },
    expected: {
      quote,
      invoiceNumber: invoiceNumber(o.runSlug),
      reference: invoiceReference(s.rateCard.sha256),
      memo: invoiceMemo(seasonLabelOf(s.season.code), s.rateCard.sha256, s.lot.lotCode),
      businessEmail: deps.env.paypal.businessEmail ?? DEMO_BUSINESS_EMAIL,
      payer: { email: payerEmail, businessName: s.payer.name },
      brandAllowlist: [payerEmail],
      invoiceId: invoice?.id ?? null,
      invoiceDate: null,
    },
    today: deps.clock.now().toISOString().slice(0, 10),
  };
}

async function currentRun(deps: AppDeps, workspaceId: string) {
  const run = await latestRun(deps.db, workspaceId);
  if (!run) throw problem.notFound("This session has no run yet.");
  const [row] = await deps.db
    .select({ rateCardSha256: schema.payRuns.rateCardSha256 })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, run.id));
  return { ...run, state: run.state as PayRunState, rateCardSha256: row?.rateCardSha256 ?? "" };
}

/** A draft tamper: the lattice's real verdict on a mutated canonical draft. */
export async function tamperDraft(
  deps: AppDeps,
  cred: JudgeSessionCredential,
  kind: DraftTamper,
): Promise<TamperOutcome> {
  const now = deps.clock.now();
  const run = await currentRun(deps, cred.workspaceId);
  const ctx = await policyContext(deps, deps.db, {
    workspaceId: cred.workspaceId,
    runSlug: run.runSlug,
    runState: run.state,
    rateCardSha256: run.rateCardSha256,
  });
  const args = tamperedDraft(canonicalInvoice(ctx.expected), kind);
  const call: ToolCall = { name: "create_invoice", args };
  const decision = decide(call, ctx);
  const reasons = decision.results
    .filter((r) => decision.decidedBy.includes(r.policy) && r.reason)
    .map((r) => `${r.policy}: ${r.reason}`);
  const label = TAMPER_LABEL[kind];
  await withWorkspaceTx(deps.db, cred.workspaceId, async (tx) => {
    const lattice = scopeFor(cred, "policy-lattice");
    await appendEvent(tx, {
      workspaceId: cred.workspaceId,
      runId: run.id,
      type: "policy.verdict",
      actor: { kind: "system", id: "policy-lattice", impersonatedBy: `judge_session:${cred.sessionId}` },
      // the verdict is the real lattice's, computed now; the label says the draft was a simulated attack
      provenance: "live",
      payload: {
        tool: call.name,
        verdict: decision.verdict,
        decidedBy: decision.decidedBy,
        reasons: [label, ...reasons],
        sessionId: null,
      },
    });
    await appendLedger(tx, lattice, {
      kind: "policy.verdict",
      payload: {
        runId: run.id,
        tool: call.name,
        verdict: decision.verdict,
        decidedBy: decision.decidedBy,
        tamper: kind,
        simulated: true,
        argsSha256: sha256Hex(jcs(args)),
      },
      actor: { kind: "system", id: "policy-lattice", impersonatedBy: `judge_session:${cred.sessionId}` },
      runId: run.id,
      at: now,
    });
  });
  return {
    kind,
    label,
    simulated: true,
    runSlug: run.runSlug,
    verdict: decision.verdict,
    decidedBy: decision.decidedBy,
    reasons,
    armed: false,
    paypalCalls: 0,
    modelCalls: 0,
  };
}

const ARMED = "judge.tamper.armed";
const APPLIED = "judge.tamper.applied";

async function tamperEntries(db: DbOrTx, workspaceId: string, runId: string) {
  const le = schema.ledgerEntries;
  const rows = await db
    .select({ kind: le.kind })
    .from(le)
    .where(and(eq(le.workspaceId, workspaceId), eq(le.runId, runId), inArray(le.kind, [ARMED, APPLIED])));
  return { armed: rows.some((r) => r.kind === ARMED), applied: rows.some((r) => r.kind === APPLIED) };
}

/** Whether a change_payout tamper is armed (and not yet applied) for this run. */
export async function tamperArmed(db: DbOrTx, workspaceId: string, runId: string): Promise<boolean> {
  const t = await tamperEntries(db, workspaceId, runId);
  return t.armed && !t.applied;
}

/** Arms "change one payout after both keys": allowed only before the second key. Idempotent. */
export async function armChangePayout(deps: AppDeps, cred: JudgeSessionCredential): Promise<TamperOutcome> {
  const now = deps.clock.now();
  const run = await currentRun(deps, cred.workspaceId);
  const base = {
    kind: "change_payout" as const,
    label: TAMPER_LABEL.change_payout,
    simulated: true as const,
    runSlug: run.runSlug,
    verdict: null,
    decidedBy: [],
    reasons: [],
    armed: true,
    paypalCalls: 0 as const,
    modelCalls: 0 as const,
  };
  await withWorkspaceTx(deps.db, cred.workspaceId, async (tx) => {
    const [row] = await tx
      .select({ state: schema.payRuns.state })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, run.id))
      .for("update");
    const state = (row?.state ?? run.state) as PayRunState;
    const t = await tamperEntries(tx, cred.workspaceId, run.id);
    if (t.armed) return; // already armed (before the second key): it stands
    if (PAY_RUN_RANK[state] >= PAY_RUN_RANK.APPROVED) {
      throw new ApiProblem(
        "INVALID_TRANSITION",
        "Both keys are already in: arm this before the second key.",
        {
          details: { runState: state },
        },
      );
    }
    await appendLedger(tx, scopeFor(cred), {
      kind: ARMED,
      payload: { runId: run.id, kind: "change_payout", deltaCents: 1, simulated: true },
      runId: run.id,
      at: now,
    });
  });
  return base;
}

/**
 * For the run slice's `postPayoutBatch`, inside its transaction and before `executeApproved`: when a judge
 * armed "change one payout", moves one on-rail line (and its payout item, if written) up by one cent,
 * without voiding anything, exactly as an insider editing the database would. Only in judge workspaces;
 * recorded in the ledger. `executeApproved` must then refuse (I4).
 */
export async function applyArmedTamper(
  tx: DbOrTx,
  scope: WorkspaceScope,
  runId: string,
  at: Date = new Date(),
): Promise<{ applied: false } | { applied: true; lineId: string; itemId: string | null }> {
  const ws = scope.workspaceId;
  const [w] = await tx
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ws));
  if (w?.kind !== "judge") return { applied: false };
  if (!(await tamperArmed(tx, ws, runId))) return { applied: false };
  const ml = schema.memberLines;
  const [line] = await tx
    .select({ id: ml.id })
    .from(ml)
    .where(and(eq(ml.workspaceId, ws), eq(ml.runId, runId), eq(ml.rail, "ON")))
    .orderBy(asc(ml.id))
    .limit(1);
  if (!line) return { applied: false };
  await tx.execute(sql`
    update member_lines set credits_cents = credits_cents + 1, net_cents = net_cents + 1
     where workspace_id = ${ws} and id = ${line.id}`);
  const items = (await tx.execute(sql`
    update payout_items set amount_cents = amount_cents + 1
     where workspace_id = ${ws} and line_id = ${line.id} and status = 'SUBMITTED'
     returning id`)) as unknown as { id: string }[];
  const itemId = items[0]?.id ?? null;
  await appendLedger(tx, scope, {
    kind: APPLIED,
    payload: { runId, lineId: line.id, itemId, deltaCents: 1, simulated: true },
    runId,
    at,
  });
  return { applied: true, lineId: line.id, itemId };
}
