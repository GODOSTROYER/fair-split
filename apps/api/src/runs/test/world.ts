// Test world (RUNS slice tests only): the synthetic Season 2026-A of `@fairsplit/seed` written into a fresh
// workspace exactly as the persistence schema stores it, so the runs slice is exercised on the canonical
// figures (64 members, 264 slip images, H1–H3, slip 0462 by hand, the mass-balance dial, 8 PayPal items
// totalling US$368.39) and never on hand-typed numbers. The engine's first computation (the "read"
// checkpoint) is produced by the slice's own `recomputeRun`, so the holds and lines the tests act on are the
// ones code raised.
import type { PayRunState } from "@fairsplit/contracts";
import { type Db, openSeedWindow, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { ed25519FromSeed, jcs, quoteDigest, quoteInvoice, sha256Hex } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { recomputeRun } from "../engine.js";
import { ACTORS } from "../events.js";
import { lockRun } from "../load.js";

export interface SeedWorldOptions {
  kind?: "judge" | "showcase" | "real";
  /** Where the run starts. Holds and lines are computed for IN_REVIEW and later. */
  runState?: PayRunState;
  /** Whether slip 0462 waits for a person (true, the read checkpoint) or was entered by hand already. */
  pending0462?: boolean;
  /** The invoice at PayPal (id, sent): for INVOICED and later. */
  invoice?: {
    paypalInvoiceId: string;
    status: "SENT" | "UNPAID" | "MARKED_AS_PAID" | "PAID";
    sent: boolean;
  } | null;
}

export interface SeedWorld {
  workspaceId: string;
  coopId: string;
  seasonId: string;
  lotId: string;
  rateCardId: string;
  rateCardSha256: string;
  runId: string;
  runSlug: string;
  runSeq: number;
  memberId: Map<string, string>;
  /** slip_rows id by `${serial}:${copy}`. */
  slipRow: Map<string, string>;
  /** slip 0462's gross_kg and net_kg field ids. */
  fields0462: { gross: string; tare: string; net: string };
}

const at = (iso: string) => new Date(iso);

export async function seedWorld(db: Db, o: SeedWorldOptions = {}): Promise<SeedWorld> {
  const s = getSnapshot();
  const card = s.rateCard;
  const canonicalJcs = jcs(card.canonical);
  if (sha256Hex(canonicalJcs) !== card.sha256)
    throw new Error("the seed's card hash does not cover its canonical JCS");
  const pending0462 = o.pending0462 ?? true;

  const [ws] = await db
    .insert(schema.workspaces)
    .values({ kind: o.kind ?? "judge", name: "runs-slice test" })
    .returning();
  if (!ws) throw new Error("workspace");
  const workspaceId = ws.id;
  const [coop] = await db
    .insert(schema.coops)
    .values({
      workspaceId,
      name: s.coop.name,
      region: s.coop.region,
      commodity: s.coop.commodity,
      provenance: "seeded",
    })
    .returning();
  if (!coop) throw new Error("coop");
  const members = await db
    .insert(schema.members)
    .values(
      s.members.map((m) => ({
        workspaceId,
        coopId: coop.id,
        memberNo: m.memberNo,
        displayName: m.displayName,
        honorific: m.addressAs.en,
        lang: m.lang,
        receiverRef: m.rail === "PAYPAL" ? m.memberNo : null,
        provenance: "seeded" as const,
      })),
    )
    .returning({ id: schema.members.id, memberNo: schema.members.memberNo });
  const memberId = new Map(members.map((m) => [m.memberNo, m.id]));
  await db.insert(schema.plots).values(
    s.members.flatMap((m) =>
      m.plots.map((p) => ({
        workspaceId,
        memberId: memberId.get(m.memberNo) as string,
        plotCode: p.plotNo,
        trees: p.trees,
        areaHa: p.areaHa,
        registeredAt: p.registered && p.registeredOn ? at(`${p.registeredOn}T00:00:00.000Z`) : null,
        provenance: "seeded" as const,
      })),
    ),
  );
  await db.insert(schema.memberships).values([
    { workspaceId, persona: "analyn", role: "treasurer" as const },
    { workspaceId, persona: "ernesto", role: "board" as const },
    { workspaceId, persona: "theresa", role: "board" as const },
    { workspaceId, persona: "jessie", role: "clerk" as const },
  ]);
  const tol = card.canonical.rules.tolerances;
  const cosign = card.canonical.rules.cosign;
  const [season] = await db
    .insert(schema.seasons)
    .values({
      workspaceId,
      coopId: coop.id,
      code: s.season.code,
      label: s.season.label,
      opensOn: s.season.opensOn,
      closesOn: s.season.closesOn,
      currency: "USD",
      cosignBatchCents: BigInt(cosign.batchOverCents),
      cosignLineCents: BigInt(cosign.lineOverCents),
      massBalanceTolBp: tol.massBalanceTolBp,
      kgPerTreeMaxG: tol.kgPerTreeMaxG,
      autoAcceptBp: tol.autoAcceptBp,
      provenance: "seeded",
    })
    .returning();
  if (!season) throw new Error("season");
  const [lot] = await db
    .insert(schema.lots)
    .values({
      workspaceId,
      seasonId: season.id,
      lotCode: s.lot.lotCode,
      sacks: s.lot.sacks,
      shippedG: BigInt(s.lot.shippedG),
      grade1ShippedG: BigInt(s.lot.grade1ShippedG),
      shippedOn: s.lot.shippedOn,
      provenance: "seeded",
    })
    .returning();
  if (!lot) throw new Error("lot");
  // I2 (migration 0007): the database stamps a ratification with its own clock, except inside a seed window,
  // where a `seeded` card keeps the snapshot's instant. Only a showcase or judge workspace may load one; a real
  // co-op's card is ratified now, so a real world carries none of the seeded (earlier-dated) evidence.
  const real = (o.kind ?? "judge") === "real";
  const [rc] = await db.transaction(async (tx) => {
    if (!real) await openSeedWindow(tx, workspaceId);
    return tx
      .insert(schema.rateCards)
      .values({
        workspaceId,
        seasonId: season.id,
        code: card.canonical.resolutionNo,
        canonicalJcs,
        sha256: card.sha256,
        ratifiedAt: at(card.ratifiedAt),
        provenance: "seeded",
      })
      .returning();
  });
  if (!rc) throw new Error("rate card");
  if (real && (o.runState ?? "IN_REVIEW") !== "DRAFT" && !["QUOTED", "INVOICED"].includes(o.runState ?? "")) {
    throw new Error("a real test world has no seeded evidence: start it at DRAFT, QUOTED or INVOICED");
  }
  await db.insert(schema.ratifications).values(
    card.ratifications.map((r) => ({
      workspaceId,
      rateCardId: rc.id,
      approverId: r.role === "CHAIR" ? "board:ernesto" : "board:theresa",
      role: r.role,
      signedAt: at(r.at),
      provenance: "seeded" as const,
    })),
  );

  // Evidence: the 66 photos and their 264 slip rows (seeded facts; only 0462's kilos wait for a person). A
  // real world has none: its card was ratified now, after every seeded slip date (I2).
  const photos = real ? [] : s.photos;
  const slips = real ? [] : s.slips;
  const docs =
    photos.length === 0
      ? []
      : await db
          .insert(schema.documents)
          .values(
            photos.map((p) => ({
              workspaceId,
              seasonId: season.id,
              kind: "slip_photo" as const,
              sha256: p.manifestSha256,
              storage: "static" as const,
              path: p.file.replace(/^media\//, ""),
              byteSize: 0,
              mime: "image/webp",
              photoCode: p.photoId,
              provenance: p.set === "REPLAY" ? ("replay" as const) : ("seeded" as const),
            })),
          )
          .returning({ id: schema.documents.id, photoCode: schema.documents.photoCode });
  const docOf = new Map(docs.map((d) => [d.photoCode, d.id]));
  const position = { TL: 1, TR: 2, BL: 3, BR: 4 } as const;
  const rows =
    slips.length === 0
      ? []
      : await db
          .insert(schema.slipRows)
          .values(
            slips.map((x) => {
              const pending = pending0462 && x.serial === "0462";
              return {
                workspaceId,
                seasonId: season.id,
                documentId: docOf.get(x.photoId) as string,
                serial: x.serial,
                rowNo: position[x.position],
                memberId: memberId.get(x.memberNo) as string,
                slipDate: x.slipDate,
                grossG: pending ? null : BigInt(x.grossG),
                tareG: BigInt(x.tareG),
                netG: pending ? null : BigInt(x.netG),
                grade: x.grade,
                minConfidence: pending ? 0.4 : 0.97,
                state: pending ? ("NEEDS_HUMAN" as const) : ("AUTO_ACCEPTED" as const),
                copyColor: x.copy,
                provenance: x.replaySet ? ("replay" as const) : ("seeded" as const),
              };
            }),
          )
          .returning({
            id: schema.slipRows.id,
            serial: schema.slipRows.serial,
            copy: schema.slipRows.copyColor,
          });
  const slipRow = new Map(rows.map((r) => [`${r.serial}:${r.copy}`, r.id]));
  const replay = slips.filter((x) => x.replaySet);
  const read = (v: string, legibility = "CLEAR") => ({ valueText: v, legibility });
  const fieldRows = replay.flatMap((x) => {
    const id = slipRow.get(`${x.serial}:${x.copy}`) as string;
    const stained = pending0462 && x.serial === "0462";
    const misread = (v: string) => `${v.charAt(0)}1${v.slice(2)}`;
    return [
      {
        field: "gross_kg",
        value: x.boxes["6"],
        readB: stained ? misread(x.boxes["6"]) : x.boxes["6"],
        stained,
      },
      { field: "tare_kg", value: x.boxes["7"], readB: x.boxes["7"], stained: false },
      {
        field: "net_kg",
        value: x.boxes["8"],
        readB: stained ? misread(x.boxes["8"]) : x.boxes["8"],
        stained,
      },
    ].map((f) => ({
      workspaceId,
      slipRowId: id,
      field: f.field,
      readA: read(f.value, f.stained ? "SMUDGED" : "CLEAR"),
      readB: read(f.readB, f.stained ? "SMUDGED" : "CLEAR"),
      agreement: f.stained ? 0.4 : 0.97,
      finalValue: f.stained ? null : f.value,
      decidedBy: f.stained ? null : ("agreement" as const),
      provenance: "replay" as const,
    }));
  });
  const fields =
    fieldRows.length === 0
      ? []
      : await db.insert(schema.slipFields).values(fieldRows).returning({
          id: schema.slipFields.id,
          field: schema.slipFields.field,
          slipRowId: schema.slipFields.slipRowId,
        });
  const row0462 = slipRow.get("0462:WHITE_ORIGINAL") as string;
  const f = (name: string) => fields.find((x) => x.slipRowId === row0462 && x.field === name)?.id as string;
  const marks = slips.flatMap((x) =>
    x.marks.map((m) => ({
      workspaceId,
      slipRowId: slipRow.get(`${x.serial}:${x.copy}`) as string,
      textVerbatim: m.text,
      ruleId: m.ruleId,
      writtenCents: m.writtenCentavos === null ? null : BigInt(m.writtenCentavos),
      currency: "PHP",
      provenance: "seeded" as const,
    })),
  );
  if (marks.length > 0) await db.insert(schema.deductionMarks).values(marks);
  const injected = slips.filter((x) => x.marginNote !== null);
  if (injected.length > 0) {
    await db.insert(schema.slipAnomalies).values(
      injected.map((x) => ({
        workspaceId,
        documentId: docOf.get(x.photoId) as string,
        slipRowId: slipRow.get(`${x.serial}:${x.copy}`) as string,
        kind: "INSTRUCTION_LIKE_TEXT",
        detail: { source: "read_a", overlap: "NONE" },
        quarantinedText: x.marginNote,
        provenance: "replay" as const,
      })),
    );
  }

  // The run, its invoice, and (from IN_REVIEW on) the engine's own first computation.
  const quote = quoteInvoice(card, s.lot);
  const state = o.runState ?? "IN_REVIEW";
  const [run] = await db
    .insert(schema.payRuns)
    .values({
      workspaceId,
      seasonId: season.id,
      lotId: lot.id,
      rateCardId: rc.id,
      seasonCode: s.season.code,
      state,
      currency: "USD",
      fxNum: BigInt(s.fx.centavosPerCent.num),
      fxDen: BigInt(s.fx.centavosPerCent.den),
      fxSource: s.fx.source,
      quoteSha256: state === "DRAFT" ? null : quoteDigest(quote),
      rateCardSha256: card.sha256,
      provenance: "seeded",
    })
    .returning();
  if (!run) throw new Error("run");
  if (state !== "DRAFT") {
    const inv =
      o.invoice === undefined
        ? { paypalInvoiceId: "INV2-TEST-RUNS-0001", status: "SENT" as const, sent: true }
        : o.invoice;
    await db.insert(schema.invoices).values({
      workspaceId,
      runId: run.id,
      invoiceNumber: `FS-${run.runSlug}`,
      paypalInvoiceId: state === "QUOTED" ? null : (inv?.paypalInvoiceId ?? null),
      status: state === "QUOTED" ? "NEW" : (inv?.status ?? "SENT"),
      amountCents: BigInt(quote.totalCents),
      dueCents: BigInt(inv?.status === "MARKED_AS_PAID" || inv?.status === "PAID" ? 0 : quote.totalCents),
      currency: "USD",
      sentAt: state === "QUOTED" || !inv?.sent ? null : at("2026-10-27T02:00:00.000Z"),
      createdAtPaypal: state === "QUOTED" ? null : at("2026-10-27T00:00:00.000Z"),
      provenance: "simulated_rail",
    });
  }
  if (state === "IN_REVIEW" || state === "COMPUTED") {
    const scope = systemScope(workspaceId, ACTORS.engine);
    await withWorkspaceTx(db, scope, async (tx) => {
      const locked = await lockRun(tx, scope, run.id);
      await recomputeRun(tx, scope, locked, {
        at: at("2026-10-28T01:00:00.000Z"),
        actor: ACTORS.engine,
        provenance: "replay",
      });
    });
  }
  return {
    workspaceId,
    coopId: coop.id,
    seasonId: season.id,
    lotId: lot.id,
    rateCardId: rc.id,
    rateCardSha256: card.sha256,
    runId: run.id,
    runSlug: run.runSlug,
    runSeq: run.runSeq,
    memberId,
    slipRow,
    fields0462: { gross: f("gross_kg"), tare: f("tare_kg"), net: f("net_kg") },
  };
}

/** The deterministic test key pair registerKey stores for one key id in one workspace. */
export function testKeyPair(workspaceId: string, keyId: string, seed?: string) {
  return ed25519FromSeed(sha256Hex(seed ?? `runs-slice test key ${keyId} ${workspaceId}`));
}

/** A registered officer device key (`device_keys`), with its private half for the test to sign with. */
export async function registerKey(
  db: Db,
  workspaceId: string,
  k: { keyId: string; persona: string; kind?: "app" | "web_demo"; seed?: string; revokedAt?: Date | null },
) {
  const pair = testKeyPair(workspaceId, k.keyId, k.seed);
  await db.insert(schema.deviceKeys).values({
    workspaceId,
    keyId: k.keyId,
    persona: k.persona,
    publicKey: Buffer.from(pair.publicKeyHex, "hex").toString("base64url"),
    kind: k.kind ?? "app",
    revokedAt: k.revokedAt ?? null,
  });
  return pair;
}
