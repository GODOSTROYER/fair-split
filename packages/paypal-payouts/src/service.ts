// IC-06 PayoutsService: the only caller of create_payout_batch and cancel_unclaimed_payout_item
// (register §8 rules, S3 §S3.6.4). A post: kill switch (read fresh) → the batch re-read from the
// database (I4) → every approval checked against that batch: run, season, card, digest, count, total,
// exp, nonce, two people where R5 needs the Chair, and an Ed25519 signature by a registered key (I6)
// → sandbox guards (receivers, US$400, 8 items; for a new batch the daily cap and the balance, read
// in one turn with the write) → batch and item rows written as SUBMITTED → POST with
// PayPal-Request-Id = sha256(sender_batch_id) → 5xx/timeouts retried with the same ids, the kill
// switch re-read before each retry → "already exists" adopted through the HATEOAS link only if every
// listed item re-hashes to the approved digest. Nothing here trusts a line, an amount or an approval
// the caller hands in.

import type {
  CallPriority,
  PayPalFailure,
  PayPalFailureKind,
  PayPalHttp,
  PayPalResult,
} from "@fairsplit/paypal-core";
import type { Actor, ApprovalRole, SignedApproval } from "./_shims/contracts.js";
import {
  type BatchDigestFn,
  type BatchDigestRun,
  type CosignRule,
  type PayoutItemSpec,
  requiresChair,
} from "./_shims/domain.js";
import { type FairSplitPayoutBatch, fairSplitPayoutBatch } from "./fair-split-schema.js";
import {
  type CreatePayoutBatchResponse,
  cancelUnclaimedPayoutItem,
  createPayoutBatch,
  getPayoutBatch,
  getPayoutItem,
  type PayoutBatchHeader,
  type PayoutBatchResponse,
  type PayoutItemResponse,
  PayoutParamsError,
} from "./functions.js";
import {
  assertSha256,
  batchNote,
  senderBatchId as makeSenderBatchId,
  senderItemId as makeSenderItemId,
  PayoutIdError,
  parseSenderItemId,
  payPalRequestId,
} from "./ids.js";
import { centsToValue, readValueCents } from "./money.js";
import type { Context } from "./parameters.js";
import { PAYOUT_BATCH_ID_REGEX, PAYOUT_ITEM_ID_REGEX } from "./regex.js";
import { PayoutsApiError } from "./tools.js";

/** Retry the same request at 1 s, 3 s and 9 s (S3 §S3.6.4); after that the sweeper owns it. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 9_000];
/** S3.8: an approval's `exp` is at most 30 minutes after it was signed. */
export const APPROVAL_MAX_TTL_MS = 30 * 60 * 1000;
/** PayPal's limit on items per batch. */
export const PAYPAL_MAX_BATCH_ITEMS = 15_000;
const CONTEXT: Context = { sandbox: true };
const ADOPT_PAGE_SIZE = 1000;
const MAX_ADOPT_PAGES = 15; // 15,000 items at most per batch
const BATCH_PATH = /^\/v1\/payments\/payouts\/([A-Za-z0-9_-]{1,30})\/?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
/** Who may cancel an UNCLAIMED item: the treasurer (cash or re-route) and the Judge sweeper. Never the agent. */
const CANCEL_ACTOR_KINDS: ReadonlySet<Actor["kind"]> = new Set(["human", "system"]);

// ---- what the service reads ------------------------------------------------------------------

/** An on-rail line as the database holds it at the moment of the POST. */
export interface ApprovedLine {
  lineId: string;
  memberNo: string;
  receiver: string;
  amountCents: bigint;
  currency: "USD";
}

/** The facts a batch is built and checked from: read from the database, never from the caller. */
export interface PayoutRunFacts {
  runId: string;
  runSeq: number;
  /** "2026-A" */
  seasonCode: string;
  /** The season's id, as every approval payload signs it. */
  seasonId: string;
  rateCardSha256: string;
  /** R5 of the ratified card: when the Chair must co-sign. */
  cosign: CosignRule;
}

/** Batch and item rows already written as SUBMITTED: when, and the digest they carry. */
export interface SubmittedMark {
  at: string;
  batchSha256: string;
}

/** What executeApproved re-reads immediately before the POST (architecture I4, I6). */
export interface PostingSnapshot extends PayoutRunFacts {
  /** The run's on-rail lines in LOCKED state (SUBMITTED once the rows were written), as stored now. */
  lines: readonly ApprovedLine[];
  /** The run's approvals that are not voided, exactly as signed. */
  approvals: readonly SignedApproval[];
  /** Hold overrides the run carries (R5: any override needs the Chair). */
  overrides: number;
  /** Set when an earlier attempt wrote the batch rows: the post resumes with the same ids. */
  submitted: SubmittedMark | null;
}

/** A one-item batch paying a RETURNED item's line again (S3 §S3.6.4 re-route). */
export interface RerouteRequest {
  /** The RETURNED payout_item_id this item supersedes. */
  supersedesItemId: string;
  /** n in `-x{n}`: always the returned item's own n + 1 (1 for an item of the primary batch). */
  rerouteNo: number;
  /** The receiver the treasurer approved; the amount is the returned item's, read from the database. */
  receiver: string;
  /** A fresh one-item signature, plus the Chair's above the R5 thresholds. Checked like any other. */
  approvals: readonly SignedApproval[];
}

// ---- outcomes -------------------------------------------------------------------------------

export type RefusalCode =
  | "KILL_SWITCH_ON"
  | "APPROVALS_MISSING"
  | "DIGEST_MISMATCH"
  | "INVALID_BATCH"
  | "SANDBOX_GUARD"
  | "DAILY_CAP"
  | "QUEUED"
  | "CIRCUIT_OPEN"
  | "ADOPT_FAILED"
  | "NOT_RETURNED"
  | "NOT_FOR_REROUTE"
  | "ALREADY_REROUTED";

/**
 * Why a post or a cancel stopped without knowing PayPal's answer; the rows stay as written.
 * ADOPT_PENDING: PayPal holds a batch under our sender_batch_id, but it could not yet be shown to be
 * the approved one (no items listed yet, or the GET went unanswered). Nothing is adopted on a header
 * total: a later call (the sweeper) posts the same ids again, re-GETs and adopts only on the items.
 */
export type UnresolvedReason = "RETRIES_EXHAUSTED" | "KILL_SWITCH_ON" | "AUTH_FAILED" | "ADOPT_PENDING";

export type BatchOutcome =
  | {
      kind: "created" | "adopted";
      senderBatchId: string;
      payoutBatchId: string;
      batchStatus: string | null;
      batchSha256: string;
      requestId: string;
      debugId: string | null;
      attempts: number;
      /** "items": an adopted batch, re-hashed from every item PayPal lists (I4); null when created. */
      verifiedBy: "items" | null;
    }
  /**
   * Nothing was sent (or, for ADOPT_FAILED, nothing new was created): HALT or wait. QUEUED and
   * CIRCUIT_OPEN come after the rows were written as SUBMITTED; a later call resumes the same ids.
   */
  | { kind: "refused"; code: RefusalCode; reason: string; senderBatchId: string | null }
  /** A synchronous 4xx (e.g. INSUFFICIENT_FUNDS): PayPal created nothing. The run goes to DENIED. */
  | {
      kind: "rejected";
      senderBatchId: string;
      status: number;
      name: string;
      message: string;
      debugId: string | null;
    }
  /** The rows stay SUBMITTED; a later call resumes with the same ids, so PayPal can never pay twice. */
  | {
      kind: "unresolved";
      senderBatchId: string;
      attempts: number;
      lastStatus: number | null;
      debugId: string | null;
      reason: UnresolvedReason;
      /** Set after "already exists": the batch PayPal holds under our sender_batch_id, NOT adopted. */
      payoutBatchId?: string;
    };

export type CancelIntent = "cash" | "reroute";

export type CancelOutcome =
  | { kind: "RETURNED"; payoutItemId: string; intent: CancelIntent; debugId: string | null }
  | { kind: "NOT_UNCLAIMED"; payoutItemId: string; status: string | null; debugId: string | null }
  | {
      kind: "REFUSED";
      payoutItemId: string;
      /** QUEUED and CIRCUIT_OPEN: PayPal's pacing; the intent stays recorded for a later try. */
      code:
        | "KILL_SWITCH_ON"
        | "UNKNOWN_ITEM"
        | "INTENT_CONFLICT"
        | "ACTOR_NOT_ALLOWED"
        | "QUEUED"
        | "CIRCUIT_OPEN";
    }
  | {
      kind: "UNRESOLVED";
      payoutItemId: string;
      attempts: number;
      lastStatus: number | null;
      reason: UnresolvedReason;
    };

// ---- persistence port (IC-04 scoped repositories; TEMPORARY until WS-DATA's lands) -----------

export interface SubmittedItem {
  lineId: string;
  memberNo: string;
  senderItemId: string;
  receiver: string;
  amountCents: bigint;
  currency: "USD";
  supersedesItemId: string | null;
}

export interface SubmittedBatch {
  runId: string;
  kind: "primary" | "reroute";
  senderBatchId: string;
  requestId: string;
  batchSha256: string;
  note: string;
  totalCents: bigint;
  currency: "USD";
  items: SubmittedItem[];
  /** When the approvals were checked and the rows written; a resumed post checks them as of this time. */
  at: string;
}

export interface PayoutItemRow {
  payoutItemId: string;
  senderItemId: string;
  runId: string;
  lineId: string;
  memberNo: string;
  receiver: string;
  amountCents: bigint;
  /** PayPal transaction_status as last applied (UNCLAIMED, RETURNED, …). */
  status: string;
  cancelRequestedAt: string | null;
  cancelIntent: CancelIntent | null;
}

/** The item that already re-routes a RETURNED item (UNIQUE supersedes_item_id). */
export interface SupersedingItem {
  senderBatchId: string;
  senderItemId: string;
  receiver: string;
  amountCents: bigint;
  /** SUBMITTED: the POST's outcome is unknown. POSTED: PayPal holds it. REJECTED: a synchronous 4xx. */
  batchState: "SUBMITTED" | "POSTED" | "REJECTED";
  submitted: SubmittedMark;
}

export interface PayoutsRepository {
  /**
   * The run's primary batch exactly as the database holds it now: run facts, LOCKED (or already
   * SUBMITTED) lines and the approvals that are not voided. Null unless the run is APPROVED or POSTING.
   */
  loadPosting(runId: string): Promise<PostingSnapshot | null>;
  /** The facts of the run a returned item belongs to. */
  loadRun(runId: string): Promise<PayoutRunFacts | null>;
  /**
   * Writes the batch row and every item row as SUBMITTED (and moves the lines LOCKED → SUBMITTED)
   * in one transaction, BEFORE the POST, and returns the mark of the rows stored under
   * `batch.senderBatchId` once it commits. Rows already stored under that sender_batch_id are never
   * overwritten or merged: the call writes nothing and returns THEIR mark, and the service posts
   * only if that mark carries the digest it is about to send (two re-routes of one item racing to two
   * receivers share the ids; the loser must not post its receiver under the winner's rows).
   * `supersedes_item_id` is UNIQUE, so one returned item is re-routed by one item only: a second
   * superseding item fails the transaction, nothing is written and the call rejects.
   */
  writeSubmitted(batch: SubmittedBatch): Promise<SubmittedMark>;
  /**
   * A 201, or an adopted "already exists": moves the rows stored under `senderBatchId` WITH
   * `batchSha256` to POSTED (compare-and-set; idempotent once POSTED). Unless the rows under that id
   * carry exactly that digest, they are not the batch that was posted: the call writes nothing and
   * rejects (HALT and alert).
   */
  markPosted(posted: {
    senderBatchId: string;
    batchSha256: string;
    payoutBatchId: string;
    batchStatus: string | null;
    outcome: "created" | "adopted";
    debugId: string | null;
  }): Promise<void>;
  /** A synchronous 4xx: nothing was created. Compare-and-set on the digest, as markPosted. */
  markRejected(rejected: {
    senderBatchId: string;
    batchSha256: string;
    status: number;
    name: string;
    message: string;
    debugId: string | null;
  }): Promise<void>;
  /**
   * S3.6.4 step 3: the run's approvals failed their check before anything was written for its batch.
   * In one transaction: void every approval of the run not voided yet (voided_at, the reason) and move
   * the run back to IN_REVIEW, so both keys sign again what the database holds now.
   */
  voidApprovals(voided: {
    runId: string;
    code: ApprovalRefusal["code"];
    reason: string;
    at: string;
  }): Promise<void>;
  findItem(payoutItemId: string): Promise<PayoutItemRow | null>;
  /** The item that already supersedes `payoutItemId`, if any. */
  findSupersedingItem(payoutItemId: string): Promise<SupersedingItem | null>;
  /** Sets cancel_requested_at, the intent and the actor BEFORE the cancel POST, so RETURNED is ours. */
  markCancelRequested(request: {
    payoutItemId: string;
    intent: CancelIntent;
    requestedAt: string;
    by: Actor;
  }): Promise<void>;
  /** Applies a status PayPal just returned (cancel body or a fresh GET); ranks are the repository's job. */
  applyItemStatus(update: {
    payoutItemId: string;
    transactionStatus: string;
    source: "cancel" | "get";
    debugId: string | null;
    at: string;
  }): Promise<void>;
}

/**
 * The sandbox money guards (S3 §S3.6.4 step 4; plan: "receiver, US$400 (C-21), 8-item, daily-cap and
 * balance guards"). Every one is required: a missing guard is a boot error. Numbers are passed in,
 * never hard-coded here. The daily cap and the balance are checked only before a NEW batch's rows are
 * written; a resumed post was counted and funded when its rows were written.
 */
export interface PayoutLimits {
  /** C-21: the batch cap (US$400 in the register). */
  maxBatchTotalCents: bigint;
  /** Judge Mode posts at most 8 items; real mode passes PayPal's 15,000. */
  maxItems: number;
  /** Every receiver must be a known sandbox account (PP_RECEIVERS). */
  receiverAllowed: (receiver: string) => boolean;
  /**
   * C-21: at most this many live batches in any rolling 24 h (40 in the register). The judge lane's
   * own, lower quotas (S3.9, the plan's balance formula) are decided before executeApproved is called;
   * this is the hard ceiling under them.
   */
  maxPostsPer24h: number;
  /**
   * Batches this database wrote as SUBMITTED in the 24 h before `now` (primary and re-route, whatever
   * became of them since). A new batch goes out only while this is under `maxPostsPer24h`.
   */
  postsInLast24h: (now: Date) => Promise<number>;
  /**
   * The estimated sandbox balance in cents: the latest `searchBalances` reading minus every batch
   * written since it, SUBMITTED included (S1's observed balance until the first reading). Null when
   * there is no estimate, which refuses the post.
   */
  balanceCents: () => Promise<bigint | null>;
  /** A batch goes out only if the estimated balance stays at or above this floor after it. */
  minBalanceCents: bigint;
}

export interface PayoutsServiceDeps {
  /**
   * IC-05 PayPalHttp: limiter, shared token, PayPal-Request-Id, call log, debug ids, links merged from
   * details. It owns the 401 (drops the stale token, resends once), so a 401 that reaches the service
   * is final.
   */
  http: PayPalHttp;
  repo: PayoutsRepository;
  /** IC-02 `batchDigest(run, items)`; the service only compares. */
  batchDigest: BatchDigestFn;
  /**
   * True only if the approval's Ed25519 signature verifies against the approver's registered,
   * unrevoked `device_keys` row (IC-02 `approvalSignatureValid`, never the approval's own
   * publicKeyHex) and that key belongs to `payload.approverId` for that role. Everything else about
   * the approval is checked here.
   */
  verifyApprovalSignature: (approval: SignedApproval) => Promise<boolean>;
  /** `kill_payouts` / `kill_paypal_live` / FS_KILL, read fresh before every POST, retries included. */
  killSwitch: () => Promise<boolean>;
  limits: PayoutLimits;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  priority?: CallPriority;
}

/** What makes a re-route's ids `{senderBatchId}-x{n}-{memberNo}` / `r{runSeq}x{n}-{memberNo}`. */
interface RerouteOf {
  n: number;
  memberNo: string;
  /** The RETURNED payout_item_id the new item supersedes. */
  supersedesItemId: string;
}

interface PostSpec {
  facts: PayoutRunFacts;
  kind: "primary" | "reroute";
  /** Null for the run's primary batch. */
  reroute: RerouteOf | null;
  lines: readonly ApprovedLine[];
  approvals: readonly SignedApproval[];
  overrides: number;
  submitted: SubmittedMark | null;
}

interface PostContext {
  run: BatchDigestRun;
  senderBatchId: string;
  requestId: string;
  digest: string;
}

interface Refusal {
  code: RefusalCode;
  reason: string;
}

/** Why the approvals do not authorise the batch the database holds (S3.6.4 step 3). */
interface ApprovalRefusal extends Refusal {
  code: "DIGEST_MISMATCH" | "APPROVALS_MISSING";
}

const refused = (code: RefusalCode, reason: string, senderBatchId: string | null): BatchOutcome => ({
  kind: "refused",
  code,
  reason,
  senderBatchId,
});

const CHANGED = "The batch changed after it was signed. Nothing was sent.";

/** The rows stored under our sender_batch_id carry another digest: another call's batch, not ours. */
function storedElsewhere(kind: PostSpec["kind"]): Refusal {
  return kind === "reroute"
    ? {
        code: "ALREADY_REROUTED",
        reason: "Another re-route of this item was written first. Nothing was sent.",
      }
    : { code: "DIGEST_MISMATCH", reason: CHANGED };
}

type Failure = PayPalFailure;

function isRetryable(result: Failure): boolean {
  if (result.status === 429 || result.status === 401) return false;
  return result.status === 0 || result.status === 408 || result.status >= 500 || result.retryable;
}

type LocalRefusal = Extract<PayPalFailureKind, "limited" | "circuit_open" | "auth" | "invalid_request">;
const LOCAL_REFUSALS: ReadonlySet<PayPalFailureKind> = new Set<LocalRefusal>([
  "limited",
  "circuit_open",
  "auth",
  "invalid_request",
]);

/**
 * WS-PPCORE's PayPalHttp refused the call itself (limiter window, 429 circuit, no OAuth token, a request
 * it would not send): `delivery: "not_sent"`, so retrying at once would only be refused again. Such a
 * failure has status 0 like a lost response, so its `kind` decides, never its status.
 */
function localRefusal(result: Failure): LocalRefusal | null {
  return LOCAL_REFUSALS.has(result.kind) ? (result.kind as LocalRefusal) : null;
}

function detailText(details: unknown[]): string {
  return details
    .map((d) => {
      const x = (d ?? {}) as { field?: unknown; issue?: unknown; description?: unknown };
      return `${String(x.field ?? "")} ${String(x.issue ?? "")} ${String(x.description ?? "")}`;
    })
    .join(" ");
}

/** 400 USER_BUSINESS_ERROR "Batch with given sender_batch_id already exists" (PR #107 sandbox capture). */
export function isDuplicateBatchError(result: Failure): boolean {
  if (result.status !== 400) return false;
  const text = `${result.name} ${result.message} ${detailText(result.details ?? [])}`;
  return (
    /sender_batch_id already exists/i.test(text) ||
    (/USER_BUSINESS_ERROR/.test(result.name) && /SENDER_BATCH_ID/.test(text))
  );
}

/** The original batch's id from the HATEOAS link, which Payouts puts in details[].link. */
export function linkedBatchId(result: Failure): string | null {
  const candidates: unknown[] = [...(result.links ?? [])];
  for (const d of result.details ?? []) {
    const link =
      (d as { link?: unknown; links?: unknown } | null)?.link ?? (d as { links?: unknown } | null)?.links;
    if (Array.isArray(link)) candidates.push(...link);
    else if (link) candidates.push(link);
  }
  for (const c of candidates) {
    const href = (c as { href?: unknown } | null)?.href;
    if (typeof href !== "string") continue;
    try {
      const m = BATCH_PATH.exec(new URL(href).pathname);
      if (m?.[1]) return m[1];
    } catch {
      // not a URL; ignore
    }
  }
  return null;
}

function validateLines(lines: readonly ApprovedLine[]): string | null {
  if (lines.length < 1 || lines.length > PAYPAL_MAX_BATCH_ITEMS)
    return `A batch holds 1 to 15,000 items, not ${lines.length}`;
  const members = new Set<string>();
  for (const line of lines) {
    if (line.currency !== "USD") return `${line.memberNo}: payouts are USD only`;
    if (typeof line.amountCents !== "bigint" || line.amountCents <= 0n || line.amountCents > MAX_SAFE_CENTS)
      return `${line.memberNo}: amount must be positive cents`;
    if (!EMAIL.test(line.receiver) || line.receiver.length > 127)
      return `${line.memberNo}: recipient_type is EMAIL only`;
    if (members.has(line.memberNo)) return `${line.memberNo} appears twice`;
    members.add(line.memberNo);
  }
  return null;
}

function assertLimits(limits: PayoutLimits | undefined): PayoutLimits {
  if (!limits) throw new TypeError("PayoutsService needs its sandbox limits");
  const { maxBatchTotalCents, maxItems, receiverAllowed } = limits;
  const { maxPostsPer24h, postsInLast24h, balanceCents, minBalanceCents } = limits;
  if (typeof maxBatchTotalCents !== "bigint" || maxBatchTotalCents <= 0n)
    throw new TypeError("limits.maxBatchTotalCents must be positive bigint cents (C-21)");
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > PAYPAL_MAX_BATCH_ITEMS)
    throw new TypeError("limits.maxItems must be an integer from 1 to 15,000");
  if (typeof receiverAllowed !== "function")
    throw new TypeError("limits.receiverAllowed must check PP_RECEIVERS");
  if (!Number.isSafeInteger(maxPostsPer24h) || maxPostsPer24h < 1)
    throw new TypeError("limits.maxPostsPer24h must be a positive integer (C-21: live batches a day)");
  if (typeof postsInLast24h !== "function")
    throw new TypeError("limits.postsInLast24h must count the batches written in the last 24 h");
  if (typeof balanceCents !== "function")
    throw new TypeError("limits.balanceCents must read the estimated sandbox balance");
  if (typeof minBalanceCents !== "bigint" || minBalanceCents < 0n)
    throw new TypeError("limits.minBalanceCents must be bigint cents, zero or more");
  return {
    maxBatchTotalCents,
    maxItems,
    receiverAllowed,
    maxPostsPer24h,
    postsInLast24h,
    balanceCents,
    minBalanceCents,
  };
}

/** A dollar figure for a refusal's words (any sign); amounts on the wire use centsToValue. */
function usd(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}US$${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function requireFunction<T>(value: T, what: string): T {
  if (typeof value !== "function") throw new TypeError(`PayoutsService needs ${what}`);
  return value;
}

export class PayoutsService {
  readonly #http: PayPalHttp;
  readonly #repo: PayoutsRepository;
  readonly #digest: BatchDigestFn;
  readonly #verifySignature: (approval: SignedApproval) => Promise<boolean>;
  readonly #killSwitch: () => Promise<boolean>;
  readonly #limits: PayoutLimits;
  readonly #delays: readonly number[];
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;
  readonly #priority: CallPriority;
  /** The tail of the queue that serializes "check the daily cap and the balance, then write the rows". */
  #writes: Promise<void> = Promise.resolve();

  constructor(deps: PayoutsServiceDeps) {
    this.#http = deps.http;
    this.#repo = deps.repo;
    this.#digest = requireFunction(deps.batchDigest, "the IC-02 batch digest");
    this.#verifySignature = requireFunction(deps.verifyApprovalSignature, "an approval signature check");
    this.#killSwitch = requireFunction(deps.killSwitch, "the kill switch");
    this.#limits = assertLimits(deps.limits);
    this.#delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = deps.now ?? (() => new Date());
    this.#priority = deps.priority ?? "live";
  }

  /** IC-06: posts the run's approved batch exactly as signed, re-read from the database (I4). */
  async executeApproved(runId: string): Promise<BatchOutcome> {
    if (await this.#killSwitch()) return refused("KILL_SWITCH_ON", "Payouts are paused by the co-op", null);
    const snapshot = await this.#repo.loadPosting(runId);
    if (!snapshot || snapshot.runId !== runId) {
      return refused("INVALID_BATCH", "This run has no approved batch to post", null);
    }
    return this.#post({
      facts: snapshot,
      kind: "primary",
      reroute: null,
      lines: snapshot.lines,
      approvals: snapshot.approvals,
      overrides: snapshot.overrides,
      submitted: snapshot.submitted,
    });
  }

  /**
   * A one-item batch `{senderBatchId}-x{n}-{memberNo}` paying a RETURNED item's line again. Only an
   * item we cancelled for a re-route qualifies (a cash cancel sent the line to the bodega), its amount
   * is read from the database, and each returned item is re-routed at most once: a retry resumes the
   * same ids, so a second, different batch can never pay the member twice (I3). Two re-routes of one
   * item racing (to two receivers) share those ids; the write is judged on the stored digest, so only
   * one is ever posted.
   */
  async reroute(request: RerouteRequest): Promise<BatchOutcome> {
    if (await this.#killSwitch()) return refused("KILL_SWITCH_ON", "Payouts are paused by the co-op", null);
    const { supersedesItemId } = request;
    if (!PAYOUT_ITEM_ID_REGEX.test(supersedesItemId)) {
      return refused("NOT_RETURNED", "Not a payout item id", null);
    }
    const row = await this.#repo.findItem(supersedesItemId);
    if (row?.status !== "RETURNED") {
      return refused("NOT_RETURNED", "Only a RETURNED item can be re-routed", null);
    }
    // Register §7: RETURNED is accepted only after our own cancel.
    if (!row.cancelRequestedAt) {
      return refused(
        "NOT_FOR_REROUTE",
        "PayPal returned this item without our cancel; it needs follow-up",
        null,
      );
    }
    if (row.cancelIntent !== "reroute") {
      return refused("NOT_FOR_REROUTE", "This item was cancelled to be paid in cash", null);
    }
    const parsed = parseSenderItemId(row.senderItemId);
    if (!parsed || parsed.memberNo !== row.memberNo) {
      return refused("INVALID_BATCH", "The returned item does not carry one of our sender_item_ids", null);
    }
    const n = (parsed.rerouteNo ?? 0) + 1;
    if (request.rerouteNo !== n) {
      return refused("INVALID_BATCH", `This item's re-route is x${n}, not x${request.rerouteNo}`, null);
    }
    const facts = await this.#repo.loadRun(row.runId);
    if (!facts || facts.runId !== row.runId || facts.runSeq !== parsed.runSeq) {
      return refused("INVALID_BATCH", "The returned item does not belong to a known run", null);
    }
    let ids: { senderBatchId: string; senderItemId: string };
    try {
      ids = {
        senderBatchId: makeSenderBatchId({ ...facts, rerouteNo: n, memberNo: row.memberNo }),
        senderItemId: makeSenderItemId({ runSeq: facts.runSeq, memberNo: row.memberNo, rerouteNo: n }),
      };
    } catch (error) {
      if (error instanceof PayoutIdError) return refused("INVALID_BATCH", error.message, null);
      throw error;
    }

    let submitted: SubmittedMark | null = null;
    const existing = await this.#repo.findSupersedingItem(supersedesItemId);
    if (existing) {
      const ourUnresolvedAttempt =
        existing.batchState === "SUBMITTED" &&
        existing.senderBatchId === ids.senderBatchId &&
        existing.senderItemId === ids.senderItemId &&
        existing.receiver === request.receiver &&
        existing.amountCents === row.amountCents;
      if (!ourUnresolvedAttempt) {
        const reason =
          existing.batchState === "SUBMITTED"
            ? "Another re-route of this item is still unresolved"
            : "This item was already re-routed";
        return refused("ALREADY_REROUTED", reason, existing.senderBatchId);
      }
      submitted = existing.submitted;
    }

    return this.#post({
      facts,
      kind: "reroute",
      reroute: { n, memberNo: row.memberNo, supersedesItemId },
      lines: [
        {
          lineId: row.lineId,
          memberNo: row.memberNo,
          receiver: request.receiver,
          amountCents: row.amountCents,
          currency: "USD",
        },
      ],
      approvals: request.approvals,
      overrides: 0,
      submitted,
    });
  }

  async #post(spec: PostSpec): Promise<BatchOutcome> {
    const { facts } = spec;
    let senderBatchId: string;
    let items: SubmittedItem[];
    try {
      assertSha256(facts.rateCardSha256, "rateCardSha256");
      senderBatchId = makeSenderBatchId({
        ...facts,
        rerouteNo: spec.reroute?.n,
        memberNo: spec.reroute?.memberNo,
      });
      items = spec.lines
        .map((line) => ({
          lineId: line.lineId,
          memberNo: line.memberNo,
          senderItemId: makeSenderItemId({
            runSeq: facts.runSeq,
            memberNo: line.memberNo,
            rerouteNo: spec.reroute?.n,
          }),
          receiver: line.receiver,
          amountCents: line.amountCents,
          currency: line.currency,
          supersedesItemId: spec.reroute?.supersedesItemId ?? null,
        }))
        .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
    } catch (error) {
      if (error instanceof PayoutIdError) return refused("INVALID_BATCH", error.message, null);
      throw error;
    }
    const invalid = validateLines(spec.lines);
    if (invalid) return refused("INVALID_BATCH", invalid, senderBatchId);

    // I4: the approved digest is the payout. Re-hash the batch the database holds now.
    const run: BatchDigestRun = { runId: facts.runId, senderBatchId, rateCardSha256: facts.rateCardSha256 };
    const digest = await this.#digest(run, items.map(toSpec));
    const totalCents = items.reduce((sum, i) => sum + i.amountCents, 0n);
    if (spec.submitted && spec.submitted.batchSha256 !== digest) {
      return refused("DIGEST_MISMATCH", CHANGED, senderBatchId);
    }

    // I6: every approval is checked as of the moment it authorised the write (now, or when the rows
    // of a resumed post were written).
    const at = spec.submitted ? new Date(spec.submitted.at) : this.#now();
    if (Number.isNaN(at.getTime()))
      return refused("INVALID_BATCH", "Unreadable submission time", senderBatchId);
    const gate = await this.#checkApprovals(spec, { digest, itemCount: items.length, totalCents, at });
    if (gate) {
      // S3.6.4 step 3: these approvals no longer authorise what the database holds. With nothing
      // written for the run's batch yet, they are voided and the run goes back to IN_REVIEW. A resumed
      // post (rows SUBMITTED, the batch perhaps at PayPal) is a HALT, not a review; a re-route's
      // approvals are its own, not the run's.
      if (spec.kind === "primary" && !spec.submitted) {
        await this.#repo.voidApprovals({
          runId: facts.runId,
          code: gate.code,
          reason: gate.reason,
          at: this.#now().toISOString(),
        });
      }
      return refused(gate.code, gate.reason, senderBatchId);
    }

    const guard = this.#guard(items, totalCents);
    if (guard) return refused("SANDBOX_GUARD", guard, senderBatchId);

    const note = batchNote(facts.seasonCode, digest);
    const body: FairSplitPayoutBatch = {
      sender_batch_header: { sender_batch_id: senderBatchId, recipient_type: "EMAIL", note },
      items: items.map((i) => ({
        receiver: i.receiver,
        amount: { currency: "USD", value: centsToValue(i.amountCents) },
        sender_item_id: i.senderItemId,
        purpose: "GOODS",
      })),
    };
    const strict = fairSplitPayoutBatch.safeParse(body);
    if (!strict.success)
      return refused("INVALID_BATCH", strict.error.issues[0]?.message ?? "invalid batch", senderBatchId);

    const requestId = payPalRequestId(senderBatchId);
    if (!spec.submitted) {
      // A new batch: the daily cap and the balance are read, and its rows written, in one turn of
      // the queue, so two posts racing for the last slot cannot both pass on the same count.
      const stop = await this.#exclusive(async (): Promise<Refusal | null> => {
        const over = await this.#spendGuard(totalCents, at);
        if (over) return over;
        const stored = await this.#repo.writeSubmitted({
          runId: facts.runId,
          kind: spec.kind,
          senderBatchId,
          requestId,
          batchSha256: digest,
          note,
          totalCents,
          currency: "USD",
          items,
          at: at.toISOString(),
        });
        // I4 at the write: post only under rows that carry this very digest. Rows another call wrote
        // under the same ids first (a re-route of the same item to another receiver) are theirs.
        return stored?.batchSha256 === digest ? null : storedElsewhere(spec.kind);
      });
      if (stop) return refused(stop.code, stop.reason, senderBatchId);
    }
    return this.#send(body, { run, senderBatchId, requestId, digest });
  }

  /**
   * Runs `task` once every earlier one has settled. Within this service the count a guard reads
   * always includes the rows the previous post wrote; across processes live posts share one lane
   * (S3.9), and `postsInLast24h` counts committed rows.
   */
  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const turn = this.#writes.then(task);
    this.#writes = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /**
   * S3 §S3.6.4 step 4, the two guards that change by the hour: register C-21's live batches per
   * rolling 24 h, and the estimated sandbox balance, which must stay at or above the floor after this
   * batch (so it also refuses a batch the balance cannot cover). Unreadable inputs refuse.
   */
  async #spendGuard(totalCents: bigint, now: Date): Promise<Refusal | null> {
    const { maxPostsPer24h, postsInLast24h, balanceCents, minBalanceCents } = this.#limits;
    const posted = await postsInLast24h(now);
    if (!Number.isSafeInteger(posted) || posted < 0) {
      return { code: "DAILY_CAP", reason: "The live batches of the last 24 h could not be counted" };
    }
    if (posted >= maxPostsPer24h) {
      return {
        code: "DAILY_CAP",
        reason: `${posted} live batches in the last 24 h: the cap is ${maxPostsPer24h}`,
      };
    }
    const balance = await balanceCents();
    if (typeof balance !== "bigint") {
      return { code: "SANDBOX_GUARD", reason: "The sandbox balance is not known yet" };
    }
    if (balance - totalCents < minBalanceCents) {
      return {
        code: "SANDBOX_GUARD",
        reason: `The estimated sandbox balance (${usd(balance)}) less this ${usd(totalCents)} batch is under the ${usd(minBalanceCents)} floor`,
      };
    }
    return null;
  }

  /**
   * I6 inside the service: who must have signed is derived from database facts (R5), and every
   * approval must sign exactly this batch, be unexpired at `at`, carry its own nonce, and verify
   * against a registered key. The treasurer and the Chair are two people with two keys.
   */
  async #checkApprovals(
    spec: PostSpec,
    batch: { digest: string; itemCount: number; totalCents: bigint; at: Date },
  ): Promise<ApprovalRefusal | null> {
    const { facts } = spec;
    const mismatch = (reason = CHANGED): ApprovalRefusal => ({ code: "DIGEST_MISMATCH", reason });
    const at = batch.at.getTime();
    const byRole = new Map<ApprovalRole, SignedApproval>();
    const nonces = new Set<string>();
    for (const approval of spec.approvals) {
      const p = approval?.payload;
      if (!p || approval.role !== p.role || (p.role !== "treasurer" && p.role !== "chair")) {
        return mismatch("An approval's role does not match what it signed. Nothing was sent.");
      }
      if (
        p.v !== 1 ||
        p.runId !== facts.runId ||
        p.seasonId !== facts.seasonId ||
        p.rateCardSha256 !== facts.rateCardSha256 ||
        p.batchSha256 !== batch.digest ||
        p.itemCount !== batch.itemCount ||
        !Number.isSafeInteger(p.totalCents) ||
        BigInt(p.totalCents) !== batch.totalCents ||
        p.currency !== "USD"
      ) {
        return mismatch();
      }
      const exp = typeof p.exp === "string" ? Date.parse(p.exp) : Number.NaN;
      if (Number.isNaN(exp) || exp <= at || exp - at > APPROVAL_MAX_TTL_MS) {
        return mismatch("An approval expired before the batch was sent. Nothing was sent.");
      }
      if (typeof p.nonce !== "string" || p.nonce.length < 8 || nonces.has(p.nonce)) {
        return mismatch("An approval's nonce was already used. Nothing was sent.");
      }
      nonces.add(p.nonce);
      if (byRole.has(p.role)) return mismatch("One role signed twice. Nothing was sent.");
      byRole.set(p.role, approval);
    }

    const treasurer = byRole.get("treasurer");
    if (!treasurer) return { code: "APPROVALS_MISSING", reason: "The treasurer's approval is missing" };
    const chairRule = requiresChair(
      {
        batchTotalCents: Number(batch.totalCents),
        lineAmountsCents: spec.lines.map((l) => Number(l.amountCents)),
        overrides: spec.overrides,
      },
      facts.cosign,
    );
    const chair = byRole.get("chair");
    if (chairRule.required && !chair) {
      return {
        code: "APPROVALS_MISSING",
        reason: `The Chair's co-signature is missing (R5: ${chairRule.reasons.join(", ")})`,
      };
    }
    if (
      chair &&
      (chair.payload.approverId === treasurer.payload.approverId || chair.keyId === treasurer.keyId)
    ) {
      return {
        code: "APPROVALS_MISSING",
        reason: "The treasurer and the Chair must be two people with two keys",
      };
    }
    for (const approval of byRole.values()) {
      if (!(await this.#verifySignature(approval))) {
        return mismatch(
          "An approval's signature does not verify against a registered key. Nothing was sent.",
        );
      }
    }
    return null;
  }

  #guard(items: SubmittedItem[], totalCents: bigint): string | null {
    const { maxItems, maxBatchTotalCents, receiverAllowed } = this.#limits;
    if (items.length > maxItems) return `${items.length} items is over the cap of ${maxItems}`;
    if (totalCents > maxBatchTotalCents) {
      return `US$${centsToValue(totalCents)} is over the batch cap of US$${centsToValue(maxBatchTotalCents)}`;
    }
    const unknown = items.find((i) => !receiverAllowed(i.receiver));
    if (unknown) return `${unknown.senderItemId}: the receiver is not a known sandbox account`;
    return null;
  }

  async #send(body: FairSplitPayoutBatch, ctx: PostContext): Promise<BatchOutcome> {
    let attempts = 0;
    let retry = 0;
    let lastStatus: number | null = null;
    let lastDebugId: string | null = null;
    const unresolved = (reason: UnresolvedReason): BatchOutcome => ({
      kind: "unresolved",
      senderBatchId: ctx.senderBatchId,
      attempts,
      lastStatus,
      debugId: lastDebugId,
      reason,
    });
    for (;;) {
      // Read fresh just before every POST, the first included (S3.11): a new post may have waited its
      // turn in the queue and written its rows since the caller's read.
      if (await this.#killSwitch()) return unresolved("KILL_SWITCH_ON");
      attempts += 1;
      let result: PayPalResult<CreatePayoutBatchResponse> | null = null;
      try {
        result = await createPayoutBatch(this.#http, CONTEXT, body, {
          requestId: ctx.requestId,
          priority: this.#priority,
        });
      } catch (error) {
        if (error instanceof PayoutParamsError) throw error;
        result = null; // transport failure or timeout: PayPal may or may not have the batch
        lastStatus = null;
        lastDebugId = null;
      }

      if (result?.ok) {
        const header = result.body?.batch_header;
        const id = header?.payout_batch_id;
        const echoed = header?.sender_batch_header?.sender_batch_id;
        if (
          typeof id === "string" &&
          PAYOUT_BATCH_ID_REGEX.test(id) &&
          (echoed === undefined || echoed === ctx.senderBatchId)
        ) {
          // Compare-and-set: only the rows that carry the digest just posted become POSTED.
          await this.#repo.markPosted({
            senderBatchId: ctx.senderBatchId,
            batchSha256: ctx.digest,
            payoutBatchId: id,
            batchStatus: header?.batch_status ?? null,
            outcome: "created",
            debugId: result.debugId,
          });
          return {
            kind: "created",
            senderBatchId: ctx.senderBatchId,
            payoutBatchId: id,
            batchStatus: header?.batch_status ?? null,
            batchSha256: ctx.digest,
            requestId: ctx.requestId,
            debugId: result.debugId,
            attempts,
            verifiedBy: null,
          };
        }
        // A 2xx we cannot read: retrying with the same sender_batch_id is safe and resolves it.
        lastStatus = result.status;
        lastDebugId = result.debugId;
      } else if (result) {
        lastStatus = result.status;
        lastDebugId = result.debugId;
        switch (localRefusal(result)) {
          case "limited":
            return refused("QUEUED", "PayPal's sandbox is pacing us; nothing was sent", ctx.senderBatchId);
          case "circuit_open":
            return refused(
              "CIRCUIT_OPEN",
              "PayPal's sandbox is pacing us; no batch was created",
              ctx.senderBatchId,
            );
          case "auth":
            return unresolved("AUTH_FAILED");
          case "invalid_request":
            return refused(
              "INVALID_BATCH",
              `PayPalHttp would not send it: ${result.message}`,
              ctx.senderBatchId,
            );
          case null:
            break;
        }
        if (isDuplicateBatchError(result)) return this.#adopt(result, ctx, attempts);
        if (result.status === 429) {
          return refused(
            "CIRCUIT_OPEN",
            "PayPal's sandbox is pacing us; no batch was created",
            ctx.senderBatchId,
          );
        }
        // PayPalHttp already dropped the stale token and resent once: the credentials are refused.
        if (result.status === 401) return unresolved("AUTH_FAILED");
        if (!isRetryable(result)) {
          await this.#repo.markRejected({
            senderBatchId: ctx.senderBatchId,
            batchSha256: ctx.digest,
            status: result.status,
            name: result.name,
            message: result.message,
            debugId: result.debugId,
          });
          return {
            kind: "rejected",
            senderBatchId: ctx.senderBatchId,
            status: result.status,
            name: result.name,
            message: result.message,
            debugId: result.debugId,
          };
        }
      }

      const delay = this.#delays[retry];
      if (delay === undefined) return unresolved("RETRIES_EXHAUSTED");
      await this.#sleep(delay);
      retry += 1;
    }
  }

  /**
   * "Already exists" (S3 §S3.6.4 step 7): follow the HATEOAS link to the batch PayPal holds under our
   * sender_batch_id and adopt it only if every item it lists rebuilds the approved digest (I4). A
   * header total proves neither the receivers nor the split: two databases sharing the one sandbox
   * business account can collide on a run_seq block with the same total. So a batch that lists no
   * items yet, or a GET that went unanswered, leaves the rows SUBMITTED (ADOPT_PENDING) for a later
   * call to post the same ids again and re-GET; only a batch shown NOT to be ours is ADOPT_FAILED,
   * the HALT-and-alert case.
   */
  async #adopt(result: Failure, ctx: PostContext, attempts: number): Promise<BatchOutcome> {
    const fail = (reason: string) => refused("ADOPT_FAILED", reason, ctx.senderBatchId);
    const payoutBatchId = linkedBatchId(result);
    if (!payoutBatchId) return fail("PayPal says the batch exists but gave no link to it");
    const unresolved = (
      reason: "ADOPT_PENDING" | "AUTH_FAILED",
      answer: { status: number; debugId: string | null },
    ): BatchOutcome => ({
      kind: "unresolved",
      senderBatchId: ctx.senderBatchId,
      attempts,
      lastStatus: answer.status,
      debugId: answer.debugId,
      reason,
      payoutBatchId,
    });
    const paced = (code: "QUEUED" | "CIRCUIT_OPEN") =>
      refused(code, "PayPal's sandbox is pacing us; the batch is not adopted yet", ctx.senderBatchId);

    const items: PayoutItemResponse[] = [];
    let header: PayoutBatchHeader | undefined;
    let last: { status: number; debugId: string | null } = { status: result.status, debugId: result.debugId };
    for (let page = 1; page <= MAX_ADOPT_PAGES; page++) {
      const got = await getPayoutBatch(
        this.#http,
        CONTEXT,
        { payout_batch_id: payoutBatchId, page, page_size: ADOPT_PAGE_SIZE, total_required: true },
        { priority: this.#priority },
      );
      if (!got.ok) {
        switch (localRefusal(got)) {
          case "limited":
            return paced("QUEUED");
          case "circuit_open":
            return paced("CIRCUIT_OPEN");
          case "auth":
            return unresolved("AUTH_FAILED", got);
          case "invalid_request":
            return fail(`PayPalHttp would not GET the linked batch: ${got.message}`);
          case null:
            break;
        }
        if (got.status === 429) return paced("CIRCUIT_OPEN");
        // PayPalHttp already dropped the stale token and resent once: the credentials are refused.
        if (got.status === 401) return unresolved("AUTH_FAILED", got);
        // No answer, or PayPal failing: nothing is known about the batch yet. Any other 4xx is an
        // answer about the link itself (gone, forbidden): HALT.
        if (!isRetryable(got)) return fail(`GET of the existing batch failed (${got.status} ${got.name})`);
        return unresolved("ADOPT_PENDING", got);
      }
      last = got;
      const body = got.body as Partial<PayoutBatchResponse> | null;
      if (!body || typeof body !== "object" || !body.batch_header) return unresolved("ADOPT_PENDING", got);
      header ??= body.batch_header;
      const pageItems = Array.isArray(body.items) ? body.items : [];
      items.push(...pageItems);
      const totalPages = body.total_pages ?? 1;
      if (page >= totalPages || pageItems.length < ADOPT_PAGE_SIZE) break;
    }
    if (header?.sender_batch_header?.sender_batch_id !== ctx.senderBatchId) {
      return fail("The linked batch carries another sender_batch_id");
    }
    // Nothing to re-hash yet: adopting now would trust the header total alone (not I4).
    if (items.length === 0) return unresolved("ADOPT_PENDING", last);

    const specs: PayoutItemSpec[] = [];
    for (const it of items) {
      const amountCents = readValueCents(it?.payout_item?.amount?.value);
      const senderItemId = it?.payout_item?.sender_item_id;
      const receiver = it?.payout_item?.receiver;
      if (
        amountCents === null ||
        typeof senderItemId !== "string" ||
        senderItemId.length === 0 ||
        typeof receiver !== "string" ||
        it.payout_item.amount.currency !== "USD"
      ) {
        return fail("The existing batch has an item we cannot read");
      }
      specs.push({ senderItemId, receiver, amountCents, currency: "USD" });
    }
    specs.sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
    if ((await this.#digest(ctx.run, specs)) !== ctx.digest) {
      return fail("The existing batch differs from the approved digest");
    }

    await this.#repo.markPosted({
      senderBatchId: ctx.senderBatchId,
      batchSha256: ctx.digest,
      payoutBatchId,
      batchStatus: header.batch_status ?? null,
      outcome: "adopted",
      debugId: last.debugId,
    });
    return {
      kind: "adopted",
      senderBatchId: ctx.senderBatchId,
      payoutBatchId,
      batchStatus: header.batch_status ?? null,
      batchSha256: ctx.digest,
      requestId: ctx.requestId,
      debugId: last.debugId,
      attempts,
      verifiedBy: "items",
    };
  }

  /**
   * Cancels an UNCLAIMED item (Rhea's case, C-07) for `then`: "cash" (the line moves to OFF_RAIL_DUE)
   * or "reroute" (the only cancel a re-route accepts). S3 §S3.6.4 `cancelUnclaimed(payoutItemId, by,
   * then)`: the actor and the intent are required and recorded with cancel_requested_at before the
   * POST, and an intent once recorded never changes. A 400 ("Only items in Unclaimed status can be
   * cancelled.") is checked with a fresh GET.
   */
  async cancelUnclaimed(
    payoutItemId: string,
    by: Actor,
    then: CancelIntent,
    options: { priority?: CallPriority } = {},
  ): Promise<CancelOutcome> {
    if (then !== "cash" && then !== "reroute") throw new TypeError(`Unknown cancel intent: ${String(then)}`);
    if (!by || !CANCEL_ACTOR_KINDS.has(by.kind) || typeof by.id !== "string" || by.id.length === 0) {
      return { kind: "REFUSED", payoutItemId, code: "ACTOR_NOT_ALLOWED" };
    }
    const priority = options.priority ?? this.#priority;
    if (await this.#killSwitch()) return { kind: "REFUSED", payoutItemId, code: "KILL_SWITCH_ON" };
    if (!PAYOUT_ITEM_ID_REGEX.test(payoutItemId))
      return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
    const row = await this.#repo.findItem(payoutItemId);
    if (!row) return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
    if (row.cancelRequestedAt && row.cancelIntent !== null && row.cancelIntent !== then) {
      return { kind: "REFUSED", payoutItemId, code: "INTENT_CONFLICT" };
    }
    if (row.status === "RETURNED" && row.cancelRequestedAt) {
      return { kind: "RETURNED", payoutItemId, intent: row.cancelIntent ?? then, debugId: null };
    }
    if (row.status !== "UNCLAIMED")
      return { kind: "NOT_UNCLAIMED", payoutItemId, status: row.status, debugId: null };

    if (!row.cancelRequestedAt) {
      await this.#repo.markCancelRequested({
        payoutItemId,
        intent: then,
        requestedAt: this.#now().toISOString(),
        by,
      });
    }

    let attempts = 0;
    let retry = 0;
    let lastStatus: number | null = null;
    for (;;) {
      if (attempts > 0 && (await this.#killSwitch())) {
        return { kind: "UNRESOLVED", payoutItemId, attempts, lastStatus, reason: "KILL_SWITCH_ON" };
      }
      attempts += 1;
      let result: PayPalResult<PayoutItemResponse> | null = null;
      try {
        result = await cancelUnclaimedPayoutItem(
          this.#http,
          CONTEXT,
          { payout_item_id: payoutItemId },
          { priority },
        );
      } catch (error) {
        if (error instanceof PayoutParamsError) throw error;
        result = null;
        lastStatus = null;
      }
      if (result?.ok) {
        const status = result.body?.transaction_status ?? "RETURNED";
        await this.#apply(payoutItemId, status, "cancel", result.debugId);
        return status === "RETURNED"
          ? { kind: "RETURNED", payoutItemId, intent: then, debugId: result.debugId }
          : { kind: "NOT_UNCLAIMED", payoutItemId, status, debugId: result.debugId };
      }
      if (result) {
        lastStatus = result.status;
        const local = localRefusal(result);
        if (local === "limited") return { kind: "REFUSED", payoutItemId, code: "QUEUED" };
        if (local === "circuit_open" || result.status === 429)
          return { kind: "REFUSED", payoutItemId, code: "CIRCUIT_OPEN" };
        if (local === "auth") {
          return { kind: "UNRESOLVED", payoutItemId, attempts, lastStatus, reason: "AUTH_FAILED" };
        }
        if (local === "invalid_request") {
          throw new PayoutsApiError(
            "cancel_unclaimed_payout_item",
            result.status,
            result.name,
            result.debugId,
            result.message,
          );
        }
        if (result.status === 401) {
          return { kind: "UNRESOLVED", payoutItemId, attempts, lastStatus, reason: "AUTH_FAILED" };
        }
        if (result.status === 404) return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
        if (result.status === 400 || result.status === 422)
          return this.#checkItem(payoutItemId, then, priority, result);
        if (!isRetryable(result)) {
          throw new PayoutsApiError(
            "cancel_unclaimed_payout_item",
            result.status,
            result.name,
            result.debugId,
            result.message,
          );
        }
      }
      const delay = this.#delays[retry];
      if (delay === undefined) {
        return { kind: "UNRESOLVED", payoutItemId, attempts, lastStatus, reason: "RETRIES_EXHAUSTED" };
      }
      await this.#sleep(delay);
      retry += 1;
    }
  }

  async #checkItem(
    payoutItemId: string,
    intent: CancelIntent,
    priority: CallPriority,
    refusal: Failure,
  ): Promise<CancelOutcome> {
    const fresh = await getPayoutItem(this.#http, CONTEXT, { payout_item_id: payoutItemId }, { priority });
    if (!fresh.ok) {
      throw new PayoutsApiError("get_payout_item", fresh.status, fresh.name, fresh.debugId, fresh.message);
    }
    const status = fresh.body?.transaction_status ?? null;
    if (status) await this.#apply(payoutItemId, status, "get", fresh.debugId);
    // Our own earlier cancel may already have gone through (e.g. a 5xx after PayPal processed it).
    if (status === "RETURNED") return { kind: "RETURNED", payoutItemId, intent, debugId: fresh.debugId };
    // Still UNCLAIMED, yet PayPal refused the cancel: not a status race, so surface PayPal's answer.
    if (status === "UNCLAIMED") {
      throw new PayoutsApiError(
        "cancel_unclaimed_payout_item",
        refusal.status,
        refusal.name,
        refusal.debugId,
        refusal.message,
      );
    }
    return { kind: "NOT_UNCLAIMED", payoutItemId, status, debugId: fresh.debugId };
  }

  async #apply(
    payoutItemId: string,
    transactionStatus: string,
    source: "cancel" | "get",
    debugId: string | null,
  ) {
    await this.#repo.applyItemStatus({
      payoutItemId,
      transactionStatus,
      source,
      debugId,
      at: this.#now().toISOString(),
    });
  }
}

function toSpec(item: SubmittedItem): PayoutItemSpec {
  return {
    senderItemId: item.senderItemId,
    receiver: item.receiver,
    amountCents: item.amountCents,
    currency: item.currency,
  };
}
