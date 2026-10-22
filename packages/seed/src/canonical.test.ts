// canonical.test.ts (register §2): every figure of the canonical world, to the cent. This file is
// the one place the register's figures are typed; everything it checks was computed by the engine.
import {
  DeviceKeyId,
  type EngineInput,
  type ProofBundle,
  SeasonSnapshot,
  SeededKeyId,
} from "@fairsplit/contracts";
import {
  approvalBytes,
  approvalSignatureValid,
  attestedEntries,
  batchDigest,
  batchNote,
  buildApprovalPayload,
  checkApproval,
  computeLines,
  ed25519FromSeed,
  ed25519Sign,
  expectedSigner,
  factsBeforeRules,
  format,
  jcsSha256,
  lineSha256,
  paypalRequestId,
  quotesInTextLayer,
  verifyChain,
} from "@fairsplit/domain";
import { describe, expect, it } from "vitest";
import {
  getComputation,
  getFigures,
  getHolds,
  getLine,
  getMember,
  getMembers,
  getPhotos,
  getRateCard,
  getRun,
  getSlips,
  getSnapshot,
} from "./index.js";
import { textLayerString } from "./ratecard.js";

const s = getSnapshot();
const f = getFigures();
const FX = s.fx.centavosPerCent;
const resolved = getComputation("resolved");
const byHand = getComputation("byHand");
const read = getComputation("read");

describe("snapshot", () => {
  it("validates against the IC-03 schema and is labelled seeded", () => {
    expect(SeasonSnapshot.safeParse(s).success).toBe(true);
    expect(s.provenance).toBe("seeded");
  });
});

describe("co-op, people and season", () => {
  it("Bulawanon Kakaw Growers MPC: 64 members (26 women), one bodega and two purok pickups", () => {
    expect(s.coop).toMatchObject({
      name: "Bulawanon Kakaw Growers MPC",
      locality: "Calinan, Davao City",
      commodity: "cacao",
    });
    expect(getMembers()).toHaveLength(64);
    expect(f.members).toBe(64);
    expect(getMembers().filter((m) => m.gender === "F")).toHaveLength(26);
    expect(f.women).toBe(26);
    expect(s.coop.stations.map((x) => x.station)).toEqual(["BODEGA", "PUROK_2", "PUROK_4"]);
    expect(new Set(getMembers().map((m) => m.memberNo)).size).toBe(64);
  });

  it("officers, the clerk's initials on every slip, and the payer", () => {
    const o = Object.fromEntries(s.officers.map((x) => [x.role, x]));
    expect(o.TREASURER).toMatchObject({ name: "Analyn R. Sumalinog", initials: "AS" });
    expect(o.CHAIR).toMatchObject({ name: "Ernesto P. Cabahug", initials: "EC", keyId: "fs-ernesto-a1" });
    expect(o.SECRETARY?.name).toBe("Ma. Theresa L. Gumapac");
    expect(o.CLERK).toMatchObject({ name: "Jessie D. Dumaguing", initials: "JD" });
    expect(getSlips().every((x) => x.clerkInitials === "JD")).toBe(true);
    expect(s.payer).toMatchObject({
      name: "Lantern Bay Chocolate Co.",
      city: "Oakland",
      contactName: "Dana Whitfield-Santos",
      contactTitle: "Sourcing Director",
    });
  });

  it("Season 2026-A, 1 Apr–31 Aug; lot LB-PH-2026-03: 154 jute sacks, 9,625 kg (9,240 kg Grade 1), shipped 18 Sep", () => {
    expect(s.season).toMatchObject({
      code: "2026A",
      label: "2026-A",
      opensOn: "2026-04-01",
      closesOn: "2026-08-31",
    });
    expect(s.lot).toMatchObject({
      lotCode: "LB-PH-2026-03",
      sacks: 154,
      sackKind: "jute",
      shippedG: 9_625_000,
      grade1ShippedG: 9_240_000,
      shippedOn: "2026-09-18",
    });
  });
});

describe("rate card BR 2026-04", () => {
  const card = getRateCard();
  it("ratified 14 Mar 2026, before slip 0301, and its hash is computed", () => {
    expect(card.canonical.resolutionNo).toBe("BR 2026-04");
    expect(card.canonical.ratifiedOn).toBe("2026-03-14");
    expect(card.sha256).toBe(jcsSha256(card.canonical));
    expect(card.rc8).toBe(card.sha256.slice(0, 8));
    expect(card.sha16).toBe(card.sha256.slice(0, 16));
    const first = getSlips().find((x) => x.serial === "0301");
    expect(first?.slipDate).toBe("2026-04-02");
    expect(s.season.firstSlipOn).toBe("2026-04-02");
    expect(
      factsBeforeRules(
        card.ratifiedAt,
        getSlips().map((x) => x.slipDate),
      ),
    ).toEqual([]);
    expect(card.canonical.documents[0]?.sha256).toBe(jcsSha256(card.textLayer));
  });

  it("Schedule A R0–R4, co-sign over US$300 / US$150 / any override, ±2.0%, 1.6 kg a tree, 0.85", () => {
    const r = card.canonical.rules;
    expect(r.cbu).toMatchObject({ bp: 500, paidUpCapCentavos: 500_000 });
    expect(r.hauling).toMatchObject({ centavosPerNetKg: 150, stations: ["PUROK_2", "PUROK_4"] });
    expect(r.loan.capBp).toBe(5_000);
    expect(r.advance.capBp).toBe(3_000);
    expect(r.cosign).toMatchObject({ batchOverCents: 30_000, lineOverCents: 15_000, anyOverride: true });
    expect(r.tolerances).toMatchObject({ massBalanceTolBp: 200, kgPerTreeMaxG: 1_600, autoAcceptBp: 8_500 });
    expect(r.closedList.deductionRuleIds).toEqual(["R1", "R2", "R3", "R4"]);
    expect(card.canonical.pricing).toMatchObject({
      premiumCentsPerShippedKg: 30,
      bonusCentsPerShippedGrade1Kg: 15,
      disbursementCents: 6_000,
    });
    expect([...new Set(card.canonical.terms.map((t) => t.ruleId))]).toEqual([
      "CLOSED",
      "R0",
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
    ]);
    expect(quotesInTextLayer(card.canonical, textLayerString())).toEqual([]);
    expect(textLayerString()).toContain("General Assembly");
  });
});

describe("invoice (C-09)", () => {
  it("US$4,333.50 = 2,887.50 premium + 1,386.00 bonus + 60.00 disbursement, about ₱270,844", () => {
    expect(f.invoiceCents).toBe(433_350);
    expect(f.premiumPoolCents).toBe(288_750);
    expect(f.bonusPoolCents).toBe(138_600);
    expect(f.disbursementCents).toBe(6_000);
    expect(f.premiumPoolCents + f.bonusPoolCents + f.disbursementCents).toBe(f.invoiceCents);
    expect(getRun().invoice).toMatchObject({
      invoiceNumber: "FS-2026A-r37",
      amountCents: 433_350,
      dueCents: 0,
      reference: `rc:${getRateCard().sha16}`,
      note: `Season 2026-A, RC ${format.hashGroups(getRateCard().sha256)}, lot LB-PH-2026-03`,
      autoCancelOn: format.addDays(getRun().invoice.invoiceDate, 25),
    });
    expect(f.display.invoicePesoEstimate).toBe("about ₱270,844 (estimate)");
    expect(getRun().quote.items.map((i) => i.unitAmountCents)).toEqual([288_750, 138_600, 6_000]);
    expect(getRun().quoteSha256).toBe(jcsSha256(getRun().quote));
  });
});

describe("evidence", () => {
  it("264 slip images in 66 photos, 4 per photo: serials 0301–0563 plus one pink duplicate", () => {
    expect(getSlips()).toHaveLength(264);
    expect(getPhotos()).toHaveLength(66);
    expect(getPhotos().every((p) => p.slips.length === 4)).toBe(true);
    const whites = getSlips()
      .filter((x) => x.copy === "WHITE_ORIGINAL")
      .map((x) => Number(x.serial));
    expect(whites).toHaveLength(263);
    expect([...whites].sort((a, b) => a - b)).toEqual(Array.from({ length: 263 }, (_, k) => 301 + k));
    const pinks = getSlips().filter((x) => x.copy !== "WHITE_ORIGINAL");
    expect(pinks.map((x) => [x.serial, x.copy])).toEqual([["0457", "PINK_DUPLICATE"]]);
  });

  it("replay set A–L: 48 slips with every hero case, all legible except the by-hand field", () => {
    const replay = getPhotos("REPLAY");
    expect(replay.map((p) => p.photoId)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
    ]);
    const slips = getSlips().filter((x) => x.replaySet);
    expect(slips).toHaveLength(48);
    const at = (serial: string, copy = "WHITE_ORIGINAL") =>
      slips.find((x) => x.serial === serial && x.copy === copy)?.photoId;
    expect(at("0457")).toBe("B");
    expect(at("0457", "PINK_DUPLICATE")).toBe("D");
    for (const hero of ["0458", "0462", "0449", "0467"]) expect(at(hero)).toBeDefined();
    expect(slips.some((x) => x.memberNo === "M-053" && x.plotNo === "P-053-B")).toBe(true);
    expect(slips.filter((x) => x.artifacts.length > 0).map((x) => x.serial)).toEqual(["0462"]);
    expect(slips.filter((x) => x.marks.length > 0).map((x) => x.serial)).toEqual(["0458"]);
    expect(replay.every((p) => p.readOn === null && p.readProvenance === "replay")).toBe(true);
  });

  it("photos P01–P54 carry the earlier read events, each with its own date", () => {
    const earlier = getPhotos("EARLIER");
    expect(earlier).toHaveLength(54);
    expect(earlier[0]?.photoId).toBe("P01");
    expect(earlier.at(-1)?.photoId).toBe("P54");
    for (const p of earlier) {
      expect(p.readOn).toMatch(/^2026-(0[4-9])-\d{2}$/);
      const last = getSlips({ photoId: p.photoId })
        .map((x) => x.slipDate)
        .sort()
        .at(-1) as string;
      expect(p.readOn && p.readOn > last).toBe(true);
    }
  });

  it("logbook page 14 (July): 0457 once, 0458 remark, line 7 = 0462 reading 64.50", () => {
    const page = s.logbook.find((p) => p.page === 14);
    expect(page?.month).toBe("2026-07");
    expect(page?.lines.filter((l) => l.serial === "0457")).toHaveLength(1);
    expect(page?.lines.find((l) => l.serial === "0458")?.remark).toBe("multa GA ₱200");
    expect(page?.lines.find((l) => l.lineNo === 7)).toMatchObject({ serial: "0462", netKgText: "64.50" });
  });
});

describe("kilos and mass balance", () => {
  it("9,780.6 kg verified (9,388.0 kg Grade 1); shrink 1.62%, or 2.05% with 0457 counted twice", () => {
    expect(f.verifiedG).toBe(9_780_600);
    expect(f.verifiedGrade1G).toBe(9_388_000);
    expect(resolved.massBalance).toMatchObject({
      status: "INSIDE",
      shrinkBp: 162,
      verifiedG: 9_780_600,
      grade1G: 9_388_000,
    });
    expect(byHand.massBalance).toMatchObject({ status: "OUTSIDE", shrinkBp: 205, verifiedG: 9_822_600 });
    expect(f.display.shrinkOnce).toBe("1.62%");
    expect(f.display.shrinkTwice).toBe("2.05%");
    expect(f.display.verified).toBe("9,780.6 kg");
    expect(f.display.verifiedGrade1).toBe("9,388.0 kg");
  });
});

describe("lines (register §2 arithmetic)", () => {
  it("gross 4,273.50 = the pool; deductions 58.53; credits 3.20; net 4,218.17 = 368.39 PayPal (8) + 3,849.78 cash (56)", () => {
    const c = resolved.conservation;
    expect(c.balanced).toBe(true);
    expect(c.grossCents).toBe(427_350);
    expect(c.poolCents).toBe(427_350);
    expect(c.deductionsCents).toBe(5_853);
    expect(c.creditsCents).toBe(320);
    expect(c.netCents).toBe(421_817);
    expect(c.onRailNetCents).toBe(36_839);
    expect(c.offRailNetCents).toBe(384_978);
    expect(c.carriedNetCents).toBe(0);
    expect(resolved.lines.filter((l) => l.rail === "PAYPAL")).toHaveLength(8);
    expect(resolved.lines.filter((l) => l.rail === "CASH")).toHaveLength(56);
    expect(resolved.lines.every((l) => l.state === "READY")).toBe(true);
    expect(f.display).toMatchObject({
      gross: "US$4,273.50",
      deductions: "US$58.53",
      credits: "US$3.20",
      net: "US$4,218.17",
    });
    expect(f.display.premiumRate).toBe("US$0.29523 a kg");
  });

  it("redirected US$21.14 = 17.94 (duplicate slip) + 3.20 (multa returned)", () => {
    expect(f.redirectedCents).toBe(2_114);
    expect(f.redirectedDuplicateCents).toBe(1_794);
    expect(f.redirectedCreditCents).toBe(320);
  });

  it("the nine named members, exactly", () => {
    const rows: [string, string, string, "PAYPAL" | "CASH", number, number, number][] = [
      ["M-014", "Consolacion Bacus", "ceb", "PAYPAL", 148_000, 148_000, 6_445],
      ["M-007", "Dionisio Lapinig", "ceb", "PAYPAL", 144_000, 144_000, 6_271],
      ["M-060", "Arnel Sumampao", "fil", "PAYPAL", 128_500, 128_500, 5_596],
      ["M-018", "Teodoro Pacaña", "ceb", "PAYPAL", 120_400, 120_400, 5_563],
      ["M-039", "Jonathan Ripalda", "en", "PAYPAL", 88_000, 88_000, 3_832],
      ["M-022", "Pedro Ompad", "ceb", "PAYPAL", 96_500, 80_000, 3_440],
      ["M-002", "Florencia Ybañez", "ceb", "PAYPAL", 74_000, 60_000, 3_027],
      ["M-031", "Rhea Jumawan", "en", "PAYPAL", 61_200, 61_200, 2_665],
      ["M-053", "Merlyn Ponce", "ceb", "CASH", 300_000, 280_000, 12_784],
    ];
    for (const [no, name, lang, rail, g, g1, net] of rows) {
      const m = getMember(no);
      const l = getLine(no);
      expect(m, no).toMatchObject({ displayName: name, lang, rail, named: true });
      expect(l, no).toMatchObject({ verifiedG: g, grade1G: g1, netCents: net });
    }
    expect(getMembers().filter((m) => m.named)).toHaveLength(9);
  });

  it("M-014 hero line: 43.69 + 21.85 − CBU 1.09 = 64.45, about ₱4,028; slips 0403 (38.45 kg), 0419, 0436, 0467", () => {
    const l = getLine("M-014");
    expect(l).toMatchObject({
      premiumCents: 4_369,
      bonusCents: 2_185,
      deductionsCents: 109,
      creditsCents: 0,
      netCents: 6_445,
    });
    expect(l?.deductions).toEqual([
      expect.objectContaining({ ruleId: "R1", category: "CBU", amountCents: 109 }),
    ]);
    expect(format.pesoEstimate(6_445, FX, "ceb")).toBe("mga ₱4,028 (gibanabana)");
    expect(getMember("M-014")?.slipSerials).toEqual(["0403", "0419", "0436", "0467"]);
    expect(getSlips().find((x) => x.serial === "0403")).toMatchObject({
      netG: 38_450,
      payableG: 38_450,
      boxes: { "8": "38.45" },
    });
    expect(getMember("M-014")?.consoleName).toBe("Nang Celing");
  });

  it("M-007 H1: 62.71, or 80.65 with the duplicate", () => {
    expect(getLine("M-007")?.netCents).toBe(6_271);
    expect(getLine("M-007", "byHand")?.netCents).toBe(8_065);
    expect(
      getSlips()
        .filter((x) => x.serial === "0457")
        .every((x) => x.memberNo === "M-007" && x.netG === 42_000),
    ).toBe(true);
  });

  it("M-060: field 0462 entered by hand; 64.80 gross − 0.30 tare = 64.50 net", () => {
    expect(getSlips().find((x) => x.serial === "0462")).toMatchObject({
      memberNo: "M-060",
      grossG: 64_800,
      tareG: 300,
      netG: 64_500,
      artifacts: ["WATER_STAIN"],
    });
    expect(read.holds.find((h) => h.kind === "LOW_CONFIDENCE")).toMatchObject({
      gate: "BLOCKS_APPROVAL",
      memberNo: "M-060",
    });
  });

  it("M-018 H3: ₱200 multa returned as +3.20; hauling ₱91.20 stays", () => {
    const l = getLine("M-018");
    expect(l).toMatchObject({
      creditsCents: 320,
      premiumCents: 3_555,
      bonusCents: 1_777,
      deductionsCents: 89,
    });
    expect(l?.credits[0]).toMatchObject({ serial: "0458", phpCentavos: 20_000, amountCents: 320 });
    const slip = getSlips().find((x) => x.serial === "0458");
    expect(slip?.marks.map((m) => [m.text, m.ruleId, m.writtenCentavos])).toEqual([
      ["Hauling ₱91.20", "R2", 9_120],
      ["Multa (absent GA) ₱200", "NO_MATCH", 20_000],
    ]);
    expect(slip?.station).toBe("PUROK_2");
    for (const out of [read, byHand, resolved])
      expect(out.holds.some((h) => h.kind === "RATE_MISMATCH")).toBe(false);
  });

  it("M-022: loan −5.90 at the 50% cap; ₱31.25 carried to next season", () => {
    const d = getLine("M-022")?.deductions;
    expect(d).toEqual([
      {
        ruleId: "R3",
        category: "LOAN",
        computedCents: 640,
        capCents: 590,
        amountCents: 590,
        ref: "ATD-2026-022",
        carriedCentavos: 3_125,
      },
    ]);
    expect(format.money(3_125, "PHP")).toBe("₱31.25");
    expect(getLine("M-022")?.bonusCents).toBe(1_181);
  });

  it("M-002 signs with a thumbmark (audio first); M-031 is the unclaimed case, then cash", () => {
    expect(getMember("M-002")).toMatchObject({ signsWith: "THUMBMARK", audioFirst: true });
    expect(getSlips({ memberNo: "M-002" }).every((x) => x.signature === "THUMBMARK")).toBe(true);
    expect(getMember("M-031")).toMatchObject({ rail: "PAYPAL", receiverKind: "NO_PAYPAL_ACCOUNT" });
    const item = getRun().items.find((i) => i.memberNo === "M-031");
    expect(item).toMatchObject({ amountCents: 2_665, status: "RETURNED", lineState: "OFF_RAIL_DUE" });
    expect(getRun().lineStates["M-031"]).toBe("OFF_RAIL_DUE");
  });

  it("M-053 H2: 300.0 kg (280.0) from 140 trees; registers P-053-B (0.60 ha, 330 trees); 127.84 cash, about ₱7,990", () => {
    const m = getMember("M-053");
    expect(m?.plots.find((p) => p.registered)?.trees).toBe(140);
    expect(m?.plots.find((p) => p.plotNo === "P-053-B")).toMatchObject({
      areaHa: "0.60",
      trees: 330,
      registered: false,
    });
    expect(getLine("M-053")).toMatchObject({
      premiumCents: 8_857,
      bonusCents: 4_134,
      deductionsCents: 207,
      netCents: 12_784,
    });
    expect(format.pesoEstimate(12_784, FX, "en")).toBe("about ₱7,990 (estimate)");
    const h2 = resolved.holds.find((h) => h.key === "IMPLAUSIBLE_YIELD:M-053");
    expect(h2?.params).toMatchObject({
      registeredTrees: 140,
      kgPerTree: "2.14",
      treesAfter: 470,
      kgPerTreeAfter: "0.64",
    });
  });
});

describe("holds: exactly H1, H2, H3, field 0462 by hand, and the mass-balance dial", () => {
  it("lists the five seed items with the design's engine lines", () => {
    const holds = getHolds();
    expect(holds.map((h) => [h.label, h.kind, h.gate])).toEqual([
      ["H1", "DUPLICATE_SLIP", "BLOCKS_APPROVAL"],
      ["H2", "IMPLAUSIBLE_YIELD", "BLOCKS_APPROVAL"],
      ["H3", "NO_RULE", "RESERVES_LINE"],
      ["Slip 0462 by hand", "LOW_CONFIDENCE", "BLOCKS_APPROVAL"],
      ["Mass balance", "MASS_BALANCE", "BLOCKS_APPROVAL"],
    ]);
    expect(holds[0]?.engineLine).toBe(
      "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit.",
    );
    expect(holds[1]?.engineLine).toBe(
      "Merlyn Ponce: 300.0 kg from 140 registered trees is 2.14 kg a tree. The limit is 1.6.",
    );
    expect(holds[1]?.resolvedLine).toBe("300.0 kg from 470 trees is 0.64 kg a tree. Inside the limit.");
    expect(holds[2]?.engineLine).toBe(
      "'Multa (absent GA) ₱200' on slip 0458 matches no Schedule A rule. It was netted from Nong Tidoy's cash at the bodega, so it returns as a US$3.20 correction credit paid by the co-op, not from Lantern Bay's pool. Hauling ₱91.20 (R2) stays.",
    );
    expect(holds[3]?.resolvedLine).toBe("64.80 − 0.30 tare = 64.50 net. Matches logbook line 7.");
    expect(holds[4]?.resolvedLine).toBe("Shrink 1.62%, inside 2.0%.");
    for (const h of holds) expect(h.claudeLine ?? "").not.toMatch(/\d/);
  });

  it("the engine raises exactly those, no more, at every checkpoint", () => {
    expect(read.holds.map((h) => [h.kind, h.state])).toEqual([
      ["DUPLICATE_SLIP", "OPEN"],
      ["IMPLAUSIBLE_YIELD", "OPEN"],
      ["NO_RULE", "OPEN"],
      ["LOW_CONFIDENCE", "OPEN"],
    ]);
    expect(read.massBalance.status).toBe("PENDING");
    expect(byHand.holds.map((h) => [h.kind, h.state])).toEqual([
      ["DUPLICATE_SLIP", "OPEN"],
      ["IMPLAUSIBLE_YIELD", "OPEN"],
      ["NO_RULE", "OPEN"],
      ["LOW_CONFIDENCE", "RESOLVED"],
      ["MASS_BALANCE", "OPEN"],
    ]);
    expect(resolved.holds.every((h) => h.state === "RESOLVED")).toBe(true);
    expect(resolved.holds).toHaveLength(5);
    expect(resolved.approvalBlocked).toBe(false);
    expect(byHand.lines.find((l) => l.memberNo === "M-018")?.state).toBe("HELD");
  });

  it("slip 0449 is quarantined as a notice, not a hold; it belongs to a cash member", () => {
    expect(s.quarantineNotices).toEqual([
      {
        serial: "0449",
        photoId: "I",
        notice:
          "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction.",
      },
    ]);
    for (const out of [read, byHand, resolved]) {
      expect(out.quarantines.map((q) => [q.serial, q.hold])).toEqual([["0449", false]]);
      expect(out.holds.some((h) => h.kind === "SUSPECTED_INJECTION")).toBe(false);
    }
    const slip = getSlips().find((x) => x.serial === "0449");
    expect(getMember(slip?.memberNo ?? "")?.rail).toBe("CASH");
    expect(slip?.marginNote).toBeTruthy();
  });
});

describe("batch, approvals and end state", () => {
  const run = getRun();
  it("8 items, US$368.39; IDs per the register's field table, hashes computed", () => {
    expect(f.batchItemCount).toBe(8);
    expect(f.batchTotalCents).toBe(36_839);
    expect(run.items).toHaveLength(8);
    expect(run.runSlug).toBe("2026A-r37");
    expect(run.senderBatchId).toBe(`2026A-${getRateCard().rc8}-r37`);
    expect(run.paypalRequestId).toBe(paypalRequestId(run.senderBatchId));
    expect(run.items.map((i) => i.senderItemId)).toEqual(run.items.map((i) => `r37-${i.memberNo}`));
    const d = batchDigest(
      { runId: run.id, senderBatchId: run.senderBatchId, rateCardSha256: getRateCard().sha256 },
      run.items.map(({ senderItemId, receiver, amountCents, currency }) => ({
        senderItemId,
        receiver,
        amountCents,
        currency,
      })),
    );
    expect(d.batchSha256).toBe(run.batchSha256);
    expect(d.totalCents).toBe(36_839);
    expect(run.batchNote).toBe(`Fair Split 2026-A, batch ${run.batchSha256.slice(0, 8)}`);
  });

  it("two Ed25519 signatures over the same batch; the Chair is needed because the batch is over US$300", () => {
    expect(run.approvals.map((a) => [a.role, a.keyId])).toEqual([
      ["treasurer", "fs-analyn-s1"],
      ["chair", "fs-ernesto-s1"],
    ]);
    const registered = attestedEntries(s.proof.ledger, "key.registered");
    for (const a of run.approvals) {
      expect(a.payload.batchSha256).toBe(run.batchSha256);
      expect(a.payload).toMatchObject({ itemCount: 8, totalCents: 36_839, currency: "USD" });
      const key = registered.find((e) => e.payload.keyId === a.keyId)?.payload.publicKeyHex ?? "";
      expect(approvalSignatureValid(a, key)).toBe(true);
    }
    expect(run.chairNeeded).toEqual({ required: true, reasons: ["BATCH_OVER_THRESHOLD"] });
  });

  it("end state: 7 paid by PayPal (US$341.74), 57 in cash (US$3,876.43); Proof shows 7 of 64 members, 8.1% of value", () => {
    expect(f.endPaidMembers).toBe(7);
    expect(f.endPaidCents).toBe(34_174);
    expect(f.endCashMembers).toBe(57);
    expect(f.endCashCents).toBe(387_643);
    expect(f.display.proofShare).toBe("7 of 64 members, 8.1% of value");
    expect(run.items.filter((i) => i.status === "SUCCESS")).toHaveLength(7);
    expect(Object.values(run.lineStates).filter((x) => x === "PAID")).toHaveLength(7);
    expect(Object.values(run.lineStates).filter((x) => x === "OFF_RAIL_DUE")).toHaveLength(57);
  });

  it("fees: published US rate 8 × US$0.25 = US$2.00; to the Philippines 2% = US$7.37; both inside the US$60.00 line", () => {
    expect(f.feesSandboxCents).toBe(200);
    expect(f.feesProductionCents).toBe(737);
    expect(Math.max(f.feesSandboxCents, f.feesProductionCents)).toBeLessThanOrEqual(f.disbursementCents);
  });
});

describe("everything is computed, never typed", () => {
  it("recomputing the lines from the snapshot's members and slips reproduces every checkpoint", () => {
    const members = getMembers().map((m) => ({
      memberNo: m.memberNo,
      rail: m.rail,
      registeredTrees: m.plots.filter((p) => p.registered).reduce((t, p) => t + p.trees, 0),
      cbuPaidUpCentavos: m.cbuPaidUpCentavos,
      loans: m.loans,
      advances: m.advances,
    }));
    const rows = getSlips().map((x) => ({
      rowId: x.rowId,
      documentId: x.documentId,
      photoId: x.photoId,
      serial: x.serial,
      copy: x.copy,
      memberNo: x.memberNo,
      slipDate: x.slipDate,
      station: x.station,
      netG: x.netG,
      payableG: x.payableG,
      grade: x.grade,
      plotNo: x.plotNo,
      pendingFields: [],
      enteredByHand: x.serial === "0462",
      marks: x.marks.map((m) => ({
        ...m,
        ruleId: m.ruleId as EngineInput["rows"][number]["marks"][number]["ruleId"],
      })),
      anomalies: x.marginNote
        ? [
            {
              anomalyId: `anomaly-${x.serial}-1`,
              kind: "INSTRUCTION_LIKE_TEXT" as const,
              quarantined: true,
              overlap: "NONE" as const,
              source: "read_a" as const,
            },
          ]
        : [],
    }));
    const card = getRateCard();
    const { id: _id, textLayer: _t, ...ratified } = card;
    const priorHolds = [...read.holds, ...byHand.holds]
      .filter((h, i, all) => all.findIndex((x) => x.key === h.key) === i)
      .map((h) => ({ key: h.key, kind: h.kind, gate: h.gate, memberNo: h.memberNo }));
    const resolutions = resolved.holds
      .filter(
        (h) =>
          h.resolution && ["COUNT_ONCE", "REGISTER_PLOT", "RETURN_AS_CREDIT"].includes(h.resolution.kind),
      )
      .map((h) => {
        const at = h.resolution?.at as string;
        if (h.resolution?.kind === "REGISTER_PLOT") {
          return {
            holdKey: h.key,
            resolution: "REGISTER_PLOT" as const,
            plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 },
            by: h.resolution.by,
            at,
          };
        }
        return {
          holdKey: h.key,
          resolution: h.resolution?.kind as "COUNT_ONCE" | "RETURN_AS_CREDIT",
          by: h.resolution?.by as string,
          at,
        };
      });
    const { lotCode, shippedG, grade1ShippedG, sacks, sackKind, shippedOn } = s.lot;
    const again = computeLines({
      card: ratified,
      lot: { lotCode, shippedG, grade1ShippedG, sacks, sackKind, shippedOn },
      fx: FX,
      members,
      rows,
      nearDuplicates: [],
      resolutions,
      priorHolds,
    });
    expect(again).toEqual(resolved);
    for (const l of again.lines) {
      const { lineSha256: h, ...rest } = l;
      expect(lineSha256(rest, card.sha256)).toBe(h);
    }
  });

  it("the Proof bundle verifies: chain intact and all six plates match", () => {
    const v = verifyChain(s.proof);
    expect(v.chain.ok).toBe(true);
    expect(v.plates).toEqual({
      paid: { ok: true, reason: null },
      ratified: { ok: true, reason: null },
      read: { ok: true, reason: null },
      computed: { ok: true, reason: null },
      twoKeys: { ok: true, reason: null },
      payoutItems: { ok: true, reason: null },
    });
    expect(s.proof.documents).toHaveLength(66);
    expect(s.proof.lines).toHaveLength(64);
    const tampered = {
      ...s.proof,
      batch: {
        ...s.proof.batch,
        items: s.proof.batch.items.map((i, k) => (k === 0 ? { ...i, amountCents: i.amountCents + 100 } : i)),
      },
    };
    expect(verifyChain(tampered).ok).toBe(false);
  });
});

describe("seeded keys never stand in for a person (I6)", () => {
  const run = getRun();
  const deviceIds = s.officers.map((o) => o.keyId).filter((k): k is string => k !== null);

  it("no seeded approval carries a device key ID fs-{persona}-{a|w}{n}; officers keep theirs as identity only", () => {
    expect(deviceIds).toEqual(["fs-analyn-a1", "fs-ernesto-a1"]);
    for (const a of [...run.approvals, ...s.proof.approvals]) {
      expect(DeviceKeyId.safeParse(a.keyId).success, a.keyId).toBe(false);
      expect(SeededKeyId.safeParse(a.keyId).success, a.keyId).toBe(true);
    }
    const registered = attestedEntries(s.proof.ledger, "key.registered");
    expect(registered.map((e) => [e.payload.keyId, e.payload.kind])).toEqual([
      ["fs-analyn-s1", "seeded"],
      ["fs-ernesto-s1", "seeded"],
    ]);
    // A device key ID appears only once, as the officer's identity, never next to a public key.
    const text = JSON.stringify(s);
    for (const id of deviceIds) {
      expect(registered.some((e) => e.payload.keyId === id)).toBe(false);
      expect(text.split(`"keyId":"${id}"`).length - 1).toBe(1);
    }
  });

  it("the server refuses the seeded approvals even when everything else matches", () => {
    for (const a of run.approvals) {
      const now = new Date(Date.parse(a.payload.exp) - 60_000);
      // Even a registry that wrongly listed the seeded key yields no signer for it.
      const registry = [
        {
          keyId: a.keyId,
          approverId: a.payload.approverId,
          role: a.role,
          publicKeyHex: a.publicKeyHex,
          kind: "app" as const,
          revokedAt: null,
        },
      ];
      expect(expectedSigner(registry, a.role, a.keyId, now)).toMatchObject({
        ok: false,
        code: "KEY_NOT_REGISTERED",
      });
      const r = checkApproval(
        a,
        {
          runId: run.id,
          seasonId: s.season.id,
          rateCardSha256: getRateCard().sha256,
          batchSha256: run.batchSha256,
          itemCount: 8,
          totalCents: 36_839,
          role: a.role,
          keyId: a.keyId,
          publicKeyHex: a.publicKeyHex,
          approverId: a.payload.approverId,
        },
        now,
        new Set(),
      );
      expect(r).toMatchObject({ ok: false, code: "KEY_NOT_REGISTERED" });
    }
  });
});

describe("the Proof bundle is bound to its ledger (S3.12)", () => {
  const p = s.proof;
  const run = getRun();

  it("every plate's facts are in the chain", () => {
    expect(attestedEntries(p.ledger, "rate_card.ratified").map((e) => e.payload.rateCardSha256)).toEqual([
      getRateCard().sha256,
    ]);
    expect(attestedEntries(p.ledger, "invoice.funded").map((e) => e.payload)).toEqual([
      { runId: run.id, ...p.invoice },
    ]);
    expect(p.invoice.amountCents).toBe(433_350);
    expect(attestedEntries(p.ledger, "rows.accepted")).toHaveLength(66);
    expect(attestedEntries(p.ledger, "lines.computed")[0]?.payload).toMatchObject({
      lineCount: 64,
      premiumPoolCents: 288_750,
      bonusPoolCents: 138_600,
      netCents: 421_817,
      onRailNetCents: 36_839,
      balanced: true,
    });
    expect(attestedEntries(p.ledger, "payout.submitting").map((e) => e.payload)).toEqual([
      {
        runId: run.id,
        senderBatchId: run.senderBatchId,
        batchSha256: run.batchSha256,
        itemCount: 8,
        totalCents: 36_839,
        note: `Fair Split 2026-A, batch ${run.batchSha256.slice(0, 8)}`,
      },
    ]);
    expect(p.batch.note).toBe(run.batchNote);
    const applied = attestedEntries(p.ledger, "webhook.applied").map((e) => e.payload.eventId);
    for (const it of p.batch.items) expect(applied).toContain(it.eventId);
    expect(
      attestedEntries(p.ledger, "approval.signed").map((e) => [e.payload.role, e.payload.keyId]),
    ).toEqual([
      ["treasurer", "fs-analyn-s1"],
      ["chair", "fs-ernesto-s1"],
    ]);
  });

  it("refuses the reviewer's attack: a new receiver, a re-hashed batch and approvals re-signed with other keys", () => {
    const items = p.batch.items.map((i, k) => (k === 0 ? { ...i, receiver: "attacker@evil.example" } : i));
    const d = batchDigest(
      { runId: p.batch.runId, senderBatchId: p.batch.senderBatchId, rateCardSha256: p.batch.rateCardSha256 },
      items.map(({ senderItemId, receiver, amountCents, currency }) => ({
        senderItemId,
        receiver,
        amountCents,
        currency,
      })),
    );
    const approvals = p.approvals.map((a) => {
      const key = ed25519FromSeed(jcsSha256({ attacker: a.role }));
      const payload = buildApprovalPayload({
        runId: p.runId,
        seasonId: a.payload.seasonId,
        rateCardSha256: p.rateCard.sha256,
        batch: d,
        role: a.role,
        approverId: a.payload.approverId,
        nonce: a.payload.nonce,
        exp: a.payload.exp,
      });
      return {
        ...a,
        payload,
        publicKeyHex: key.publicKeyHex,
        signatureHex: ed25519Sign(key.privateKey, approvalBytes(payload)),
      };
    });
    const forged: ProofBundle = {
      ...p,
      approvals,
      batch: { ...p.batch, items, batchSha256: d.batchSha256, note: batchNote("2026-A", d.batchSha256) },
    };
    const v = verifyChain(forged);
    expect(v.ok).toBe(false);
    expect(v.chain.ok).toBe(true);
    expect(v.plates.payoutItems).toEqual({
      ok: false,
      reason: "The posted batch differs from the one in the chain.",
    });
    expect(v.plates.twoKeys.ok).toBe(false);
    expect(v.plates.paid.ok && v.plates.ratified.ok && v.plates.read.ok && v.plates.computed.ok).toBe(true);
  });
});
