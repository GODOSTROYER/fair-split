// W-TR-05's model: which engine computation the run's decisions match, and every member line on it, as pure
// functions of the IC-03 snapshot and the live RunView. Code computes every amount (I1): the figures are the
// engine's own (`snapshot.checkpoints`, written by @fairsplit/domain's engine in @fairsplit/seed); this module
// only picks which computation applies and never adds a cent of its own, except to hold back a credit whose
// hold is still open (the engine applies a credit only once a person returns it; I3 holds either way).

import type {
  EngineHold,
  EngineLine,
  EngineOutput,
  HoldGate,
  HoldKind,
  HoldResolutionKind,
  HoldState,
  Lang,
  MemberLineState,
  Rail,
  ReceiverKind,
  SeasonSnapshot,
  SnapshotMember,
  SnapshotSlip,
} from "@fairsplit/contracts";
import {
  type AmountState,
  atLeast,
  lineAmountState,
  type RunHold,
  type RunView,
} from "../../data/run-view.js";
import { format } from "../../lib/format.js";

/** The seed's three engine computations: after reading, after slip 0462 by hand, and with every hold decided. */
export type SplitBasis = "read" | "byHand" | "resolved";

const OPEN_STATES: readonly HoldState[] = ["OPEN", "ASKED_CHAIR"];

export function isOpenHold(hold: { readonly state: HoldState }): boolean {
  return OPEN_STATES.includes(hold.state);
}

/** Hold cards a person resolves on W-TR-06 (H1–H3): not the by-hand field and not the season's dial. */
export function isCardHold(hold: { readonly kind: HoldKind }): boolean {
  return hold.kind !== "LOW_CONFIDENCE" && hold.kind !== "MASS_BALANCE";
}

/**
 * Which computation the run's decisions match. Reading leaves slip 0462 to a person ("read"); entering it by
 * hand opens the dial ("byHand"); counting slip 0457 once is the one decision that moves money between members
 * ("resolved": H2 registers a plot and H3 credits one line from the co-op, so neither moves anyone else's cents).
 * Two deliveries, or an excluded duplicate, keep both slips counted: the by-hand computation still applies.
 */
export function splitBasis(view: RunView): SplitBasis {
  const holds = Object.values(view.holds);
  if (holds.length === 0) return view.origin === "showcase" ? "resolved" : "read";
  if (holds.some((h) => h.kind === "LOW_CONFIDENCE" && isOpenHold(h))) return "read";
  const duplicate = holds.find((h) => h.kind === "DUPLICATE_SLIP");
  if (!duplicate)
    return holds.some((h) => h.kind === "MASS_BALANCE" && isOpenHold(h)) ? "byHand" : "resolved";
  if (duplicate.state !== "RESOLVED") return "byHand";
  return duplicate.resolution === null || duplicate.resolution === "COUNT_ONCE" ? "resolved" : "byHand";
}

/** The event whose decision set the current computation (the wave and the dial start from it), or null. */
export function basisEventId(view: RunView, basis: SplitBasis = splitBasis(view)): string | null {
  const holds = Object.values(view.holds);
  if (basis === "resolved") return holds.find((h) => h.kind === "DUPLICATE_SLIP")?.eventId ?? null;
  if (basis === "byHand") return holds.find((h) => h.kind === "LOW_CONFIDENCE")?.eventId ?? null;
  return null;
}

export function engineOutput(snapshot: SeasonSnapshot, basis: SplitBasis): EngineOutput {
  return snapshot.checkpoints[basis];
}

/** The engine's own facts about a hold (every digit in its line comes from these). */
export function engineHold(output: EngineOutput, key: string): EngineHold | undefined {
  return output.holds.find((h) => h.key === key);
}

export interface RowHold {
  readonly holdId: string;
  readonly label: string;
  readonly kind: HoldKind;
  readonly gate: HoldGate;
  readonly state: HoldState;
  readonly resolution: HoldResolutionKind | null;
}

export type RowConfidence =
  | { readonly kind: "score"; readonly score: number }
  | { readonly kind: "you"; readonly score: number | null; readonly serial: string | null }
  | { readonly kind: "by-hand"; readonly by: string; readonly at: string }
  | { readonly kind: "unknown" };

export type RowStatus =
  | { readonly kind: "held"; readonly hold: RowHold }
  | { readonly kind: "reserved"; readonly hold: RowHold }
  | { readonly kind: "line"; readonly state: MemberLineState };

export interface RowSlip {
  readonly serial: string;
  readonly copy: SnapshotSlip["copy"];
  readonly photoId: string;
}

export interface RowDeduction {
  readonly ruleId: "R1" | "R3" | "R4";
  readonly category: "CBU" | "LOAN" | "ADVANCE";
  readonly amountCents: number;
}

export interface SplitRow {
  readonly memberNo: string;
  /** How the console names them: "Nang Celing", "Merlyn Ponce". */
  readonly name: string;
  readonly fullName: string;
  readonly lang: Lang;
  /** The line's rail as computed; a parked PayPal line re-routed to cash shows `movedToCash`. */
  readonly rail: Rail;
  readonly movedToCash: boolean;
  readonly receiverKind: ReceiverKind;
  readonly state: MemberLineState;
  readonly status: RowStatus;
  /** S2.2.1's grammar for the net. */
  readonly amountState: AmountState;
  /** Premium, bonus, kaltas and credit are components, never money in flight: pencil until both keys, then ink. */
  readonly partsState: "pencil" | "ink";
  readonly verifiedG: number;
  readonly grade1G: number;
  readonly trees: number;
  /** "2.14": kilos a registered tree, two places (format.kgPerTree). */
  readonly kgPerTree: string;
  /** Kilos a tree against the ratified limit (1 = at the limit). A display ratio, not money. */
  readonly treeRatio: number;
  readonly overYield: boolean;
  readonly slips: readonly RowSlip[];
  readonly confidence: RowConfidence;
  readonly premiumCents: number;
  readonly bonusCents: number;
  readonly grossCents: number;
  readonly deductions: readonly RowDeduction[];
  readonly deductionsCents: number;
  /** Credits the engine applied whose hold is decided. */
  readonly creditsCents: number;
  /** A credit computed for a hold that is still open: shown as waiting, not paid. */
  readonly pendingCredit: { readonly cents: number; readonly label: string } | null;
  readonly netCents: number;
  readonly holds: readonly RowHold[];
  /** The hold to open from this row, if any is open (cards first, then the by-hand field). */
  readonly openHold: RowHold | null;
  /** The event that last changed the amounts (the computation's decision) and the status, for live washes. */
  readonly amountsEventId: string | null;
  readonly statusEventId: string | null;
  readonly statusCause: "paypal" | "engine" | "person" | "system" | null;
}

function rowHold(h: RunHold): RowHold {
  return {
    holdId: h.holdId,
    label: h.label,
    kind: h.kind,
    gate: h.gate,
    state: h.state,
    resolution: h.resolution,
  };
}

function registeredTrees(member: SnapshotMember | undefined): number {
  return (member?.plots ?? []).filter((p) => p.registered).reduce((sum, p) => sum + p.trees, 0);
}

/** Trees the engine counts for a member: the registry, plus a plot a person registered to resolve H2. */
function treesFor(
  member: SnapshotMember | undefined,
  holds: readonly RunHold[],
  snapshot: SeasonSnapshot,
): number {
  const registered = registeredTrees(member);
  const plotted = holds.find(
    (h) => h.kind === "IMPLAUSIBLE_YIELD" && h.state === "RESOLVED" && h.resolution === "REGISTER_PLOT",
  );
  if (!plotted) return registered;
  const after = engineHold(snapshot.checkpoints.resolved, plotted.key)?.params.treesAfter;
  return typeof after === "number" && after > 0 ? after : registered;
}

function confidenceFor(
  memberNo: string,
  slips: readonly RowSlip[],
  holds: readonly RunHold[],
  view: RunView,
  read: EngineOutput,
): RowConfidence {
  const serials = new Set(slips.map((s) => s.serial));
  const entered = Object.values(view.fields).find((f) => serials.has(f.serial));
  if (entered) return { kind: "by-hand", by: entered.enteredBy, at: entered.at };
  const byHand = holds.find((h) => h.kind === "LOW_CONFIDENCE");
  if (byHand && isOpenHold(byHand)) {
    const facts = engineHold(read, byHand.key);
    const score = facts?.params.minScore;
    return {
      kind: "you",
      score: typeof score === "number" ? score : null,
      serial: facts?.serials[0] ?? null,
    };
  }
  if (byHand?.state === "RESOLVED") {
    return { kind: "by-hand", by: byHand.resolvedBy ?? "AS", at: byHand.resolvedAt ?? "" };
  }
  let min: number | null = null;
  for (const row of view.rows) {
    if (row.memberNo !== memberNo) continue;
    for (const field of Object.values(row.fields)) {
      if (min === null || field.score < min) min = field.score;
    }
  }
  return min === null ? { kind: "unknown" } : { kind: "score", score: min };
}

const CASH_STATES: readonly MemberLineState[] = ["RETURNED", "REROUTED", "OFF_RAIL_DUE", "OFF_RAIL_PAID"];

function lineState(view: RunView, line: EngineLine, open: readonly RunHold[]): MemberLineState {
  const live = view.lines[line.memberNo];
  const state = live
    ? live.state
    : open.length > 0
      ? "HELD"
      : line.state === "EXCLUDED"
        ? "EXCLUDED"
        : "READY";
  // Posting the primary batch moves every READY cash line to cash due in the same step (fs-api CASH_DUE): a cash
  // line still READY on a posted run is cash due, never "Ready".
  if (state === "READY" && line.rail === "CASH" && atLeast(view, "POSTED")) return "OFF_RAIL_DUE";
  return state;
}

/** True once the run has lines to show: the engine computed them (register §7). */
export function hasLines(view: RunView): boolean {
  return view.origin === "showcase" || atLeast(view, "COMPUTED") || Object.keys(view.holds).length > 0;
}

/** Every member line on the computation the run's decisions match, ordered by member number. */
export function splitRows(snapshot: SeasonSnapshot, view: RunView): SplitRow[] {
  if (!hasLines(view)) return [];
  const basis = splitBasis(view);
  const output = engineOutput(snapshot, basis);
  const amountsEventId = basisEventId(view, basis);
  const members = new Map(snapshot.members.map((m) => [m.memberNo, m]));
  const slipsBySerial = new Map<string, SnapshotSlip[]>();
  for (const slip of snapshot.slips) {
    const list = slipsBySerial.get(slip.serial) ?? [];
    list.push(slip);
    slipsBySerial.set(slip.serial, list);
  }
  const holdsByMember = new Map<string, RunHold[]>();
  const holdsByKey = new Map<string, RunHold>();
  for (const hold of Object.values(view.holds)) {
    holdsByKey.set(hold.key, hold);
    if (!hold.memberNo) continue;
    const list = holdsByMember.get(hold.memberNo) ?? [];
    list.push(hold);
    holdsByMember.set(hold.memberNo, list);
  }
  const approved = atLeast(view, "APPROVED");
  const limitG = snapshot.rateCard.canonical.rules.tolerances.kgPerTreeMaxG;

  return output.lines
    .map((line): SplitRow => {
      const member = members.get(line.memberNo);
      const holds = (holdsByMember.get(line.memberNo) ?? [])
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label));
      const open = holds.filter(isOpenHold);
      const state = lineState(view, line, open);
      // Every copy in the evidence once (a slip counted twice lists its serial twice; its copies are still two).
      const slips: RowSlip[] = [];
      const seenCopies = new Set<string>();
      for (const serial of line.slipSerials) {
        for (const slip of slipsBySerial.get(serial) ?? []) {
          const id = `${slip.serial}|${slip.copy}|${slip.photoId}`;
          if (slip.memberNo !== line.memberNo || seenCopies.has(id)) continue;
          seenCopies.add(id);
          slips.push({ serial: slip.serial, copy: slip.copy, photoId: slip.photoId });
        }
      }
      // A credit applies once its hold is returned; until then it waits and the net stays without it.
      let pendingCents = 0;
      let pendingLabel: string | null = null;
      let applied = 0;
      for (const credit of line.credits) {
        const hold = holdsByKey.get(credit.holdKey);
        if (hold && hold.state !== "RESOLVED") {
          pendingCents += credit.amountCents;
          pendingLabel = hold.label;
        } else {
          applied += credit.amountCents;
        }
      }
      const pending = pendingLabel === null ? null : { cents: pendingCents, label: pendingLabel };
      const netCents = line.netCents - pendingCents;
      const trees = treesFor(member, holds, snapshot);
      const card = open.find(isCardHold) ?? open[0] ?? null;
      const status: RowStatus =
        card && isCardHold(card) && card.gate === "RESERVES_LINE"
          ? { kind: "reserved", hold: rowHold(card) }
          : card
            ? { kind: "held", hold: rowHold(card) }
            : { kind: "line", state };
      const live = view.lines[line.memberNo];
      // Jade is money PayPal confirmed: a PAID line takes its cause and evidence from the verified item, whatever
      // bookkeeping event moved the line after it.
      const item = Object.values(view.items).find((i) => i.memberNo === line.memberNo);
      const landed = state === "PAID" && item?.status === "SUCCESS";
      return {
        memberNo: line.memberNo,
        name: member?.consoleName ?? line.memberNo,
        fullName: member?.displayName ?? line.memberNo,
        lang: member?.lang ?? "ceb",
        rail: line.rail,
        movedToCash: line.rail === "PAYPAL" && CASH_STATES.includes(state),
        receiverKind: member?.receiverKind ?? "NONE",
        state,
        status,
        amountState: lineAmountState(view, line.memberNo),
        partsState: approved ? "ink" : "pencil",
        verifiedG: line.verifiedG,
        grade1G: line.grade1G,
        trees,
        kgPerTree: format.kgPerTree(line.verifiedG, trees),
        treeRatio: trees > 0 ? line.verifiedG / trees / limitG : 0,
        overYield: trees > 0 && line.verifiedG > trees * limitG,
        slips,
        confidence: confidenceFor(line.memberNo, slips, holds, view, snapshot.checkpoints.read),
        premiumCents: line.premiumCents,
        bonusCents: line.bonusCents,
        grossCents: line.grossCents,
        deductions: line.deductions.map((d) => ({
          ruleId: d.ruleId,
          category: d.category,
          amountCents: d.amountCents,
        })),
        deductionsCents: line.deductionsCents,
        creditsCents: applied,
        pendingCredit: pending,
        netCents,
        holds: holds.map(rowHold),
        openHold: card ? rowHold(card) : null,
        amountsEventId,
        statusEventId: landed ? (item?.eventId ?? live?.eventId ?? null) : (live?.eventId ?? null),
        statusCause: landed ? "paypal" : live?.changedBy === "paypal" ? null : (live?.changedBy ?? null),
      };
    })
    .sort((a, b) => a.memberNo.localeCompare(b.memberNo));
}

export interface SplitTotals {
  readonly lines: number;
  readonly poolCents: number;
  readonly premiumCents: number;
  readonly bonusCents: number;
  readonly grossCents: number;
  readonly deductionsCents: number;
  readonly creditsCents: number;
  readonly netCents: number;
  /** I3: pool = Σ gross = Σ net + Σ deductions − Σ credits, to the cent. */
  readonly balanced: boolean;
}

/** The engine's conservation proof for the computation, less any credit still waiting for its hold. */
export function splitTotals(snapshot: SeasonSnapshot, view: RunView, rows: readonly SplitRow[]): SplitTotals {
  const c = engineOutput(snapshot, splitBasis(view)).conservation;
  const pending = rows.reduce((sum, r) => sum + (r.pendingCredit?.cents ?? 0), 0);
  const creditsCents = c.creditsCents - pending;
  const netCents = c.netCents - pending;
  return {
    lines: rows.length,
    poolCents: c.poolCents,
    premiumCents: c.premiumSumCents,
    bonusCents: c.bonusSumCents,
    grossCents: c.grossCents,
    deductionsCents: c.deductionsCents,
    creditsCents,
    netCents,
    balanced:
      c.balanced &&
      c.grossCents === c.poolCents &&
      netCents + c.deductionsCents - creditsCents === c.poolCents,
  };
}

export interface MassBalanceView {
  readonly status: "PENDING" | "INSIDE" | "OUTSIDE";
  readonly shrinkBp: number;
  /** "2.05%" */
  readonly display: string;
  readonly tolBp: number;
  /** "2.0%" */
  readonly limitDisplay: string;
  readonly verified: string;
  readonly shipped: string;
  /** The slip the dial waits for while a kilo field is with a person. */
  readonly waitingFor: string | null;
  /** Shrink in percent for the dial's needle (a display number, never money). */
  readonly value: number;
}

export function massBalanceView(snapshot: SeasonSnapshot, view: RunView): MassBalanceView {
  const basis = splitBasis(view);
  const mb = engineOutput(snapshot, basis).massBalance;
  const byHand = Object.values(view.holds).find((h) => h.kind === "LOW_CONFIDENCE");
  const waiting =
    mb.status === "PENDING"
      ? (engineHold(snapshot.checkpoints.read, byHand?.key ?? "")?.serials[0] ??
        snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ??
        null)
      : null;
  return {
    status: mb.status,
    shrinkBp: mb.shrinkBp,
    display: format.percentBp(mb.shrinkBp),
    tolBp: mb.tolBp,
    limitDisplay: format.percentBp(mb.tolBp, 1),
    verified: format.kg(mb.verifiedG),
    shipped: format.kg(mb.shippedG, 0),
    waitingFor: waiting,
    value: mb.shrinkBp / 100,
  };
}

export type SplitFilter = "all" | "held" | "byHand" | "paypal" | "cash";
export const SPLIT_FILTERS: readonly SplitFilter[] = ["all", "held", "byHand", "paypal", "cash"];

function matches(row: SplitRow, filter: SplitFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "held":
      return row.status.kind !== "line" && isCardHold(row.status.hold);
    case "byHand":
      return row.confidence.kind === "you" || row.confidence.kind === "by-hand";
    case "paypal":
      return row.rail === "PAYPAL" && !row.movedToCash;
    case "cash":
      return row.rail === "CASH" || row.movedToCash;
  }
}

export function filterRows(rows: readonly SplitRow[], filter: SplitFilter): SplitRow[] {
  return rows.filter((r) => matches(r, filter));
}

/**
 * The lines a person must still decide (an open hold card, or a field to enter by hand), in the order the run pill
 * walks them: the field by hand first, then H1, H2 and H3. Split review pins these above the other lines.
 */
export function decisionRows(rows: readonly SplitRow[]): SplitRow[] {
  const rank = (r: SplitRow) => (r.openHold?.kind === "LOW_CONFIDENCE" ? "0" : `1${r.openHold?.label ?? ""}`);
  return rows.filter((r) => r.openHold !== null).sort((a, b) => rank(a).localeCompare(rank(b)));
}

export function filterCounts(rows: readonly SplitRow[]): Readonly<Record<SplitFilter, number>> {
  const out: Record<SplitFilter, number> = { all: 0, held: 0, byHand: 0, paypal: 0, cash: 0 };
  for (const row of rows) for (const f of SPLIT_FILTERS) if (matches(row, f)) out[f] += 1;
  return out;
}

/** "3 holds, 1 by hand": open hold cards and open by-hand fields. */
export function openCounts(view: RunView): { readonly holds: number; readonly byHand: number } {
  const open = Object.values(view.holds).filter(isOpenHold);
  return {
    holds: open.filter(isCardHold).length,
    byHand: open.filter((h) => h.kind === "LOW_CONFIDENCE").length,
  };
}

/** The first open hold card (H1, then H2, then H3), the treasurer's next decision on this screen. */
export function nextOpenCard(view: RunView): RunHold | null {
  return (
    Object.values(view.holds)
      .filter((h) => isCardHold(h) && isOpenHold(h))
      .sort((a, b) => a.label.localeCompare(b.label))[0] ?? null
  );
}
