// IC-06 PayoutsService: the only caller of create_payout_batch and cancel_unclaimed_payout_item
// (register §8 rules, S3 §S3.6.4). Order of a post: kill switch → approvals → re-hash (I4) →
// guards → batch and item rows written as SUBMITTED → POST with PayPal-Request-Id =
// sha256(sender_batch_id) → retry 5xx/timeouts with the same ids → adopt "already exists" through
// the HATEOAS link, only if it matches the approved digest.

import type { BatchDigestFn, BatchDigestRun, PayoutItemSpec } from "./_shims/domain.js";
import type { CallPriority, PayPalAuth, PayPalHttp, PayPalResult } from "./_shims/paypal-core.js";
import { type FairSplitPayoutBatch, fairSplitPayoutBatch } from "./fair-split-schema.js";
import {
  type CreatePayoutBatchResponse,
  cancelUnclaimedPayoutItem,
  createPayoutBatch,
  getPayoutBatch,
  getPayoutItem,
  type PayoutBatchHeader,
  type PayoutItemResponse,
  PayoutParamsError,
} from "./functions.js";
import {
  assertSha256,
  batchNote,
  senderBatchId as makeSenderBatchId,
  senderItemId as makeSenderItemId,
  PayoutIdError,
  payPalRequestId,
} from "./ids.js";
import { centsToValue, readValueCents } from "./money.js";
import type { Context } from "./parameters.js";
import { PAYOUT_BATCH_ID_REGEX, PAYOUT_ITEM_ID_REGEX } from "./regex.js";
import { PayoutsApiError } from "./tools.js";

/** Retry the same request at 1 s, 3 s and 9 s (S3 §S3.6.4); after that the sweeper owns it. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 9_000];
const CONTEXT: Context = { sandbox: true };
const ADOPT_PAGE_SIZE = 1000;
const MAX_ADOPT_PAGES = 15; // 15,000 items at most per batch
const BATCH_PATH = /^\/v1\/payments\/payouts\/([A-Za-z0-9_-]{1,30})\/?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- inputs ---------------------------------------------------------------------------------

/** A LOCKED on-rail line, re-read from the database immediately before the POST. */
export interface ApprovedLine {
  lineId: string;
  memberNo: string;
  receiver: string;
  amountCents: bigint;
  currency: "USD";
}

export type ApprovalRole = "TREASURER" | "CHAIR";

/** A verified approval (its Ed25519 signature was checked upstream) and the digest it signed. */
export interface ApprovalDigest {
  role: ApprovalRole;
  batchSha256: string;
}

export interface ApprovedRun {
  runId: string;
  runSeq: number;
  /** "2026-A" */
  seasonCode: string;
  rateCardSha256: string;
  /** The treasurer always; the Chair as well above the thresholds (decided upstream). */
  approvals: readonly ApprovalDigest[];
  lines: readonly ApprovedLine[];
}

/** A one-item batch paying a RETURNED item's line to a (possibly new) receiver. */
export interface RerouteRequest {
  runId: string;
  runSeq: number;
  seasonCode: string;
  rateCardSha256: string;
  /** n in `-x{n}`, from 1. */
  rerouteNo: number;
  /** The RETURNED payout_item_id this item supersedes. */
  supersedesItemId: string;
  line: ApprovedLine;
  /** A fresh one-item signature (plus the Chair's above the thresholds). */
  approvals: readonly ApprovalDigest[];
}

// ---- outcomes -------------------------------------------------------------------------------

export type RefusalCode =
  | "KILL_SWITCH_ON"
  | "APPROVALS_MISSING"
  | "DIGEST_MISMATCH"
  | "INVALID_BATCH"
  | "SANDBOX_GUARD"
  | "CIRCUIT_OPEN"
  | "ADOPT_FAILED"
  | "NOT_RETURNED";

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
      /** For an adopted batch: re-hashed from its items, or (items not listed yet) its header total. */
      verifiedBy: "items" | "header" | null;
    }
  /** Nothing was sent (or, for ADOPT_FAILED / CIRCUIT_OPEN, nothing new was created): HALT or wait. */
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
  /** Retries exhausted on 5xx/timeouts; the rows stay SUBMITTED and a retry later reuses the same ids. */
  | {
      kind: "unresolved";
      senderBatchId: string;
      attempts: number;
      lastStatus: number | null;
      debugId: string | null;
    };

export type CancelIntent = "cash" | "reroute";

export type CancelOutcome =
  | { kind: "RETURNED"; payoutItemId: string; intent: CancelIntent; debugId: string | null }
  | { kind: "NOT_UNCLAIMED"; payoutItemId: string; status: string | null; debugId: string | null }
  | { kind: "REFUSED"; payoutItemId: string; code: "KILL_SWITCH_ON" | "UNKNOWN_ITEM" }
  | { kind: "UNRESOLVED"; payoutItemId: string; attempts: number; lastStatus: number | null };

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

export interface PayoutsRepository {
  /**
   * Writes the batch row and every item row as SUBMITTED (and moves the lines LOCKED → SUBMITTED)
   * in one transaction, BEFORE the POST. Idempotent on sender_batch_id / sender_item_id.
   */
  writeSubmitted(batch: SubmittedBatch): Promise<void>;
  /** A 201, or an adopted "already exists". */
  markPosted(posted: {
    senderBatchId: string;
    payoutBatchId: string;
    batchStatus: string | null;
    outcome: "created" | "adopted";
    debugId: string | null;
  }): Promise<void>;
  /** A synchronous 4xx: nothing was created. */
  markRejected(rejected: {
    senderBatchId: string;
    status: number;
    name: string;
    message: string;
    debugId: string | null;
  }): Promise<void>;
  findItem(payoutItemId: string): Promise<PayoutItemRow | null>;
  /** Sets cancel_requested_at and the intent BEFORE the cancel POST, so RETURNED is ours. */
  markCancelRequested(request: {
    payoutItemId: string;
    intent: CancelIntent;
    requestedAt: string;
    by: string | null;
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

export interface PayoutLimits {
  /** C-21: the batch cap (US$400 in the register); passed in, never hard-coded here. */
  maxBatchTotalCents?: bigint;
  /** Judge Mode posts at most 8 items. */
  maxItems?: number;
  /** Every receiver must be a known sandbox account (PP_RECEIVERS). */
  receiverAllowed?: (receiver: string) => boolean;
}

export interface PayoutsServiceDeps {
  /** IC-05 PayPalHttp: limiter, PayPal-Request-Id, call log, debug ids, links merged from details. */
  http: PayPalHttp;
  /** IC-05 PayPalAuth: on a 401 we invalidate the shared token and retry once. */
  auth?: Pick<PayPalAuth, "invalidate">;
  repo: PayoutsRepository;
  /** IC-02 `batchDigest(run, items)`; the service only compares. */
  batchDigest: BatchDigestFn;
  /** `kill_payouts` / FS_KILL, read fresh before every PayPal call that moves money. */
  killSwitch?: () => Promise<boolean>;
  limits?: PayoutLimits;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  priority?: CallPriority;
}

interface PostSpec {
  runId: string;
  runSeq: number;
  seasonCode: string;
  rateCardSha256: string;
  kind: "primary" | "reroute";
  rerouteNo?: number;
  supersedesItemId: string | null;
  lines: readonly ApprovedLine[];
  approvals: readonly ApprovalDigest[];
}

interface PostContext {
  run: BatchDigestRun;
  senderBatchId: string;
  requestId: string;
  digest: string;
  totalCents: bigint;
}

const refused = (code: RefusalCode, reason: string, senderBatchId: string | null): BatchOutcome => ({
  kind: "refused",
  code,
  reason,
  senderBatchId,
});

type Failure = Extract<PayPalResult<unknown>, { ok: false }>;

function isRetryable(result: Failure): boolean {
  if (result.status === 429 || result.status === 401) return false;
  return result.status === 0 || result.status === 408 || result.status >= 500 || result.retryable;
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
  if (lines.length < 1 || lines.length > 15_000)
    return `A batch holds 1 to 15,000 items, not ${lines.length}`;
  const members = new Set<string>();
  for (const line of lines) {
    if (line.currency !== "USD") return `${line.memberNo}: payouts are USD only`;
    if (typeof line.amountCents !== "bigint" || line.amountCents <= 0n)
      return `${line.memberNo}: amount must be positive cents`;
    if (!EMAIL.test(line.receiver) || line.receiver.length > 127)
      return `${line.memberNo}: recipient_type is EMAIL only`;
    if (members.has(line.memberNo)) return `${line.memberNo} appears twice`;
    members.add(line.memberNo);
  }
  return null;
}

export class PayoutsService {
  readonly #http: PayPalHttp;
  readonly #auth: Pick<PayPalAuth, "invalidate"> | undefined;
  readonly #repo: PayoutsRepository;
  readonly #digest: BatchDigestFn;
  readonly #killSwitch: () => Promise<boolean>;
  readonly #limits: PayoutLimits;
  readonly #delays: readonly number[];
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;
  readonly #priority: CallPriority;

  constructor(deps: PayoutsServiceDeps) {
    this.#http = deps.http;
    this.#auth = deps.auth;
    this.#repo = deps.repo;
    this.#digest = deps.batchDigest;
    this.#killSwitch = deps.killSwitch ?? (async () => false);
    this.#limits = deps.limits ?? {};
    this.#delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = deps.now ?? (() => new Date());
    this.#priority = deps.priority ?? "live";
  }

  /** Posts the approved batch exactly as signed (I4), or refuses without sending anything. */
  async executeApproved(run: ApprovedRun): Promise<BatchOutcome> {
    return this.#post({ ...run, kind: "primary", supersedesItemId: null });
  }

  /** A one-item batch `{senderBatchId}-x{n}` paying a RETURNED item's line again. */
  async reroute(request: RerouteRequest): Promise<BatchOutcome> {
    if (await this.#killSwitch()) return refused("KILL_SWITCH_ON", "Payouts are paused by the co-op", null);
    if (!PAYOUT_ITEM_ID_REGEX.test(request.supersedesItemId)) {
      return refused("NOT_RETURNED", "Not a payout item id", null);
    }
    const row = await this.#repo.findItem(request.supersedesItemId);
    if (row?.status !== "RETURNED") {
      return refused("NOT_RETURNED", "Only a RETURNED item can be re-routed", null);
    }
    if (row.runId !== request.runId || row.memberNo !== request.line.memberNo) {
      return refused("INVALID_BATCH", "A re-route pays the same member of the same run", null);
    }
    if (row.amountCents !== request.line.amountCents) {
      return refused("INVALID_BATCH", "A re-route pays exactly the returned amount", null);
    }
    return this.#post({
      runId: request.runId,
      runSeq: request.runSeq,
      seasonCode: request.seasonCode,
      rateCardSha256: request.rateCardSha256,
      kind: "reroute",
      rerouteNo: request.rerouteNo,
      supersedesItemId: request.supersedesItemId,
      lines: [request.line],
      approvals: request.approvals,
    });
  }

  async #post(spec: PostSpec): Promise<BatchOutcome> {
    if (await this.#killSwitch()) return refused("KILL_SWITCH_ON", "Payouts are paused by the co-op", null);

    let senderBatchId: string;
    let items: SubmittedItem[];
    try {
      assertSha256(spec.rateCardSha256, "rateCardSha256");
      senderBatchId = makeSenderBatchId({ ...spec });
      items = spec.lines
        .map((line) => ({
          lineId: line.lineId,
          memberNo: line.memberNo,
          senderItemId: makeSenderItemId({
            runSeq: spec.runSeq,
            memberNo: line.memberNo,
            rerouteNo: spec.rerouteNo,
          }),
          receiver: line.receiver,
          amountCents: line.amountCents,
          currency: line.currency,
          supersedesItemId: spec.supersedesItemId,
        }))
        .sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
    } catch (error) {
      if (error instanceof PayoutIdError) return refused("INVALID_BATCH", error.message, null);
      throw error;
    }

    if (!spec.approvals.some((a) => a.role === "TREASURER")) {
      return refused("APPROVALS_MISSING", "The treasurer's approval is missing", senderBatchId);
    }
    const invalid = validateLines(spec.lines);
    if (invalid) return refused("INVALID_BATCH", invalid, senderBatchId);

    // I4: the approved digest is the payout. Re-hash what we are about to send and compare.
    const run: BatchDigestRun = { runId: spec.runId, senderBatchId, rateCardSha256: spec.rateCardSha256 };
    const digest = await this.#digest(run, items.map(toSpec));
    if (!spec.approvals.every((a) => a.batchSha256 === digest)) {
      return refused(
        "DIGEST_MISMATCH",
        "The batch changed after it was signed. Nothing was sent.",
        senderBatchId,
      );
    }

    const totalCents = items.reduce((sum, i) => sum + i.amountCents, 0n);
    const guard = this.#guard(items, totalCents);
    if (guard) return refused("SANDBOX_GUARD", guard, senderBatchId);

    const note = batchNote(spec.seasonCode, digest);
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
    await this.#repo.writeSubmitted({
      runId: spec.runId,
      kind: spec.kind,
      senderBatchId,
      requestId,
      batchSha256: digest,
      note,
      totalCents,
      currency: "USD",
      items,
    });
    return this.#send(body, { run, senderBatchId, requestId, digest, totalCents });
  }

  #guard(items: SubmittedItem[], totalCents: bigint): string | null {
    const { maxItems, maxBatchTotalCents, receiverAllowed } = this.#limits;
    if (maxItems !== undefined && items.length > maxItems)
      return `${items.length} items is over the cap of ${maxItems}`;
    if (maxBatchTotalCents !== undefined && totalCents > maxBatchTotalCents) {
      return `US$${centsToValue(totalCents)} is over the batch cap of US$${centsToValue(maxBatchTotalCents)}`;
    }
    const unknown = receiverAllowed ? items.find((i) => !receiverAllowed(i.receiver)) : undefined;
    if (unknown) return `${unknown.senderItemId}: the receiver is not a known sandbox account`;
    return null;
  }

  async #send(body: FairSplitPayoutBatch, ctx: PostContext): Promise<BatchOutcome> {
    let attempts = 0;
    let authRetried = false;
    let lastStatus: number | null = null;
    let lastDebugId: string | null = null;
    for (let retry = 0; ; ) {
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
          await this.#repo.markPosted({
            senderBatchId: ctx.senderBatchId,
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
        if (result.status === 401 && this.#auth && !authRetried) {
          this.#auth.invalidate();
          authRetried = true;
          continue;
        }
        if (isDuplicateBatchError(result)) return this.#adopt(result, ctx, attempts);
        if (result.status === 429) {
          return refused(
            "CIRCUIT_OPEN",
            "PayPal's sandbox is pacing us; no batch was created",
            ctx.senderBatchId,
          );
        }
        if (result.status === 401) {
          return {
            kind: "unresolved",
            senderBatchId: ctx.senderBatchId,
            attempts,
            lastStatus,
            debugId: lastDebugId,
          };
        }
        if (!isRetryable(result)) {
          await this.#repo.markRejected({
            senderBatchId: ctx.senderBatchId,
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
      if (delay === undefined) {
        return {
          kind: "unresolved",
          senderBatchId: ctx.senderBatchId,
          attempts,
          lastStatus,
          debugId: lastDebugId,
        };
      }
      await this.#sleep(delay);
      retry += 1;
    }
  }

  /** "Already exists": follow the link to the original batch and adopt it only if it is the approved one. */
  async #adopt(result: Failure, ctx: PostContext, attempts: number): Promise<BatchOutcome> {
    const fail = (reason: string) => refused("ADOPT_FAILED", reason, ctx.senderBatchId);
    const payoutBatchId = linkedBatchId(result);
    if (!payoutBatchId) return fail("PayPal says the batch exists but gave no link to it");

    const items: PayoutItemResponse[] = [];
    let header: PayoutBatchHeader | undefined;
    let debugId: string | null = null;
    for (let page = 1; page <= MAX_ADOPT_PAGES; page++) {
      const got = await getPayoutBatch(
        this.#http,
        CONTEXT,
        { payout_batch_id: payoutBatchId, page, page_size: ADOPT_PAGE_SIZE, total_required: true },
        { priority: this.#priority },
      );
      if (!got.ok) return fail(`GET of the existing batch failed (${got.status} ${got.name})`);
      header ??= got.body.batch_header;
      debugId = got.debugId;
      const pageItems = got.body.items ?? [];
      items.push(...pageItems);
      const totalPages = got.body.total_pages ?? 1;
      if (page >= totalPages || pageItems.length < ADOPT_PAGE_SIZE) break;
    }
    if (header?.sender_batch_header?.sender_batch_id !== ctx.senderBatchId) {
      return fail("The linked batch carries another sender_batch_id");
    }

    let verifiedBy: "items" | "header";
    if (items.length > 0) {
      const specs: PayoutItemSpec[] = [];
      for (const it of items) {
        const amountCents = readValueCents(it.payout_item?.amount?.value);
        const senderItemId = it.payout_item?.sender_item_id;
        if (amountCents === null || !senderItemId || it.payout_item?.amount?.currency !== "USD") {
          return fail("The existing batch has an item we cannot read");
        }
        specs.push({ senderItemId, receiver: it.payout_item.receiver, amountCents, currency: "USD" });
      }
      specs.sort((a, b) => (a.senderItemId < b.senderItemId ? -1 : a.senderItemId > b.senderItemId ? 1 : 0));
      if ((await this.#digest(ctx.run, specs)) !== ctx.digest) {
        return fail("The existing batch differs from the approved digest");
      }
      verifiedBy = "items";
    } else {
      const total = readValueCents(header?.amount?.value);
      if (total === null || header?.amount?.currency !== "USD" || total !== ctx.totalCents) {
        return fail("The existing batch lists no items yet and its total cannot be matched");
      }
      verifiedBy = "header";
    }

    await this.#repo.markPosted({
      senderBatchId: ctx.senderBatchId,
      payoutBatchId,
      batchStatus: header.batch_status ?? null,
      outcome: "adopted",
      debugId,
    });
    return {
      kind: "adopted",
      senderBatchId: ctx.senderBatchId,
      payoutBatchId,
      batchStatus: header.batch_status ?? null,
      batchSha256: ctx.digest,
      requestId: ctx.requestId,
      debugId,
      attempts,
      verifiedBy,
    };
  }

  /**
   * Cancels an UNCLAIMED item (Rhea's case, C-07): cancel_requested_at first, then the POST. A 400
   * ("Only items in Unclaimed status can be cancelled.") is checked with a fresh GET.
   */
  async cancelUnclaimed(
    payoutItemId: string,
    options: { intent?: CancelIntent; by?: string; priority?: CallPriority } = {},
  ): Promise<CancelOutcome> {
    const intent = options.intent ?? "cash";
    const priority = options.priority ?? this.#priority;
    if (await this.#killSwitch()) return { kind: "REFUSED", payoutItemId, code: "KILL_SWITCH_ON" };
    if (!PAYOUT_ITEM_ID_REGEX.test(payoutItemId))
      return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
    const row = await this.#repo.findItem(payoutItemId);
    if (!row) return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
    if (row.status === "RETURNED" && row.cancelRequestedAt) {
      return { kind: "RETURNED", payoutItemId, intent: row.cancelIntent ?? intent, debugId: null };
    }
    if (row.status !== "UNCLAIMED")
      return { kind: "NOT_UNCLAIMED", payoutItemId, status: row.status, debugId: null };

    await this.#repo.markCancelRequested({
      payoutItemId,
      intent,
      requestedAt: this.#now().toISOString(),
      by: options.by ?? null,
    });

    let attempts = 0;
    let authRetried = false;
    let lastStatus: number | null = null;
    for (let retry = 0; ; ) {
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
          ? { kind: "RETURNED", payoutItemId, intent, debugId: result.debugId }
          : { kind: "NOT_UNCLAIMED", payoutItemId, status, debugId: result.debugId };
      }
      if (result) {
        lastStatus = result.status;
        if (result.status === 401 && this.#auth && !authRetried) {
          this.#auth.invalidate();
          authRetried = true;
          continue;
        }
        if (result.status === 404) return { kind: "REFUSED", payoutItemId, code: "UNKNOWN_ITEM" };
        if (result.status === 400 || result.status === 422)
          return this.#checkItem(payoutItemId, intent, priority, result);
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
      if (delay === undefined) return { kind: "UNRESOLVED", payoutItemId, attempts, lastStatus };
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
