// The Proof bundle (S3.12, contracts `ProofBundle`): six plates, every one bound to the workspace's hash-chained
// ledger and anchored by a checkpoint this server signs at serve time. Everything here is read from the server's
// records and computed by code (I1); nothing is taken from a request. The bundle is built whole, then redacted
// per tier (./tier.ts): the public tier shows member IDs, never names or receivers (C-23).
//
// Where each plate comes from:
//   1 Paid        `invoices` (status, amount, due) and the reference `rc:{sha16}` code derives from the card
//   2 Ratified    `rate_cards` (canonical JCS, sha256, ratified_at); the first slip date from `slip_rows`
//   3 Read        `documents` behind the season's accepted slip rows (the chain must attest each hash)
//   4 Computed    `member_lines` with each line's canonical content (re-hashed here before it is served) and
//                 the pools code quotes from the lot and the ratified card
//   5 Two keys    `approvals` (signed, not voided) with each key's registered public half (`device_keys`, else
//                 the chain's `key.registered` entry, else the seeded sample keys); never trusted, only shown
//   6 Items       the run's primary `payout_batches` row and its `payout_items`; each status's event id is the
//                 forward-only fold of the chain's verified `webhook.applied` entries
import {
  type ApprovalPayload,
  ApprovalPayload as ApprovalPayloadSchema,
  INVOICE_STATUSES,
  type InvoiceStatus,
  type LedgerEntry,
  LedgerPayloads,
  type LineCanonical,
  LineCanonical as LineCanonicalSchema,
  type PayoutItemStatus,
  type PayRunState,
  type ProofBundle,
  type ProofItem,
  type ProofLine,
  type Provenance,
  type RateCardCanonical,
  RateCardCanonical as RateCardCanonicalSchema,
  type SignedApproval,
} from "@fairsplit/contracts";
import { type Db, type DbOrTx, isTransaction, schema } from "@fairsplit/db";
import {
  applyItemStatus,
  batchNote,
  ENGINE_VERSION,
  invoiceReference,
  itemStatusFromEvent,
  jcsSha256,
  mulDivHalfUp,
  seasonLabelOf,
} from "@fairsplit/domain";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { Logger } from "pino";
import { readWorkspaceLedger, signProofCheckpoint } from "../ledger/chain.js";
import type { LedgerSigningKey } from "../ledger/keys.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { publicKeyHexOf, sampleOfficerKeys } from "./keys.js";

// ---------------------------------------------------------------- the run

/** A Proof exists once the batch exists: from POSTING on (and for a batch PayPal denied). */
export const PROOF_STATES: readonly PayRunState[] = schema.RUN_STATES_WITH_DIGEST;

export interface ProofRun {
  id: string;
  workspaceId: string;
  runSlug: string;
  runSeq: number;
  seasonId: string;
  seasonCode: string;
  lotId: string | null;
  rateCardId: string;
  rateCardSha256: string;
  batchSha256: string | null;
  senderBatchId: string | null;
  state: PayRunState;
  provenance: Provenance;
  fx: { num: number; den: number } | null;
}

const runColumns = {
  id: schema.payRuns.id,
  workspaceId: schema.payRuns.workspaceId,
  runSlug: schema.payRuns.runSlug,
  runSeq: schema.payRuns.runSeq,
  seasonId: schema.payRuns.seasonId,
  seasonCode: schema.payRuns.seasonCode,
  lotId: schema.payRuns.lotId,
  rateCardId: schema.payRuns.rateCardId,
  rateCardSha256: schema.payRuns.rateCardSha256,
  batchSha256: schema.payRuns.batchSha256,
  senderBatchId: schema.payRuns.senderBatchId,
  state: schema.payRuns.state,
  provenance: schema.payRuns.provenance,
  fxNum: schema.payRuns.fxNum,
  fxDen: schema.payRuns.fxDen,
};

interface RunRow {
  id: string;
  workspaceId: string;
  runSlug: string;
  runSeq: number;
  seasonId: string;
  seasonCode: string;
  lotId: string | null;
  rateCardId: string;
  rateCardSha256: string;
  batchSha256: string | null;
  senderBatchId: string | null;
  state: string;
  provenance: string;
  fxNum: bigint | null;
  fxDen: bigint | null;
}

function toProofRun(row: RunRow): ProofRun {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runSlug: row.runSlug,
    runSeq: Number(row.runSeq),
    seasonId: row.seasonId,
    seasonCode: row.seasonCode,
    lotId: row.lotId ?? null,
    rateCardId: row.rateCardId,
    rateCardSha256: row.rateCardSha256,
    batchSha256: row.batchSha256 ?? null,
    senderBatchId: row.senderBatchId ?? null,
    state: row.state as PayRunState,
    provenance: row.provenance as Provenance,
    fx:
      row.fxNum !== null && row.fxDen !== null && row.fxDen > 0n
        ? { num: Number(row.fxNum), den: Number(row.fxDen) }
        : null,
  };
}

/** Public lookup: run slugs are globally unique (one sequence), so the public Proof needs no workspace. */
export async function findRunBySlug(db: DbOrTx, runSlug: string, now: Date): Promise<ProofRun | null> {
  // Permanent seeded worlds have no expiring claim (judge/pool.ts workspaceInUse). A Reset ends an
  // expiring judge claim immediately; its expiry remains unchanged until the hourly purge.
  const [row] = await db
    .select(runColumns)
    .from(schema.payRuns)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.payRuns.workspaceId))
    .where(
      and(
        eq(schema.payRuns.runSlug, runSlug),
        or(isNull(schema.workspaces.expiresAt), gt(schema.workspaces.expiresAt, now)),
        or(
          isNull(schema.workspaces.expiresAt),
          ne(schema.workspaces.kind, "judge"),
          isNotNull(schema.workspaces.claimedAt),
        ),
      ),
    )
    .limit(1);
  return row ? toProofRun(row) : null;
}

/** Scoped lookup: the run must be in the credential's workspace (another workspace's run looks absent). */
export async function findRunInWorkspace(
  db: DbOrTx,
  workspaceId: string,
  runSlug: string,
): Promise<ProofRun | null> {
  const [row] = await db
    .select(runColumns)
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, workspaceId), eq(schema.payRuns.runSlug, runSlug)))
    .limit(1);
  return row ? toProofRun(row) : null;
}

/**
 * The run as the snapshot `db` sees it. A caller's lookup happened before the snapshot began, so a transition
 * committed in between would mix two moments (the run's state, hashes and reference from one, everything else
 * from the other); every builder therefore re-reads the run inside its own snapshot and trusts only the ids.
 */
async function runInSnapshot(db: DbOrTx, run: Pick<ProofRun, "id" | "workspaceId">): Promise<ProofRun> {
  const [row] = await db
    .select(runColumns)
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, run.workspaceId), eq(schema.payRuns.id, run.id)))
    .limit(1);
  if (!row) throw problem.notFound("No such pay run.");
  return toProofRun(row);
}

export function proofReady(run: ProofRun): boolean {
  return PROOF_STATES.includes(run.state) && run.batchSha256 !== null && run.senderBatchId !== null;
}

/** 404 with the reason the console shows ("No pay run yet" / "published once the batch is posted"). */
export function notReady(run: ProofRun): never {
  throw new ApiProblem(
    "NOT_FOUND",
    `Run ${run.runSlug} has no Proof yet: it is published once the batch is posted to PayPal.`,
    { details: { reason: "PROOF_NOT_READY", runState: run.state } },
  );
}

// ---------------------------------------------------------------- provenance (I8)

const REALNESS: Readonly<Record<Provenance, number>> = { seeded: 0, simulated_rail: 1, replay: 2, live: 3 };

/** The least-real label among the parts: a bundle is only as real as its least real part. */
export function weakestProvenance(labels: readonly Provenance[]): Provenance {
  let out: Provenance = "live";
  for (const l of labels) if (REALNESS[l] < REALNESS[out]) out = l;
  return out;
}

/** Payout replays must survive a seeded or simulated envelope label in every served export. */
function proofProvenance(
  run: Provenance,
  invoice: Provenance | null,
  payouts: readonly Provenance[],
): Provenance {
  return payouts.includes("replay")
    ? "replay"
    : weakestProvenance([run, ...(invoice ? [invoice] : []), ...payouts]);
}

// ---------------------------------------------------------------- facts the metrics reuse

export interface LineFact {
  lineId: string;
  memberId: string;
  memberNo: string;
  state: string;
  rail: "PAYPAL" | "CASH";
  netCents: number;
  premiumCents: number;
  bonusCents: number;
  deductionsCents: number;
  creditsCents: number;
  /** The line's canonical content re-hashes to its stored line hash (it traces to slips and rules). */
  explained: boolean;
}

export interface ItemFact {
  provenance: Provenance;
  senderItemId: string;
  memberNo: string | null;
  amountCents: number;
  status: PayoutItemStatus;
  eventId: string | null;
  lineId: string;
}

export interface ProofFacts {
  run: ProofRun;
  lines: LineFact[];
  items: ItemFact[];
  premiumPoolCents: number;
  bonusPoolCents: number;
  ledger: LedgerEntry[];
  /** Replay when payouts replay; otherwise the least-real label of the run, invoice, batch and items (I8). */
  provenance: Provenance;
}

export interface BuiltProof {
  bundle: ProofBundle;
  provenance: Provenance;
  facts: ProofFacts;
}

// ---------------------------------------------------------------- building

interface BuildOptions {
  key: LedgerSigningKey;
  now: Date;
  log?: Pick<Logger, "warn">;
}

const ACCEPTED_ROWS = ["AUTO_ACCEPTED", "CONFIRMED"] as const;
const SLIP_DOCUMENT_KINDS = ["slip_photo", "slip_page"] as const;

/**
 * Runs `fn` on one consistent, read-only snapshot (REPEATABLE READ): a webhook applied while a Proof is being
 * assembled lands either entirely before it (ledger entry, item status and line state together) or entirely
 * after it, never half in. Inside an open transaction, that transaction is the snapshot.
 */
export function readSnapshot<T>(db: DbOrTx, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  if (isTransaction(db)) return fn(db);
  return (db as Db).transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** The facts metrics and streams need, without building (or signing) the bundle. */
export function loadProofFacts(db: DbOrTx, run: ProofRun): Promise<ProofFacts> {
  if (!proofReady(run)) notReady(run);
  return readSnapshot(db, (tx) => readFacts(tx, run));
}

/**
 * A run's facts at any state (the brand view before posting): no items before the batch exists, and pools of
 * zero while nothing can be quoted yet. Never signs anything.
 */
export function loadRunFacts(db: DbOrTx, run: ProofRun): Promise<ProofFacts> {
  return readSnapshot(db, (tx) => readFacts(tx, run, false));
}

async function readFacts(db: DbOrTx, lookedUp: ProofRun, strict = true): Promise<ProofFacts> {
  const run = await runInSnapshot(db, lookedUp);
  if (strict && !proofReady(run)) notReady(run);
  const ledger = await readWorkspaceLedger(db, run.workspaceId);
  const invoice = await readInvoiceOrNull(db, run, strict);
  const lines = await readLines(db, run);
  const batch = await readItems(db, run, ledger, strict);
  const pools = strict
    ? await readPools(db, run, ledger)
    : await readPools(db, run, ledger).catch(() => ({ premiumPoolCents: 0, bonusPoolCents: 0 }));
  return {
    run,
    lines: lines.facts,
    items: batch.facts,
    premiumPoolCents: pools.premiumPoolCents,
    bonusPoolCents: pools.bonusPoolCents,
    ledger,
    provenance: proofProvenance(run.provenance, invoice?.provenance ?? null, batch.provenances),
  };
}

async function readInvoiceOrNull(db: DbOrTx, run: ProofRun, strict: boolean) {
  try {
    return await readInvoice(db, run);
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

/** Builds the full (unredacted) bundle for a posted run, from one snapshot, and signs its checkpoint. */
export function buildProofBundle(db: DbOrTx, run: ProofRun, o: BuildOptions): Promise<BuiltProof> {
  if (!proofReady(run)) notReady(run);
  return readSnapshot(db, (tx) => assemble(tx, run, o));
}

async function assemble(db: DbOrTx, lookedUp: ProofRun, o: BuildOptions): Promise<BuiltProof> {
  const run = await runInSnapshot(db, lookedUp);
  if (!proofReady(run)) notReady(run);
  const ledger = await readWorkspaceLedger(db, run.workspaceId, o.log);
  const card = await readCard(db, run);
  const invoice = await readInvoice(db, run);
  const lines = await readLines(db, run);
  const docs = await readDocuments(db, run, ledger);
  const approvals = await readApprovals(db, run, ledger);
  const batch = await readItems(db, run, ledger);
  const pools = await readPools(db, run, ledger);
  for (const l of lines.facts) {
    if (!l.explained)
      o.log?.warn({ runSlug: run.runSlug, memberNo: l.memberNo }, "proof: line canonical not found");
  }
  const bundleWithoutCheckpoint: Omit<ProofBundle, "checkpoint"> = {
    v: 1,
    runId: run.id,
    runSlug: run.runSlug,
    invoice: invoice.dto,
    rateCard: card,
    firstSlipDate: docs.firstSlipDate,
    documents: docs.documents,
    pools: { premiumPoolCents: pools.premiumPoolCents, bonusPoolCents: pools.bonusPoolCents },
    lines: lines.proof,
    approvals,
    batch: {
      runId: run.id,
      senderBatchId: batch.senderBatchId,
      rateCardSha256: run.rateCardSha256,
      batchSha256: batch.batchSha256,
      note: batchNote(seasonLabelOf(run.seasonCode), batch.batchSha256),
      items: batch.items,
    },
    ledger,
  };
  const checkpoint = signProofCheckpoint(ledger, run.id, o.key, o.now);
  const provenance = proofProvenance(run.provenance, invoice.provenance, batch.provenances);
  return {
    bundle: { ...bundleWithoutCheckpoint, checkpoint },
    provenance,
    facts: {
      run,
      lines: lines.facts,
      items: batch.facts,
      premiumPoolCents: pools.premiumPoolCents,
      bonusPoolCents: pools.bonusPoolCents,
      ledger,
      provenance,
    },
  };
}

// ---------------------------------------------------------------- plate 2: the rate card

async function readCard(db: DbOrTx, run: ProofRun): Promise<ProofBundle["rateCard"]> {
  const [card] = await db
    .select({
      canonicalJcs: schema.rateCards.canonicalJcs,
      sha256: schema.rateCards.sha256,
      ratifiedAt: schema.rateCards.ratifiedAt,
    })
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.workspaceId, run.workspaceId), eq(schema.rateCards.id, run.rateCardId)))
    .limit(1);
  if (!card) throw problem.internal("The run's rate card is missing.");
  if (!card.ratifiedAt) throw problem.internal("The run's rate card was never ratified.");
  const canonical = parseCanonical(card.canonicalJcs);
  return { canonical, sha256: card.sha256, ratifiedAt: card.ratifiedAt.toISOString() };
}

export function parseCanonical(canonicalJcs: string): RateCardCanonical {
  let json: unknown;
  try {
    json = JSON.parse(canonicalJcs);
  } catch {
    throw problem.internal("The ratified rate card is not readable JSON.");
  }
  const parsed = RateCardCanonicalSchema.safeParse(json);
  if (!parsed.success) throw problem.internal("The ratified rate card is not in the contract's shape.");
  return parsed.data;
}

// ---------------------------------------------------------------- plate 1: the invoice

const KNOWN_INVOICE = new Set<string>(INVOICE_STATUSES);

async function readInvoice(
  db: DbOrTx,
  run: ProofRun,
): Promise<{ dto: ProofBundle["invoice"]; provenance: Provenance | null }> {
  const [inv] = await db
    .select({
      invoiceNumber: schema.invoices.invoiceNumber,
      status: schema.invoices.status,
      amountCents: schema.invoices.amountCents,
      dueCents: schema.invoices.dueCents,
      provenance: schema.invoices.provenance,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, run.workspaceId), eq(schema.invoices.runId, run.id)))
    .limit(1);
  if (!inv) throw problem.internal("The run's invoice is missing.");
  const amount = Number(inv.amountCents);
  return {
    dto: {
      invoiceNumber: inv.invoiceNumber,
      // NEW is our own pre-create checkpoint, never a PayPal status: it reads as a draft
      status: (KNOWN_INVOICE.has(inv.status) ? inv.status : "DRAFT") as InvoiceStatus,
      amountCents: amount,
      dueCents: inv.dueCents === null ? amount : Number(inv.dueCents),
      reference: invoiceReference(run.rateCardSha256),
    },
    provenance: inv.provenance as Provenance,
  };
}

// ---------------------------------------------------------------- plate 4: pools and lines

async function readPools(
  db: DbOrTx,
  run: ProofRun,
  ledger: readonly LedgerEntry[] | null,
): Promise<{ premiumPoolCents: number; bonusPoolCents: number }> {
  const [card] = await db
    .select({ canonicalJcs: schema.rateCards.canonicalJcs })
    .from(schema.rateCards)
    .where(and(eq(schema.rateCards.workspaceId, run.workspaceId), eq(schema.rateCards.id, run.rateCardId)))
    .limit(1);
  const lotWhere = run.lotId
    ? and(eq(schema.lots.workspaceId, run.workspaceId), eq(schema.lots.id, run.lotId))
    : and(eq(schema.lots.workspaceId, run.workspaceId), eq(schema.lots.seasonId, run.seasonId));
  const [lot] = await db
    .select({ shippedG: schema.lots.shippedG, grade1ShippedG: schema.lots.grade1ShippedG })
    .from(schema.lots)
    .where(lotWhere)
    .orderBy(asc(schema.lots.createdAt))
    .limit(1);
  if (card && lot) {
    const parsed = RateCardCanonicalSchema.safeParse(safeJson(card.canonicalJcs));
    if (parsed.success) {
      // C-09, exactly as the quote: shipped kg × premium rate, shipped Grade-1 kg × bonus rate (half-up)
      const p = parsed.data.pricing;
      return {
        premiumPoolCents: mulDivHalfUp(Number(lot.shippedG), p.premiumCentsPerShippedKg, 1000),
        bonusPoolCents: mulDivHalfUp(Number(lot.grade1ShippedG), p.bonusCentsPerShippedGrade1Kg, 1000),
      };
    }
  }
  const computed = ledger ? lastComputed(ledger, run.id) : null;
  if (computed) {
    return { premiumPoolCents: computed.premiumPoolCents, bonusPoolCents: computed.bonusPoolCents };
  }
  throw problem.internal("The run's pools cannot be quoted: no lot or rate card pricing.");
}

function lastComputed(ledger: readonly LedgerEntry[], runId: string) {
  let out: { premiumPoolCents: number; bonusPoolCents: number } | null = null;
  for (const e of ledger) {
    if (e.kind !== "lines.computed") continue;
    const p = LedgerPayloads["lines.computed"].safeParse(e.payload);
    if (p.success && p.data.runId === runId) out = p.data;
  }
  return out;
}

interface LineRow {
  id: string;
  memberId: string;
  memberNo: string;
  state: string;
  rail: string;
  verifiedG: bigint;
  grade1G: bigint;
  premiumCents: bigint;
  bonusCents: bigint;
  deductionsCents: bigint;
  creditsCents: bigint;
  netCents: bigint;
  deductions: unknown;
  lineSha256: string | null;
  trace: unknown;
}

async function readLines(db: DbOrTx, run: ProofRun): Promise<{ proof: ProofLine[]; facts: LineFact[] }> {
  const ml = schema.memberLines;
  const rows: LineRow[] = await db
    .select({
      id: ml.id,
      memberId: ml.memberId,
      memberNo: schema.members.memberNo,
      state: ml.state,
      rail: ml.rail,
      verifiedG: ml.verifiedG,
      grade1G: ml.grade1G,
      premiumCents: ml.premiumCents,
      bonusCents: ml.bonusCents,
      deductionsCents: ml.deductionsCents,
      creditsCents: ml.creditsCents,
      netCents: ml.netCents,
      deductions: ml.deductions,
      lineSha256: ml.lineSha256,
      trace: ml.trace,
    })
    .from(ml)
    .innerJoin(
      schema.members,
      and(eq(schema.members.workspaceId, ml.workspaceId), eq(schema.members.id, ml.memberId)),
    )
    .where(and(eq(ml.workspaceId, run.workspaceId), eq(ml.runId, run.id)));
  const serialsByMember = await acceptedSerialsByMember(db, run);
  const proof: ProofLine[] = [];
  const facts: LineFact[] = [];
  for (const row of rows.sort((a, b) => (a.memberNo < b.memberNo ? -1 : 1))) {
    const resolved = resolveLineCanonical(row, run.rateCardSha256, serialsByMember.get(row.memberId) ?? []);
    const rail = row.rail === "ON" ? "PAYPAL" : "CASH";
    proof.push({
      memberNo: row.memberNo,
      rail,
      premiumCents: Number(row.premiumCents),
      bonusCents: Number(row.bonusCents),
      deductionsCents: Number(row.deductionsCents),
      creditsCents: Number(row.creditsCents),
      netCents: Number(row.netCents),
      canonical: resolved.canonical,
      lineSha256: row.lineSha256 ?? resolved.sha256,
    });
    facts.push({
      lineId: row.id,
      memberId: row.memberId,
      memberNo: row.memberNo,
      state: row.state,
      rail,
      netCents: Number(row.netCents),
      premiumCents: Number(row.premiumCents),
      bonusCents: Number(row.bonusCents),
      deductionsCents: Number(row.deductionsCents),
      creditsCents: Number(row.creditsCents),
      explained: resolved.matches,
    });
  }
  return { proof, facts };
}

/** Serials of the season's accepted slip rows per member, sorted as the engine sorts them. */
async function acceptedSerialsByMember(db: DbOrTx, run: ProofRun): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ memberId: schema.slipRows.memberId, serial: schema.slipRows.serial })
    .from(schema.slipRows)
    .where(
      and(
        eq(schema.slipRows.workspaceId, run.workspaceId),
        eq(schema.slipRows.seasonId, run.seasonId),
        inArray(schema.slipRows.state, [...ACCEPTED_ROWS]),
      ),
    );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.memberId) continue;
    out.set(r.memberId, [...(out.get(r.memberId) ?? []), r.serial]);
  }
  for (const list of out.values()) list.sort();
  return out;
}

const DEDUCTION_RULES = new Set(["R1", "R3", "R4"]);

/**
 * The canonical content behind a stored line hash. The line writer keeps it in `member_lines.trace` (as
 * `{canonical}` or as the canonical itself); otherwise it is rebuilt from the line's columns, its engine
 * deductions and the member's accepted slips. Whatever is served must re-hash to the stored hash to count as
 * explained; a line that does not is still served as rebuilt, so the verifier fails plate 4 honestly.
 */
export function resolveLineCanonical(
  row: Pick<
    LineRow,
    | "memberNo"
    | "rail"
    | "verifiedG"
    | "grade1G"
    | "premiumCents"
    | "bonusCents"
    | "netCents"
    | "deductions"
    | "lineSha256"
    | "trace"
  >,
  rateCardSha256: string,
  acceptedSerials: readonly string[],
): { canonical: LineCanonical; sha256: string; matches: boolean } {
  const candidates: LineCanonical[] = [];
  const trace = asRecord(row.trace);
  for (const c of [trace?.canonical, row.trace, asRecord(row.deductions)?.canonical]) {
    const p = LineCanonicalSchema.safeParse(c);
    if (p.success) candidates.push(p.data);
  }
  const traceSerials = stringArray(trace?.slipSerials);
  const traceCredits = Array.isArray(trace?.credits)
    ? (trace.credits as unknown[]).flatMap((c) => {
        const r = asRecord(c);
        return r && typeof r.markId === "string" && Number.isSafeInteger(r.amountCents)
          ? [{ markId: r.markId, amountCents: Number(r.amountCents) }]
          : [];
      })
    : [];
  const deductionList = Array.isArray(row.deductions)
    ? row.deductions
    : ((asRecord(row.deductions)?.items as unknown[] | undefined) ?? []);
  const rebuilt: LineCanonical = {
    v: 1,
    engine: ENGINE_VERSION,
    rateCardSha256,
    memberNo: row.memberNo,
    rail: row.rail === "ON" ? "PAYPAL" : "CASH",
    verifiedG: Number(row.verifiedG),
    grade1G: Number(row.grade1G),
    slipSerials: traceSerials ?? [...acceptedSerials],
    premiumCents: Number(row.premiumCents),
    bonusCents: Number(row.bonusCents),
    deductions: deductionList.flatMap((d) => {
      const r = asRecord(d);
      if (!r || typeof r.ruleId !== "string" || !DEDUCTION_RULES.has(r.ruleId)) return [];
      const amount = Number(r.amountCents);
      if (!Number.isSafeInteger(amount) || amount < 0) return [];
      return [
        {
          ruleId: r.ruleId as "R1" | "R3" | "R4",
          amountCents: amount,
          ref: typeof r.ref === "string" ? r.ref : null,
          carriedCentavos: Number.isSafeInteger(r.carriedCentavos) ? Number(r.carriedCentavos) : null,
        },
      ];
    }),
    credits: traceCredits,
    netCents: Number(row.netCents),
  };
  candidates.push(rebuilt);
  for (const c of candidates) {
    const sha = jcsSha256(c);
    if (row.lineSha256 !== null && sha === row.lineSha256)
      return { canonical: c, sha256: sha, matches: true };
  }
  return { canonical: rebuilt, sha256: jcsSha256(rebuilt), matches: false };
}

// ---------------------------------------------------------------- plates 2 and 3: slips and photos

async function readDocuments(
  db: DbOrTx,
  run: ProofRun,
  ledger: readonly LedgerEntry[],
): Promise<{ documents: ProofBundle["documents"]; firstSlipDate: string }> {
  const rows = await db
    .select({
      documentId: schema.slipRows.documentId,
      slipDate: schema.slipRows.slipDate,
    })
    .from(schema.slipRows)
    .where(
      and(
        eq(schema.slipRows.workspaceId, run.workspaceId),
        eq(schema.slipRows.seasonId, run.seasonId),
        inArray(schema.slipRows.state, [...ACCEPTED_ROWS]),
      ),
    );
  let ids = [...new Set(rows.map((r) => r.documentId))];
  if (ids.length === 0) {
    // No slip rows (an archived season): the documents the chain records as read, if we still hold them.
    ids = [
      ...new Set(
        ledger.flatMap((e) => {
          if (e.kind !== "rows.accepted") return [];
          const p = LedgerPayloads["rows.accepted"].safeParse(e.payload);
          return p.success ? [p.data.documentId] : [];
        }),
      ),
    ];
  }
  const docs =
    ids.length === 0
      ? []
      : await db
          .select({ id: schema.documents.id, sha256: schema.documents.sha256 })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.workspaceId, run.workspaceId),
              inArray(schema.documents.id, ids),
              inArray(schema.documents.kind, [...SLIP_DOCUMENT_KINDS]),
            ),
          );
  const documents = docs
    .map((d) => ({ documentId: d.id, sha256: d.sha256 }))
    .sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
  const held = new Set(documents.map((d) => d.documentId));
  let first = rows
    .filter((r) => held.has(r.documentId) && r.slipDate)
    .map((r) => String(r.slipDate))
    .sort()[0];
  if (!first) {
    first = ledger
      .flatMap((e) => {
        if (e.kind !== "rows.accepted") return [];
        const p = LedgerPayloads["rows.accepted"].safeParse(e.payload);
        return p.success && held.has(p.data.documentId) ? p.data.slipDates : [];
      })
      .sort()[0];
  }
  if (!first) {
    const [season] = await db
      .select({ opensOn: schema.seasons.opensOn })
      .from(schema.seasons)
      .where(and(eq(schema.seasons.workspaceId, run.workspaceId), eq(schema.seasons.id, run.seasonId)))
      .limit(1);
    first = season ? String(season.opensOn) : "1970-01-01";
  }
  return { documents, firstSlipDate: first };
}

// ---------------------------------------------------------------- plate 5: two keys

async function readApprovals(
  db: DbOrTx,
  run: ProofRun,
  ledger: readonly LedgerEntry[],
): Promise<SignedApproval[]> {
  const a = schema.approvals;
  const rows = await db
    .select({
      role: a.role,
      keyId: a.keyId,
      payloadJcs: a.payloadJcs,
      signature: a.signature,
      createdAt: a.createdAt,
    })
    .from(a)
    .where(
      and(
        eq(a.workspaceId, run.workspaceId),
        eq(a.runId, run.id),
        eq(a.decision, "SIGNED"),
        isNull(a.voidedAt),
      ),
    )
    .orderBy(asc(a.createdAt));
  const deviceKeys = await db
    .select({ keyId: schema.deviceKeys.keyId, publicKey: schema.deviceKeys.publicKey })
    .from(schema.deviceKeys)
    .where(eq(schema.deviceKeys.workspaceId, run.workspaceId));
  const registered = new Map<string, string>();
  for (const e of ledger) {
    if (e.kind !== "key.registered") continue;
    const p = LedgerPayloads["key.registered"].safeParse(e.payload);
    if (p.success && !registered.has(p.data.keyId)) registered.set(p.data.keyId, p.data.publicKeyHex);
  }
  const samples = new Map(sampleOfficerKeys().map((k) => [k.keyId, k.publicKeyHex]));
  const out: SignedApproval[] = [];
  for (const row of rows) {
    if (!row.keyId || !row.payloadJcs || !row.signature) continue;
    const payload = parsePayload(row.payloadJcs);
    const signatureHex = signatureHexOf(row.signature);
    const stored = deviceKeys.find((k) => k.keyId === row.keyId);
    const publicKeyHex =
      (stored ? publicKeyHexOf(stored.publicKey) : null) ??
      registered.get(row.keyId) ??
      samples.get(row.keyId) ??
      null;
    if (!payload || !signatureHex || !publicKeyHex) continue;
    out.push({
      role: row.role === "board" ? "chair" : "treasurer",
      keyId: row.keyId,
      publicKeyHex,
      payload,
      signatureHex,
    });
  }
  return out.sort((x, y) => (x.role === y.role ? 0 : x.role === "treasurer" ? -1 : 1));
}

function parsePayload(jcsText: string): ApprovalPayload | null {
  const p = ApprovalPayloadSchema.safeParse(safeJson(jcsText));
  return p.success ? p.data : null;
}

/** Signatures are stored as hex (the API's wire form); base64url of the 64 bytes is accepted too. */
export function signatureHexOf(stored: string): string | null {
  if (/^[0-9a-f]{128}$/.test(stored)) return stored;
  if (/^[A-Za-z0-9_-]{86}$/.test(stored)) {
    const b = Buffer.from(stored, "base64url");
    return b.length === 64 ? b.toString("hex") : null;
  }
  return null;
}

// ---------------------------------------------------------------- plate 6: payout items

async function readItems(
  db: DbOrTx,
  run: ProofRun,
  ledger: readonly LedgerEntry[] | null,
  strict = true,
): Promise<{
  senderBatchId: string;
  batchSha256: string;
  items: ProofItem[];
  facts: ItemFact[];
  provenances: Provenance[];
}> {
  const pb = schema.payoutBatches;
  const [batch] = await db
    .select({
      id: pb.id,
      senderBatchId: pb.senderBatchId,
      batchSha256: pb.batchSha256,
      provenance: pb.provenance,
    })
    .from(pb)
    .where(and(eq(pb.workspaceId, run.workspaceId), eq(pb.runId, run.id), eq(pb.kind, "primary")))
    .orderBy(desc(pb.submittedAt))
    .limit(1);
  const senderBatchId = batch?.senderBatchId ?? run.senderBatchId;
  const batchSha256 = batch?.batchSha256 ?? run.batchSha256;
  if (!senderBatchId || !batchSha256) {
    if (strict) notReady(run);
    return { senderBatchId: "", batchSha256: "", items: [], facts: [], provenances: [] };
  }
  if (!batch) {
    return { senderBatchId, batchSha256, items: [], facts: [], provenances: [] };
  }
  const pi = schema.payoutItems;
  const rows = await db
    .select({
      senderItemId: pi.senderItemId,
      receiver: pi.receiver,
      amountCents: pi.amountCents,
      currency: pi.currency,
      payoutItemId: pi.payoutItemId,
      status: pi.status,
      lineId: pi.lineId,
      provenance: pi.provenance,
    })
    .from(pi)
    .where(and(eq(pi.workspaceId, run.workspaceId), eq(pi.batchId, batch.id)))
    .orderBy(asc(pi.senderItemId));
  const folds = ledger ? foldItemEvents(ledger) : new Map<string, ItemFold>();
  const items: ProofItem[] = [];
  const facts: ItemFact[] = [];
  for (const r of rows) {
    const status = r.status as PayoutItemStatus;
    const fold = folds.get(r.senderItemId);
    // The event the status rests on: the last verified event that moved this item, if it moved it here.
    const replayed =
      r.provenance === "replay" || batch.provenance === "replay" || run.provenance === "replay";
    const eventId = !replayed && fold && fold.status === status ? fold.lastEventId : null;
    items.push({
      senderItemId: r.senderItemId,
      receiver: r.receiver,
      amountCents: Number(r.amountCents),
      currency: "USD",
      payoutItemId: r.payoutItemId ?? null,
      status,
      eventId,
      ...(replayed ? { provenance: "replay" as const } : {}),
    });
    facts.push({
      provenance: replayed ? "replay" : (r.provenance as Provenance),
      senderItemId: r.senderItemId,
      memberNo: /-(M-\d{3})$/.exec(r.senderItemId)?.[1] ?? null,
      amountCents: Number(r.amountCents),
      status,
      eventId,
      lineId: r.lineId,
    });
  }
  return {
    senderBatchId: batch.senderBatchId,
    batchSha256: batch.batchSha256,
    items,
    facts,
    provenances: [batch.provenance as Provenance, ...rows.map((r) => r.provenance as Provenance)],
  };
}

export interface ItemFold {
  status: PayoutItemStatus;
  lastEventId: string | null;
}

/**
 * The forward-only fold of the chain's `webhook.applied` item entries, exactly as plate 6 replays it: an event
 * applies only if its status outranks the current one, and RETURNED only after our own `payout.cancel`.
 */
export function foldItemEvents(ledger: readonly LedgerEntry[]): Map<string, ItemFold> {
  const out = new Map<string, ItemFold>();
  const cancelled = new Set<string>();
  for (const e of ledger) {
    if (e.kind === "payout.cancel") {
      const p = LedgerPayloads["payout.cancel"].safeParse(e.payload);
      if (p.success) cancelled.add(p.data.senderItemId);
      continue;
    }
    if (e.kind !== "webhook.applied") continue;
    const p = LedgerPayloads["webhook.applied"].safeParse(e.payload);
    if (!p.success || p.data.resource !== "payout_item") continue;
    const ev = p.data;
    if (
      ev.verified === "dev_mock" ||
      ev.provenance === "replay" ||
      itemStatusFromEvent(ev.eventType) !== ev.status
    )
      continue;
    const cur = out.get(ev.senderItemId) ?? { status: "SUBMITTED" as PayoutItemStatus, lastEventId: null };
    const applied = applyItemStatus(cur.status, ev.status, {
      cancelRequested: cancelled.has(ev.senderItemId),
    });
    if (applied.applied) out.set(ev.senderItemId, { status: applied.next, lastEventId: ev.eventId });
    else out.set(ev.senderItemId, cur);
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? [...(v as string[])] : null;
}
