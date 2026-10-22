// The primitives' contract (IC-09, design §5, S2 §2.7): one set of prop types, two implementations. ui-web
// renders it with React DOM, Motion and Base UI; ui-native renders the same props with Reanimated and
// react-native-svg. This file is platform-neutral: no React, no DOM.
//
// UI never imports `domain`, so DTOs carry `display` and `spoken` strings that `format.*` made server-side
// (S2 §2.7 "Formatting"). The view types below mirror what IC-01's DTOs must provide; when contracts freeze
// (24 Oct) they become aliases of the contract types.

export type Depth = "d1" | "d2" | "d3";
export type SlabTone = "chalk" | "jade";
export type HoldMs = 1600 | 1200;

/** `data-state` values a Slab can show (S2 §2.7). */
export const SLAB_STATES = [
  "rest",
  "pressed",
  "holding",
  "committed",
  "unavailable",
  "bolted",
  "refusing",
] as const;
export type SlabState = (typeof SLAB_STATES)[number];

/** Hold progress is reported in quarters on `data-hold-progress`. */
export type HoldProgress = 0 | 25 | 50 | 75 | 100;

/**
 * The hold slab's dialog route (design §5, S2 §2.7): it states the amount, the recipients and the consequence
 * before asking for the key. `Body` is the platform's node type (ReactNode on web and on native).
 */
export interface SlabConfirm<Body = string> {
  /** "Approve 8 payouts" */
  readonly title: string;
  /** The amount, the recipients and the consequence. */
  readonly body: Body;
  /** Defaults to "Approve with my key". */
  readonly confirmLabel?: string;
  /** Defaults to "Not now". */
  readonly cancelLabel?: string;
}

interface SlabBaseProps {
  readonly label: string;
  readonly depth: Depth;
  readonly tone: SlabTone;
  /** Zero travel: the rules the Board ratified will not move for anyone. */
  readonly bolted?: boolean;
  /** The slab sinks flush with a hatched face and this reason beneath. Never greyed out. */
  readonly unavailableReason?: string;
  /** What a screen reader hears: label, amount and consequence. */
  readonly srLabel: string;
  readonly onCommit: () => void;
  readonly testId: string;
}

/** A press slab: commits on release (d1 springs back, d2 and d3 stay flush). It has no dialog route. */
export interface PressSlabProps {
  readonly hold?: undefined;
  readonly confirm?: undefined;
}

/**
 * A hold slab. It always carries its dialog route, opened by Enter, a screen reader's activation or the
 * visible "Can't hold? Approve another way" link, so no action depends on timing alone: a hold slab without
 * `confirm` does not type-check.
 */
export interface HoldSlabProps<Body = string> {
  /** Hold-to-commit length. Only d3 slabs hold: 1,600 ms on the console, 1,200 ms on the Chair's phone. */
  readonly hold: HoldMs;
  readonly confirm: SlabConfirm<Body>;
}

export type SlabProps<Body = string> = SlabBaseProps & (PressSlabProps | HoldSlabProps<Body>);

export type PrintProvenance = "claude" | "engine";
export type PrintState = "pencil" | "hollow" | "ink";

export interface PrintProps {
  readonly value: string;
  readonly provenance: PrintProvenance;
  /** Read confidence, 0 to 1. Below 0.85 the value shows in a You cell for a person to confirm. */
  readonly confidence?: number;
  readonly state: PrintState;
  readonly footer?: string;
  /** Print with the 180 ms linear clip wipe. */
  readonly reveal?: boolean;
}

/** Read confidence at or above this is accepted automatically (register §2). */
export const AUTO_ACCEPT = 0.85;

export type KeysSigned = 0 | 1 | 2;

export interface SealProps {
  readonly batchSha256: string;
  readonly size: number;
  readonly keys: KeysSigned;
  /** Engrave newly signed rings (600 ms per ring, staggered 120 ms) instead of drawing them complete. */
  readonly engrave?: boolean;
}

/** A pre-formatted amount: what to show and what to say. */
export interface MoneyView {
  /** "US$64.45" */
  readonly display: string;
  /** "sixty-four dollars and forty-five cents" */
  readonly spoken: string;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type SegmentId = "kg-rate" | "premium" | "bonus" | `rule:${string}` | `credit:${string}` | "net";

export interface RuleChipView {
  readonly id: string;
  /** "CBU" */
  readonly name: string;
  /** "R1" */
  readonly rule: string;
  /** "BR 2026-04" */
  readonly card: string;
  /** Shown as a deduction: "−1.09" */
  readonly amount: MoneyView;
}

export interface CreditView {
  readonly id: string;
  readonly name: string;
  readonly amount: MoneyView;
}

/** One member's statement line (M-MB-01, W-TR-09), every figure formatted by `format.*`. */
export interface StatementLineView {
  readonly memberNo: string;
  /** "148.0 kg" */
  readonly kg: string;
  /** "US$0.2952" */
  readonly rate: string;
  /** The rule that sets the premium: "R0". */
  readonly premiumRule: string;
  readonly premium: MoneyView;
  readonly bonus: MoneyView;
  readonly deductions: readonly RuleChipView[];
  readonly credits: readonly CreditView[];
  readonly net: MoneyView;
  /** The peso estimate at the run's reference rate: "₱4,028". */
  readonly netPhp?: string;
}

export interface ReceiptBarProps {
  readonly line: StatementLineView;
  readonly onSegment: (id: SegmentId, rect: Rect) => void;
}

export type HoldGate = "BLOCKS_APPROVAL" | "RESERVES_LINE";
export type HoldKind =
  | "DUPLICATE_SLIP"
  | "IMPLAUSIBLE_YIELD"
  | "NO_RULE"
  | "RATE_MISMATCH"
  | "SUSPECTED_INJECTION"
  | "LOW_CONFIDENCE"
  | "MASS_BALANCE";

/**
 * `data-state` values a HoldCard can show: S2 §2.7's five, plus the register's EXCLUDED (register §7 states
 * OPEN, ASKED_CHAIR, RESOLVED, EXCLUDED; the register outranks S2). Resolved and excluded are final: they
 * never show actions.
 */
export const HOLD_CARD_STATES = [
  "open",
  "resolving",
  "resolved",
  "asked-chair",
  "conflict",
  "excluded",
] as const;
export type HoldCardState = (typeof HOLD_CARD_STATES)[number];

/** The states in which a hold is decided: flush, stamped, with no actions. */
export const HOLD_CARD_FINAL_STATES = ["resolved", "excluded"] as const satisfies readonly HoldCardState[];

export function isFinalHoldState(state: HoldCardState): state is (typeof HOLD_CARD_FINAL_STATES)[number] {
  return (HOLD_CARD_FINAL_STATES as readonly HoldCardState[]).includes(state);
}

export interface HoldView {
  readonly id: string;
  readonly kind: HoldKind;
  readonly title: string;
  /** The engine's sentence: a template whose digits come from code. */
  readonly engineLine: string;
  /** Claude's sentence, in pencil, with no digits (a digit fails validation and is regenerated). */
  readonly claudeLine?: string;
  /** The money effect of the proposed resolution, from code. */
  readonly effect?: string;
  readonly state: HoldCardState;
}

/** A person's initials stamp on a decision. */
export interface StampView {
  readonly initials: string;
  readonly name: string;
  /** "10:24" */
  readonly at: string;
}

export interface SlabAction {
  readonly kind: "slab";
  readonly label: string;
  readonly srLabel: string;
  readonly onCommit: () => void;
  readonly testId: string;
  /** The audit agent proposed this resolution: a pencil caption says so. */
  readonly suggestedByClaude?: boolean;
}

export interface FlatAction {
  readonly kind: "flat";
  readonly label: string;
  /** "Needs a reason, then the Chair" */
  readonly note?: string;
  readonly onSelect: () => void;
  readonly testId: string;
}

export interface HoldCardProps {
  readonly hold: HoldView;
  readonly gate: HoldGate;
  /** At most one d2 slab and one flat action. Never shown once the hold is resolved or excluded. */
  readonly actions: readonly [SlabAction] | readonly [SlabAction, FlatAction];
  /** Who resolved or excluded the hold, and when: the flush stamp on a final card. */
  readonly resolution?: StampView;
}

/** Slab travel helpers shared by both platforms (S2 §2.5): the face moves (t, t); edges collapse at t = d. */
export function edgeScale(t: number, d: number): number {
  if (d <= 0) return 0;
  return Math.max(0, Math.min(1, (d - t) / d));
}

/** The hold progress quarter for a 0..1 progress value. */
export function holdQuarter(progress: number): HoldProgress {
  const q = Math.max(0, Math.min(4, Math.floor(progress * 4 + 1e-9)));
  return (q * 25) as HoldProgress;
}
