// The deterministic engine (IC-02 `computeLines`). Schedule A, BR 2026-04:
//   R0  premium shared by verified kilos, never deducted; bonus shared by verified Grade-1 kilos
//   R1  CBU 5% of the bonus until ₱5,000 is paid up         (taken at pay time, on the line)
//   R2  hauling ₱1.50/kg at purok pickups                    (netted in cash at the bodega; audited)
//   R3  loan only with an Authority to Deduct, ≤ 50% of bonus (pay time, on the line)
//   R4  advance only against a voucher, ≤ 30% of bonus       (pay time, on the line)
// Pool shares: largest remainder, ties to the lower member number. Deductions: half-up per
// component. Caps: round down. Box-13 marks were netted from the member's cash at the bodega, so a
// ruled mark "stays" (no effect on the line) and an unruled one raises a hold whose resolution can
// return it as a credit the co-op pays. The engine never redistributes a held line's money (I3).
import {
  BLOCKING_SLIP_FIELDS,
  type ConservationProof,
  type EngineHold,
  type EngineHoldState,
  EngineInput,
  type EngineLine,
  type EngineMember,
  type EngineOutput,
  type EngineResolution,
  type EngineRow,
  type HoldGate,
  type HoldKind,
  type HoldResolutionKind,
  type Json,
  type LineCanonical,
  type LineCredit,
  type LineDeduction,
  type MassBalance,
  type Quarantine,
  type RateCardRules,
  type RuleId,
  type SlipFieldName,
} from "@fairsplit/contracts";
import { jcsSha256, sha256Hex } from "./canon.js";
import { linesRootJcs } from "./digest-input.js";
import * as fmt from "./format.js";
import {
  bpFloor,
  bpHalfUp,
  centavosToCents,
  centsToCentavos,
  type FxRate,
  largestRemainder,
  mulDivHalfUp,
} from "./money.js";
import { quoteInvoice } from "./quote.js";

export const ENGINE_VERSION = "engine v1" as const;

export const HOLD_KIND_ORDER: readonly HoldKind[] = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
  "LOW_CONFIDENCE",
  "MASS_BALANCE",
];

/** Which resolutions apply to which hold kind. MASS_BALANCE is raised and cleared by the engine only. */
export const ALLOWED_RESOLUTIONS: Readonly<Record<HoldKind, readonly HoldResolutionKind[]>> = {
  DUPLICATE_SLIP: ["COUNT_ONCE", "TWO_DELIVERIES", "EXCLUDE_LINE"],
  IMPLAUSIBLE_YIELD: ["REGISTER_PLOT", "EXCLUDE_LINE"],
  NO_RULE: ["RETURN_AS_CREDIT", "APPLY_RULE", "EXCLUDE_LINE"],
  RATE_MISMATCH: ["RETURN_AS_CREDIT", "CONFIRM_AS_READ", "EXCLUDE_LINE"],
  SUSPECTED_INJECTION: ["CONFIRM_AS_READ", "EXCLUDE_LINE"],
  LOW_CONFIDENCE: ["CONFIRM_AS_READ", "EXCLUDE_LINE"],
  MASS_BALANCE: [],
};

export function isResolutionAllowed(kind: HoldKind, resolution: HoldResolutionKind): boolean {
  return ALLOWED_RESOLUTIONS[kind].includes(resolution);
}

/** An override needs the Chair (R5 "any override of a hold"). */
export function isOverride(kind: HoldKind, resolution: HoldResolutionKind): boolean {
  if (resolution === "TWO_DELIVERIES") return true;
  return resolution === "CONFIRM_AS_READ" && (kind === "RATE_MISMATCH" || kind === "SUSPECTED_INJECTION");
}

export const holdKey = {
  duplicate: (serial: string) => `DUPLICATE_SLIP:${serial}`,
  nearDuplicate: (rowA: string, rowB: string) => `DUPLICATE_SLIP:${[rowA, rowB].sort().join("~")}`,
  yield: (memberNo: string) => `IMPLAUSIBLE_YIELD:${memberNo}`,
  noRule: (markId: string) => `NO_RULE:${markId}`,
  rateMismatch: (markId: string) => `RATE_MISMATCH:${markId}`,
  injection: (anomalyId: string, rowId: string) => `SUSPECTED_INJECTION:${anomalyId}:${rowId}`,
  lowConfidence: (rowId: string) => `LOW_CONFIDENCE:${rowId}`,
  massBalance: () => "MASS_BALANCE:season",
} as const;

const KILO_FIELDS: ReadonlySet<SlipFieldName> = new Set([
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_pct",
  "mc_less_kg",
  "payable_kg",
]);
const BLOCKING: ReadonlySet<string> = new Set(BLOCKING_SLIP_FIELDS);

const COPY_PRIORITY: Readonly<Record<string, number>> = {
  WHITE_ORIGINAL: 0,
  PINK_DUPLICATE: 1,
  YELLOW_TRIPLICATE: 2,
  LOGBOOK_LINE: 3,
  UNKNOWN: 4,
};

function byCopyThenId(a: EngineRow, b: EngineRow): number {
  const pa = COPY_PRIORITY[a.copy] ?? 9;
  const pb = COPY_PRIORITY[b.copy] ?? 9;
  if (pa !== pb) return pa - pb;
  if (a.documentId !== b.documentId) return a.documentId < b.documentId ? -1 : 1;
  return a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0;
}

export interface ComputeOptions {
  /** Validate the input with the contracts schema first (default true). */
  validate?: boolean;
}

/** IC-02: lines, holds and the I3 conservation proof for one pay run. Pure and deterministic. */
export function computeLines(input: EngineInput, options: ComputeOptions = {}): EngineOutput {
  const parsed = options.validate === false ? input : EngineInput.parse(input);
  return compute(parsed, true);
}

interface MemberKilos {
  g: number;
  g1: number;
  serials: string[];
}

type Res = EngineResolution;

function resolutionOf(r: Res | undefined, kind: HoldKind): Res | undefined {
  return r && isResolutionAllowed(kind, r.resolution) ? r : undefined;
}

function resolutionRecord(r: Res): EngineHold["resolution"] {
  return { kind: r.resolution, by: r.by, at: r.at };
}

function compute(input: EngineInput, withEffects: boolean): EngineOutput {
  const { card, lot } = input;
  const fx: FxRate = input.fx;
  const rules = card.canonical.rules;
  const quote = quoteInvoice(card, lot);

  const resolutions = new Map<string, Res>();
  for (const r of input.resolutions) resolutions.set(r.holdKey, r);

  const members = [...input.members].sort((a, b) => (a.memberNo < b.memberNo ? -1 : 1));
  const memberByNo = new Map<string, EngineMember>();
  for (const m of members) {
    if (memberByNo.has(m.memberNo)) throw new Error(`duplicate member ${m.memberNo}`);
    memberByNo.set(m.memberNo, m);
  }
  const rows = [...input.rows].sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0));
  const rowById = new Map<string, EngineRow>();
  for (const row of rows) {
    if (!memberByNo.has(row.memberNo))
      throw new Error(`row ${row.rowId} names unknown member ${row.memberNo}`);
    if (rowById.has(row.rowId)) throw new Error(`duplicate row ${row.rowId}`);
    rowById.set(row.rowId, row);
  }

  const holds = new Map<string, EngineHold>();
  const excludedRows = new Set<string>();
  const excludedMembers = new Set<string>();

  const putHold = (h: EngineHold) => {
    holds.set(h.key, h);
    if (h.state === "EXCLUDED" && h.memberNo) excludedMembers.add(h.memberNo);
  };

  // ------------------------------------------------ duplicates: the same serial on two rows
  const bySerial = new Map<string, EngineRow[]>();
  for (const row of rows) bySerial.set(row.serial, [...(bySerial.get(row.serial) ?? []), row]);
  for (const serial of [...bySerial.keys()].sort()) {
    const group = bySerial.get(serial) ?? [];
    if (group.length < 2) continue;
    const ordered = [...group].sort(byCopyThenId);
    const keeper = ordered[0] as EngineRow;
    const key = holdKey.duplicate(serial);
    const r = resolutionOf(resolutions.get(key), "DUPLICATE_SLIP");
    let state: EngineHoldState = "OPEN";
    if (r?.resolution === "COUNT_ONCE") {
      for (const x of ordered.slice(1)) excludedRows.add(x.rowId);
      state = "RESOLVED";
    } else if (r?.resolution === "TWO_DELIVERIES") state = "RESOLVED";
    else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
    putHold({
      key,
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      state,
      memberNo: keeper.memberNo,
      serials: [serial],
      rowIds: ordered.map((x) => x.rowId),
      documentIds: ordered.map((x) => x.documentId),
      params: {
        signal: "SAME_SERIAL",
        copies: ordered.map((x) => ({
          rowId: x.rowId,
          copy: x.copy,
          photoId: x.photoId,
          documentId: x.documentId,
        })),
        kilosMatch: new Set(ordered.map((x) => x.payableG)).size === 1,
        payableG: keeper.payableG,
        payableDisplay: keeper.payableG === null ? null : fmt.kg(keeper.payableG),
      },
      resolution: r ? resolutionRecord(r) : null,
    });
  }

  // ------------------------------------------------ near duplicates: re-shoots (dHash ≤ 8)
  for (const nd of [...input.nearDuplicates].sort((a, b) => (a.rowA + a.rowB < b.rowA + b.rowB ? -1 : 1))) {
    if (nd.dhashDistance > 8) continue;
    const a = rowById.get(nd.rowA);
    const b = rowById.get(nd.rowB);
    if (!a || !b || a.serial === b.serial) continue;
    const ordered = [a, b].sort(byCopyThenId);
    const keeper = ordered[0] as EngineRow;
    const key = holdKey.nearDuplicate(a.rowId, b.rowId);
    const r = resolutionOf(resolutions.get(key), "DUPLICATE_SLIP");
    let state: EngineHoldState = "OPEN";
    if (r?.resolution === "COUNT_ONCE") {
      excludedRows.add((ordered[1] as EngineRow).rowId);
      state = "RESOLVED";
    } else if (r?.resolution === "TWO_DELIVERIES") state = "RESOLVED";
    else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
    putHold({
      key,
      kind: "DUPLICATE_SLIP",
      gate: "BLOCKS_APPROVAL",
      state,
      memberNo: keeper.memberNo,
      serials: ordered.map((x) => x.serial),
      rowIds: ordered.map((x) => x.rowId),
      documentIds: ordered.map((x) => x.documentId),
      params: { signal: "DHASH", dhashDistance: nd.dhashDistance },
      resolution: r ? resolutionRecord(r) : null,
    });
  }

  // ------------------------------------------------ low confidence ("By hand")
  // Kilos no person has confirmed never count (C-17), whatever happens to the line: excluding it
  // carries the line but does not make a doubtful reading count in everyone else's split.
  const unconfirmedKilos = new Set<string>();
  for (const row of rows) {
    if (excludedRows.has(row.rowId) || row.pendingFields.length === 0) continue;
    const key = holdKey.lowConfidence(row.rowId);
    const r = resolutionOf(resolutions.get(key), "LOW_CONFIDENCE");
    const gate: HoldGate = row.pendingFields.some((f) => BLOCKING.has(f.field))
      ? "BLOCKS_APPROVAL"
      : "RESERVES_LINE";
    let state: EngineHoldState = "OPEN";
    if (r?.resolution === "CONFIRM_AS_READ" && row.payableG !== null) state = "RESOLVED";
    else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
    if (state !== "RESOLVED" && row.pendingFields.some((f) => KILO_FIELDS.has(f.field)))
      unconfirmedKilos.add(row.rowId);
    putHold({
      key,
      kind: "LOW_CONFIDENCE",
      gate,
      state,
      memberNo: row.memberNo,
      serials: [row.serial],
      rowIds: [row.rowId],
      documentIds: [row.documentId],
      params: {
        fields: row.pendingFields.map((f) => ({ fieldId: f.fieldId, field: f.field, score: f.score })),
        minScore: Math.min(...row.pendingFields.map((f) => f.score)),
      },
      resolution: r && state !== "OPEN" ? resolutionRecord(r) : null,
    });
  }

  // ------------------------------------------------ verified kilos per member
  const kilos = new Map<string, MemberKilos>();
  for (const m of members) kilos.set(m.memberNo, { g: 0, g1: 0, serials: [] });
  const pendingRowIds: string[] = [];
  for (const row of rows) {
    if (excludedRows.has(row.rowId)) continue;
    if (row.payableG === null || unconfirmedKilos.has(row.rowId)) {
      pendingRowIds.push(row.rowId);
      continue;
    }
    const k = kilos.get(row.memberNo) as MemberKilos;
    k.g += row.payableG;
    if (row.grade === "G1") k.g1 += row.payableG;
    k.serials.push(row.serial);
  }
  for (const k of kilos.values()) k.serials.sort();

  // ------------------------------------------------ mass balance (season level)
  let verifiedG = 0;
  let grade1G = 0;
  for (const k of kilos.values()) {
    verifiedG += k.g;
    grade1G += k.g1;
  }
  const diff = verifiedG - lot.shippedG;
  const shrinkBp = (diff < 0 ? -1 : 1) * mulDivHalfUp(Math.abs(diff), 10_000, lot.shippedG);
  const tolBp = rules.tolerances.massBalanceTolBp;
  const inside = Math.abs(diff) * 10_000 <= tolBp * lot.shippedG;
  const massBalance: MassBalance = {
    status: pendingRowIds.length > 0 ? "PENDING" : inside ? "INSIDE" : "OUTSIDE",
    verifiedG,
    grade1G,
    shippedG: lot.shippedG,
    shrinkBp,
    tolBp,
    pendingRowIds: [...pendingRowIds].sort(),
  };

  // ------------------------------------------------ pool shares (R0)
  const split = (pool: number, weight: (k: MemberKilos) => number) => {
    const weights = members.map((m) => ({
      id: m.memberNo,
      weight: weight(kilos.get(m.memberNo) as MemberKilos),
    }));
    const total = weights.reduce((s, w) => s + w.weight, 0);
    if (total === 0) return new Map(members.map((m) => [m.memberNo, 0]));
    return new Map(largestRemainder(pool, weights).allocations.map((a) => [a.id, a.amount]));
  };
  const premium = split(quote.premiumPoolCents, (k) => k.g);
  const bonus = split(quote.bonusPoolCents, (k) => k.g1);

  // ------------------------------------------------ implausible yield (C-15: ≤ 1.6 kg per registered tree)
  const maxG = rules.tolerances.kgPerTreeMaxG;
  for (const m of members) {
    const g = (kilos.get(m.memberNo) as MemberKilos).g;
    const over = g > m.registeredTrees * maxG;
    if (!over) continue;
    const key = holdKey.yield(m.memberNo);
    const r = resolutionOf(resolutions.get(key), "IMPLAUSIBLE_YIELD");
    const added = r?.resolution === "REGISTER_PLOT" ? r.plot.trees : 0;
    const treesAfter = m.registeredTrees + added;
    let state: EngineHoldState = "OPEN";
    if (r?.resolution === "REGISTER_PLOT" && g <= treesAfter * maxG) state = "RESOLVED";
    else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
    putHold({
      key,
      kind: "IMPLAUSIBLE_YIELD",
      gate: "BLOCKS_APPROVAL",
      state,
      memberNo: m.memberNo,
      serials: [...(kilos.get(m.memberNo) as MemberKilos).serials],
      rowIds: [],
      documentIds: [],
      params: {
        verifiedG: g,
        verifiedDisplay: fmt.kg(g),
        registeredTrees: m.registeredTrees,
        kgPerTree: fmt.kgPerTree(g, m.registeredTrees),
        limitGPerTree: maxG,
        limitDisplay: fmt.kgNumber(maxG, 1),
        plot: r?.resolution === "REGISTER_PLOT" ? r.plot : null,
        treesAfter: r?.resolution === "REGISTER_PLOT" ? treesAfter : null,
        kgPerTreeAfter: r?.resolution === "REGISTER_PLOT" ? fmt.kgPerTree(g, treesAfter) : null,
      },
      resolution: r && state !== "OPEN" ? resolutionRecord(r) : null,
    });
  }

  // ------------------------------------------------ box-13 marks netted at the bodega (R2 audit, NO_RULE, RATE_MISMATCH)
  const credits = new Map<string, LineCredit[]>();
  const addCredit = (memberNo: string, c: LineCredit) =>
    credits.set(memberNo, [...(credits.get(memberNo) ?? []), c]);
  const deductionIds = new Set<RuleId>(rules.closedList.deductionRuleIds);
  for (const row of rows) {
    if (excludedRows.has(row.rowId)) continue;
    const member = memberByNo.get(row.memberNo) as EngineMember;
    const stays: string[] = [];
    const pendingNoRule: EngineHold[] = [];
    for (const mark of row.marks) {
      const classified =
        mark.ruleId !== "NO_MATCH" && deductionIds.has(mark.ruleId) ? mark.ruleId : "NO_MATCH";
      let effective: RuleId | "NO_MATCH" = classified;
      if (classified === "NO_MATCH") {
        const key = holdKey.noRule(mark.markId);
        const r = resolutionOf(resolutions.get(key), "NO_RULE");
        let state: EngineHoldState = "OPEN";
        let creditCents: number | null =
          mark.writtenCentavos === null ? null : centavosToCents(mark.writtenCentavos, fx, "halfUp");
        if (r?.resolution === "RETURN_AS_CREDIT" && mark.writtenCentavos !== null && creditCents !== null) {
          state = "RESOLVED";
          addCredit(row.memberNo, {
            kind: "RETURNED_MARK",
            holdKey: key,
            markId: mark.markId,
            serial: row.serial,
            text: mark.text,
            phpCentavos: mark.writtenCentavos,
            amountCents: creditCents,
          });
        } else if (r?.resolution === "APPLY_RULE" && deductionIds.has(r.ruleId)) {
          state = "RESOLVED";
          effective = r.ruleId;
          creditCents = null;
        } else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
        const hold: EngineHold = {
          key,
          kind: "NO_RULE",
          gate: "RESERVES_LINE",
          state,
          memberNo: row.memberNo,
          serials: [row.serial],
          rowIds: [row.rowId],
          documentIds: [row.documentId],
          params: {
            text: mark.text,
            writtenCentavos: mark.writtenCentavos,
            writtenDisplay: mark.writtenCentavos === null ? null : fmt.pesoWhole(mark.writtenCentavos),
            creditCents,
            creditDisplay: creditCents === null ? null : fmt.money(creditCents),
            stays: [],
          },
          resolution: r && state !== "OPEN" ? resolutionRecord(r) : null,
        };
        putHold(hold);
        pendingNoRule.push(hold);
      }
      if (effective === "NO_MATCH") continue;
      const check = checkRuledMark(effective, mark.writtenCentavos, mark.documentRef, row, member, rules);
      if (check.ok) {
        stays.push(`${mark.text} (${effective})`);
        continue;
      }
      const key = holdKey.rateMismatch(mark.markId);
      const r = resolutionOf(resolutions.get(key), "RATE_MISMATCH");
      const written = mark.writtenCentavos ?? 0;
      const excess = Math.max(0, written - check.allowedCentavos);
      const creditCents = centavosToCents(excess, fx, "halfUp");
      let state: EngineHoldState = "OPEN";
      if (r?.resolution === "RETURN_AS_CREDIT") {
        state = "RESOLVED";
        if (creditCents > 0) {
          addCredit(row.memberNo, {
            kind: "RETURNED_MARK",
            holdKey: key,
            markId: mark.markId,
            serial: row.serial,
            text: mark.text,
            phpCentavos: excess,
            amountCents: creditCents,
          });
        }
      } else if (r?.resolution === "CONFIRM_AS_READ") state = "RESOLVED";
      else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
      putHold({
        key,
        kind: "RATE_MISMATCH",
        gate: "RESERVES_LINE",
        state,
        memberNo: row.memberNo,
        serials: [row.serial],
        rowIds: [row.rowId],
        documentIds: [row.documentId],
        params: {
          text: mark.text,
          ruleId: effective,
          writtenCentavos: mark.writtenCentavos,
          allowedCentavos: check.allowedCentavos,
          reason: check.reason,
          creditCents,
          creditDisplay: fmt.money(creditCents),
        },
        resolution: r && state !== "OPEN" ? resolutionRecord(r) : null,
      });
    }
    for (const h of pendingNoRule) h.params = { ...h.params, stays };
  }

  // ------------------------------------------------ quarantined text (AI-4): notice always, hold only on overlap
  const quarantines: Quarantine[] = [];
  for (const row of rows) {
    for (const a of row.anomalies) {
      if (!a.quarantined) continue;
      const raises = a.overlap !== "NONE";
      quarantines.push({
        anomalyId: a.anomalyId,
        documentId: row.documentId,
        rowId: row.rowId,
        serial: row.serial,
        source: a.source,
        hold: raises,
      });
      if (!raises || excludedRows.has(row.rowId)) continue;
      const key = holdKey.injection(a.anomalyId, row.rowId);
      const r = resolutionOf(resolutions.get(key), "SUSPECTED_INJECTION");
      let state: EngineHoldState = "OPEN";
      if (r?.resolution === "CONFIRM_AS_READ") state = "RESOLVED";
      else if (r?.resolution === "EXCLUDE_LINE") state = "EXCLUDED";
      putHold({
        key,
        kind: "SUSPECTED_INJECTION",
        gate: a.overlap === "KILO_FIELD" ? "BLOCKS_APPROVAL" : "RESERVES_LINE",
        state,
        memberNo: row.memberNo,
        serials: [row.serial],
        rowIds: [row.rowId],
        documentIds: [row.documentId],
        params: { overlap: a.overlap, source: a.source, quarantined: true },
        resolution: r && state !== "OPEN" ? resolutionRecord(r) : null,
      });
    }
  }
  quarantines.sort((a, b) => (a.serial + a.anomalyId < b.serial + b.anomalyId ? -1 : 1));

  // ------------------------------------------------ mass-balance hold (engine raises and clears it)
  const priorKeys = new Set(input.priorHolds.map((p) => p.key));
  const mbKey = holdKey.massBalance();
  const mbParams: Record<string, Json> = {
    shrinkBp,
    shrinkDisplay: fmt.percentBp(shrinkBp),
    tolBp,
    tolDisplay: fmt.percentBp(tolBp, 1),
    verifiedG,
    verifiedDisplay: fmt.kg(verifiedG),
    grade1G,
    shippedG: lot.shippedG,
    shippedDisplay: fmt.kg(lot.shippedG, 0),
    status: massBalance.status,
  };
  if (massBalance.status === "OUTSIDE" || (massBalance.status === "PENDING" && priorKeys.has(mbKey))) {
    putHold(seasonHold(mbKey, "OPEN", mbParams, null));
  } else if (massBalance.status === "INSIDE" && priorKeys.has(mbKey)) {
    putHold(seasonHold(mbKey, "RESOLVED", mbParams, { kind: "ENGINE_CLEARED", by: "engine", at: null }));
  }

  // ------------------------------------------------ holds raised earlier whose cause is gone
  for (const p of input.priorHolds) {
    if (holds.has(p.key)) continue;
    const handEntered =
      p.kind === "LOW_CONFIDENCE" &&
      rowById.get(p.key.slice("LOW_CONFIDENCE:".length))?.enteredByHand === true;
    putHold({
      key: p.key,
      kind: p.kind,
      gate: p.gate,
      state: "RESOLVED",
      memberNo: p.memberNo,
      serials: [],
      rowIds: [],
      documentIds: [],
      params: {},
      resolution: handEntered
        ? { kind: "ENTERED_BY_HAND", by: "person", at: null }
        : { kind: "ENGINE_CLEARED", by: "engine", at: null },
    });
  }

  // ------------------------------------------------ lines
  const holdList = [...holds.values()];
  const lines: EngineLine[] = members.map((m) => {
    const k = kilos.get(m.memberNo) as MemberKilos;
    const p = premium.get(m.memberNo) ?? 0;
    const b = bonus.get(m.memberNo) ?? 0;
    const deductions = payTimeDeductions(m, b, rules, fx);
    const lineCredits = [...(credits.get(m.memberNo) ?? [])].sort((x, y) => (x.markId < y.markId ? -1 : 1));
    const deductionsCents = deductions.reduce((s, d) => s + d.amountCents, 0);
    const creditsCents = lineCredits.reduce((s, c) => s + c.amountCents, 0);
    const netCents = p + b - deductionsCents + creditsCents;
    const mine = holdList.filter((h) => h.memberNo === m.memberNo);
    const state = excludedMembers.has(m.memberNo)
      ? "EXCLUDED"
      : mine.some((h) => h.state === "OPEN")
        ? "HELD"
        : "READY";
    const line: Omit<EngineLine, "lineSha256"> = {
      memberNo: m.memberNo,
      rail: m.rail,
      state,
      verifiedG: k.g,
      grade1G: k.g1,
      slipSerials: [...k.serials],
      premiumCents: p,
      bonusCents: b,
      grossCents: p + b,
      deductions,
      credits: lineCredits,
      deductionsCents,
      creditsCents,
      netCents,
      holdKeys: mine.map((h) => h.key).sort(),
    };
    return { ...line, lineSha256: lineSha256(line, card.sha256) };
  });

  // ------------------------------------------------ money effect of each duplicate (what counting both moves)
  if (withEffects) {
    for (const h of holdList) {
      if (h.kind !== "DUPLICATE_SLIP" || h.state === "EXCLUDED" || !h.memberNo) continue;
      const others = input.resolutions.filter((r) => r.holdKey !== h.key);
      const both = compute({ ...input, resolutions: others }, false);
      const once = compute(
        {
          ...input,
          resolutions: [...others, { holdKey: h.key, resolution: "COUNT_ONCE", by: "engine", at: EPOCH }],
        },
        false,
      );
      const netOf = (out: EngineOutput, no: string) =>
        out.lines.find((l) => l.memberNo === no)?.netCents ?? 0;
      const moved = netOf(both, h.memberNo) - netOf(once, h.memberNo);
      let othersGain = 0;
      for (const l of once.lines)
        if (l.memberNo !== h.memberNo) othersGain += l.netCents - netOf(both, l.memberNo);
      h.params = {
        ...h.params,
        holderNetBothCents: netOf(both, h.memberNo),
        holderNetBothDisplay: fmt.money(netOf(both, h.memberNo)),
        holderNetOnceCents: netOf(once, h.memberNo),
        holderNetOnceDisplay: fmt.money(netOf(once, h.memberNo)),
        movedCents: moved,
        movedDisplay: fmt.money(moved),
        othersGainCents: othersGain,
        othersCount: members.length - 1,
        shrinkBothBp: both.massBalance.shrinkBp,
        shrinkBothDisplay: fmt.percentBp(both.massBalance.shrinkBp),
        shrinkOnceBp: once.massBalance.shrinkBp,
        shrinkOnceDisplay: fmt.percentBp(once.massBalance.shrinkBp),
        tolDisplay: fmt.percentBp(tolBp, 1),
        bothInside: Math.abs(both.massBalance.verifiedG - lot.shippedG) * 10_000 <= tolBp * lot.shippedG,
      };
    }
  }

  // ------------------------------------------------ conservation (I3)
  const conservation = conserve(lines, quote.premiumPoolCents, quote.bonusPoolCents);
  const sortedHolds = holdList.sort((a, b) => {
    const ka = HOLD_KIND_ORDER.indexOf(a.kind);
    const kb = HOLD_KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const blockingHoldKeys = sortedHolds
    .filter((h) => h.state === "OPEN" && h.gate === "BLOCKS_APPROVAL")
    .map((h) => h.key);
  return {
    engineVersion: ENGINE_VERSION,
    lines,
    holds: sortedHolds,
    massBalance,
    conservation,
    quarantines,
    // A pool with no verified kilos to share it by stays unallocated: conservation fails, and so
    // does approval, rather than paying the lines without it.
    approvalBlocked: blockingHoldKeys.length > 0 || massBalance.status !== "INSIDE" || !conservation.balanced,
    blockingHoldKeys,
  };
}

const EPOCH = "1970-01-01T00:00:00.000Z";

function seasonHold(
  key: string,
  state: EngineHoldState,
  params: Record<string, Json>,
  resolution: EngineHold["resolution"],
): EngineHold {
  return {
    key,
    kind: "MASS_BALANCE",
    gate: "BLOCKS_APPROVAL",
    state,
    memberNo: null,
    serials: [],
    rowIds: [],
    documentIds: [],
    params,
    resolution,
  };
}

interface MarkCheck {
  ok: boolean;
  allowedCentavos: number;
  reason: string | null;
}

/** Audits a box-13 mark against its rule. The mark was already netted at the bodega. */
export function checkRuledMark(
  ruleId: RuleId,
  writtenCentavos: number | null,
  documentRef: string | null,
  row: Pick<EngineRow, "netG" | "station">,
  member: Pick<EngineMember, "loans" | "advances">,
  rules: RateCardRules,
): MarkCheck {
  if (writtenCentavos === null) return { ok: false, allowedCentavos: 0, reason: "AMOUNT_UNREADABLE" };
  switch (ruleId) {
    case "R2": {
      if (!rules.hauling.stations.includes(row.station)) {
        return { ok: false, allowedCentavos: 0, reason: "NOT_A_PUROK_PICKUP" };
      }
      if (row.netG === null) return { ok: false, allowedCentavos: 0, reason: "NET_UNKNOWN" };
      const expected = mulDivHalfUp(row.netG, rules.hauling.centavosPerNetKg, 1000);
      return expected === writtenCentavos
        ? { ok: true, allowedCentavos: expected, reason: null }
        : { ok: false, allowedCentavos: Math.min(expected, writtenCentavos), reason: "AMOUNT_DIFFERS" };
    }
    case "R1":
      return { ok: false, allowedCentavos: 0, reason: "CBU_IS_TAKEN_AT_PAY_TIME" };
    case "R3": {
      const loan = member.loans.find(
        (l) => l.authorityToDeduct && (documentRef === null || l.ref === documentRef),
      );
      if (!loan) return { ok: false, allowedCentavos: 0, reason: "NO_AUTHORITY_TO_DEDUCT" };
      return writtenCentavos <= loan.outstandingCentavos
        ? { ok: true, allowedCentavos: writtenCentavos, reason: null }
        : { ok: false, allowedCentavos: loan.outstandingCentavos, reason: "OVER_OUTSTANDING" };
    }
    case "R4": {
      const adv = member.advances.find(
        (a) => a.voucherNo !== null && (documentRef === null || a.voucherNo === documentRef),
      );
      if (!adv) return { ok: false, allowedCentavos: 0, reason: "NO_VOUCHER" };
      return writtenCentavos <= adv.outstandingCentavos
        ? { ok: true, allowedCentavos: writtenCentavos, reason: null }
        : { ok: false, allowedCentavos: adv.outstandingCentavos, reason: "OVER_OUTSTANDING" };
    }
    default:
      return { ok: false, allowedCentavos: 0, reason: "NOT_A_DEDUCTION_RULE" };
  }
}

/**
 * Pay-time deductions on the line, in Schedule A order. Each component rounds half-up; caps round
 * down; nothing is ever taken beyond the bonus, so the premium is never deducted (R0).
 */
export function payTimeDeductions(
  member: Pick<EngineMember, "cbuPaidUpCentavos" | "loans" | "advances">,
  bonusCents: number,
  rules: RateCardRules,
  fx: FxRate,
): LineDeduction[] {
  const out: LineDeduction[] = [];
  let room = bonusCents;
  if (member.cbuPaidUpCentavos < rules.cbu.paidUpCapCentavos) {
    const computed = bpHalfUp(bonusCents, rules.cbu.bp);
    const capCents = centavosToCents(rules.cbu.paidUpCapCentavos - member.cbuPaidUpCentavos, fx, "floor");
    const amount = Math.min(computed, capCents, room);
    if (amount > 0) {
      out.push({
        ruleId: "R1",
        category: "CBU",
        computedCents: computed,
        capCents,
        amountCents: amount,
        ref: null,
        carriedCentavos: null,
      });
      room -= amount;
    }
  }
  let loanCap = bpFloor(bonusCents, rules.loan.capBp);
  for (const loan of [...member.loans].sort((a, b) => (a.ref < b.ref ? -1 : 1))) {
    if (!loan.authorityToDeduct || loan.outstandingCentavos <= 0) continue;
    const owed = centavosToCents(loan.outstandingCentavos, fx, "halfUp");
    const amount = Math.min(owed, loanCap, room);
    const carried = Math.max(0, loan.outstandingCentavos - centsToCentavos(amount, fx, "halfUp"));
    out.push({
      ruleId: "R3",
      category: "LOAN",
      computedCents: owed,
      capCents: bpFloor(bonusCents, rules.loan.capBp),
      amountCents: amount,
      ref: loan.ref,
      carriedCentavos: carried,
    });
    loanCap -= amount;
    room -= amount;
  }
  let advanceCap = bpFloor(bonusCents, rules.advance.capBp);
  for (const adv of [...member.advances].sort((a, b) =>
    (a.voucherNo ?? "") < (b.voucherNo ?? "") ? -1 : 1,
  )) {
    if (adv.voucherNo === null || adv.outstandingCentavos <= 0) continue;
    const owed = centavosToCents(adv.outstandingCentavos, fx, "halfUp");
    const amount = Math.min(owed, advanceCap, room);
    const carried = Math.max(0, adv.outstandingCentavos - centsToCentavos(amount, fx, "halfUp"));
    out.push({
      ruleId: "R4",
      category: "ADVANCE",
      computedCents: owed,
      capCents: bpFloor(bonusCents, rules.advance.capBp),
      amountCents: amount,
      ref: adv.voucherNo,
      carriedCentavos: carried,
    });
    advanceCap -= amount;
    room -= amount;
  }
  return out;
}

/** The canonical content a line hash covers (Proof plate 4 recomputes it). */
export function lineCanonical(line: Omit<EngineLine, "lineSha256">, rateCardSha256: string): LineCanonical {
  return {
    v: 1,
    engine: ENGINE_VERSION,
    rateCardSha256,
    memberNo: line.memberNo,
    rail: line.rail,
    verifiedG: line.verifiedG,
    grade1G: line.grade1G,
    slipSerials: [...line.slipSerials],
    premiumCents: line.premiumCents,
    bonusCents: line.bonusCents,
    deductions: line.deductions.map((d) => ({
      ruleId: d.ruleId,
      amountCents: d.amountCents,
      ref: d.ref,
      carriedCentavos: d.carriedCentavos,
    })),
    credits: line.credits.map((c) => ({ markId: c.markId, amountCents: c.amountCents })),
    netCents: line.netCents,
  };
}

export function lineSha256(line: Omit<EngineLine, "lineSha256">, rateCardSha256: string): string {
  return jcsSha256(lineCanonical(line, rateCardSha256));
}

/** The lines root a `lines.computed` ledger entry carries: sha256(JCS([{memberNo, lineSha256}])). */
export function linesRootSha256(lines: readonly Pick<EngineLine, "memberNo" | "lineSha256">[]): string {
  return sha256Hex(linesRootJcs(lines));
}

/** I3: pool = Σ gross = Σ net + Σ deductions − Σ credits, and Σ net = on-rail + off-rail + carried. */
export function conserve(
  lines: readonly Pick<
    EngineLine,
    "premiumCents" | "bonusCents" | "deductionsCents" | "creditsCents" | "netCents" | "rail" | "state"
  >[],
  premiumPoolCents: number,
  bonusPoolCents: number,
): ConservationProof {
  let premiumSum = 0;
  let bonusSum = 0;
  let deductions = 0;
  let creditsSum = 0;
  let net = 0;
  let onRail = 0;
  let offRail = 0;
  let carried = 0;
  for (const l of lines) {
    premiumSum += l.premiumCents;
    bonusSum += l.bonusCents;
    deductions += l.deductionsCents;
    creditsSum += l.creditsCents;
    net += l.netCents;
    if (l.state === "HELD" || l.state === "EXCLUDED") carried += l.netCents;
    else if (l.rail === "PAYPAL") onRail += l.netCents;
    else offRail += l.netCents;
  }
  const pool = premiumPoolCents + bonusPoolCents;
  const gross = premiumSum + bonusSum;
  return {
    premiumPoolCents,
    bonusPoolCents,
    poolCents: pool,
    premiumSumCents: premiumSum,
    bonusSumCents: bonusSum,
    grossCents: gross,
    deductionsCents: deductions,
    creditsCents: creditsSum,
    netCents: net,
    onRailNetCents: onRail,
    offRailNetCents: offRail,
    carriedNetCents: carried,
    balanced:
      premiumSum === premiumPoolCents &&
      bonusSum === bonusPoolCents &&
      net + deductions - creditsSum === pool &&
      onRail + offRail + carried === net,
  };
}
