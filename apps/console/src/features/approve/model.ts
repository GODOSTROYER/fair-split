// W-TR-07's model: which state the approval is in, the batch both keys sign, why it is safe, and the lines
// digest, as pure functions of the IC-03 snapshot, the live RunView, the run's own lines and what this browser
// is doing. Every figure is the API's (the run's lines, the approval payload) or, for a run nothing serves (the
// seeded showcase), the engine's (snapshot checkpoints); nothing here invents a cent. The only arithmetic is the
// lines root (a hash over the run's own line hashes) and display shares.

import {
  type ApprovalPayload,
  type ErrorCode,
  type Rail,
  type SeasonSnapshot,
  webRoutes,
} from "@fairsplit/contracts";
import { isApiClientError, isContractError, isNetworkError } from "../../data/errors.js";
import {
  atLeast,
  blockingHolds,
  byHandHolds,
  holdCards,
  type RunApproval,
  type RunHold,
  type RunView,
} from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { jcs } from "../../lib/jcs.js";
import { signingKeyKind } from "../../lib/keys.js";
import { linesRoot } from "../../lib/lines-root.js";
import { isOpenHold, massBalanceView, type SplitRow, splitRows } from "../split/model.js";

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

/**
 * What only this browser knows: a refused signature, or one being sent again because the server did not answer.
 * Sending again is the browser's own retry of its POST, never PayPal's (S1.7 `retrying` is PayPal's: see
 * `PaypalRetry`), so it leaves the screen's state alone and says so in its own words.
 */
export interface LocalApproval {
  readonly mismatch: boolean;
  readonly expired: boolean;
  /** The send about to go again under the same Idempotency-Key (2, 3 or 4), or null. */
  readonly resending: number | null;
}

export const NO_LOCAL: LocalApproval = { mismatch: false, expired: false, resending: null };

/** Every send of one signed approval, the first included. */
export const SEND_ATTEMPTS = 4;

/** Waits before sending the same signature again (no answer): 0.5 s, 1.5 s, 4.5 s. Not motion. */
export const RESEND_WAIT_MS = [500, 1500, 4500] as const;

/**
 * PayPal's Payouts POST being retried by the server with the same PayPal-Request-Id (S1.7 `retrying`: "PayPal
 * didn't answer. Retrying with the same request ID, so no one is paid twice. Attempt 2 of 4."). No RunEvent
 * carries the attempt yet (shared contract request: a POSTING retry event), so the screen passes null until one
 * does; the state, its copy and its test are ready for it.
 */
export interface PaypalRetry {
  readonly attempt: number;
  readonly of: number;
}

/**
 * The server's retry of PayPal's Payouts POST, read from the run's events. No RunEvent carries a POSTING attempt
 * yet (shared contract request: an attempt number on `run.state` metadata or `item.updated`), so this is null
 * until one does; the screen never borrows the spec's words for its own retries.
 */
export function paypalRetryOf(_view: RunView): PaypalRetry | null {
  return null;
}

const POSTED_STATES = ["POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"] as const;

export function isPosted(view: RunView): boolean {
  return (POSTED_STATES as readonly string[]).includes(view.state);
}

export interface LiveApprovals {
  readonly treasurer: RunApproval | null;
  readonly chair: RunApproval | null;
}

/**
 * The signatures that still count. A decline voids every approval before it (the server voids them and moves the
 * run back to review); the next `approval.signed` clears the decline, so a decline on the view means nothing
 * signed before it binds anything now (S2.2.1: when approvals are voided, ink returns to pencil).
 */
export function liveApprovals(view: RunView): LiveApprovals {
  if (view.approvals.declined !== null) return { treasurer: null, chair: null };
  return { treasurer: view.approvals.treasurer, chair: view.approvals.chair };
}

/** S1.7's W-TR-07 states, most specific first. */
export function approveState(
  view: RunView,
  local: LocalApproval = NO_LOCAL,
  paypalRetry: PaypalRetry | null = null,
): ApproveState {
  if (view.state === "DENIED") return "denied";
  if (view.state === "HALTED" || view.flags.kill_payouts === true) return "killed";
  if (local.mismatch) return "mismatch";
  if (local.expired) return "expired";
  if (view.state === "POSTING") return paypalRetry ? "retrying" : "posting";
  if (view.state === "APPROVED" || isPosted(view)) return "approved";
  if (view.state === "TREASURER_APPROVED" || view.state === "AWAITING_BOARD") return "key1";
  if (view.state !== "IN_REVIEW" && view.state !== "COMPUTED") return "blocked";
  if (blockingHolds(view).length > 0) return "blocked";
  if (view.approvals.declined !== null) return "declined";
  return "ready";
}

/** Can the treasurer's key sign now? */
export function canSign(state: ApproveState): boolean {
  return state === "ready" || state === "declined";
}

export type KeysSigned = 0 | 1 | 2;

export function sealKeys(view: RunView): KeysSigned {
  const signed = liveApprovals(view);
  if (signed.treasurer && signed.chair) return 2;
  return signed.treasurer ? 1 : 0;
}

/** The batch hash both keys sign: the signed one once key 1 is in, else the payload's, else none yet. */
export function batchHashOf(view: RunView, payload: ApprovalPayload | null | undefined): string | null {
  const signed = liveApprovals(view);
  return signed.treasurer?.batchSha256 ?? signed.chair?.batchSha256 ?? payload?.batchSha256 ?? null;
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
 * A member line as the run serves it (GET /v1/runs/:runSlug/lines, fs-api's MemberLineDTO): the amounts W-TR-07
 * shows and the hash the lines root binds. The hash is the workspace's own (its mark IDs are its own), so it is
 * read, never rebuilt from the seed.
 */
export interface ServedLine {
  readonly memberNo: string;
  readonly rail: Rail;
  readonly state: string;
  readonly netCents: number;
  readonly lineSha256: string;
}

/** The line states fs-api puts in the batch (approvals/batch.ts IN_BATCH). */
const IN_BATCH: readonly string[] = ["READY", "LOCKED", "SUBMITTED"];

/** Members whose line an open hold reserves (H3): the batch leaves them out until the hold is decided. */
function reservedMembers(view: RunView): Set<string> {
  return new Set(
    holdCards(view)
      .filter((h) => h.gate === "RESERVES_LINE" && isOpenHold(h) && h.memberNo !== null)
      .map((h) => h.memberNo as string),
  );
}

/** The batch from the run's own lines: fs-api's rule for an item (on PayPal, in the batch, not reserved, > 0). */
function servedFacts(
  snapshot: SeasonSnapshot,
  view: RunView,
  served: readonly ServedLine[],
  payload: ApprovalPayload | null | undefined,
): BatchFacts {
  const names = new Map(snapshot.members.map((m) => [m.memberNo, m.displayName]));
  const reserved = reservedMembers(view);
  const open = served.filter(
    (l) => !reserved.has(l.memberNo) && l.state !== "EXCLUDED" && l.state !== "HELD",
  );
  const onPaypal = open.filter((l) => l.rail === "PAYPAL" && IN_BATCH.includes(l.state) && l.netCents > 0);
  const cash = open.filter((l) => l.rail === "CASH");
  const sum = (list: readonly ServedLine[]) => list.reduce((s, l) => s + l.netCents, 0);
  return {
    itemCount: payload?.itemCount ?? onPaypal.length,
    totalCents: payload?.totalCents ?? sum(onPaypal),
    cashCount: cash.length,
    cashCents: sum(cash),
    netCents: sum(onPaypal) + sum(cash),
    lines: served.length,
    recipients: onPaypal
      .slice()
      .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0))
      .map((l) => ({ name: names.get(l.memberNo) ?? l.memberNo, memberNo: l.memberNo, cents: l.netCents })),
    final: blockingHolds(view).length === 0 && atLeast(view, "COMPUTED"),
  };
}

/**
 * The batch both keys sign. The run's own lines, once read, give the amounts (the recipients, the cash side and
 * the whole); the payload, once the API has built it, is the authority on what is signed (its item count and
 * total win). A run nothing serves (the seeded showcase) shows the engine's lines from the snapshot.
 */
export function batchFacts(
  snapshot: SeasonSnapshot,
  view: RunView,
  payload?: ApprovalPayload | null,
  served?: readonly ServedLine[] | null,
): BatchFacts {
  if (served && served.length > 0) return servedFacts(snapshot, view, served, payload);
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
 * every member line the run serves (the cash lines too), sorted by member number, recomputed in this browser from
 * the lines on screen. Never from the seed: a judge workspace mints its own mark IDs, and a line's hash covers
 * its credits' mark IDs, so the seed's root is never the workspace's. Null when nothing can be signed: no lines,
 * a member with two, or a hash that is not one. A signature binds it only once the approval payload carries it
 * (`signedLinesDigest`) and the two agree.
 */
export function linesDigest(lines: readonly ServedLine[] | null | undefined): string | null {
  if (!lines || lines.length === 0) return null;
  if (new Set(lines.map((l) => l.memberNo)).size !== lines.length) return null;
  if (lines.some((l) => !SHA256_HEX.test(l.lineSha256))) return null;
  return linesRoot(lines);
}

/**
 * What the run's lines follow: every hold decision, every field entered by hand and every line's state. When it
 * changes, the lines and the payload are read again together, so the root on screen and the one the payload
 * binds are always from the same moment.
 */
export function linesVersion(view: RunView): string {
  const parts = [
    ...Object.values(view.holds).map((h) => `h:${h.holdId}:${h.state}:${h.resolution ?? ""}`),
    ...Object.values(view.fields).map((f) => `f:${f.fieldId}:${f.value}`),
    ...Object.values(view.lines).map((l) => `l:${l.memberNo}:${l.state}`),
  ];
  return parts.sort().join("|");
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

export type KeyLabelKind = "seeded" | "demo" | "web" | "app";

/**
 * How a key ID says what signed (contracts: one ID shape per kind, C-13): `-s1` a seeded sample, `-demo-{6}` a
 * judge session's demo key, `-w1` an officer's persisted browser key, `-a1` an officer's app key. Null for an ID
 * no signing key can carry.
 */
export function keyKind(keyId: string): KeyLabelKind | null {
  switch (signingKeyKind(keyId)) {
    case "seeded":
      return "seeded";
    case "web_demo":
      return "demo";
    case "web":
      return "web";
    case "app":
      return "app";
    case null:
      return null;
  }
}

/** The presence label's hold number: "H2" → "2". */
export function holdNumber(label: string): string {
  const m = /(\d+)$/.exec(label);
  return m?.[1] ?? label;
}

/** The phase MM-5 rests in for a state reached without a live act (history, a replay, a reload). */
export function restingPhase(
  state: ApproveState,
): "blocked" | "ready" | "waiting-2" | "inked" | "declined" | "expired" | "mismatch" {
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
    case "retrying":
    case "denied":
      return "inked";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "mismatch":
      return "mismatch";
  }
}

/** S2.2.1 for the batch amount: pencil until both keys, ink once approved, hollow while PayPal has it. */
export function batchAmountState(view: RunView): "pencil" | "ink" | "hollow" {
  if (view.state === "SETTLED" || view.state === "CLOSED") return "ink";
  if (view.state === "POSTING" || isPosted(view)) return "hollow";
  const signed = liveApprovals(view);
  return signed.treasurer && signed.chair ? "ink" : "pencil";
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The lines root the payload asks both keys to sign (IC-02 `linesDigest`: every member line, the cash lines too),
 * or null while there is no payload. The contract requires it, so a payload without a well-formed root is one
 * nothing signs.
 */
export function signedLinesDigest(payload: ApprovalPayload | null | undefined): string | null {
  const value = payload?.linesDigest;
  return typeof value === "string" && SHA256_HEX.test(value) ? value : null;
}

/** What the screen showed before the hold: the batch hash on the seal, and the lines root this browser computed. */
export interface ShownBatch {
  readonly batchSha256: string | null;
  readonly linesDigest: string | null;
}

/**
 * I4 on the client: the payload must be exactly the bytes the API says it is, carry the batch hash the seal and the
 * dialog showed, and carry the lines root this browser recomputed from the lines on screen (IC-02 `linesDigest`),
 * so a cash line changed behind the screen signs nothing either. Nothing shown, nothing signed.
 */
export function payloadMatches(payload: ApprovalPayload, serverJcs: string, shown: ShownBatch): boolean {
  if (shown.batchSha256 === null || shown.linesDigest === null) return false;
  if (jcs(payload as unknown as Parameters<typeof jcs>[0]) !== serverJcs) return false;
  if (payload.batchSha256 !== shown.batchSha256) return false;
  const lines = signedLinesDigest(payload);
  return lines !== null && lines === shown.linesDigest;
}

/** Statuses that mean the server gave no definitive answer (unknown outcome, a gateway, a timeout). */
const UNANSWERED_STATUS: ReadonlySet<number> = new Set([500, 502, 503, 504]);

/** Typed refusals that are answers even with a 5xx status: sending the same request again changes nothing. */
const DEFINITIVE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "PAYPAL_REJECTED",
  "CIRCUIT_OPEN",
  "AI_LIVE_DISABLED",
]);

/**
 * Whether a signed approval may be sent again under the same Idempotency-Key: only when the request got no
 * definitive answer. A 501 (the step is not wired on the server yet) and other definitive refusals are answers,
 * shown at once; so is any 4xx.
 */
export function isUnanswered(error: unknown): boolean {
  if (isNetworkError(error)) return !error.aborted;
  // "The first request with this Idempotency-Key is still running" (fs-api): its answer is still coming, and a
  // later send under the same key gets the stored one.
  if (isApiClientError(error, "VERSION_CONFLICT") && error.details.reason === "IDEMPOTENCY_KEY_IN_FLIGHT") {
    return true;
  }
  if (isApiClientError(error)) {
    return !error.notImplemented && UNANSWERED_STATUS.has(error.status) && !DEFINITIVE_CODES.has(error.code);
  }
  if (isContractError(error)) return UNANSWERED_STATUS.has(error.status);
  return false;
}
