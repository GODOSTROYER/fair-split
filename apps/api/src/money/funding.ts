// Quote → invoice → funding (S3.6.3, S3.5):
//
//   DRAFT ─QUOTE─▶ QUOTED ─INVOICE_SENT─▶ INVOICED ─FUND─▶ FUNDED ─START_EXTRACTION─▶ EXTRACTING
//
// `ensureInvoiceSent` is the ensureInvoice{target:SENT} task: create (or adopt) the code-built invoice, send it
// (the treasurer's approval: in Judge Mode the session start, "Judge as Treasurer approved send"), GET it to
// confirm it is payable and learn PayPal's invoice date, add the AUTO_CANCEL rule; each step is checkpointed
// in `invoices` before the next, so a retried task resumes where it stopped. Every call's body is IC-02
// `canonicalInvoiceCall(...).args`, decided by the policy lattice (the verdict recorded) and then sent as is
// (money/policy.ts `decideInvoiceCall`).
//
// `recordPaymentAndFund` (Judge Mode's "Mark paid", the recordPayment task) and `confirmFunding` (the
// ensureInvoice{target:FUNDED} GET) end in `fund`: FUNDED only on a fresh GET showing PAID or MARKED_AS_PAID
// with 0.00 due, with the `invoice.funded` ledger entry, and the reading queued (I7).
import type { InvoiceStatus, PayRunState, Provenance } from "@fairsplit/contracts";
import { TASKS } from "@fairsplit/contracts";
import {
  type Actor,
  type DbOrTx,
  schema,
  type Tx,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import { quoteDigest, runMachine } from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { ACTORS, emit, proofLedger } from "../runs/events.js";
import { extractDedupeKey } from "../runs/extract.js";
import { lockRun, runById } from "../runs/load.js";
import { cause, moveRun, type RunRow } from "../runs/machine.js";
import { PayPalStepError } from "./errors.js";
import {
  addAutoCancelRule,
  createOrAdopt,
  getInvoice,
  type InvoiceSnapshot,
  isFunded,
  PAYABLE,
  recordPayment,
  sendInvoice,
} from "./invoices.js";
import { decideInvoiceCall, type InvoiceMethod, type InvoiceWorld, invoiceWorld, todayOf } from "./policy.js";
import { toolkitFor } from "./toolkit.js";

type Deps = Pick<AppDeps, "db" | "env" | "paypal" | "clock" | "logger">;
type InvoiceRow = typeof schema.invoices.$inferSelect;

const statusOf = (s: string | null | undefined): InvoiceStatus | null =>
  s && s !== "NEW" ? (s as InvoiceStatus) : null;

async function invoiceRow(tx: DbOrTx, scope: WorkspaceScope, runId: string): Promise<InvoiceRow | null> {
  const [row] = await tx
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)))
    .for("update");
  return row ?? null;
}

/** invoice.state (IC-01) for every status we learn from PayPal. */
async function invoiceState(
  tx: DbOrTx,
  scope: WorkspaceScope,
  run: RunRow,
  row: InvoiceRow,
  to: InvoiceStatus,
  dueCents: number,
  provenance: Provenance,
  actor: Actor,
): Promise<void> {
  const from = statusOf(row.status);
  if (from === to) return;
  await tx
    .update(schema.invoices)
    .set({ status: to, dueCents: BigInt(dueCents), provenance })
    .where(eq(schema.invoices.id, row.id));
  await emit(
    tx,
    scope,
    "invoice.state",
    { invoiceId: row.paypalInvoiceId ?? row.id, invoiceNumber: row.invoiceNumber, from, to, dueCents },
    { runId: run.id, provenance, actor },
  );
}

/** DRAFT → QUOTED: the quote from the ratified card and the lot, before any slip (C-09). */
async function quote(
  tx: DbOrTx,
  scope: WorkspaceScope,
  w: InvoiceWorld,
  provenance: Provenance,
): Promise<RunRow> {
  let run = w.run;
  if (run.state === "DRAFT") {
    run = await moveRun(tx, scope, {
      id: run.id,
      from: "DRAFT",
      to: "QUOTED",
      version: run.version,
      cause: cause("QUOTE", quoteDigest(w.quote)),
      provenance,
      actor: ACTORS.engine,
      patch: { quoteSha256: quoteDigest(w.quote) },
    });
  }
  if (!w.invoice) {
    await tx.insert(schema.invoices).values({
      workspaceId: scope.workspaceId,
      runId: run.id,
      invoiceNumber: w.expected.invoiceNumber,
      status: "NEW",
      amountCents: BigInt(w.quote.totalCents),
      dueCents: BigInt(w.quote.totalCents),
      currency: "USD",
      provenance,
    });
  }
  return run;
}

/** DRAFT → QUOTED and the invoice checkpoint row (no PayPal call); the invoice world after it. */
export async function quoteRun(deps: Deps, scope: WorkspaceScope, runId: string): Promise<InvoiceWorld> {
  return withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, runId);
    const world = await invoiceWorld(tx, scope, deps, run);
    if (run.state !== "DRAFT" && run.state !== "QUOTED") return world;
    await quote(tx, scope, world, deps.paypal.provenance);
    return invoiceWorld(tx, scope, deps, await runById(tx, scope, runId));
  });
}

export interface SendApproval {
  /** "treasurer:analyn", or "judge" ("Judge as Treasurer approved send"). */
  approverId: string;
  at: Date;
}

export interface EnsureOutcome {
  state: "INVOICED" | "PENDING_APPROVAL" | "DENIED_BY_POLICY";
  invoiceId: string | null;
  reason: string | null;
}

/** ensureInvoice{target: SENT}: create, send, GET (payable), AUTO_CANCEL, then QUOTED → INVOICED. */
export async function ensureInvoiceSent(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  o: { approval: SendApproval | null; labels?: readonly string[]; actor?: Actor; sessionId?: string | null },
): Promise<EnsureOutcome> {
  const provenance = deps.paypal.provenance;
  const actor = o.actor ?? ACTORS.outbox;
  const tk = toolkitFor(deps, { workspaceId: scope.workspaceId });
  const today = () => todayOf(deps.clock.now());
  // Each call: IC-02 `canonicalInvoiceCall` builds the args from the run, the lattice decides them (recorded),
  // and exactly those args are sent; a call code cannot build is decided as asked, refused, and never sent.
  const step = async <M extends InvoiceMethod>(
    method: M,
    c: { labels?: readonly string[]; invoiceDate?: string | null } = {},
  ) =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      const run = await lockRun(tx, scope, runId);
      const w = await invoiceWorld(tx, scope, deps, run);
      const decided = await decideInvoiceCall(tx, scope, deps, w, {
        method,
        ...(c.labels ? { labels: c.labels } : {}),
        ...(c.invoiceDate ? { invoiceDate: c.invoiceDate } : {}),
        today: today(),
        record: { runId, sessionId: o.sessionId ?? null, actor, at: deps.clock.now(), provenance },
      });
      return { w, ...decided };
    });
  const denied = (d: { decision: { decidedBy: string[] }; reason: string | null }) =>
    d.decision.decidedBy.join(", ") || d.reason || "refused";

  // 0. the quote and the checkpoint row
  let w = await quoteRun(deps, scope, runId);
  if (w.run.state !== "QUOTED") {
    return {
      state: w.run.state === "INVOICED" ? "INVOICED" : "DENIED_BY_POLICY",
      invoiceId: w.invoice?.paypalInvoiceId ?? null,
      reason: `run is ${w.run.state}`,
    };
  }

  // 1. create (or adopt)
  let invoiceId = w.invoice?.paypalInvoiceId ?? null;
  if (!invoiceId) {
    const create = await step("create_invoice", o.labels ? { labels: o.labels } : {});
    if (create.decision.verdict === "DENY" || !create.args)
      return { state: "DENIED_BY_POLICY", invoiceId: null, reason: denied(create) };
    const created = await createOrAdopt(tk, create.w, create.args);
    invoiceId = created.invoiceId;
    await withWorkspaceTx(deps.db, scope, async (tx) => {
      await tx
        .update(schema.invoices)
        .set({ paypalInvoiceId: created.invoiceId, status: "DRAFT", provenance })
        .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
    });
  }
  const id = invoiceId;

  // 2. send (needs the treasurer's approval: sendNeedsTreasurer)
  w = await withWorkspaceTx(deps.db, scope, async (tx) =>
    invoiceWorld(tx, scope, deps, await runById(tx, scope, runId)),
  );
  if (!w.invoice?.sentAt) {
    const send = await step("send_invoice");
    if (send.decision.verdict === "DENY" || !send.args)
      return { state: "DENIED_BY_POLICY", invoiceId: id, reason: denied(send) };
    if (!o.approval)
      return { state: "PENDING_APPROVAL", invoiceId: id, reason: "send_invoice waits for the treasurer" };
    const sent = await sendInvoice(tk, send.args);
    await withWorkspaceTx(deps.db, scope, async (tx) => {
      await tx
        .update(schema.invoices)
        .set({ sentAt: deps.clock.now(), payerViewUrl: sent.payerViewUrl })
        .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
    });
  }

  // 3. the payable check: a fresh GET (status, PayPal's invoice date, the payer's link), unless a GET after
  //    the send already checkpointed both (the agent's send step does)
  const [known] = await deps.db
    .select({ status: schema.invoices.status, invoiceDate: schema.invoices.createdAtPaypal })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
  let invoiceDate = known?.invoiceDate ? known.invoiceDate.toISOString().slice(0, 10) : null;
  if (!known || !invoiceDate || !PAYABLE.has(known.status)) {
    const got = await getInvoice(tk, id);
    if (!got.rawStatus || !PAYABLE.has(got.rawStatus)) {
      throw new PayPalStepError(
        "PAYPAL_REJECTED",
        `The invoice is ${got.rawStatus ?? "in an unknown state"}, not payable.`,
        { transient: false },
      );
    }
    const date = got.invoiceDate ?? today();
    invoiceDate = date;
    await withWorkspaceTx(deps.db, scope, async (tx) => {
      const run = await runById(tx, scope, runId);
      const row = await invoiceRow(tx, scope, runId);
      if (!row) return;
      await tx
        .update(schema.invoices)
        .set({
          createdAtPaypal: new Date(`${date}T00:00:00.000Z`),
          payerViewUrl: got.payerViewUrl ?? row.payerViewUrl,
        })
        .where(eq(schema.invoices.id, row.id));
      if (got.status)
        await invoiceState(tx, scope, run, row, got.status, got.dueCents ?? 0, provenance, ACTORS.paypalGet);
    });
  }
  const payableOn = invoiceDate;

  // 4. AUTO_CANCEL at PayPal's invoice date + 25 days
  w = await withWorkspaceTx(deps.db, scope, async (tx) =>
    invoiceWorld(tx, scope, deps, await runById(tx, scope, runId)),
  );
  const [cp] = await deps.db
    .select({ ruleCreatedAt: schema.invoices.ruleCreatedAt })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
  if (!cp?.ruleCreatedAt) {
    const rule = await step("create_conditional_rules_for_invoice", { invoiceDate: payableOn });
    if (rule.decision.verdict === "DENY" || !rule.args)
      return { state: "DENIED_BY_POLICY", invoiceId: id, reason: denied(rule) };
    const on = await addAutoCancelRule(tk, rule.args);
    await withWorkspaceTx(deps.db, scope, async (tx) => {
      await tx
        .update(schema.invoices)
        .set({ ruleCreatedAt: deps.clock.now(), autoCancelOn: on })
        .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
    });
  }

  // 5. QUOTED → INVOICED
  await withWorkspaceTx(deps.db, scope, async (tx) => {
    const run = await lockRun(tx, scope, runId);
    if (run.state !== "QUOTED") return;
    await moveRun(tx, scope, {
      id: run.id,
      from: "QUOTED",
      to: "INVOICED",
      version: run.version,
      cause: cause("INVOICE_SENT", id),
      provenance,
      actor: o.approval
        ? { kind: "human", id: o.approval.approverId, impersonatedBy: actor.impersonatedBy ?? null }
        : actor,
    });
  });
  return { state: "INVOICED", invoiceId: id, reason: null };
}

// ---------------------------------------------------------------- funding

export interface FundOutcome {
  funded: boolean;
  snapshot: InvoiceSnapshot;
  runState: PayRunState;
}

/** The FUND edge with its record, in one transaction: FUNDED → EXTRACTING, the reading queued (I7). */
export async function fund(
  tx: Tx,
  scope: WorkspaceScope,
  runId: string,
  snapshot: InvoiceSnapshot,
  o: { provenance: Provenance; at: Date },
): Promise<PayRunState> {
  const run = await lockRun(tx, scope, runId);
  const row = await invoiceRow(tx, scope, runId);
  if (!row) return run.state as PayRunState;
  if (snapshot.status) {
    await invoiceState(
      tx,
      scope,
      run,
      row,
      snapshot.status,
      snapshot.dueCents ?? 0,
      o.provenance,
      ACTORS.paypalGet,
    );
  }
  if (run.state !== "INVOICED" || !isFunded(snapshot) || !snapshot.status) return run.state as PayRunState;
  await tx.update(schema.invoices).set({ fundedAt: o.at }).where(eq(schema.invoices.id, row.id));
  await proofLedger(
    tx,
    scope,
    "invoice.funded",
    {
      runId,
      invoiceNumber: row.invoiceNumber,
      status: snapshot.status as "PAID" | "MARKED_AS_PAID",
      amountCents: snapshot.totalCents ?? Number(row.amountCents),
      dueCents: snapshot.dueCents ?? 0,
      reference: snapshot.reference ?? "",
    },
    { runId, at: o.at, actor: ACTORS.paypalGet },
  );
  const funded = await moveRun(tx, scope, {
    id: run.id,
    from: "INVOICED",
    to: "FUNDED",
    version: run.version,
    cause: cause("FUND", snapshot.invoiceId),
    provenance: o.provenance,
    actor: ACTORS.paypalGet,
  });
  const reading = await moveRun(tx, scope, {
    id: funded.id,
    from: "FUNDED",
    to: "EXTRACTING",
    version: funded.version,
    cause: cause("START_EXTRACTION"),
    provenance: o.provenance,
    actor: ACTORS.engine,
  });
  // The season's slip photos no row has been read from yet go to the reader; then the engine computes.
  const unread = await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.workspaceId, scope.workspaceId),
        eq(schema.documents.seasonId, run.seasonId),
        eq(schema.documents.kind, "slip_photo"),
        isNull(schema.documents.exactDuplicateOf),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(schema.slipRows)
            .where(eq(schema.slipRows.documentId, schema.documents.id)),
        ),
      ),
    );
  if (unread.length > 0) {
    const args = { documentIds: unread.map((d) => d.id).slice(0, 200), runId };
    // IC-01's key names every photo: past five it outgrows the outbox's 200 characters (runs/extract.ts)
    await enqueue(tx, "extract", args, extractDedupeKey(args), { workspaceId: scope.workspaceId });
  }
  const computeArgs = { runId, version: reading.version };
  await enqueue(tx, "computeRun", computeArgs, TASKS.computeRun.dedupeKey(computeArgs), {
    workspaceId: scope.workspaceId,
  });
  return reading.state as PayRunState;
}

/**
 * recordPayment task / Judge "Mark paid": record_payment_for_invoice, then a fresh GET, then FUND.
 *
 * S3.10 "Record payment: a retry GETs first". `retry` is set when an earlier attempt may have reached PayPal (this
 * outbox row ran before, or an earlier press's row did): `payment_recorded_at` is written only after PayPal
 * answers, so a crash or a lost answer in between leaves it empty although the payment exists. The retry reads
 * the invoice first and records nothing when it is already MARKED_AS_PAID or PAID, funding from that GET.
 */
export async function recordPaymentAndFund(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  o: { retry?: boolean } = {},
): Promise<FundOutcome> {
  const provenance = deps.paypal.provenance;
  const tk = toolkitFor(deps, { workspaceId: scope.workspaceId });
  const { row, run } = await withWorkspaceTx(deps.db, scope, async (tx) => ({
    run: await runById(tx, scope, runId),
    row: await invoiceRow(tx, scope, runId),
  }));
  if (!row?.paypalInvoiceId || !row.sentAt) {
    throw new PayPalStepError("INVALID_TRANSITION", "The invoice has not been sent yet.", {
      transient: false,
    });
  }
  if (run.state !== "INVOICED") {
    const snapshot: InvoiceSnapshot = {
      invoiceId: row.paypalInvoiceId,
      status: statusOf(row.status),
      rawStatus: row.status,
      invoiceNumber: row.invoiceNumber,
      reference: null,
      totalCents: Number(row.amountCents),
      dueCents: row.dueCents === null ? null : Number(row.dueCents),
      invoiceDate: null,
      payerViewUrl: row.payerViewUrl,
      invoicer: null,
      recipients: [],
    };
    return {
      funded: runMachine.isFundedOrLater(run.state as PayRunState),
      snapshot,
      runState: run.state as PayRunState,
    };
  }
  const markRecorded = () =>
    withWorkspaceTx(deps.db, scope, (tx) =>
      tx
        .update(schema.invoices)
        .set({ paymentRecordedAt: deps.clock.now() })
        .where(eq(schema.invoices.id, row.id)),
    );
  if (!row.paymentRecordedAt) {
    if (o.retry) {
      const seen = await getInvoice(tk, row.paypalInvoiceId);
      if (seen.status === "MARKED_AS_PAID" || seen.status === "PAID") {
        // MARKED_AS_PAID: the earlier attempt's record reached PayPal. PAID: the brand paid; nothing to record.
        if (seen.status === "MARKED_AS_PAID") await markRecorded();
        return fundFrom(deps, scope, runId, seen, { provenance });
      }
    }
    await recordPayment(tk, row.paypalInvoiceId, Number(row.amountCents));
    await markRecorded();
  }
  return confirmFunding(deps, scope, runId, { provenance, tkOverride: tk });
}

/** FUND from a fresh GET's snapshot (I8: a payment we recorded is the simulated rail). */
async function fundFrom(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  snapshot: InvoiceSnapshot,
  o: { provenance?: Provenance },
): Promise<FundOutcome> {
  // a replayed step's rows say `replay` whatever the replayed answer was
  const provenance: Provenance =
    deps.paypal.provenance === "replay"
      ? "replay"
      : snapshot.status === "MARKED_AS_PAID"
        ? "simulated_rail"
        : (o.provenance ?? deps.paypal.provenance);
  const runState = await withWorkspaceTx(deps.db, scope, (tx) =>
    fund(tx, scope, runId, snapshot, { provenance, at: deps.clock.now() }),
  );
  return { funded: isFunded(snapshot), snapshot, runState };
}

/** ensureInvoice{target: FUNDED} (the PAID webhook or the 60 s fallback): one GET, then FUND if it says so. */
export async function confirmFunding(
  deps: Deps,
  scope: WorkspaceScope,
  runId: string,
  o: { provenance?: Provenance; tkOverride?: ReturnType<typeof toolkitFor> } = {},
): Promise<FundOutcome> {
  const tk = o.tkOverride ?? toolkitFor(deps, { workspaceId: scope.workspaceId });
  const [row] = await deps.db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, scope.workspaceId), eq(schema.invoices.runId, runId)));
  if (!row?.paypalInvoiceId) {
    throw new PayPalStepError("INVALID_TRANSITION", "The run has no invoice at PayPal yet.", {
      transient: false,
    });
  }
  // I8: a payment recorded by us is the simulated rail; PayPal's own PAID carries the rail's provenance.
  return fundFrom(deps, scope, runId, await getInvoice(tk, row.paypalInvoiceId), o);
}
