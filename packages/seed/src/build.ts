// Builds the season snapshot (IC-03) from the world: three engine checkpoints of the review, the
// five seed items (H1, H2, H3, slip 0462 by hand, the mass-balance dial), the hero run r37 with its
// invoice, batch, two signed approvals and end state, the figures, and a verifiable Proof bundle.
import {
  type EngineHold,
  type EngineInput,
  type EngineOutput,
  type LedgerEntry,
  type LedgerPayload,
  type MemberLineState,
  type PriorHold,
  type ProofBundle,
  type ProofLedgerKind,
  type PublishedKeys,
  type SeasonSnapshot,
  SeasonSnapshot as SeasonSnapshotSchema,
  type SignedApproval,
  type SnapshotHold,
  type SnapshotItem,
} from "@fairsplit/contracts";
import {
  approvalBytes,
  batchDigest,
  batchNote,
  buildApprovalPayload,
  buildLedger,
  computeLines,
  ed25519FromSeed,
  ed25519Sign,
  engineLine,
  format,
  invoiceMemo,
  invoiceNumber,
  invoiceReference,
  type LedgerFact,
  lineCanonical,
  linesDigest,
  linesRootSha256,
  overrideCount,
  paypalRequestId,
  publishedFees,
  quarantineNotice,
  quoteDigest,
  quoteInvoice,
  requiresChair,
  runSlug,
  senderBatchId,
  senderItemId,
  sha256Hex,
  signCheckpoint,
  uuidv7,
} from "@fairsplit/domain";
import {
  BY_HAND_SERIAL,
  COOP,
  DUPLICATE_SERIAL,
  FX,
  INJECTION_SERIAL,
  LOT,
  MULTA_SERIAL,
  OFFICERS,
  PAYER,
  RUN,
  SEASON,
  SEEDED_KEY_IDS,
  SEEDED_LEDGER_KEY_ID,
} from "./constants.js";
import { TEXT_LAYER } from "./ratecard.js";
import { buildWorld, engineInputs, type World } from "./world.js";

export const GENERATOR = { name: "@fairsplit/seed", version: "1" } as const;

const at = (time: string) => `${RUN.recordedOn}T${time}.000Z`;

/** The hero run's timeline on 29 Oct (UTC). */
export const TIMELINE = {
  invoiceSent: at("01:58:20"),
  funded: at("02:01:05"),
  readStart: at("02:01:30"),
  byHand: at("02:03:12"),
  h1: at("02:05:10"),
  h2: at("02:06:24"),
  h3: at("02:07:02"),
  computed: at("02:07:03"),
  treasurerSigned: at("02:09:00"),
  chairSigned: at("02:10:31"),
  posted: at("02:10:35"),
  unclaimed: at("02:11:20"),
  cancelled: at("02:12:30"),
  returned: at("02:12:44"),
  /** The Proof is served, and its ledger checkpoint signed, after the last item event. */
  proofServed: at("02:15:00"),
} as const;

/** Item webhooks: each member's SUCCEEDED (Rhea's goes UNCLAIMED). */
const ITEM_EVENT_TIMES = [
  "02:10:52",
  "02:11:04",
  "02:11:09",
  "02:11:15",
  "02:11:31",
  "02:11:46",
  "02:12:01",
  "02:13:47",
];

function priorOf(...outs: EngineOutput[]): PriorHold[] {
  const seen = new Map<string, PriorHold>();
  for (const out of outs) {
    for (const h of out.holds) {
      if (!seen.has(h.key)) seen.set(h.key, { key: h.key, kind: h.kind, gate: h.gate, memberNo: h.memberNo });
    }
  }
  return [...seen.values()];
}

function hold(out: EngineOutput, key: string): EngineHold {
  const h = out.holds.find((x) => x.key === key);
  if (!h) throw new Error(`hold ${key} missing`);
  return h;
}

/**
 * Seeded keys derive from public text, so anyone can sign with them: they carry seeded key IDs
 * (`fs-{persona}-s{n}`), are registered only in the seeded ledger as kind "seeded", and are never
 * written to `device_keys` or accepted by the API (I6).
 */
function seededKey(keyId: string) {
  return ed25519FromSeed(sha256Hex(`fair-split seeded demo key ${keyId} (public, synthetic)`));
}

/**
 * The keys a verifier pins for the seeded data, in the shape of /.well-known/fairsplit-keys.json.
 * Every one is a sample key derived from public text, so the seeded Proof reads "Sample" in demo
 * mode and fails outside it; it is never "Verified". The live app publishes its own keys.
 */
export function seededPublishedKeys(): PublishedKeys {
  const treasurer = OFFICERS.find((o) => o.role === "TREASURER");
  const chair = OFFICERS.find((o) => o.role === "CHAIR");
  if (!treasurer || !chair) throw new Error("officers missing");
  const officer = (role: "treasurer" | "chair", keyId: string, approverId: string) => ({
    keyId,
    approverId,
    role,
    publicKeyHex: seededKey(keyId).publicKeyHex,
    kind: "seeded" as const,
    revokedAt: null,
  });
  return {
    v: 1,
    officers: [
      officer("treasurer", SEEDED_KEY_IDS.treasurer, treasurer.persona),
      officer("chair", SEEDED_KEY_IDS.chair, chair.persona),
    ],
    ledger: [
      {
        keyId: SEEDED_LEDGER_KEY_ID,
        publicKeyHex: seededKey(SEEDED_LEDGER_KEY_ID).publicKeyHex,
        kind: "seeded",
        revokedAt: null,
      },
    ],
  };
}

/** A ledger fact whose payload is checked against the contract's shape for its kind. */
function proofFact<K extends ProofLedgerKind>(
  kind: K,
  payload: LedgerPayload<K>,
  at: string,
  actor: Pick<LedgerFact, "actorKind" | "actorId">,
): LedgerFact {
  return { kind, actorKind: actor.actorKind, actorId: actor.actorId, impersonatedBy: null, payload, at };
}

const idOf = (prefix: string, label: string) =>
  `${prefix}${sha256Hex(label)
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 9)
    .toUpperCase()}`;

export interface Built {
  snapshot: SeasonSnapshot;
  world: World;
}

export function buildSnapshot(): Built {
  const world = buildWorld();
  const { card } = world;
  const rules = card.canonical.rules;
  const ins = engineInputs(world);
  const fx = { ...FX.centavosPerCent };
  const base: Omit<EngineInput, "rows" | "resolutions" | "priorHolds"> = {
    card,
    lot: { ...LOT },
    fx,
    members: ins.members,
    nearDuplicates: [],
  };
  const treasurer = OFFICERS.find((o) => o.role === "TREASURER") as (typeof OFFICERS)[number];
  const chair = OFFICERS.find((o) => o.role === "CHAIR") as (typeof OFFICERS)[number];

  // ---------------- checkpoints
  const read = computeLines({ ...base, rows: ins.rowsAtRead, resolutions: [], priorHolds: [] });
  const byHand = computeLines({
    ...base,
    rows: ins.rowsAfterEntry,
    resolutions: [],
    priorHolds: priorOf(read),
  });
  const multaMark = world.slips
    .find((s) => s.serial === MULTA_SERIAL)
    ?.marks.find((m) => m.ruleId === "NO_MATCH");
  if (!multaMark) throw new Error("multa mark missing");
  const keys = {
    h1: `DUPLICATE_SLIP:${DUPLICATE_SERIAL}`,
    h2: "IMPLAUSIBLE_YIELD:M-053",
    h3: `NO_RULE:${multaMark.markId}`,
    byHand: `LOW_CONFIDENCE:${(world.slips.find((s) => s.serial === BY_HAND_SERIAL) as { rowId: string }).rowId}`,
    massBalance: "MASS_BALANCE:season",
  };
  const by = treasurer.persona;
  const resolved = computeLines({
    ...base,
    rows: ins.rowsAfterEntry,
    resolutions: [
      { holdKey: keys.h1, resolution: "COUNT_ONCE", by, at: TIMELINE.h1 },
      {
        holdKey: keys.h2,
        resolution: "REGISTER_PLOT",
        plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 },
        by,
        at: TIMELINE.h2,
      },
      { holdKey: keys.h3, resolution: "RETURN_AS_CREDIT", by, at: TIMELINE.h3 },
    ],
    priorHolds: priorOf(read, byHand),
  });

  // ---------------- the five seed items
  const memberOf = new Map(world.members.map((m) => [m.memberNo, m]));
  const ctx = {
    consoleName: (no: string) => memberOf.get(no)?.consoleName ?? no,
    buyerShortName: PAYER.shortName,
  };
  const h1 = hold(byHand, keys.h1);
  const byHandSlip = world.slips.find((s) => s.serial === BY_HAND_SERIAL) as World["slips"][number];
  const logLine = world.logbook[0]?.lines.find((l) => l.serial === BY_HAND_SERIAL);
  const holds: SnapshotHold[] = [
    {
      label: "H1",
      key: keys.h1,
      kind: "DUPLICATE_SLIP",
      gate: h1.gate,
      memberNo: h1.memberNo,
      serials: h1.serials,
      engineLine: engineLine(h1, ctx),
      claudeLine: "The second image is the office's pink copy of the same receipt.",
      resolvedWith: "COUNT_ONCE",
      resolvedLine: `Returned to ${String(h1.params.othersCount)} members: ${String(h1.params.movedDisplay)}.`,
      resolvedBy: treasurer.initials,
      resolvedAt: TIMELINE.h1,
    },
    {
      label: "H2",
      key: keys.h2,
      kind: "IMPLAUSIBLE_YIELD",
      gate: hold(byHand, keys.h2).gate,
      memberNo: "M-053",
      serials: [],
      engineLine: engineLine(hold(byHand, keys.h2), ctx),
      claudeLine: "Her deliveries suggest a second plot that isn't in the registry yet.",
      resolvedWith: "REGISTER_PLOT",
      resolvedLine: engineLine(hold(resolved, keys.h2), ctx),
      resolvedBy: treasurer.initials,
      resolvedAt: TIMELINE.h2,
    },
    {
      label: "H3",
      key: keys.h3,
      kind: "NO_RULE",
      gate: hold(byHand, keys.h3).gate,
      memberNo: hold(byHand, keys.h3).memberNo,
      serials: [MULTA_SERIAL],
      engineLine: engineLine(hold(byHand, keys.h3), ctx),
      claudeLine: "The clerk noted a fine for missing the general assembly.",
      resolvedWith: "RETURN_AS_CREDIT",
      resolvedLine: `Returned as a ${String(hold(resolved, keys.h3).params.creditDisplay)} credit paid by the co-op.`,
      resolvedBy: treasurer.initials,
      resolvedAt: TIMELINE.h3,
    },
    {
      label: `Slip ${BY_HAND_SERIAL} by hand`,
      key: keys.byHand,
      kind: "LOW_CONFIDENCE",
      gate: hold(read, keys.byHand).gate,
      memberNo: byHandSlip.memberNo,
      serials: [BY_HAND_SERIAL],
      engineLine: engineLine(hold(read, keys.byHand), ctx),
      claudeLine: null,
      resolvedWith: "ENTERED_BY_HAND",
      resolvedLine: `${format.slipKg(byHandSlip.grossG)} − ${format.slipKg(byHandSlip.tareG)} tare = ${format.slipKg(byHandSlip.netG)} net. ${logLine && logLine.netKgText === format.slipKg(byHandSlip.netG) ? `Matches logbook line ${logLine.lineNo}.` : "Check the logbook."}`,
      resolvedBy: treasurer.initials,
      resolvedAt: TIMELINE.byHand,
    },
    {
      label: "Mass balance",
      key: keys.massBalance,
      kind: "MASS_BALANCE",
      gate: hold(byHand, keys.massBalance).gate,
      memberNo: null,
      serials: [],
      engineLine: engineLine(hold(byHand, keys.massBalance), ctx),
      claudeLine: null,
      resolvedWith: "ENGINE_CLEARED",
      resolvedLine: engineLine(hold(resolved, keys.massBalance), ctx),
      resolvedBy: "engine",
      resolvedAt: TIMELINE.h1,
    },
  ];

  // ---------------- run, invoice and batch
  const runSeq = RUN.runSeq;
  const slug = runSlug(SEASON.code, runSeq);
  const runId = uuidv7(Date.parse(RUN.createdAt), `run:${slug}`);
  const seasonId = uuidv7(Date.parse("2026-03-01T00:00:00.000Z"), `season:${SEASON.code}`);
  const quote = quoteInvoice(card, LOT);
  const sbid = senderBatchId(SEASON.code, card.sha256, runSeq);
  const onRail = resolved.lines.filter((l) => l.rail === "PAYPAL");
  const items = onRail.map((l) => {
    const m = memberOf.get(l.memberNo);
    if (!m?.receiverAlias) throw new Error(`no receiver for ${l.memberNo}`);
    return {
      senderItemId: senderItemId(runSeq, l.memberNo),
      receiver: m.receiverAlias,
      amountCents: l.netCents,
      currency: "USD" as const,
    };
  });
  const digest = batchDigest({ runId, senderBatchId: sbid, rateCardSha256: card.sha256 }, items);
  const sign = (
    role: "treasurer" | "chair",
    keyId: string,
    approverId: string,
    signedAt: string,
  ): SignedApproval => {
    const payload = buildApprovalPayload({
      runId,
      seasonId,
      rateCardSha256: card.sha256,
      batch: digest,
      // Both keys bind every member line, the 56 cash lines too (the approved plan's linesDigest).
      linesDigest: linesDigest(resolved.lines),
      role,
      approverId,
      nonce: sha256Hex(`nonce:${slug}:${role}`).slice(0, 32),
      exp: new Date(Date.parse(signedAt) + 30 * 60 * 1000).toISOString(),
    });
    const key = seededKey(keyId);
    return {
      role,
      keyId,
      publicKeyHex: key.publicKeyHex,
      payload,
      signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
    };
  };
  const approvals = [
    sign("treasurer", SEEDED_KEY_IDS.treasurer, treasurer.persona, TIMELINE.treasurerSigned),
    sign("chair", SEEDED_KEY_IDS.chair, chair.persona, TIMELINE.chairSigned),
  ];
  const note = batchNote(SEASON.label, digest.batchSha256);
  const overrides = overrideCount(resolved.holds);
  const chairNeeded = requiresChair(
    { batchTotalCents: digest.totalCents, lineAmountsCents: items.map((i) => i.amountCents), overrides },
    rules.cosign,
  );

  // ---------------- end state: 7 paid by PayPal, Rhea parked then returned to cash
  const unclaimedNo = world.members.find((m) => m.receiverKind === "NO_PAYPAL_ACCOUNT")?.memberNo;
  const snapshotItems: SnapshotItem[] = digest.items.map((it) => {
    const memberNo = it.senderItemId.split("-").slice(1).join("-");
    const returned = memberNo === unclaimedNo;
    return {
      ...it,
      memberNo,
      payoutItemId: idOf("SEED", `item:${it.senderItemId}`),
      status: returned ? "RETURNED" : "SUCCESS",
      eventId: `WH-SEED-${idOf("", `event:${it.senderItemId}:${returned ? "CANCELED" : "SUCCEEDED"}`)}`,
      lineState: returned ? "OFF_RAIL_DUE" : "PAID",
    };
  });
  const lineStates: Record<string, MemberLineState> = {};
  for (const l of resolved.lines) {
    lineStates[l.memberNo] =
      l.rail === "CASH"
        ? "OFF_RAIL_DUE"
        : (snapshotItems.find((i) => i.memberNo === l.memberNo)?.lineState ?? "READY");
  }

  // ---------------- figures
  const c = resolved.conservation;
  const paid = snapshotItems.filter((i) => i.status === "SUCCESS");
  const endPaidCents = paid.reduce((s, i) => s + i.amountCents, 0);
  const endCashCents = c.netCents - endPaidCents;
  const credits = resolved.lines.reduce((s, l) => s + l.creditsCents, 0);
  const moved = Number(h1.params.movedCents);
  const fees = publishedFees(digest.itemCount, digest.totalCents);
  const dupOut = byHand.massBalance;
  const figures: SeasonSnapshot["figures"] = {
    invoiceCents: quote.totalCents,
    premiumPoolCents: quote.premiumPoolCents,
    bonusPoolCents: quote.bonusPoolCents,
    disbursementCents: quote.disbursementCents,
    poolCents: quote.poolCents,
    grossCents: c.grossCents,
    deductionsCents: c.deductionsCents,
    creditsCents: c.creditsCents,
    netCents: c.netCents,
    onRailNetCents: c.onRailNetCents,
    onRailMembers: onRail.length,
    cashNetCents: c.offRailNetCents,
    cashMembers: resolved.lines.filter((l) => l.rail === "CASH").length,
    redirectedCents: moved + credits,
    redirectedDuplicateCents: moved,
    redirectedCreditCents: credits,
    othersGainOnCountOnceCents: Number(h1.params.othersGainCents),
    batchItemCount: digest.itemCount,
    batchTotalCents: digest.totalCents,
    endPaidMembers: paid.length,
    endPaidCents,
    endCashMembers: world.members.length - paid.length,
    endCashCents,
    feesSandboxCents: fees.sandboxCents,
    feesProductionCents: fees.productionCents,
    verifiedG: resolved.massBalance.verifiedG,
    verifiedGrade1G: resolved.massBalance.grade1G,
    shippedG: LOT.shippedG,
    grade1ShippedG: LOT.grade1ShippedG,
    shrinkOnceBp: resolved.massBalance.shrinkBp,
    shrinkTwiceBp: dupOut.shrinkBp,
    members: world.members.length,
    women: world.members.filter((m) => m.gender === "F").length,
    slipImages: world.slips.length,
    photos: world.photos.length,
    display: {
      invoice: format.money(quote.totalCents),
      invoicePesoEstimate: format.pesoEstimate(quote.totalCents, fx, "en"),
      premiumPool: format.money(quote.premiumPoolCents),
      bonusPool: format.money(quote.bonusPoolCents),
      disbursement: format.money(quote.disbursementCents),
      gross: format.money(c.grossCents),
      deductions: format.money(c.deductionsCents),
      credits: format.money(c.creditsCents),
      net: format.money(c.netCents),
      onRailNet: format.money(c.onRailNetCents),
      cashNet: format.money(c.offRailNetCents),
      redirected: format.money(moved + credits),
      batchTotal: format.money(digest.totalCents),
      endPaid: format.money(endPaidCents),
      endCash: format.money(endCashCents),
      proofShare: `${paid.length} of ${world.members.length} members, ${format.shareOf(endPaidCents, c.netCents)} of value`,
      feesSandbox: `${format.money(25, "USD").replace("US$", "$")} × ${digest.itemCount} = ${format.money(fees.sandboxCents).replace("US$", "$")}`,
      feesProduction: `2% = ${format.money(fees.productionCents).replace("US$", "$")}`,
      verified: format.kg(resolved.massBalance.verifiedG),
      verifiedGrade1: format.kg(resolved.massBalance.grade1G),
      shipped: format.kg(LOT.shippedG, 0),
      shrinkOnce: format.percentBp(resolved.massBalance.shrinkBp),
      shrinkTwice: format.percentBp(dupOut.shrinkBp),
      tolerance: format.percentBp(rules.tolerances.massBalanceTolBp, 1),
      premiumRate: format.ratePerKg(quote.premiumPoolCents, resolved.massBalance.verifiedG),
      rc: format.hashGroups(card.sha256),
    },
  };

  // ---------------- proof bundle with a hash-chained ledger
  const docs = world.photos.map((p) => ({ documentId: p.documentId, sha256: p.manifestSha256 }));
  const proofLines = resolved.lines.map((l) => {
    const { lineSha256: hash, ...rest } = l;
    return {
      memberNo: l.memberNo,
      rail: l.rail,
      premiumCents: l.premiumCents,
      bonusCents: l.bonusCents,
      deductionsCents: l.deductionsCents,
      creditsCents: l.creditsCents,
      netCents: l.netCents,
      canonical: lineCanonical(rest, card.sha256),
      lineSha256: hash,
    };
  });
  const sortedPhotos = [...world.photos].sort((a, b) =>
    (a.readOn ?? "9999") + a.photoId < (b.readOn ?? "9999") + b.photoId ? -1 : 1,
  );
  const slipDatesOf = (p: World["photos"][number]) =>
    p.slips.map((ps) => {
      const slip = world.slips.find(
        (x) => x.photoId === p.photoId && x.serial === ps.serial && x.copy === ps.copy,
      );
      if (!slip) throw new Error(`slip ${ps.serial} missing from photo ${p.photoId}`);
      return slip.slipDate;
    });
  const reference = invoiceReference(card.sha256);
  const returnedItem = snapshotItems.find((i) => i.status === "RETURNED");
  const unclaimedEventId = (it: SnapshotItem) => `WH-SEED-${idOf("", `event:${it.senderItemId}:UNCLAIMED`)}`;
  const human = (actorId: string) => ({ actorKind: "human" as const, actorId });
  const engine = { actorKind: "engine" as const, actorId: "engine v1" };
  const paypal = { actorKind: "paypal" as const, actorId: "paypal" };
  const facts: LedgerFact[] = [
    {
      kind: "rate_card.certified",
      actorKind: "human",
      actorId: "board:theresa",
      impersonatedBy: null,
      payload: { rateCardSha256: card.sha256, resolutionNo: card.canonical.resolutionNo },
      at: card.ratifications[0]?.at ?? card.ratifiedAt,
    },
    proofFact(
      "rate_card.ratified",
      { rateCardSha256: card.sha256, resolutionNo: card.canonical.resolutionNo, ratifiedAt: card.ratifiedAt },
      card.ratifications[1]?.at ?? card.ratifiedAt,
      human(chair.persona),
    ),
    ...sortedPhotos.map((p) =>
      proofFact(
        "rows.accepted",
        {
          documentId: p.documentId,
          photoId: p.photoId,
          sha256: p.manifestSha256,
          serials: p.slips.map((x) => x.serial),
          slipDates: slipDatesOf(p),
          provenance: p.readProvenance,
        },
        p.readOn ? `${p.readOn}T09:30:00.000Z` : TIMELINE.readStart,
        engine,
      ),
    ),
    ...approvals.map((a) =>
      proofFact(
        "key.registered",
        { keyId: a.keyId, persona: a.payload.approverId, kind: "seeded", publicKeyHex: a.publicKeyHex },
        RUN.createdAt,
        { actorKind: "system", actorId: "seed" },
      ),
    ),
    proofFact(
      "invoice.funded",
      {
        runId,
        invoiceNumber: invoiceNumber(slug),
        status: "MARKED_AS_PAID",
        amountCents: quote.totalCents,
        dueCents: 0,
        reference,
      },
      TIMELINE.funded,
      { actorKind: "system", actorId: "ensureInvoice" },
    ),
    {
      kind: "field.entered",
      actorKind: "human",
      actorId: treasurer.persona,
      impersonatedBy: null,
      payload: {
        serial: BY_HAND_SERIAL,
        field: "gross_kg",
        value: format.slipKg(byHandSlip.grossG),
        derivedNet: format.slipKg(byHandSlip.netG),
      },
      at: TIMELINE.byHand,
    },
    ...holds.map(
      (h): LedgerFact => ({
        kind: "hold.resolved",
        actorKind: h.kind === "MASS_BALANCE" ? "engine" : "human",
        actorId: h.kind === "MASS_BALANCE" ? "engine v1" : treasurer.persona,
        impersonatedBy: null,
        payload: { key: h.key, label: h.label, resolution: h.resolvedWith },
        at: h.resolvedAt ?? TIMELINE.computed,
      }),
    ),
    proofFact(
      "lines.computed",
      {
        runId,
        engine: "engine v1",
        rateCardSha256: card.sha256,
        lineCount: resolved.lines.length,
        linesRootSha256: linesRootSha256(resolved.lines),
        premiumPoolCents: c.premiumPoolCents,
        bonusPoolCents: c.bonusPoolCents,
        netCents: c.netCents,
        onRailNetCents: c.onRailNetCents,
        balanced: c.balanced,
        overrides: overrideCount(resolved.holds),
      },
      TIMELINE.computed,
      engine,
    ),
    ...approvals.map((a) =>
      proofFact(
        "approval.signed",
        {
          runId,
          role: a.role,
          keyId: a.keyId,
          approverId: a.payload.approverId,
          batchSha256: a.payload.batchSha256,
          nonce: a.payload.nonce,
        },
        a.role === "treasurer" ? TIMELINE.treasurerSigned : TIMELINE.chairSigned,
        human(a.payload.approverId),
      ),
    ),
    proofFact(
      "payout.submitting",
      {
        runId,
        senderBatchId: sbid,
        batchSha256: digest.batchSha256,
        itemCount: digest.itemCount,
        totalCents: digest.totalCents,
        note,
      },
      TIMELINE.posted,
      { actorKind: "system", actorId: "PayoutsService" },
    ),
    ...snapshotItems.map((it, k) => {
      const parked = it.status === "RETURNED";
      return proofFact(
        "webhook.applied",
        {
          resource: "payout_item",
          eventId: parked ? unclaimedEventId(it) : (it.eventId as string),
          eventType: parked ? "PAYMENT.PAYOUTS-ITEM.UNCLAIMED" : "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
          verified: "self",
          provenance: "seeded",
          senderItemId: it.senderItemId,
          payoutItemId: it.payoutItemId,
          status: parked ? "UNCLAIMED" : "SUCCESS",
        },
        parked ? TIMELINE.unclaimed : at(ITEM_EVENT_TIMES[k] ?? "02:13:00"),
        paypal,
      );
    }),
    ...(returnedItem
      ? [
          proofFact(
            "payout.cancel",
            {
              senderItemId: returnedItem.senderItemId,
              payoutItemId: returnedItem.payoutItemId,
              afterCancel: "cash",
            },
            TIMELINE.cancelled,
            human(treasurer.persona),
          ),
          proofFact(
            "webhook.applied",
            {
              resource: "payout_item",
              eventId: returnedItem.eventId as string,
              eventType: "PAYMENT.PAYOUTS-ITEM.CANCELED",
              verified: "self",
              provenance: "seeded",
              senderItemId: returnedItem.senderItemId,
              payoutItemId: returnedItem.payoutItemId,
              status: "RETURNED",
            },
            TIMELINE.returned,
            paypal,
          ),
        ]
      : []),
  ];
  const ledger: LedgerEntry[] = buildLedger(facts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)));
  const checkpoint = signCheckpoint(
    ledger,
    runId,
    { keyId: SEEDED_LEDGER_KEY_ID, privateKey: seededKey(SEEDED_LEDGER_KEY_ID).privateKey },
    TIMELINE.proofServed,
  );
  const proof: ProofBundle = {
    v: 1,
    runId,
    runSlug: slug,
    invoice: {
      invoiceNumber: invoiceNumber(slug),
      status: "MARKED_AS_PAID",
      amountCents: quote.totalCents,
      dueCents: 0,
      reference,
    },
    rateCard: { canonical: card.canonical, sha256: card.sha256, ratifiedAt: card.ratifiedAt },
    firstSlipDate: [...world.slips].map((s) => s.slipDate).sort()[0] as string,
    documents: docs,
    pools: { premiumPoolCents: quote.premiumPoolCents, bonusPoolCents: quote.bonusPoolCents },
    lines: proofLines,
    approvals,
    batch: {
      runId,
      senderBatchId: sbid,
      rateCardSha256: card.sha256,
      batchSha256: digest.batchSha256,
      note,
      items: snapshotItems.map((i) => ({
        senderItemId: i.senderItemId,
        receiver: i.receiver,
        amountCents: i.amountCents,
        currency: i.currency,
        payoutItemId: i.payoutItemId,
        status: i.status,
        eventId: i.eventId,
      })),
    },
    ledger,
    checkpoint,
  };

  const slipDates = world.slips.map((s) => s.slipDate).sort();
  const injection = world.slips.find((s) => s.serial === INJECTION_SERIAL);
  const snapshot: SeasonSnapshot = {
    v: 1,
    provenance: "seeded",
    generator: { ...GENERATOR, attempt: world.tune.attempt },
    coop: {
      id: uuidv7(Date.parse("2015-01-01T00:00:00.000Z"), "coop:bulawanon"),
      name: COOP.name,
      shortName: COOP.shortName,
      locality: COOP.locality,
      region: COOP.region,
      commodity: "cacao",
      stations: COOP.stations.map((s) => ({ ...s })),
    },
    officers: OFFICERS.map((o) => ({ ...o })),
    payer: { ...PAYER },
    season: {
      id: seasonId,
      code: SEASON.code,
      label: SEASON.label,
      opensOn: SEASON.opensOn,
      closesOn: SEASON.closesOn,
      firstSlipOn: slipDates[0] as string,
      lastSlipOn: slipDates.at(-1) as string,
      serialFirst: String(SEASON.serialFirst).padStart(4, "0"),
      serialLast: String(SEASON.serialLast).padStart(4, "0"),
    },
    lot: {
      ...LOT,
      id: uuidv7(Date.parse("2026-09-18T00:00:00.000Z"), `lot:${LOT.lotCode}`),
      buyer: PAYER.name,
    },
    rateCard: {
      ...card,
      id: uuidv7(Date.parse(card.ratifiedAt), `rate-card:${card.canonical.resolutionNo}`),
      textLayer: TEXT_LAYER,
    },
    fx: { centavosPerCent: fx, display: FX.display, source: FX.source },
    members: world.members.map(({ homeStation: _home, ...m }) => m),
    slips: world.slips,
    photos: world.photos,
    logbook: world.logbook,
    checkpoints: { read, byHand, resolved },
    holds,
    quarantineNotices: injection
      ? [{ serial: injection.serial, photoId: injection.photoId, notice: quarantineNotice(injection.serial) }]
      : [],
    run: {
      id: runId,
      runSeq,
      runSlug: slug,
      state: "SETTLED",
      recordedOn: RUN.recordedOn,
      fx: { centavosPerCent: fx, display: FX.display, source: FX.source },
      cashDay: RUN.cashDay,
      quote,
      quoteSha256: quoteDigest(quote),
      invoice: {
        invoiceNumber: invoiceNumber(slug),
        reference,
        note: invoiceMemo(SEASON.label, card.sha256, LOT.lotCode),
        invoiceDate: RUN.invoiceDate,
        dueDate: format.addDays(RUN.invoiceDate, RUN.dueInDays),
        autoCancelOn: format.addDays(RUN.invoiceDate, RUN.autoCancelInDays),
        status: "MARKED_AS_PAID",
        amountCents: quote.totalCents,
        dueCents: 0,
        provenance: "simulated_rail",
        pesoEstimate: format.pesoEstimate(quote.totalCents, fx, "en"),
      },
      senderBatchId: sbid,
      paypalRequestId: paypalRequestId(sbid),
      batchNote: note,
      batchSha256: digest.batchSha256,
      items: snapshotItems,
      approvals,
      chairNeeded: { required: chairNeeded.required, reasons: chairNeeded.reasons },
      lineStates,
    },
    figures,
    proof,
    publishedKeys: seededPublishedKeys(),
  };
  return { snapshot: SeasonSnapshotSchema.parse(snapshot), world };
}
