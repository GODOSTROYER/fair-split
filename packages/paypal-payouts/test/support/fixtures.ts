// Response bodies shaped after PayPal's Payouts v1 API reference (paypal-rest-api-specifications,
// openapi/payments_payouts_batch_v1.json: payout, payout_batch, payout_item, error) and the
// duplicate-batch body PR #107 captured in the sandbox. Receivers are sandbox aliases.
//
// TEMPORARY: the eight PayPal-rail lines below mirror register §2 until the IC-03 seed snapshot
// lands; then read them from packages/seed/snapshot/season-2026A.json.

import { createHash } from "node:crypto";
import {
  type ApprovedLine,
  batchNote,
  type PayoutItemRow,
  type PayoutRunFacts,
  type PostingSnapshot,
  type SignedApproval,
  senderBatchId,
  senderItemId,
} from "../../src/index.js";
import { approve, CHAIR, type TestSigner, TREASURER } from "./approvals.js";
import { referenceBatchDigest } from "./digest.js";
import { SANDBOX } from "./msw.js";

/** The service's clock in every test: approvals below expire 10 minutes after it. */
export const NOW = new Date("2026-11-05T02:10:00.000Z");
export const EXP = new Date(NOW.getTime() + 10 * 60_000).toISOString();

/** Computed, never typed (register §2). */
export const RATE_CARD_SHA256 = createHash("sha256").update("BR 2026-04 fixture card").digest("hex");

const line = (memberNo: string, cents: bigint, receiver?: string): ApprovedLine => ({
  lineId: `line-${memberNo}`,
  memberNo,
  receiver: receiver ?? `${memberNo.toLowerCase().replace("-", "")}@example.test`,
  amountCents: cents,
  currency: "USD",
});

/** Register §2: 8 items, US$368.39. M-031 (Rhea) has no PayPal account: her item goes UNCLAIMED. */
export const HERO_LINES: ApprovedLine[] = [
  line("M-014", 6_445n),
  line("M-007", 6_271n),
  line("M-060", 5_596n),
  line("M-018", 5_563n),
  line("M-039", 3_832n),
  line("M-022", 3_440n),
  line("M-002", 3_027n),
  line("M-031", 2_665n, "rhea.no-account@example.test"),
];

export const RUN_BASE = {
  runId: "0199f6a0-0000-7000-8000-000000000037",
  runSeq: 37,
  seasonCode: "2026-A",
  rateCardSha256: RATE_CARD_SHA256,
} as const;

/** Run facts as the database holds them; R5 thresholds from BR 2026-04 (register §2). */
export const RUN_FACTS: PayoutRunFacts = {
  ...RUN_BASE,
  seasonId: "0199f6a0-0000-7000-8000-00000002026a",
  cosign: { ruleId: "R5", batchOverCents: 30_000, lineOverCents: 15_000, anyOverride: true },
};

export const HERO_SENDER_BATCH_ID = senderBatchId(RUN_BASE);

/** A run's own ids (the hero run, r37, unless a test posts another run of the season). */
export interface RunIds {
  runId: string;
  runSeq: number;
}

/** The digest the treasurer and the Chair sign for a set of lines (reference IC-02). */
export async function digestFor(
  lines: readonly ApprovedLine[],
  rerouteNo?: number,
  run: RunIds = RUN_BASE,
): Promise<string> {
  const sbid = senderBatchId({ ...RUN_BASE, ...run, rerouteNo });
  const items = lines.map((l) => ({
    senderItemId: senderItemId({ runSeq: run.runSeq, memberNo: l.memberNo, rerouteNo }),
    receiver: l.receiver,
    amountCents: l.amountCents,
    currency: l.currency,
  }));
  return referenceBatchDigest(
    { runId: run.runId, senderBatchId: sbid, rateCardSha256: RATE_CARD_SHA256 },
    items,
  );
}

/** Signed approvals of exactly these lines (the treasurer and, by default, the Chair). */
export async function approvalsFor(
  lines: readonly ApprovedLine[] = HERO_LINES,
  options: { signers?: readonly TestSigner[]; rerouteNo?: number; exp?: string; run?: RunIds } = {},
): Promise<SignedApproval[]> {
  const batch = {
    runId: options.run?.runId ?? RUN_FACTS.runId,
    seasonId: RUN_FACTS.seasonId,
    rateCardSha256: RUN_FACTS.rateCardSha256,
    batchSha256: await digestFor(lines, options.rerouteNo, options.run),
    itemCount: lines.length,
    totalCents: Number(lines.reduce((s, l) => s + l.amountCents, 0n)),
  };
  return (options.signers ?? [TREASURER, CHAIR]).map((signer) =>
    approve(signer, batch, { exp: options.exp ?? EXP }),
  );
}

/** The database's view of an APPROVED run: what executeApproved re-reads before the POST. */
export async function postingSnapshot(
  lines: readonly ApprovedLine[] = HERO_LINES,
  extra: Partial<PostingSnapshot> = {},
): Promise<PostingSnapshot> {
  return {
    ...RUN_FACTS,
    lines,
    approvals: extra.approvals ?? (await approvalsFor(lines)),
    overrides: 0,
    submitted: null,
    ...extra,
  };
}

export const PAYOUT_BATCH_ID = "5UXD2E8A7EBQJ";

/** 201 Created (`payout`). */
export const created = (sbid = HERO_SENDER_BATCH_ID, note?: string) => ({
  batch_header: {
    sender_batch_header: { sender_batch_id: sbid, recipient_type: "EMAIL", ...(note ? { note } : {}) },
    payout_batch_id: PAYOUT_BATCH_ID,
    batch_status: "PENDING",
  },
  links: [
    {
      href: `${SANDBOX}/v1/payments/payouts/${PAYOUT_BATCH_ID}`,
      rel: "self",
      method: "GET",
      encType: "application/json",
    },
  ],
});

/** 400 for a reused sender_batch_id (PR #107 sandbox capture; plutov/paypal v2.0.5 fixture). */
export const duplicateBatch = (batchId = PAYOUT_BATCH_ID, withLink = true) => ({
  name: "USER_BUSINESS_ERROR",
  message: "User business error.",
  debug_id: "f05063556a338",
  information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  details: [
    {
      field: "SENDER_BATCH_ID",
      location: "body",
      issue: "Batch with given sender_batch_id already exists",
      ...(withLink
        ? {
            link: [
              {
                href: `https://api.sandbox.paypal.com/v1/payments/payouts/${batchId}`,
                rel: "self",
                method: "GET",
              },
            ],
          }
        : {}),
    },
  ],
});

export const paypalError = (name: string, message: string, debugId = "a1b2c3d4e5f60") => ({
  name,
  message,
  debug_id: debugId,
  information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
  links: [],
});

const itemId = (memberNo: string) => `ITEM${memberNo.replace("-", "")}AB12CD`;

/** 200 GET (`payout_batch`) for a batch whose items are the given lines. */
export function batchBody(
  lines: readonly ApprovedLine[],
  opts: {
    sbid?: string;
    status?: string;
    listItems?: boolean;
    runSeq?: number;
    rerouteNo?: number;
    digest?: string;
  } = {},
) {
  const total = lines.reduce((s, l) => s + l.amountCents, 0n);
  const value = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
  const sbid = opts.sbid ?? HERO_SENDER_BATCH_ID;
  return {
    total_items: opts.listItems === false ? 0 : lines.length,
    total_pages: 1,
    batch_header: {
      payout_batch_id: PAYOUT_BATCH_ID,
      batch_status: opts.status ?? "PENDING",
      time_created: "2026-11-05T02:10:00Z",
      sender_batch_header: {
        sender_batch_id: sbid,
        ...(opts.digest ? { note: batchNote("2026-A", opts.digest) } : {}),
      },
      amount: { currency: "USD", value: value(total) },
      fees: { currency: "USD", value: "0.00" },
    },
    items:
      opts.listItems === false
        ? []
        : lines.map((l) => ({
            payout_item_id: itemId(l.memberNo),
            transaction_status: "PENDING",
            payout_item_fee: { currency: "USD", value: "0.25" },
            payout_batch_id: PAYOUT_BATCH_ID,
            payout_item: {
              recipient_type: "EMAIL",
              amount: { currency: "USD", value: value(l.amountCents) },
              receiver: l.receiver,
              sender_item_id: senderItemId({
                runSeq: opts.runSeq ?? RUN_BASE.runSeq,
                memberNo: l.memberNo,
                rerouteNo: opts.rerouteNo,
              }),
              purpose: "GOODS",
            },
            links: [
              {
                href: `${SANDBOX}/v1/payments/payouts-item/${itemId(l.memberNo)}`,
                rel: "item",
                method: "GET",
              },
            ],
          })),
    links: [
      {
        href: `${SANDBOX}/v1/payments/payouts/${PAYOUT_BATCH_ID}?page_size=1000&page=1`,
        rel: "self",
        method: "GET",
      },
    ],
  };
}

export const RHEA_ITEM_ID = "8AELMXH8UB2P8";

/** 200 GET payouts-item / 200 cancel (`payout_item`). */
export function itemBody(status: string, id = RHEA_ITEM_ID) {
  return {
    payout_item_id: id,
    transaction_id: "4T328230B1D337285",
    transaction_status: status,
    payout_item_fee: { currency: "USD", value: "0.00" },
    payout_batch_id: PAYOUT_BATCH_ID,
    sender_batch_id: HERO_SENDER_BATCH_ID,
    payout_item: {
      recipient_type: "EMAIL",
      amount: { currency: "USD", value: "26.65" },
      receiver: "rhea.no-account@example.test",
      sender_item_id: "r37-M-031",
    },
    time_processed: "2026-11-05T02:11:43Z",
    ...(status === "UNCLAIMED"
      ? {
          errors: {
            name: "RECEIVER_UNREGISTERED",
            message: "Receiver is unregistered",
            information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
          },
        }
      : {}),
    links: [{ href: `${SANDBOX}/v1/payments/payouts-item/${id}`, rel: "item", method: "GET" }],
  };
}

export function rheaRow(status: string, extra: Partial<PayoutItemRow> = {}): PayoutItemRow {
  return {
    payoutItemId: RHEA_ITEM_ID,
    senderItemId: "r37-M-031",
    runId: RUN_BASE.runId,
    lineId: "line-M-031",
    memberNo: "M-031",
    receiver: "rhea.no-account@example.test",
    amountCents: 2_665n,
    status,
    cancelRequestedAt: null,
    cancelIntent: null,
    ...extra,
  };
}
