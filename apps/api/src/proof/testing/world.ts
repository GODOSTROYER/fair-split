// Test world for the Proof slice: the seed's canonical showcase run (2026A-r37, SETTLED) written into Postgres
// the way the judge clone and the runs slice write it, so every Proof, statement, print and /ops test runs on
// the register's real figures (IC-03: no figure is typed here; every one comes from @fairsplit/seed).
//
//   keys: "seeded"  the snapshot as is: seeded officer keys, seeded chain → Proof reads "Sample" (demo mode)
//   keys: "app"     the same run re-signed by two registered app keys (device_keys + key.registered in a rebuilt
//                   chain) → with FS_LEDGER_SIGNING_KEY set, the Proof reads "Verified"
//
// Conventions this world writes (and the slice reads), reported to the line writers:
//   member_lines.deductions  the engine's LineDeduction[]
//   member_lines.trace       { v: 1, canonical: LineCanonical, credits: LineCredit[], lines: string[] }
//   members.honorific        JSON {"ceb","fil","en"} of the registry's honorifics
//   device_keys.persona      the approver id (`treasurer:analyn`), as in the key.registered ledger payload
import {
  type ApprovalPayload,
  type EngineLine,
  type Json,
  type LedgerEntry,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type SignedApproval,
} from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import {
  approvalBytes,
  buildLedger,
  type Ed25519KeyPair,
  ed25519FromSeed,
  ed25519Sign,
  jcs,
  type LedgerFact,
  lineCanonical,
  sha256Hex,
} from "@fairsplit/domain";
import {
  getComputation,
  getHolds,
  getMembers,
  getPhotos,
  getProof,
  getRateCard,
  getRun,
  getSeason,
  getSlips,
} from "@fairsplit/seed";
import { storedPublicKeyOf } from "../keys.js";

export interface ShowcaseOptions {
  keys?: "seeded" | "app";
  kind?: "showcase" | "judge" | "real";
  expiresAt?: Date | null;
}

export interface AppKey extends Ed25519KeyPair {
  keyId: string;
  approverId: string;
}

export interface ShowcaseWorld {
  workspaceId: string;
  runId: string;
  runSlug: string;
  seasonId: string;
  rateCardSha256: string;
  memberIds: Map<string, string>;
  lineIds: Map<string, string>;
  batchId: string;
  ledger: LedgerEntry[];
  /** App mode only: the officers' registered keys. */
  appKeys: { treasurer: AppKey; chair: AppKey } | null;
}

const CASH_DAY_AT = (cashDay: string) => new Date(`${cashDay}T01:00:00.000Z`);

export function appKey(keyId: string, approverId: string): AppKey {
  return { keyId, approverId, ...ed25519FromSeed(sha256Hex(`proof test app key ${keyId}`)) };
}

/** Writes the showcase run into `db` (a fresh test database: the snapshot's own ids are used). */
export async function loadShowcase(db: Db, opts: ShowcaseOptions = {}): Promise<ShowcaseWorld> {
  const season = getSeason();
  const card = getRateCard();
  const run = getRun();
  const proof = getProof();
  const members = getMembers();
  const lines = getComputation("resolved").lines;
  const engineHolds = getComputation("resolved").holds;

  const [ws] = await db
    .insert(schema.workspaces)
    .values({ kind: opts.kind ?? "showcase", name: "Showcase 2026-A", expiresAt: opts.expiresAt ?? null })
    .returning({ id: schema.workspaces.id });
  const workspaceId = must(ws).id;

  await db.insert(schema.coops).values({
    id: season.coop.id,
    workspaceId,
    name: season.coop.name,
    region: season.coop.region,
    provenance: "seeded",
  });
  const rules = card.canonical.rules;
  await db.insert(schema.seasons).values({
    id: season.id,
    workspaceId,
    coopId: season.coop.id,
    code: season.code,
    label: season.label,
    opensOn: season.opensOn,
    closesOn: season.closesOn,
    currency: "USD",
    cosignBatchCents: BigInt(rules.cosign.batchOverCents),
    cosignLineCents: BigInt(rules.cosign.lineOverCents),
    massBalanceTolBp: rules.tolerances.massBalanceTolBp,
    kgPerTreeMaxG: rules.tolerances.kgPerTreeMaxG,
    autoAcceptBp: rules.tolerances.autoAcceptBp,
    provenance: "seeded",
  });
  await db.insert(schema.lots).values({
    id: season.lot.id,
    workspaceId,
    seasonId: season.id,
    lotCode: season.lot.lotCode,
    sacks: season.lot.sacks,
    shippedG: BigInt(season.lot.shippedG),
    grade1ShippedG: BigInt(season.lot.grade1ShippedG),
    shippedOn: season.lot.shippedOn,
    provenance: "seeded",
  });
  const canonicalJcs = jcs(card.canonical);
  await db.insert(schema.rateCards).values({
    id: card.id,
    workspaceId,
    seasonId: season.id,
    code: card.canonical.resolutionNo,
    canonicalJcs,
    sha256: sha256Hex(canonicalJcs),
    ratifiedAt: new Date(card.ratifiedAt),
    provenance: "seeded",
  });

  await db.insert(schema.members).values(
    members.map((m) => ({
      id: m.id,
      workspaceId,
      coopId: season.coop.id,
      memberNo: m.memberNo,
      displayName: m.displayName,
      honorific: JSON.stringify(m.addressAs),
      lang: m.lang,
      receiverRef: m.rail === "PAYPAL" ? m.memberNo : null,
      provenance: "seeded" as const,
    })),
  );
  const memberIds = new Map(members.map((m) => [m.memberNo, m.id]));
  await db.insert(schema.memberships).values([
    { workspaceId, persona: "analyn", role: "treasurer" as const },
    { workspaceId, persona: "ernesto", role: "board" as const },
    { workspaceId, persona: "jessie", role: "clerk" as const },
    { workspaceId, persona: "dana", role: "brand" as const },
  ]);

  const photos = getPhotos();
  await db.insert(schema.documents).values(
    photos.map((p) => ({
      id: p.documentId,
      workspaceId,
      seasonId: season.id,
      kind: "slip_photo" as const,
      sha256: p.manifestSha256,
      storage: "static" as const,
      path: `photos/${p.photoId}.webp`,
      byteSize: 0,
      mime: "image/webp",
      photoCode: p.photoId,
      capturedAt: new Date(`${p.capturedOn}T08:00:00.000Z`),
      provenance: "seeded" as const,
    })),
  );
  const slips = getSlips();
  for (let i = 0; i < slips.length; i += 100) {
    await db.insert(schema.slipRows).values(
      slips.slice(i, i + 100).map((s) => ({
        id: s.rowId,
        workspaceId,
        seasonId: season.id,
        documentId: s.documentId,
        serial: s.serial,
        rowNo: 1,
        memberId: memberIds.get(s.memberNo) ?? null,
        slipDate: s.slipDate,
        grossG: BigInt(s.grossG),
        tareG: BigInt(s.tareG),
        netG: BigInt(s.payableG),
        grade: s.grade,
        minConfidence: 0.97,
        state: "AUTO_ACCEPTED" as const,
        copyColor: s.copy,
        provenance: "seeded" as const,
      })),
    );
  }

  await db.insert(schema.payRuns).values({
    id: run.id,
    workspaceId,
    seasonId: season.id,
    lotId: season.lot.id,
    rateCardId: card.id,
    seasonCode: season.code,
    runSeq: run.runSeq,
    state: run.state,
    currency: "USD",
    fxNum: BigInt(run.fx.centavosPerCent.num),
    fxDen: BigInt(run.fx.centavosPerCent.den),
    fxSource: run.fx.source,
    quoteSha256: run.quoteSha256,
    rateCardSha256: card.sha256,
    batchSha256: run.batchSha256,
    senderBatchId: run.senderBatchId,
    provenance: "seeded",
  });
  await db.insert(schema.invoices).values({
    workspaceId,
    runId: run.id,
    paypalInvoiceId: "INV2-SEED-R37",
    invoiceNumber: run.invoice.invoiceNumber,
    status: run.invoice.status,
    amountCents: BigInt(run.invoice.amountCents),
    dueCents: BigInt(run.invoice.dueCents),
    currency: "USD",
    autoCancelOn: run.invoice.autoCancelOn,
    provenance: run.invoice.provenance,
  });

  const lineRows = await db
    .insert(schema.memberLines)
    .values(
      lines.map((l) => lineRow(l, workspaceId, run.id, memberIds, card.sha256, run.lineStates[l.memberNo])),
    )
    .returning({ id: schema.memberLines.id, memberId: schema.memberLines.memberId });
  const memberNoById = new Map(members.map((m) => [m.id, m.memberNo]));
  const lineIds = new Map(lineRows.map((r) => [memberNoById.get(r.memberId) as string, r.id]));

  const holdRows = getHolds().map((h) => {
    const eh = engineHolds.find((e) => e.key === h.key);
    return {
      workspaceId,
      runId: run.id,
      lineId: h.memberNo ? (lineIds.get(h.memberNo) ?? null) : null,
      code: h.label,
      kind: h.kind,
      gate: h.gate,
      state: "RESOLVED" as const,
      engineParams: eh?.params ?? {},
      claudeLine: h.claudeLine,
      evidence: { serials: h.serials },
      raisedBy: "engine",
      resolvedBy: h.resolvedBy,
      resolution: h.resolvedWith ? { kind: h.resolvedWith, by: h.resolvedBy, at: h.resolvedAt } : null,
      resolvedAt: h.resolvedAt ? new Date(h.resolvedAt) : null,
      provenance: "seeded" as const,
    };
  });
  await db.insert(schema.holds).values(holdRows);

  const appKeys =
    opts.keys === "app"
      ? {
          treasurer: appKey("fs-analyn-a1", "treasurer:analyn"),
          chair: appKey("fs-ernesto-a1", "board:ernesto"),
        }
      : null;
  const approvals: SignedApproval[] = appKeys
    ? run.approvals.map((a) => {
        const k = a.role === "treasurer" ? appKeys.treasurer : appKeys.chair;
        return {
          ...a,
          keyId: k.keyId,
          publicKeyHex: k.publicKeyHex,
          signatureHex: ed25519Sign(k.privateKey, approvalBytes(a.payload)),
        };
      })
    : run.approvals;
  if (appKeys) {
    await db.insert(schema.deviceKeys).values(
      [appKeys.treasurer, appKeys.chair].map((k) => ({
        workspaceId,
        keyId: k.keyId,
        persona: k.approverId,
        publicKey: storedPublicKeyOf(k.publicKeyHex),
        kind: "app" as const,
        platform: "android",
      })),
    );
  }
  await db
    .insert(schema.approvals)
    .values(approvals.map((a) => approvalRow(a, workspaceId, run.id, a.payload)));

  const [batch] = await db
    .insert(schema.payoutBatches)
    .values({
      workspaceId,
      runId: run.id,
      senderBatchId: run.senderBatchId,
      requestId: run.paypalRequestId,
      paypalBatchId: "SEEDBATCHR37",
      batchSha256: run.batchSha256,
      kind: "primary",
      status: "SUCCESS",
      itemCount: run.items.length,
      totalCents: BigInt(run.items.reduce((s, i) => s + i.amountCents, 0)),
      currency: "USD",
      submittedAt: new Date("2026-10-29T02:10:35.000Z"),
      provenance: "seeded",
    })
    .returning({ id: schema.payoutBatches.id });
  const batchId = must(batch).id;
  await db.insert(schema.payoutItems).values(
    run.items.map((it) => ({
      workspaceId,
      batchId,
      lineId: lineIds.get(it.memberNo) as string,
      senderItemId: it.senderItemId,
      payoutItemId: it.payoutItemId,
      receiver: it.receiver,
      amountCents: BigInt(it.amountCents),
      currency: "USD",
      status: it.status,
      statusRank: PAYOUT_ITEM_RANK[it.status as PayoutItemStatus],
      ...(it.status === "RETURNED"
        ? { cancelRequestedAt: new Date("2026-10-29T02:12:30.000Z"), cancelIntent: "cash" as const }
        : {}),
      provenance: "seeded" as const,
    })),
  );

  const ledger = appKeys ? rebuildLedgerWithAppKeys(proof.ledger, appKeys) : proof.ledger;
  await insertLedger(db, workspaceId, run.id, ledger);

  return {
    workspaceId,
    runId: run.id,
    runSlug: run.runSlug,
    seasonId: season.id,
    rateCardSha256: card.sha256,
    memberIds,
    lineIds,
    batchId,
    ledger,
    appKeys,
  };
}

function lineRow(
  l: EngineLine,
  workspaceId: string,
  runId: string,
  memberIds: Map<string, string>,
  rateCardSha256: string,
  state: string | undefined,
) {
  const { lineSha256, ...rest } = l;
  return {
    workspaceId,
    runId,
    memberId: memberIds.get(l.memberNo) as string,
    state: (state ?? "READY") as (typeof schema.memberLines.$inferInsert)["state"] & string,
    rail: l.rail === "PAYPAL" ? ("ON" as const) : ("OFF" as const),
    currency: "USD",
    verifiedG: BigInt(l.verifiedG),
    grade1G: BigInt(l.grade1G),
    premiumCents: BigInt(l.premiumCents),
    bonusCents: BigInt(l.bonusCents),
    deductionsCents: BigInt(l.deductionsCents),
    creditsCents: BigInt(l.creditsCents),
    netCents: BigInt(l.netCents),
    deductions: l.deductions,
    lineSha256,
    trace: {
      v: 1,
      canonical: lineCanonical(rest, rateCardSha256),
      credits: l.credits,
      lines: [],
    },
    provenance: "seeded" as const,
  };
}

function approvalRow(a: SignedApproval, workspaceId: string, runId: string, p: ApprovalPayload) {
  return {
    workspaceId,
    runId,
    role: a.role === "chair" ? ("board" as const) : ("treasurer" as const),
    decision: "SIGNED" as const,
    approverId: p.approverId,
    keyId: a.keyId,
    payloadJcs: jcs(p),
    signature: a.signatureHex,
    batchSha256: p.batchSha256,
    nonce: p.nonce,
    exp: new Date(p.exp),
    provenance: "seeded" as const,
  };
}

/** The seeded chain with its key registrations and approvals re-made for two registered app keys. */
export function rebuildLedgerWithAppKeys(
  seeded: readonly LedgerEntry[],
  keys: { treasurer: AppKey; chair: AppKey },
): LedgerEntry[] {
  const byApprover = new Map([
    [keys.treasurer.approverId, keys.treasurer],
    [keys.chair.approverId, keys.chair],
  ]);
  const facts: LedgerFact[] = seeded.map((e): LedgerFact => {
    const payload = e.payload as { [key: string]: Json };
    if (e.kind === "key.registered") {
      const k = byApprover.get(String(payload.persona)) as AppKey;
      const registered: Json = {
        keyId: k.keyId,
        persona: k.approverId,
        kind: "app",
        publicKeyHex: k.publicKeyHex,
      };
      return { ...fact(e), payload: registered };
    }
    if (e.kind === "approval.signed") {
      const k = byApprover.get(String(payload.approverId)) as AppKey;
      const signed: Json = { ...payload, keyId: k.keyId };
      return { ...fact(e), payload: signed };
    }
    return fact(e);
  });
  return buildLedger(facts);
}

function fact(e: LedgerEntry): LedgerFact {
  return {
    kind: e.kind,
    actorKind: e.actorKind,
    actorId: e.actorId,
    impersonatedBy: e.impersonatedBy,
    payload: e.payload,
    at: e.at,
  };
}

const RUN_KINDS = new Set([
  "invoice.funded",
  "lines.computed",
  "approval.signed",
  "payout.submitting",
  "payout.cancel",
  "webhook.applied",
  "hold.resolved",
  "field.entered",
]);

/** Appends entries verbatim (the link trigger re-checks seq and prev_hash; the hashes are the chain's own). */
export async function insertLedger(
  db: Db,
  workspaceId: string,
  runId: string,
  entries: readonly LedgerEntry[],
): Promise<void> {
  for (const e of entries) {
    await db.insert(schema.ledgerEntries).values({
      workspaceId,
      seq: e.seq,
      kind: e.kind,
      actorKind: e.actorKind,
      actorId: e.actorId,
      impersonatedBy: e.impersonatedBy,
      payload: e.payload as Record<string, unknown>,
      at: new Date(e.at),
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      runId: RUN_KINDS.has(e.kind) ? runId : null,
    });
  }
}

/** Cash receipts for some cash lines (the clerk's "Nadawat" attestations). */
export async function attestCash(
  db: Db,
  w: ShowcaseWorld,
  memberNos: readonly string[],
  at = CASH_DAY_AT(getRun().cashDay),
): Promise<void> {
  const lines = getComputation("resolved").lines;
  for (const no of memberNos) {
    const l = lines.find((x) => x.memberNo === no);
    if (!l) throw new Error(`no line for ${no}`);
    await db.insert(schema.cashReceipts).values({
      workspaceId: w.workspaceId,
      lineId: w.lineIds.get(no) as string,
      amountCents: BigInt(l.netCents),
      currency: "USD",
      paidAt: at,
      attestedBy: "clerk:jessie",
      provenance: "seeded",
    });
  }
}

/** The value, or an error naming what was missing (tests use it instead of non-null assertions). */
export function must<T>(v: T | undefined | null, what = "value"): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}
