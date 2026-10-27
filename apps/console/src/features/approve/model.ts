// W-TR-07's model: which state the approval is in, the batch both keys sign, why it is safe, and the lines
// digest, as pure functions of the IC-03 snapshot, the live RunView and what this browser is doing. Every
// figure is the engine's (snapshot checkpoints) or the API's (the approval payload); nothing here invents a
// cent. The only arithmetic is the lines root (a hash over the engine's own line hashes) and display shares.

import { type ApprovalPayload, type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import {
  atLeast,
  blockingHolds,
  byHandHolds,
  holdCards,
  type RunHold,
  type RunView,
} from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { sha256Hex } from "../../lib/sha256.js";
import {
  engineOutput,
  isOpenHold,
  massBalanceView,
  type SplitRow,
  splitBasis,
  splitRows,
} from "../split/model.js";
import { jcs } from "./jcs.js";

export type ApproveState =
  | "blocked"
  | "ready"
  | "key1"
  | "declined"
  | "expired"
  | "approved"
  | "posting"
  | "mismatch"
  | "retrying"
  | "denied"
  | "killed";

/** What only this browser knows: a refused or unanswered signature. */
export interface LocalApproval {
  readonly mismatch: boolean;
  readonly expired: boolean;
  /** The attempt now being sent again with the same request ID, or null. */
  readonly retrying: number | null;
}

export const NO_LOCAL: LocalApproval = { mismatch: false, expired: false, retrying: null };

/** Every attempt at one signed approval, the first included (S1.7 "Attempt 2 of 4"). */
export const MAX_ATTEMPTS = 4;

const POSTED_STATES = ["POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"] as const;

export function isPosted(view: RunView): boolean {
  return (POSTED_STATES as readonly string[]).includes(view.state);
}

/** S1.7's W-TR-07 states, most specific first. */
export function approveState(view: RunView, local: LocalApproval = NO_LOCAL): ApproveState {
  if (view.state === "DENIED") return "denied";
  if (view.state === "HALTED" || view.flags.kill_payouts === true) return "killed";
  if (local.mismatch) return "mismatch";
  if (local.expired) return "expired";
  if (local.retrying !== null) return "retrying";
  if (view.state === "POSTING") return "posting";
  if (view.state === "APPROVED" || isPosted(view)) return "approved";
  if (view.state === "TREASURER_APPROVED" || view.state === "AWAITING_BOARD") return "key1";
  if (view.state !== "IN_REVIEW" && view.state !== "COMPUTED") return "blocked";
  if (blockingHolds(view).length > 0) return "blocked";
  if (view.approvals.declined !== null && view.approvals.treasurer === null) return "declined";
  return "ready";
}

/** Can the treasurer's key sign now? */
export function canSign(state: ApproveState): boolean {
  return state === "ready" || state === "declined";
}

export type KeysSigned = 0 | 1 | 2;

export function sealKeys(view: RunView): KeysSigned {
  if (view.approvals.treasurer && view.approvals.chair) return 2;
  return view.approvals.treasurer ? 1 : 0;
}

/** The batch hash both keys sign: the signed one once key 1 is in, else the payload's, else none yet. */
export function batchHashOf(view: RunView, payload: ApprovalPayload | null | undefined): string | null {
  return (
    view.approvals.treasurer?.batchSha256 ?? view.approvals.chair?.batchSha256 ?? payload?.batchSha256 ?? null
  );
}

export interface BatchFacts {
  /** PayPal items in the batch. */
  readonly itemCount: number;
  readonly totalCents: number;
  /** Lines paid in cash at the bodega. */
  readonly cashCount: number;
  readonly cashCents: number;
  /** Every line's net (the fan's and the rail bar's whole). */
  readonly netCents: number;
  readonly lines: number;
  /** The PayPal recipients, by name, for the dialog route. */
  readonly recipients: readonly {
    readonly name: string;
    readonly memberNo: string;
    readonly cents: number;
  }[];
  /** True when the figures are final: every decision that changes kilos is made. */
  readonly final: boolean;
}

function payable(row: SplitRow): boolean {
  return row.state !== "EXCLUDED";
}

/**
 * The batch as the engine computes it now. The payload, once the API has built it, is the authority on what is
 * signed (its item count and total win); the engine's lines give names and the cash side.
 */
export function batchFacts(
  snapshot: SeasonSnapshot,
  view: RunView,
  payload?: ApprovalPayload | null,
): BatchFacts {
  const rows = splitRows(snapshot, view);
  const onPaypal = rows.filter((r) => r.rail === "PAYPAL" && payable(r));
  const cash = rows.filter((r) => r.rail === "CASH" && payable(r));
  const sum = (list: readonly SplitRow[]) => list.reduce((s, r) => s + r.netCents, 0);
  const total = sum(onPaypal);
  return {
    itemCount: payload?.itemCount ?? onPaypal.length,
    totalCents: payload?.totalCents ?? total,
    cashCount: cash.length,
    cashCents: sum(cash),
    netCents: sum(rows.filter(payable)),
    lines: rows.length,
    recipients: onPaypal.map((r) => ({ name: r.fullName, memberNo: r.memberNo, cents: r.netCents })),
    final: blockingHolds(view).length === 0 && atLeast(view, "COMPUTED"),
  };
}

/**
 * The lines root (`linesRootSha256`, S3 ledger `lines.computed`): sha256 of JCS([{memberNo, lineSha256}]) over
 * every line of the computation the run's decisions match, sorted by member number. It binds the 56 cash lines
 * as well as the 8 PayPal items.
 */
export function linesDigest(snapshot: SeasonSnapshot, view: RunView): string | null {
  if (view.origin !== "showcase" && !atLeast(view, "COMPUTED") && Object.keys(view.holds).length === 0)
    return null;
  const lines = engineOutput(snapshot, splitBasis(view))
    .lines.map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
    .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
  return sha256Hex(jcs(lines));
}

export interface SafeFacts {
  readonly holds: number;
  readonly byHand: number;
  readonly shrink: string;
  readonly limit: string;
  readonly explained: number;
  readonly lines: number;
  /** "14 Mar": the rate card has not changed since its ratification. */
  readonly date: string;
}

/** "3 holds resolved. 1 field entered by hand. Shrink 1.62%, inside 2.0%. 64 of 64 lines explained…" */
export function safeFacts(snapshot: SeasonSnapshot, view: RunView): SafeFacts {
  const rows = splitRows(snapshot, view);
  const dial = massBalanceView(snapshot, view);
  return {
    holds: holdCards(view).filter((h) => !isOpenHold(h)).length,
    byHand: byHandHolds(view).filter((h) => !isOpenHold(h)).length,
    shrink: dial.display,
    limit: dial.limitDisplay,
    explained: rows.filter((r) => r.openHold === null).length,
    lines: rows.length,
    date: format.dateShort(snapshot.rateCard.canonical.ratifiedOn),
  };
}

export interface FeeFacts {
  readonly sandboxEach: string;
  readonly count: number;
  readonly sandboxTotal: string;
  readonly production: string;
  readonly disbursement: string;
}

/** C-28: published rates, labelled as such; PayPal's reported fees appear on W-TR-08 only. */
export function feeFacts(snapshot: SeasonSnapshot): FeeFacts {
  const f = snapshot.figures;
  const count = f.batchItemCount;
  const each = count > 0 && f.feesSandboxCents % count === 0 ? f.feesSandboxCents / count : null;
  return {
    sandboxEach: each === null ? format.money(f.feesSandboxCents) : format.money(each),
    count,
    sandboxTotal: format.money(f.feesSandboxCents),
    production: format.money(f.feesProductionCents),
    disbursement: format.money(f.disbursementCents),
  };
}

/** `sender_batch_id` (register §8): `{season}-{rc8}-r{runSeq}`, from the run's own slug. */
export function senderBatchIdFor(snapshot: SeasonSnapshot, runSlug: string): string {
  const seq = /-r(\d+)$/.exec(runSlug)?.[1];
  return seq ? `${snapshot.season.code}-${snapshot.rateCard.rc8}-r${seq}` : snapshot.run.senderBatchId;
}

/** "US$300": whole dollars print without cents (the co-sign rule names a round threshold). */
export function wholeDollars(cents: number): string {
  const text = format.money(cents);
  return cents % 100 === 0 ? text.replace(/\.00$/, "") : text;
}

export interface ChairRule {
  readonly required: boolean;
  /** "US$300" */
  readonly threshold: string;
}

export function chairRule(snapshot: SeasonSnapshot, totalCents: number): ChairRule {
  const over = snapshot.rateCard.canonical.rules.cosign.batchOverCents;
  return {
    required: snapshot.run.chairNeeded.required || totalCents > over,
    threshold: wholeDollars(over),
  };
}

export interface BlockingReason {
  readonly hold: RunHold;
  readonly href: string;
}

/** Where each open blocking hold is decided: hold cards in their drawer, slip 0462 on W-TR-04, the dial via H1. */
export function blockingReasons(snapshot: SeasonSnapshot, view: RunView): BlockingReason[] {
  const open = blockingHolds(view).sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
  const duplicate = Object.values(view.holds).find((h) => h.kind === "DUPLICATE_SLIP" && isOpenHold(h));
  return open.map((hold) => {
    if (hold.kind === "LOW_CONFIDENCE") {
      const serial =
        snapshot.holds.find((h) => h.key === hold.key)?.serials[0] ??
        snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ??
        "";
      return { hold, href: webRoutes.byHand(snapshot.season.label, serial) };
    }
    if (hold.kind === "MASS_BALANCE" && duplicate) {
      return { hold, href: webRoutes.holdDrawer(view.runSlug, duplicate.label) };
    }
    return { hold, href: webRoutes.holdDrawer(view.runSlug, hold.label) };
  });
}

function order(h: RunHold): number {
  if (h.kind === "LOW_CONFIDENCE") return 0;
  if (h.kind === "MASS_BALANCE") return 2;
  return 1;
}

export type KeyLabelKind = "seeded" | "web" | "device";

/** How a key ID says where it lives: `-s1` seeded sample, `-w1` this browser (demo in Judge Mode), `-a1` a device. */
export function keyKind(keyId: string): KeyLabelKind {
  if (/-s\d+$/.test(keyId)) return "seeded";
  if (/-w\d+$/.test(keyId)) return "web";
  return "device";
}

/** The presence label's hold number: "H2" → "2". */
export function holdNumber(label: string): string {
  const m = /(\d+)$/.exec(label);
  return m?.[1] ?? label;
}

/** The phase MM-5 rests in for a state reached without a live act (history, a replay, a reload). */
export function restingPhase(
  state: ApproveState,
): "blocked" | "ready" | "waiting-2" | "inked" | "declined" | "expired" | "mismatch" | null {
  switch (state) {
    case "blocked":
    case "killed":
      return "blocked";
    case "ready":
      return "ready";
    case "key1":
      return "waiting-2";
    case "approved":
    case "posting":
    case "denied":
      return "inked";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "mismatch":
      return "mismatch";
    case "retrying":
      return null;
  }
}

/** S2.2.1 for the batch amount: pencil until both keys, ink once approved, hollow while PayPal has it. */
export function batchAmountState(view: RunView): "pencil" | "ink" | "hollow" {
  if (view.state === "SETTLED" || view.state === "CLOSED") return "ink";
  if (view.state === "POSTING" || isPosted(view)) return "hollow";
  return view.approvals.treasurer && view.approvals.chair ? "ink" : "pencil";
}

/** I4 on the client: the payload must be exactly the bytes the API says it is, and carry the batch on screen. */
export function payloadMatches(
  payload: ApprovalPayload,
  serverJcs: string,
  shownBatchSha256: string | null,
): boolean {
  if (jcs(payload as unknown as Parameters<typeof jcs>[0]) !== serverJcs) return false;
  return shownBatchSha256 === null || payload.batchSha256 === shownBatchSha256;
}
