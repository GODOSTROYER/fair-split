// Code computes every amount (I1, I3): `recompute` rebuilds the IC-02 EngineInput for a run from the database
// (the ratified card, the lot, the members, every slip row with its people-decided fields, the resolutions
// people made), runs the pure `computeLines`, and writes what changed in the caller's transaction: member
// lines (amounts, hashes, HELD → READY | EXCLUDED), holds (raised, engine-cleared, entered by hand), their
// IC-01 events, and the `lines.computed` ledger entry Proof plate 4 checks.
//
// Seeded workspaces (showcase, judge) hold the synthetic season of `@fairsplit/seed`. Facts the persistence
// schema does not store yet (a slip's collection station and moisture deduction, members' CBU, loans and
// advances) are read from that snapshot by natural key (serial + copy colour, member number); every
// decision (a value typed by hand, a hold resolution) comes from the database. A `real` workspace uses its
// stored rows only. Nothing here reads a clock or calls out: it is safe inside a request transaction.
import {
  BLOCKING_SLIP_FIELDS,
  type CopyColor,
  CopyColor as CopyColorSchema,
  type EngineHold,
  type EngineInput,
  type EngineLine,
  type EngineMark,
  type EngineMember,
  type EngineOutput,
  type EngineResolution,
  type EngineRow,
  type Grade,
  type HoldKind,
  type HoldResolutionKind,
  type Json,
  type PriorHold,
  type Provenance,
  type RatifiedRateCard,
  RuleId,
  type SnapshotSlip,
  type Station,
} from "@fairsplit/contracts";
import { type Actor, type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import {
  computeLines,
  deriveKilos,
  engineLine,
  linesRootSha256,
  normalise,
  overrideCount,
} from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, inArray } from "drizzle-orm";
import { problem } from "../lib/problem.js";
import { initialsOf } from "./access.js";
import { dbRailOf, railOf, toInt } from "./codes.js";
import { ACTORS, emit, proofLedger } from "./events.js";
import { cardById, lotById, lotOf, ratifiedCard } from "./load.js";
import { cause, type HoldRow, type LineRow, moveHold, moveLine, type RunRow } from "./machine.js";

export type SlipRowRow = typeof schema.slipRows.$inferSelect;
export type SlipFieldRow = typeof schema.slipFields.$inferSelect;
type MarkRow = typeof schema.deductionMarks.$inferSelect;
type AnomalyRow = typeof schema.slipAnomalies.$inferSelect;
type DocumentRow = typeof schema.documents.$inferSelect;
type MemberRow = typeof schema.members.$inferSelect;

/** What a stored hold keeps in `engine_params` (the schema has no column for the engine key). */
export interface StoredHoldFacts {
  key: string;
  memberNo: string | null;
  serials: string[];
  rowIds: string[];
  documentIds: string[];
  params: Record<string, Json>;
}

export function holdFacts(row: HoldRow): StoredHoldFacts {
  const p = (row.engineParams ?? {}) as Partial<StoredHoldFacts>;
  return {
    key: typeof p.key === "string" ? p.key : `${row.kind}:${row.id}`,
    memberNo: typeof p.memberNo === "string" ? p.memberNo : null,
    serials: Array.isArray(p.serials) ? p.serials.map(String) : [],
    rowIds: Array.isArray(p.rowIds) ? p.rowIds.map(String) : [],
    documentIds: Array.isArray(p.documentIds) ? p.documentIds.map(String) : [],
    params: p.params && typeof p.params === "object" ? (p.params as Record<string, Json>) : {},
  };
}

/** A stored resolution (`holds.resolution` jsonb). */
export interface StoredResolution {
  kind: HoldResolutionKind;
  by: string;
  at: string | null;
  reason: string | null;
  plot?: { plotNo: string; areaHa: string; trees: number };
  ruleId?: string;
}

export function resolutionOf(row: HoldRow): StoredResolution | null {
  const r = row.resolution as Partial<StoredResolution> | null;
  if (!r || typeof r.kind !== "string") return null;
  return {
    kind: r.kind as HoldResolutionKind,
    by: typeof r.by === "string" ? r.by : (row.resolvedBy ?? "engine"),
    at: typeof r.at === "string" ? r.at : (row.resolvedAt?.toISOString() ?? null),
    reason: typeof r.reason === "string" ? r.reason : null,
    ...(r.plot ? { plot: r.plot } : {}),
    ...(typeof r.ruleId === "string" ? { ruleId: r.ruleId } : {}),
  };
}

// ---------------------------------------------------------------- reading the inputs

export interface RunWorld {
  run: RunRow;
  card: RatifiedRateCard;
  seeded: boolean;
  members: MemberRow[];
  memberById: Map<string, MemberRow>;
  memberByNo: Map<string, MemberRow>;
  lines: LineRow[];
  holds: HoldRow[];
  input: EngineInput;
}

const SEEDED_KINDS = new Set(["showcase", "judge"]);
const PERSON = "person";

function seedSlipIndex(): Map<string, SnapshotSlip> {
  const m = new Map<string, SnapshotSlip>();
  for (const s of getSnapshot().slips) m.set(`${s.serial}:${s.copy}`, s);
  return m;
}

function copyOf(v: string | null | undefined): CopyColor {
  const parsed = CopyColorSchema.safeParse(v);
  return parsed.success ? parsed.data : "UNKNOWN";
}

function gramsOf(text: string | null | undefined): number | null {
  return text ? normalise.kgGrams(text) : null;
}

function plotNoOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const v = normalise.plotNo(text);
  return /^P-\d{3}-[A-Z]$/.test(v) ? v : null;
}

/** One stored slip row as the engine reads it: seeded facts by natural key, people's decisions from the DB. */
export function engineRowOf(
  row: SlipRowRow,
  ctx: {
    doc: DocumentRow | undefined;
    memberNo: string | null;
    fields: readonly SlipFieldRow[];
    marks: readonly MarkRow[];
    anomalies: readonly AnomalyRow[];
    seed: SnapshotSlip | undefined;
    autoAcceptScore: number;
  },
): EngineRow | null {
  const { seed, fields } = ctx;
  const memberNo = ctx.memberNo ?? seed?.memberNo ?? null;
  const slipDate = row.slipDate ?? seed?.slipDate ?? null;
  const grade = (normalise.grade(row.grade ?? "") ?? seed?.grade ?? null) as Grade | null;
  if (!memberNo || !slipDate || !grade) return null;

  const byField = new Map(fields.map((f) => [f.field, f]));
  const blocking = new Set<string>(BLOCKING_SLIP_FIELDS);
  const pendingFields = fields
    .filter(
      (f) =>
        blocking.has(f.field) &&
        f.decidedBy === null &&
        f.finalValue === null &&
        (f.agreement ?? 0) < ctx.autoAcceptScore,
    )
    .map((f) => ({
      fieldId: f.id,
      field: f.field as EngineRow["pendingFields"][number]["field"],
      score: f.agreement ?? 0,
    }));
  const typed = (name: string) => {
    const f = byField.get(name);
    return f && f.decidedBy === PERSON ? gramsOf(f.finalValue) : null;
  };
  const enteredByHand = fields.some((f) => f.decidedBy === PERSON);

  // Kilos: the slip as written (seed, else the stored row), with whatever a person typed by hand.
  let grossG = seed?.grossG ?? (row.grossG === null ? null : toInt(row.grossG));
  let tareG = seed?.tareG ?? (row.tareG === null ? null : toInt(row.tareG));
  let netG = seed?.netG ?? (row.netG === null ? null : toInt(row.netG));
  const typedGross = typed("gross_kg");
  const typedTare = typed("tare_kg");
  const typedNet = typed("net_kg");
  if (typedGross !== null || typedTare !== null) {
    const d = deriveKilos({ grossG: typedGross ?? grossG, tareG: typedTare ?? tareG, netG: null });
    if (d) ({ grossG, tareG, netG } = d);
  }
  if (typedNet !== null) netG = typedNet;
  const mcLessG = seed?.mcLessG ?? gramsOf(byField.get("mc_less_kg")?.finalValue) ?? 0;
  const typedPayable = typed("payable_kg");
  let payableG: number | null =
    typedPayable ?? (netG === null ? null : seed && netG === seed.netG ? seed.payableG : netG - mcLessG);
  if (pendingFields.length > 0) {
    netG = null;
    payableG = null;
  }
  if (netG !== null && netG < 0) netG = 0;
  if (payableG !== null && payableG < 0) payableG = 0;

  const seedMarks = seed?.marks ?? [];
  const marks: EngineMark[] = ctx.marks.map((m) => {
    const sm = seedMarks.find((x) => x.text === m.textVerbatim);
    const rule = RuleId.safeParse(m.ruleId);
    return {
      markId: m.id,
      text: m.textVerbatim,
      ruleId: rule.success ? rule.data : "NO_MATCH",
      writtenCentavos: m.writtenCents === null ? (sm?.writtenCentavos ?? null) : toInt(m.writtenCents),
      documentRef: sm?.documentRef ?? null,
    };
  });
  const anomalies = ctx.anomalies.map((a) => {
    const d = (a.detail ?? {}) as { overlap?: string; source?: string };
    return {
      anomalyId: a.id,
      kind: (a.kind === "ALTERED_VALUE" || a.kind === "UNKNOWN_MARK" ? a.kind : "INSTRUCTION_LIKE_TEXT") as
        | "INSTRUCTION_LIKE_TEXT"
        | "ALTERED_VALUE"
        | "UNKNOWN_MARK",
      quarantined: a.quarantinedText !== null,
      overlap: (["NONE", "FIELD", "KILO_FIELD", "DEDUCTION_LINE", "UNLOCATED"].includes(d.overlap ?? "")
        ? d.overlap
        : "NONE") as EngineRow["anomalies"][number]["overlap"],
      source: (["screen", "read_a", "read_b"].includes(d.source ?? "") ? d.source : "read_a") as
        | "screen"
        | "read_a"
        | "read_b",
    };
  });
  return {
    rowId: row.id,
    documentId: row.documentId,
    photoId: ctx.doc?.photoCode ?? seed?.photoId ?? null,
    serial: row.serial,
    copy: copyOf(row.copyColor ?? seed?.copy),
    memberNo,
    slipDate,
    station: (seed?.station ?? "BODEGA") as Station,
    netG,
    payableG,
    grade,
    plotNo: plotNoOf(byField.get("plot_no")?.finalValue) ?? seed?.plotNo ?? null,
    pendingFields,
    enteredByHand,
    marks,
    anomalies,
  };
}

/** Everything `computeLines` needs for a run, read in the caller's transaction. */
export async function loadRunWorld(tx: DbOrTx, scope: WorkspaceScope, run: RunRow): Promise<RunWorld> {
  const ws = scope.workspaceId;
  const cardRow = await cardById(tx, scope, run.rateCardId);
  const card = await ratifiedCard(tx, scope, cardRow);
  if (!card)
    throw problem.validation("The run's rate card is not a ratified Schedule A; nothing can be computed.");
  const lotRow = await lotById(tx, scope, run.lotId);
  if (!lotRow) throw problem.validation("The run has no lot; the quote cannot be computed.");
  const [wsRow] = await tx
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ws));
  const seeded = SEEDED_KINDS.has(wsRow?.kind ?? "real");
  const snapshot = getSnapshot();

  const [season] = await tx
    .select()
    .from(schema.seasons)
    .where(and(eq(schema.seasons.workspaceId, ws), eq(schema.seasons.id, run.seasonId)));
  if (!season) throw problem.notFound("No such season in this workspace.");
  const members = await tx
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.coopId, season.coopId)))
    .orderBy(asc(schema.members.memberNo));
  const plots = await tx.select().from(schema.plots).where(eq(schema.plots.workspaceId, ws));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const memberByNo = new Map(members.map((m) => [m.memberNo, m]));
  const seedMember = new Map(snapshot.members.map((m) => [m.memberNo, m]));

  const engineMembers: EngineMember[] = members.map((m) => {
    const fin = seeded ? seedMember.get(m.memberNo) : undefined;
    const registeredTrees = plots
      .filter((p) => p.memberId === m.id && p.registeredAt !== null)
      .reduce((s, p) => s + p.trees, 0);
    return {
      memberNo: m.memberNo,
      rail: railOf(m.rail),
      registeredTrees,
      cbuPaidUpCentavos: fin?.cbuPaidUpCentavos ?? 0,
      loans: (fin?.loans ?? []).map((l) => ({ ...l })),
      advances: (fin?.advances ?? []).map((a) => ({ ...a })),
    };
  });

  const slipRows = await tx
    .select()
    .from(schema.slipRows)
    .where(and(eq(schema.slipRows.workspaceId, ws), eq(schema.slipRows.seasonId, run.seasonId)));
  const live = slipRows.filter((r) => r.state !== "REJECTED");
  const rowIds = live.map((r) => r.id);
  const docIds = [...new Set(live.map((r) => r.documentId))];
  const [fields, marks, anomalies, docs] = rowIds.length
    ? await Promise.all([
        tx
          .select()
          .from(schema.slipFields)
          .where(and(eq(schema.slipFields.workspaceId, ws), inArray(schema.slipFields.slipRowId, rowIds))),
        tx
          .select()
          .from(schema.deductionMarks)
          .where(
            and(eq(schema.deductionMarks.workspaceId, ws), inArray(schema.deductionMarks.slipRowId, rowIds)),
          ),
        tx
          .select()
          .from(schema.slipAnomalies)
          .where(
            and(eq(schema.slipAnomalies.workspaceId, ws), inArray(schema.slipAnomalies.documentId, docIds)),
          ),
        tx
          .select()
          .from(schema.documents)
          .where(and(eq(schema.documents.workspaceId, ws), inArray(schema.documents.id, docIds))),
      ])
    : [[], [], [], []];
  const group = <T>(xs: readonly T[], key: (x: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = key(x);
      if (k === null) continue;
      const list = m.get(k) ?? [];
      list.push(x);
      m.set(k, list);
    }
    return m;
  };
  const fieldsBy = group(fields, (f) => f.slipRowId);
  const marksBy = group(marks, (m) => m.slipRowId);
  const anomaliesBy = group(anomalies, (a) => a.slipRowId);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const seedSlips = seeded ? seedSlipIndex() : new Map<string, SnapshotSlip>();
  const autoAcceptScore = season.autoAcceptBp / 10_000;

  const rows: EngineRow[] = [];
  for (const r of live) {
    const memberNo = r.memberId ? (memberById.get(r.memberId)?.memberNo ?? null) : null;
    const er = engineRowOf(r, {
      doc: docById.get(r.documentId),
      memberNo,
      fields: fieldsBy.get(r.id) ?? [],
      marks: marksBy.get(r.id) ?? [],
      anomalies: anomaliesBy.get(r.id) ?? [],
      seed: seedSlips.get(`${r.serial}:${copyOf(r.copyColor)}`),
      autoAcceptScore,
    });
    if (er && memberByNo.has(er.memberNo)) rows.push(er);
  }

  const lines = await tx
    .select()
    .from(schema.memberLines)
    .where(and(eq(schema.memberLines.workspaceId, ws), eq(schema.memberLines.runId, run.id)));
  const holds = await tx
    .select()
    .from(schema.holds)
    .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.runId, run.id)))
    .orderBy(asc(schema.holds.createdAt));

  const resolutions: EngineResolution[] = [];
  const priorHolds: PriorHold[] = [];
  const seenKeys = new Set<string>();
  for (const h of holds) {
    const f = holdFacts(h);
    if (!seenKeys.has(f.key)) {
      priorHolds.push({
        key: f.key,
        kind: h.kind as HoldKind,
        gate: h.gate as PriorHold["gate"],
        memberNo: f.memberNo,
      });
      seenKeys.add(f.key);
    }
    const r = resolutionOf(h);
    if (!r || (h.state !== "RESOLVED" && h.state !== "EXCLUDED")) continue;
    const at = r.at ?? h.resolvedAt?.toISOString() ?? new Date(0).toISOString();
    const base = { holdKey: f.key, by: r.by, at };
    switch (r.kind) {
      case "COUNT_ONCE":
      case "RETURN_AS_CREDIT":
      case "CONFIRM_AS_READ":
        resolutions.push({ ...base, resolution: r.kind });
        break;
      case "TWO_DELIVERIES":
      case "EXCLUDE_LINE":
        resolutions.push({ ...base, resolution: r.kind, reason: r.reason ?? "resolved by a person" });
        break;
      case "REGISTER_PLOT":
        if (r.plot) resolutions.push({ ...base, resolution: "REGISTER_PLOT", plot: r.plot });
        break;
      case "APPLY_RULE": {
        const rule = RuleId.safeParse(r.ruleId);
        if (rule.success) resolutions.push({ ...base, resolution: "APPLY_RULE", ruleId: rule.data });
        break;
      }
      default:
        break; // ENTERED_BY_HAND and ENGINE_CLEARED are the engine's own outcomes, not inputs
    }
  }

  const fxNum = run.fxNum === null ? null : toInt(run.fxNum);
  const fxDen = run.fxDen === null ? null : toInt(run.fxDen);
  const input: EngineInput = {
    card,
    lot: lotOf(lotRow),
    fx: fxNum && fxDen ? { num: fxNum, den: fxDen } : { ...snapshot.fx.centavosPerCent },
    members: engineMembers,
    rows,
    nearDuplicates: [],
    resolutions,
    priorHolds,
  };
  return { run, card, seeded, members, memberById, memberByNo, lines, holds, input };
}

// ---------------------------------------------------------------- writing the outputs

export interface RecomputeResult {
  output: EngineOutput;
  /** Lines whose amounts or state changed. */
  linesChanged: number;
  raised: string[];
  cleared: string[];
}

export interface ApplyOptions {
  at: Date;
  /** Who caused the recompute (a person's resolution, the engine after reading). */
  actor: Actor;
  provenance: Provenance;
}

// Exclusion is a terminal state, but its computed amounts still participate in the signed root.
// A later kilo correction changes the pool allocation for excluded members too (I3, I4).
const MUTABLE_LINE_STATES = new Set(["COMPUTED", "HELD", "READY", "EXCLUDED"]);

function seedHoldFor(kind: HoldKind, memberNo: string | null, serials: readonly string[]) {
  return getSnapshot().holds.find(
    (h) =>
      h.kind === kind &&
      h.memberNo === memberNo &&
      (h.serials.length === 0 || serials.length === 0 || h.serials.some((s) => serials.includes(s))),
  );
}

function storedFacts(h: EngineHold): StoredHoldFacts {
  return {
    key: h.key,
    memberNo: h.memberNo,
    serials: [...h.serials],
    rowIds: [...h.rowIds],
    documentIds: [...h.documentIds],
    params: h.params,
  };
}

/** The engine's view of a stored hold, for the engine line printed on its card. */
export function engineHoldOf(row: HoldRow): EngineHold {
  const f = holdFacts(row);
  const r = resolutionOf(row);
  return {
    key: f.key,
    kind: row.kind as HoldKind,
    gate: row.gate as EngineHold["gate"],
    state: row.state === "EXCLUDED" ? "EXCLUDED" : row.state === "RESOLVED" ? "RESOLVED" : "OPEN",
    memberNo: f.memberNo,
    serials: f.serials,
    rowIds: f.rowIds,
    documentIds: f.documentIds,
    params: f.params,
    resolution: r ? { kind: r.kind, by: r.by, at: r.at } : null,
  };
}

export function engineLineOf(row: HoldRow): string {
  const snapshot = getSnapshot();
  const names = new Map(snapshot.members.map((m) => [m.memberNo, m.consoleName]));
  return engineLine(engineHoldOf(row), {
    consoleName: (no) => names.get(no) ?? no,
    buyerShortName: snapshot.payer.shortName,
  });
}

function labelFor(h: EngineHold, existing: readonly HoldRow[]): string {
  const seed = seedHoldFor(h.kind, h.memberNo, h.serials);
  if (seed && !existing.some((x) => x.code === seed.label)) return seed.label;
  if (h.kind === "LOW_CONFIDENCE") return `Slip ${h.serials[0] ?? "?"} by hand`;
  if (h.kind === "MASS_BALANCE") return "Mass balance";
  const used = new Set(existing.map((x) => x.code));
  let n = 1;
  while (used.has(`H${n}`)) n++;
  return `H${n}`;
}

/**
 * Runs the engine over the stored world and writes the result. Lines move only along the machine
 * (COMPUTED → READY | HELD, HELD → READY | EXCLUDED); a READY line is never sent back to HELD (I5): an
 * open hold still keeps it out of the batch. Holds are raised once and cleared by the engine
 * (ENGINE_CLEARED) or by a hand entry (ENTERED_BY_HAND); a person's resolutions are inputs, not outputs.
 */
export async function recompute(
  tx: DbOrTx,
  scope: WorkspaceScope,
  world: RunWorld,
  o: ApplyOptions,
): Promise<RecomputeResult> {
  const { run } = world;
  const output = computeLines(world.input);
  const ws = scope.workspaceId;
  let linesChanged = 0;

  // lines
  const lineByMember = new Map(world.lines.map((l) => [l.memberId, l]));
  const lineIdByNo = new Map<string, string>();
  for (const l of output.lines) {
    const member = world.memberByNo.get(l.memberNo);
    if (!member) continue;
    const values = lineValues(l);
    const existing = lineByMember.get(member.id);
    if (!existing) {
      const [row] = await tx
        .insert(schema.memberLines)
        .values({
          workspaceId: ws,
          runId: run.id,
          memberId: member.id,
          state: l.state,
          rail: dbRailOf(l.rail),
          currency: "USD",
          provenance: o.provenance,
          ...values,
        })
        .returning({ id: schema.memberLines.id });
      if (row) lineIdByNo.set(l.memberNo, row.id);
      linesChanged++;
      continue;
    }
    lineIdByNo.set(l.memberNo, existing.id);
    if (!MUTABLE_LINE_STATES.has(existing.state)) continue;
    const amountsChanged = existing.lineSha256 !== l.lineSha256;
    const target = nextLineState(existing.state, l.state);
    if (target && target !== existing.state) {
      await moveLine(tx, scope, {
        id: existing.id,
        memberNo: l.memberNo,
        runId: run.id,
        from: existing.state as LineRow["state"],
        to: target,
        version: existing.version,
        cause: cause(
          target === "EXCLUDED" ? "HOLD_EXCLUDED" : target === "READY" ? "HOLDS_CLEARED" : "HOLD_RAISED",
        ),
        provenance: o.provenance,
        actor: o.actor,
        patch: values,
      });
      linesChanged++;
    } else if (amountsChanged) {
      await tx
        .update(schema.memberLines)
        .set(values)
        .where(and(eq(schema.memberLines.workspaceId, ws), eq(schema.memberLines.id, existing.id)));
      linesChanged++;
    }
  }

  // holds
  const raised: string[] = [];
  const cleared: string[] = [];
  const latestByKey = new Map<string, HoldRow>();
  for (const h of world.holds) latestByKey.set(holdFacts(h).key, h);
  const allHolds = [...world.holds];
  for (const h of output.holds) {
    const existing = latestByKey.get(h.key);
    const facts = storedFacts(h);
    const lineId = h.memberNo && h.kind !== "MASS_BALANCE" ? (lineIdByNo.get(h.memberNo) ?? null) : null;
    const reopened = existing && h.state === "OPEN" && existing.state === "RESOLVED";
    if (!existing || reopened) {
      if (h.state !== "OPEN") continue; // a hold the engine reports already cleared was never raised here
      const seed = seedHoldFor(h.kind, h.memberNo, h.serials);
      const label = labelFor(h, allHolds);
      const [row] = await tx
        .insert(schema.holds)
        .values({
          workspaceId: ws,
          runId: run.id,
          lineId,
          code: label,
          kind: h.kind,
          gate: h.gate,
          state: "OPEN",
          engineParams: facts,
          claudeLine: seed?.claudeLine && !/[0-9]/.test(seed.claudeLine) ? seed.claudeLine : null,
          evidence: h.serials.map((s) => ({ kind: "slip", ref: s })),
          raisedBy: "engine",
          provenance: o.provenance,
        })
        .returning();
      if (!row) continue;
      allHolds.push(row);
      raised.push(row.id);
      await emit(
        tx,
        scope,
        "hold.raised",
        { holdId: row.id, label, key: h.key, kind: h.kind, gate: h.gate, memberNo: h.memberNo, lineId },
        { runId: run.id, lineId, provenance: o.provenance, actor: ACTORS.engine },
      );
      continue;
    }
    // keep the engine facts current (shrink figures, credits) whatever the state
    await tx
      .update(schema.holds)
      .set({ engineParams: facts })
      .where(and(eq(schema.holds.workspaceId, ws), eq(schema.holds.id, existing.id)));
    const open = existing.state === "OPEN" || existing.state === "ASKED_CHAIR";
    const engineOutcome = h.resolution?.kind === "ENGINE_CLEARED" || h.resolution?.kind === "ENTERED_BY_HAND";
    if (open && h.state !== "OPEN" && engineOutcome && h.resolution) {
      const byHand = h.resolution.kind === "ENTERED_BY_HAND";
      await moveHold(tx, scope, {
        hold: { ...existing, engineParams: facts },
        to: h.state === "EXCLUDED" ? "EXCLUDED" : "RESOLVED",
        resolution: {
          kind: h.resolution.kind,
          by: byHand ? initialsOf(o.actor.id) : "engine",
          at: o.at.toISOString(),
          reason: null,
        },
        resolvedBy: byHand ? o.actor.id : "engine",
        provenance: o.provenance,
        actor: byHand ? o.actor : ACTORS.engine,
        at: o.at,
      });
      cleared.push(existing.id);
    }
  }

  // I3, Proof plate 4
  const c = output.conservation;
  await proofLedger(
    tx,
    scope,
    "lines.computed",
    {
      runId: run.id,
      engine: output.engineVersion,
      rateCardSha256: world.card.sha256,
      lineCount: output.lines.length,
      linesRootSha256: linesRootSha256(output.lines),
      premiumPoolCents: c.premiumPoolCents,
      bonusPoolCents: c.bonusPoolCents,
      netCents: c.netCents,
      onRailNetCents: c.onRailNetCents,
      balanced: c.balanced,
      // R5: hold resolutions in this computation that are overrides; with `cosign.anyOverride`, Proof plate 5
      // then requires the Chair's key (domain `overrideCount`, as the seed computes it).
      overrides: overrideCount(output.holds),
    },
    { runId: run.id, at: o.at, actor: ACTORS.engine },
  );
  return { output, linesChanged, raised, cleared };
}

function nextLineState(from: string, engine: EngineLine["state"]): LineRow["state"] | null {
  if (from === "COMPUTED") return engine;
  if (from === "HELD") return engine === "HELD" ? null : engine;
  if (from === "READY") return null; // READY never goes back to HELD (I5); EXCLUDE needs a HELD line
  return null;
}

/** The stored columns of an engine line (amounts in bigint cents, the full deduction and credit detail). */
export function lineValues(l: EngineLine) {
  return {
    verifiedG: BigInt(l.verifiedG),
    grade1G: BigInt(l.grade1G),
    premiumCents: BigInt(l.premiumCents),
    bonusCents: BigInt(l.bonusCents),
    deductionsCents: BigInt(l.deductionsCents),
    creditsCents: BigInt(l.creditsCents),
    netCents: BigInt(l.netCents),
    deductions: l.deductions,
    lineSha256: l.lineSha256,
    trace: {
      v: 1,
      slipSerials: l.slipSerials,
      credits: l.credits,
      holdKeys: l.holdKeys,
      grossCents: l.grossCents,
    },
  };
}

/** Load, compute, write: the one call resolveHold, enterField and the computeRun task make. */
export async function recomputeRun(
  tx: DbOrTx,
  scope: WorkspaceScope,
  run: RunRow,
  o: ApplyOptions,
): Promise<RecomputeResult> {
  return recompute(tx, scope, await loadRunWorld(tx, scope, run), o);
}
