// An honest Proof bundle whose ledger follows the contract (S3.12): what the seed and the API write.
import type {
  LedgerPayload,
  ProofBundle,
  ProofLedgerKind,
  ProofTrust,
  SignedApproval,
} from "@fairsplit/contracts";
import { approvalBytes, buildApprovalPayload } from "../approval.js";
import {
  batchDigest,
  batchNote,
  invoiceNumber,
  invoiceReference,
  senderBatchId,
  senderItemId,
} from "../batch.js";
import { sha256Hex } from "../canon.js";
import { buildLedger, type LedgerFact, signCheckpoint } from "../chain.js";
import { computeLines, lineCanonical, linesRootSha256 } from "../engine.js";
import { quoteInvoice } from "../quote.js";
import { ed25519FromSeed, ed25519Sign } from "../sig.js";
import { input, member, row, TEST_LOT, testCard } from "./world.js";

export const PROOF_KEYS = {
  treasurer: ed25519FromSeed(sha256Hex("proof fixture key treasurer")),
  chair: ed25519FromSeed(sha256Hex("proof fixture key chair")),
};
export const APPROVERS = { treasurer: "treasurer:analyn", chair: "board:ernesto" } as const;
export const KEY_IDS = { treasurer: "fs-analyn-a1", chair: "fs-ernesto-a1" } as const;
/** The server's ledger key: it signs each Proof's checkpoint; verifiers pin its public key. */
export const LEDGER_KEY = {
  keyId: "fs-ledger-k1",
  ...ed25519FromSeed(sha256Hex("proof fixture ledger key")),
};

/** What the app publishes at /.well-known/fairsplit-keys.json: the verifier's only trust anchors. */
export const PROOF_TRUST: ProofTrust = {
  officers: (["treasurer", "chair"] as const).map((role) => ({
    keyId: KEY_IDS[role],
    approverId: APPROVERS[role],
    role,
    publicKeyHex: PROOF_KEYS[role].publicKeyHex,
    kind: "app" as const,
    revokedAt: null,
  })),
  ledger: [
    { keyId: LEDGER_KEY.keyId, publicKeyHex: LEDGER_KEY.publicKeyHex, kind: "server", revokedAt: null },
  ],
};

/** Signs a checkpoint over the bundle's current ledger head (what the server does when it serves Proof). */
export function withCheckpoint(
  p: Omit<ProofBundle, "checkpoint">,
  key: { keyId: string; privateKey: typeof LEDGER_KEY.privateKey } = LEDGER_KEY,
  runId = p.runId,
  at = T("02:14:00"),
): ProofBundle {
  return { ...p, checkpoint: signCheckpoint(p.ledger, runId, key, at) };
}

export function fact<K extends ProofLedgerKind>(
  kind: K,
  payload: LedgerPayload<K>,
  at: string,
  actor: Pick<LedgerFact, "actorKind" | "actorId"> = { actorKind: "system", actorId: "fs-api" },
): LedgerFact {
  return { kind, actorKind: actor.actorKind, actorId: actor.actorId, impersonatedBy: null, payload, at };
}

export const T = (hms: string) => `2026-10-29T${hms}.000Z`;

/** Three members (two on PayPal), no holds, both approvals, one item paid and one returned to cash. */
export function honestProof(): ProofBundle {
  const card = testCard();
  const members = [member("M-001", { rail: "PAYPAL" }), member("M-002", { rail: "PAYPAL" }), member("M-003")];
  const rows = [
    row("M-001", 400, { serial: "0301", slipDate: "2026-04-02" }),
    row("M-002", 350, { serial: "0302", slipDate: "2026-04-03" }),
    row("M-003", 250, { serial: "0303", slipDate: "2026-04-04" }),
  ];
  const out = computeLines(input(members, rows));
  const quote = quoteInvoice(card, TEST_LOT);
  const runId = "run-1";
  const slug = "2026A-r1";
  const sbid = senderBatchId("2026A", card.sha256, 1);
  const onRail = out.lines.filter((l) => l.rail === "PAYPAL" && l.state === "READY");
  const digest = batchDigest(
    { runId, senderBatchId: sbid, rateCardSha256: card.sha256 },
    onRail.map((l) => ({
      senderItemId: senderItemId(1, l.memberNo),
      receiver: `${l.memberNo.toLowerCase()}@sandbox.example`,
      amountCents: l.netCents,
      currency: "USD" as const,
    })),
  );
  const note = batchNote("2026-A", digest.batchSha256);
  const signedAt = { treasurer: T("02:09:00"), chair: T("02:10:00") };
  const approvals: SignedApproval[] = (["treasurer", "chair"] as const).map((role) => {
    const payload = buildApprovalPayload({
      runId,
      seasonId: "season-1",
      rateCardSha256: card.sha256,
      batch: digest,
      role,
      approverId: APPROVERS[role],
      nonce: `nonce-${role}-0001`,
      exp: new Date(Date.parse(signedAt[role]) + 30 * 60 * 1000).toISOString(),
    });
    return {
      role,
      keyId: KEY_IDS[role],
      publicKeyHex: PROOF_KEYS[role].publicKeyHex,
      payload,
      signatureHex: ed25519Sign(PROOF_KEYS[role].privateKey, approvalBytes(payload)),
    };
  });
  const docs = rows.map((r) => ({ documentId: r.documentId, sha256: sha256Hex(`image ${r.documentId}`) }));
  const reference = invoiceReference(card.sha256);
  const invoice = {
    invoiceNumber: invoiceNumber(slug),
    status: "MARKED_AS_PAID" as const,
    amountCents: quote.totalCents,
    dueCents: 0,
    reference,
  };
  const [paidItem, parkedItem] = digest.items as [(typeof digest.items)[0], (typeof digest.items)[0]];
  const ledger = buildLedger([
    fact(
      "rate_card.ratified",
      { rateCardSha256: card.sha256, resolutionNo: card.canonical.resolutionNo, ratifiedAt: card.ratifiedAt },
      card.ratifiedAt,
      { actorKind: "human", actorId: "board:ernesto" },
    ),
    ...(["treasurer", "chair"] as const).map((role) =>
      fact(
        "key.registered",
        {
          keyId: KEY_IDS[role],
          persona: APPROVERS[role],
          kind: "app",
          publicKeyHex: PROOF_KEYS[role].publicKeyHex,
        },
        "2026-10-01T00:00:00.000Z",
      ),
    ),
    fact("invoice.funded", { runId, ...invoice }, T("01:59:00")),
    ...rows.map((r, i) =>
      fact(
        "rows.accepted",
        {
          documentId: r.documentId,
          photoId: null,
          sha256: docs[i]?.sha256 as string,
          serials: [r.serial],
          slipDates: [r.slipDate],
          provenance: "live",
        },
        T("02:00:00"),
        { actorKind: "engine", actorId: "engine v1" },
      ),
    ),
    fact(
      "lines.computed",
      {
        runId,
        engine: "engine v1",
        rateCardSha256: card.sha256,
        lineCount: out.lines.length,
        linesRootSha256: linesRootSha256(out.lines),
        premiumPoolCents: quote.premiumPoolCents,
        bonusPoolCents: quote.bonusPoolCents,
        netCents: out.conservation.netCents,
        onRailNetCents: out.conservation.onRailNetCents,
        balanced: out.conservation.balanced,
      },
      T("02:05:00"),
      { actorKind: "engine", actorId: "engine v1" },
    ),
    ...approvals.map((a) =>
      fact(
        "approval.signed",
        {
          runId,
          role: a.role,
          keyId: a.keyId,
          approverId: a.payload.approverId,
          batchSha256: a.payload.batchSha256,
          nonce: a.payload.nonce,
        },
        signedAt[a.role],
        { actorKind: "human", actorId: a.payload.approverId },
      ),
    ),
    fact(
      "payout.submitting",
      {
        runId,
        senderBatchId: sbid,
        batchSha256: digest.batchSha256,
        itemCount: 2,
        totalCents: digest.totalCents,
        note,
      },
      T("02:11:00"),
    ),
    fact(
      "webhook.applied",
      {
        resource: "payout_item",
        eventId: "WH-1",
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        provenance: "live",
        senderItemId: paidItem.senderItemId,
        payoutItemId: "ITEM-1",
        status: "SUCCESS",
      },
      T("02:12:00"),
      { actorKind: "paypal", actorId: "paypal" },
    ),
    fact(
      "webhook.applied",
      {
        resource: "payout_item",
        eventId: "WH-2",
        eventType: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
        verified: "self",
        provenance: "live",
        senderItemId: parkedItem.senderItemId,
        payoutItemId: "ITEM-2",
        status: "UNCLAIMED",
      },
      T("02:12:30"),
      { actorKind: "paypal", actorId: "paypal" },
    ),
    fact(
      "payout.cancel",
      { senderItemId: parkedItem.senderItemId, payoutItemId: "ITEM-2", afterCancel: "cash" },
      T("02:13:00"),
      { actorKind: "human", actorId: APPROVERS.treasurer },
    ),
    fact(
      "webhook.applied",
      {
        resource: "payout_item",
        eventId: "WH-3",
        eventType: "PAYMENT.PAYOUTS-ITEM.CANCELED",
        verified: "self",
        provenance: "live",
        senderItemId: parkedItem.senderItemId,
        payoutItemId: "ITEM-2",
        status: "RETURNED",
      },
      T("02:13:30"),
      { actorKind: "paypal", actorId: "paypal" },
    ),
  ]);
  return withCheckpoint({
    v: 1,
    runId,
    runSlug: slug,
    invoice,
    rateCard: { canonical: card.canonical, sha256: card.sha256, ratifiedAt: card.ratifiedAt },
    firstSlipDate: "2026-04-02",
    documents: docs,
    pools: { premiumPoolCents: quote.premiumPoolCents, bonusPoolCents: quote.bonusPoolCents },
    lines: out.lines.map((l) => {
      const { lineSha256: h, ...rest } = l;
      return {
        memberNo: l.memberNo,
        rail: l.rail,
        premiumCents: l.premiumCents,
        bonusCents: l.bonusCents,
        deductionsCents: l.deductionsCents,
        creditsCents: l.creditsCents,
        netCents: l.netCents,
        canonical: lineCanonical(rest, card.sha256),
        lineSha256: h,
      };
    }),
    approvals,
    batch: {
      runId,
      senderBatchId: sbid,
      rateCardSha256: card.sha256,
      batchSha256: digest.batchSha256,
      note,
      items: [
        { ...paidItem, payoutItemId: "ITEM-1", status: "SUCCESS", eventId: "WH-1" },
        { ...parkedItem, payoutItemId: "ITEM-2", status: "RETURNED", eventId: "WH-3" },
      ],
    },
    ledger,
  });
}
