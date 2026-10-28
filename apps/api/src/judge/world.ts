// The judge world: the canonical Season 2026-A (IC-03, `@fairsplit/seed`) written into one judge workspace,
// so a judge acts on real rows in their own sandbox (S3.9 "pooled workspace clone"). Everything here is
// provenance `seeded` and every figure comes from the seed snapshot; nothing is computed or invented.
//
// What a clone holds (the contract the run slice builds on):
//   coops (1) · memberships (the officers and the brand contact: treasurer:analyn, board:ernesto,
//   board:theresa, clerk:jessie, brand:dana) · seasons (1, thresholds from the card's R5/R6) · lots (1)
//   · rate_cards (1, JCS of the canonical card, sha256 checked against the seed, ratified 14 Mar)
//   · rate_rules (R0–R4) · ratifications (Secretary, Chair) · members (64) · plots (registered only; P-053-B
//   stays unregistered for H2) · documents (every photo, static `/media` paths) · slip_rows and
//   deduction_marks for the EARLIER photos (read on their own dates, seeded) · the opening ledger: the
//   seed's `rate_card.certified`, `rate_card.ratified` and seeded `rows.accepted` entries, in the seed's
//   order with the clone's document ids, so Proof's "Ratified" plate holds for a judge run too.
// Not in a clone: a pay run (made when a judge claims the workspace, with a fresh runSeq), the replay
// photos' rows (the replayed 28 Oct read writes them), keys, lines, holds and approvals.
import type { SeasonSnapshot } from "@fairsplit/contracts";
import { appendLedger, openSeedWindow, schema, systemScope, type Tx, uuidv7 } from "@fairsplit/db";
import { jcs, sha256Hex } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { eq } from "drizzle-orm";

export interface JudgeWorld {
  workspaceId: string;
  coopId: string;
  seasonId: string;
  /** ID code, e.g. 2026A (pay_runs.season_code). */
  seasonCode: string;
  lotId: string;
  rateCardId: string;
  rateCardSha256: string;
  memberIdByNo: ReadonlyMap<string, string>;
  documentIdByPhoto: ReadonlyMap<string, string>;
}

/** The brand contact's persona (Dana Whitfield-Santos → `brand:dana`). */
export function brandPersona(s: SeasonSnapshot = getSnapshot()): string {
  return (s.payer.contactName.split(/\s+/)[0] ?? "brand").toLowerCase();
}

/** Officer personas (`treasurer:analyn`…) plus the brand contact, as membership rows. */
export function worldPersonas(s: SeasonSnapshot = getSnapshot()): { role: string; persona: string }[] {
  const officers = s.officers.map((o) => {
    const [role, persona] = o.persona.split(":") as [string, string];
    return { role, persona };
  });
  return [...officers, { role: "brand", persona: brandPersona(s) }];
}

let seedTagCache: string | null = null;

/**
 * A short fingerprint of the seed snapshot. Pooled workspaces carry it in their name, so a deploy with a
 * new seed never hands a judge a workspace cloned from the old one.
 */
export function seedTag(): string {
  seedTagCache ??= sha256Hex(jcs(getSnapshot())).slice(0, 12);
  return seedTagCache;
}

const ledgerPrefixKinds = new Set(["rate_card.certified", "rate_card.ratified"]);

/** The seed ledger entries a fresh clone starts with: the ratification and the archived photos' reads. */
export function openingLedger(s: SeasonSnapshot = getSnapshot()): SeasonSnapshot["proof"]["ledger"] {
  return s.proof.ledger.filter(
    (e) =>
      ledgerPrefixKinds.has(e.kind) ||
      (e.kind === "rows.accepted" && (e.payload as { provenance?: unknown }).provenance === "seeded"),
  );
}

/**
 * Writes the canonical season into `workspaceId` (which must already exist, in this transaction). Takes
 * about 400 rows and 56 ledger entries; run it in the background (pool refill) or once per empty pool.
 */
export async function materializeWorld(tx: Tx, workspaceId: string): Promise<JudgeWorld> {
  const s = getSnapshot(); // validated against IC-03 on first access
  const card = s.rateCard;
  const canonicalJcs = jcs(card.canonical);
  if (sha256Hex(canonicalJcs) !== card.sha256) {
    throw new Error("judge world: the seed's rate card does not re-hash to its sha256 (seed drift)");
  }
  const rules = card.canonical.rules;
  const seeded = "seeded" as const;
  // I2 (migration 0007): the database stamps a ratification with its own clock, except inside a seed window,
  // where rows labelled `seeded` keep the snapshot's historical instant (the card ratified on 14 Mar, before the
  // slips it pays). The window is this fresh judge workspace's, for this transaction only.
  await openSeedWindow(tx, workspaceId);

  const coopId = uuidv7();
  await tx.insert(schema.coops).values({
    id: coopId,
    workspaceId,
    name: s.coop.name,
    region: `${s.coop.locality}, ${s.coop.region}`,
    commodity: s.coop.commodity,
    provenance: seeded,
  });

  await tx.insert(schema.memberships).values(
    worldPersonas(s).map((p) => ({
      id: uuidv7(),
      workspaceId,
      persona: p.persona,
      role: p.role as (typeof schema.memberships.$inferInsert)["role"],
    })),
  );

  const seasonId = uuidv7();
  await tx.insert(schema.seasons).values({
    id: seasonId,
    workspaceId,
    coopId,
    code: s.season.code,
    label: s.season.label,
    opensOn: s.season.opensOn,
    closesOn: s.season.closesOn,
    tz: "Asia/Manila",
    currency: card.canonical.pricing.currency,
    cosignBatchCents: BigInt(rules.cosign.batchOverCents),
    cosignLineCents: BigInt(rules.cosign.lineOverCents),
    massBalanceTolBp: rules.tolerances.massBalanceTolBp,
    kgPerTreeMaxG: rules.tolerances.kgPerTreeMaxG,
    autoAcceptBp: rules.tolerances.autoAcceptBp,
    provenance: seeded,
  });

  const lotId = uuidv7();
  await tx.insert(schema.lots).values({
    id: lotId,
    workspaceId,
    seasonId,
    lotCode: s.lot.lotCode,
    sacks: s.lot.sacks,
    shippedG: BigInt(s.lot.shippedG),
    grade1ShippedG: BigInt(s.lot.grade1ShippedG),
    shippedOn: s.lot.shippedOn,
    provenance: seeded,
  });

  // I2 order: the card and its rules are written unratified, then the card is ratified (the guard
  // triggers refuse any rule written after that).
  const rateCardId = uuidv7();
  await tx.insert(schema.rateCards).values({
    id: rateCardId,
    workspaceId,
    seasonId,
    code: card.canonical.resolutionNo,
    canonicalJcs,
    sha256: card.sha256,
    provenance: seeded,
  });
  const typed: Record<string, { category: string; params: unknown }> = {
    R0: { category: "share", params: rules.share },
    R1: { category: "cbu", params: rules.cbu },
    R2: { category: "hauling", params: rules.hauling },
    R3: { category: "loan", params: rules.loan },
    R4: { category: "advance", params: rules.advance },
  };
  await tx.insert(schema.rateRules).values(
    Object.entries(typed).map(([ruleId, r]) => {
      const terms = card.canonical.terms.filter((t) => t.ruleId === ruleId);
      const first = terms[0];
      if (!first) throw new Error(`judge world: the seed card has no printed term for ${ruleId}`);
      return {
        id: uuidv7(),
        workspaceId,
        rateCardId,
        ruleId,
        kind: first.kind === "SHARE" ? ("SHARE" as const) : ("DEDUCTION" as const),
        category: r.category,
        basis: [...new Set(terms.map((t) => t.basis))].join("+"),
        params: r.params,
        sourcePage: first.source.page,
        sourceQuote: [...new Set(terms.map((t) => t.source.quote))].join("\n"),
        provenance: seeded,
      };
    }),
  );
  const officerByRole = new Map(s.officers.map((o) => [o.role, o.persona]));
  await tx.insert(schema.ratifications).values(
    card.ratifications.map((r) => ({
      id: uuidv7(),
      workspaceId,
      rateCardId,
      approverId: officerByRole.get(r.role) ?? r.name,
      role: r.role,
      signedAt: new Date(r.at),
      provenance: seeded,
    })),
  );
  await tx
    .update(schema.rateCards)
    .set({ ratifiedAt: new Date(card.ratifiedAt) })
    .where(eq(schema.rateCards.id, rateCardId));

  const memberIdByNo = new Map<string, string>();
  for (const m of s.members) memberIdByNo.set(m.memberNo, uuidv7());
  await tx.insert(schema.members).values(
    s.members.map((m) => ({
      id: memberIdByNo.get(m.memberNo) as string,
      workspaceId,
      coopId,
      memberNo: m.memberNo,
      displayName: m.displayName,
      honorific: m.addressAs[m.lang],
      lang: m.lang,
      // A key into PP_RECEIVERS (env), never an address: the receiver itself never lives in the database.
      receiverRef: m.rail === "PAYPAL" ? m.memberNo : null,
      provenance: seeded,
    })),
  );
  const plots = s.members.flatMap((m) =>
    m.plots
      .filter((p) => p.registered)
      .map((p) => ({
        id: uuidv7(),
        workspaceId,
        memberId: memberIdByNo.get(m.memberNo) as string,
        plotCode: p.plotNo,
        trees: p.trees,
        areaHa: p.areaHa,
        registeredAt: p.registeredOn ? new Date(`${p.registeredOn}T00:00:00+08:00`) : null,
        provenance: seeded,
      })),
  );
  if (plots.length > 0) await tx.insert(schema.plots).values(plots);

  const documentIdByPhoto = new Map<string, string>();
  for (const p of s.photos) documentIdByPhoto.set(p.photoId, uuidv7());
  await tx.insert(schema.documents).values(
    s.photos.map((p) => ({
      id: documentIdByPhoto.get(p.photoId) as string,
      workspaceId,
      seasonId,
      kind: "slip_photo" as const,
      // The photo's canonical slip manifest hash (what Proof and `rows.accepted` attest); the image file's
      // own byte hash and size land with IC-11's media manifest.
      sha256: p.manifestSha256,
      storage: "static" as const,
      path: p.file.replace(/^media\//, ""),
      byteSize: 0,
      mime: "image/webp",
      photoCode: p.photoId,
      capturedAt: new Date(`${p.capturedOn}T00:00:00+08:00`),
      provenance: seeded,
    })),
  );

  const earlier = s.slips.filter((x) => !x.replaySet);
  const rowIdBySlip = new Map<string, string>();
  for (const x of earlier) rowIdBySlip.set(`${x.photoId}|${x.serial}`, uuidv7());
  if (earlier.length > 0) {
    await tx.insert(schema.slipRows).values(
      earlier.map((x) => ({
        id: rowIdBySlip.get(`${x.photoId}|${x.serial}`) as string,
        workspaceId,
        seasonId,
        documentId: documentIdByPhoto.get(x.photoId) as string,
        serial: x.serial,
        rowNo: 1,
        memberId: memberIdByNo.get(x.memberNo) ?? null,
        slipDate: x.slipDate,
        grossG: BigInt(x.grossG),
        tareG: BigInt(x.tareG),
        netG: BigInt(x.netG),
        grade: x.grade,
        state: "CONFIRMED" as const,
        copyColor: x.copy,
        provenance: seeded,
      })),
    );
    const marks = earlier.flatMap((x) =>
      x.marks.map((mark) => ({
        id: uuidv7(),
        workspaceId,
        slipRowId: rowIdBySlip.get(`${x.photoId}|${x.serial}`) as string,
        textVerbatim: mark.text,
        ruleId: mark.ruleId,
        writtenCents: mark.writtenCentavos === null ? null : BigInt(mark.writtenCentavos),
        currency: "PHP",
        provenance: seeded,
      })),
    );
    if (marks.length > 0) await tx.insert(schema.deductionMarks).values(marks);
  }

  // The opening ledger, as in the showcase: the ratification first, then the archived photos' reads.
  const scope = systemScope(workspaceId, { kind: "system", id: "system:seed" });
  for (const e of openingLedger(s)) {
    const payload = { ...(e.payload as Record<string, unknown>) };
    if (typeof payload.documentId === "string" && typeof payload.photoId === "string") {
      const id = documentIdByPhoto.get(payload.photoId);
      if (!id)
        throw new Error(`judge world: the ledger names photo ${payload.photoId}, which the seed lacks`);
      payload.documentId = id;
    }
    await appendLedger(tx, scope, {
      kind: e.kind,
      payload,
      actor: {
        kind: e.actorKind,
        id: e.actorId,
        impersonatedBy: e.impersonatedBy,
      },
      at: new Date(e.at),
    });
  }

  return {
    workspaceId,
    coopId,
    seasonId,
    seasonCode: s.season.code,
    lotId,
    rateCardId,
    rateCardSha256: card.sha256,
    memberIdByNo,
    documentIdByPhoto,
  };
}
