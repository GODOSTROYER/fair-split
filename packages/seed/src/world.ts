// Assembles the canonical world: 64 members, 263 slips (0301–0563) plus the pink copy of 0457 as
// 264 slip images in 66 photos (replay set A–L, earlier photos P01–P54), logbook page 14, the
// ratified card and the lot. Deterministic: every random choice comes from a labelled PRNG stream.
import type {
  CopyColor,
  EngineMember,
  EngineRow,
  RatifiedRateCard,
  SnapshotLogbookPage,
  SnapshotMember,
  SnapshotPhoto,
  SnapshotSlip,
} from "@fairsplit/contracts";
import {
  bpHalfUp,
  format,
  jcsSha256,
  largestRemainder,
  mulDivHalfUp,
  parseWrittenCentavos,
  payTimeDeductions,
  quoteInvoice,
  uuidv7,
} from "@fairsplit/domain";
import {
  type BgKilos,
  backgroundNumbers,
  DKG,
  FINAL_TOTALS,
  type TuneResult,
  tuneBackground,
} from "./background.js";
import {
  BY_HAND_SERIAL,
  COOP,
  DUPLICATE_SERIAL,
  FX,
  INJECTION_SERIAL,
  INJECTION_TEXT,
  LOT,
  REPLAY_FIRST,
  REPLAY_LAST,
  SEASON,
} from "./constants.js";
import { NAMED, type SlipSpec } from "./named.js";
import { MEN_FIRST, SURNAMES, WOMEN_FIRST } from "./names.js";
import { rng } from "./prng.js";
import { buildRateCard } from "./ratecard.js";

type Position = "TL" | "TR" | "BL" | "BR";
const POSITIONS: Position[] = ["TL", "TR", "BL", "BR"];

/** Replay set A–L: 47 serials (0425–0471) plus the pink copy of 0457. 0457 white is in B, pink in D. */
export const REPLAY_LAYOUT: Record<string, { serial: number; copy: CopyColor }[]> = {
  A: [425, 426, 427, 428].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  B: [455, 456, 457, 458].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  C: [429, 430, 431, 432].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  D: [
    { serial: 457, copy: "PINK_DUPLICATE" },
    { serial: 459, copy: "WHITE_ORIGINAL" },
    { serial: 460, copy: "WHITE_ORIGINAL" },
    { serial: 461, copy: "WHITE_ORIGINAL" },
  ],
  E: [433, 434, 435, 436].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  F: [437, 438, 439, 440].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  G: [441, 442, 443, 444].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  H: [445, 446, 447, 448].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  I: [449, 450, 451, 452].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  J: [453, 454, 462, 463].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  K: [464, 465, 466, 467].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
  L: [468, 469, 470, 471].map((serial) => ({ serial, copy: "WHITE_ORIGINAL" })),
};

const serialStr = (n: number) => String(n).padStart(4, "0");

/** Deliveries per month (serials in order): Apr 50, May 50, Jun 55, Jul 55, Aug 53 = 263. */
const MONTH_BLOCKS = [
  { month: 4, first: 301, last: 350, days: 29, firstDay: 2 },
  { month: 5, first: 351, last: 400, days: 31, firstDay: 1 },
  { month: 6, first: 401, last: 455, days: 30, firstDay: 1 },
  { month: 7, first: 456, last: 510, days: 31, firstDay: 1 },
  { month: 8, first: 511, last: 563, days: 31, firstDay: 1 },
];

export function slipDate(serial: number): string {
  const b = MONTH_BLOCKS.find((x) => serial >= x.first && serial <= x.last);
  if (!b) throw new RangeError(`serial ${serial} outside the season pad`);
  const count = b.last - b.first + 1;
  const day = b.firstDay + Math.floor(((serial - b.first) * b.days) / count);
  return `2026-${String(b.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function slipDateWritten(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${(y as string).slice(2)}`;
}

const isoMs = (isoDate: string, hour = 2) =>
  Date.parse(`${isoDate}T${String(hour).padStart(2, "0")}:00:00.000Z`);

export interface WorldMember extends SnapshotMember {
  homeStation: "BODEGA" | "PUROK_2" | "PUROK_4";
}

export interface World {
  card: RatifiedRateCard;
  members: WorldMember[];
  /** Every slip image, the pink copy included (264). */
  slips: SnapshotSlip[];
  photos: SnapshotPhoto[];
  logbook: SnapshotLogbookPage[];
  tune: TuneResult;
}

// ---------------------------------------------------------------- background identities

interface BgIdentity {
  memberNo: string;
  displayName: string;
  gender: "F" | "M";
  lang: "ceb" | "fil" | "en";
  signsWith: "SIGNATURE" | "THUMBMARK";
  homeStation: "BODEGA" | "PUROK_2" | "PUROK_4";
}

function backgroundIdentities(): BgIdentity[] {
  const r = rng("fair-split seed v1 identities");
  const numbers = backgroundNumbers();
  const namedWomen = NAMED.filter((m) => m.gender === "F").length;
  const women = new Set(r.shuffle(numbers).slice(0, COOP.womenCount - namedWomen));
  const wFirst = r.shuffle(WOMEN_FIRST);
  const mFirst = r.shuffle(MEN_FIRST);
  const surnames = r.shuffle(SURNAMES);
  const langs = r.shuffle([
    ...Array<"ceb">(44).fill("ceb"),
    ...Array<"fil">(8).fill("fil"),
    ...Array<"en">(3).fill("en"),
  ]);
  const thumb = new Set(r.shuffle(numbers).slice(0, 6));
  const stations = r.shuffle([
    ...Array<"BODEGA">(33).fill("BODEGA"),
    ...Array<"PUROK_2">(11).fill("PUROK_2"),
    ...Array<"PUROK_4">(11).fill("PUROK_4"),
  ]);
  let w = 0;
  let m = 0;
  return numbers.map((memberNo, i) => {
    const gender = women.has(memberNo) ? "F" : "M";
    const first = gender === "F" ? (wFirst[w++] as string) : (mFirst[m++] as string);
    return {
      memberNo,
      displayName: `${first} ${surnames[i] as string}`,
      gender,
      lang: langs[i] as "ceb" | "fil" | "en",
      signsWith: thumb.has(memberNo) ? "THUMBMARK" : "SIGNATURE",
      homeStation: stations[i] as "BODEGA" | "PUROK_2" | "PUROK_4",
    };
  });
}

function addressAs(name: string, gender: "F" | "M"): { ceb: string; fil: string; en: string } {
  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");
  return gender === "F"
    ? { ceb: `Nang ${first}`, fil: `Gng. ${last}`, en: `Mrs. ${last}` }
    : { ceb: `Nong ${first}`, fil: `G. ${last}`, en: `Mr. ${last}` };
}

// ---------------------------------------------------------------- slip counts and weights

const SLIP_MIN_G = 15_000;
const SLIP_MAX_G = 62_000;
const BG_SLIPS = 263 - NAMED.reduce((s, m) => s + m.slips.length, 0);

function slipCounts(bg: BgKilos[]): number[] {
  const g1Slots = (b: BgKilos, n: number) => n - (b.g2D > 0 ? 1 : 0);
  const n = bg.map((b) => Math.min(7, Math.max(2, Math.round((b.kgD * DKG) / 37_500))));
  const canAdd = (i: number) => {
    const b = bg[i] as BgKilos;
    return ((b.kgD - b.g2D) * DKG) / g1Slots(b, (n[i] as number) + 1) >= SLIP_MIN_G && (n[i] as number) < 8;
  };
  const canDrop = (i: number) => {
    const b = bg[i] as BgKilos;
    const s = g1Slots(b, (n[i] as number) - 1);
    return s >= 1 && ((b.kgD - b.g2D) * DKG) / s <= SLIP_MAX_G;
  };
  const perSlip = (i: number) => ((bg[i] as BgKilos).kgD * DKG) / (n[i] as number);
  for (let guard = 0; guard < 1_000; guard++) {
    const total = n.reduce((s, x) => s + x, 0);
    if (total === BG_SLIPS) break;
    const idx = bg.map((_, i) => i);
    if (total < BG_SLIPS) {
      const i = idx.filter(canAdd).sort((a, b) => perSlip(b) - perSlip(a) || a - b)[0];
      if (i === undefined) throw new Error("cannot add a slip");
      n[i] = (n[i] as number) + 1;
    } else {
      const i = idx.filter(canDrop).sort((a, b) => perSlip(a) - perSlip(b) || a - b)[0];
      if (i === undefined) throw new Error("cannot drop a slip");
      n[i] = (n[i] as number) - 1;
    }
  }
  for (let i = 0; i < bg.length; i++) {
    const b = bg[i] as BgKilos;
    const s = g1Slots(b, n[i] as number);
    const per = ((b.kgD - b.g2D) * DKG) / s;
    if (s < 1 || per < SLIP_MIN_G || per > SLIP_MAX_G)
      throw new Error(`slip count infeasible for ${b.memberNo}`);
  }
  return n;
}

/** Splits grams (a multiple of 100) into `parts` slips of whole 50 g, each within 15–62 kg. */
function splitGrams(totalG: number, parts: number, label: string): number[] {
  const r = rng(label);
  const units = totalG / 50;
  for (let attempt = 0; attempt < 60; attempt++) {
    const spread = attempt < 40 ? 0.12 : 0.04;
    const base = units / parts;
    const out: number[] = [];
    for (let k = 0; k < parts - 1; k++) out.push(Math.round(base * (1 + (r.next() * 2 - 1) * spread)));
    out.push(units - out.reduce((s, x) => s + x, 0));
    const grams = out.map((u) => u * 50);
    if (grams.every((x) => x >= SLIP_MIN_G && x <= SLIP_MAX_G)) return grams;
  }
  throw new Error(`cannot split ${totalG} g into ${parts}`);
}

// ---------------------------------------------------------------- CBU payers (register: deductions 58.53)

function chooseCbuPayers(bgBonus: Map<string, number>, targetCents: number, order: string[]): Set<string> {
  // Subset-sum over each member's CBU (5% of bonus, half-up); reachable[s] = index that reached s.
  const items = order.map((no) => ({ no, c: bpHalfUp(bgBonus.get(no) as number, 500) }));
  const max = items.reduce((s, it) => s + it.c, 0);
  if (targetCents > max) throw new Error("CBU target above every member paying");
  const from = new Int32Array(max + 1).fill(-2);
  from[0] = -1;
  for (let k = 0; k < items.length; k++) {
    const c = (items[k] as { c: number }).c;
    for (let s = max; s >= c; s--) if (from[s] === -2 && from[s - c] !== -2) from[s] = k;
  }
  if (from[targetCents] === -2) throw new Error("no CBU payer set reaches the target");
  const payers = new Set<string>();
  let s = targetCents;
  while (s > 0) {
    const k = from[s] as number;
    const it = items[k] as { no: string; c: number };
    payers.add(it.no);
    s -= it.c;
  }
  return payers;
}

// ---------------------------------------------------------------- the world

export function buildWorld(): World {
  const card = buildRateCard();
  const quote = quoteInvoice(card, LOT);
  const tune = tuneBackground({ premiumCents: quote.premiumPoolCents, bonusCents: quote.bonusPoolCents });
  const bg = tune.background;
  const ids = backgroundIdentities();
  const idOf = new Map(ids.map((i) => [i.memberNo, i]));
  const r = rng("fair-split seed v1 world");

  // ---------------- background plots, loans and advances
  const bgPlots = new Map<string, { plotNo: string; areaHa: string; trees: number; registered: boolean }[]>();
  for (const b of bg) {
    const kgG = b.kgD * DKG;
    const perTreeG = 450 + r.int(0, 800);
    const trees = Math.ceil(kgG / perTreeG);
    const n = Number(b.memberNo.slice(2));
    const plotNo = (s: string) => `P-${String(n).padStart(3, "0")}-${s}`;
    const area = (t: number) => (t / (480 + r.int(0, 140))).toFixed(2);
    if (r.next() < 0.25) {
      const t1 = Math.round(trees * 0.6);
      bgPlots.set(b.memberNo, [
        { plotNo: plotNo("A"), areaHa: area(t1), trees: t1, registered: true },
        { plotNo: plotNo("B"), areaHa: area(trees - t1), trees: trees - t1, registered: true },
      ]);
    } else {
      bgPlots.set(b.memberNo, [{ plotNo: plotNo("A"), areaHa: area(trees), trees, registered: true }]);
    }
  }
  const [loanA, loanB, loanNoAtd, advanceA] = r.shuffle(bg.map((b) => b.memberNo)).slice(0, 4) as string[];
  const bgLoans = new Map<string, { ref: string; outstandingCentavos: number; authorityToDeduct: boolean }[]>(
    [
      [
        loanA as string,
        [
          {
            ref: `ATD-2026-${(loanA as string).slice(2)}`,
            outstandingCentavos: 65_000,
            authorityToDeduct: true,
          },
        ],
      ],
      [
        loanB as string,
        [
          {
            ref: `ATD-2026-${(loanB as string).slice(2)}`,
            outstandingCentavos: 30_000,
            authorityToDeduct: true,
          },
        ],
      ],
      [
        loanNoAtd as string,
        [
          {
            ref: `LN-2026-${(loanNoAtd as string).slice(2)}`,
            outstandingCentavos: 45_000,
            authorityToDeduct: false,
          },
        ],
      ],
    ],
  );
  const bgAdvances = new Map<string, { voucherNo: string | null; outstandingCentavos: number }[]>([
    [advanceA as string, [{ voucherNo: "CA-0177", outstandingCentavos: 50_000 }]],
  ]);

  // ---------------- final shares (largest remainder) for the CBU payer choice
  const weightsG1 = [
    ...NAMED.map((m) => ({
      id: m.memberNo,
      weight: m.slips.filter((s) => s.grade === "G1").reduce((t, s) => t + s.payableG, 0),
    })),
    ...bg.map((b) => ({ id: b.memberNo, weight: (b.kgD - b.g2D) * DKG })),
  ];
  const totalG1 = weightsG1.reduce((s, w) => s + w.weight, 0);
  if (totalG1 !== FINAL_TOTALS.grade1D * DKG) throw new Error("grade-1 total drifted");
  const bonusLr = largestRemainder(quote.bonusPoolCents, weightsG1);
  const bonusOf = new Map(bonusLr.allocations.map((a) => [a.id, a.amount]));
  const rules = card.canonical.rules;
  const deductionsOf = (
    no: string,
    paidUp: number,
    loans: EngineMember["loans"],
    advances: EngineMember["advances"],
  ) =>
    payTimeDeductions(
      { cbuPaidUpCentavos: paidUp, loans, advances },
      bonusOf.get(no) as number,
      rules,
      FX.centavosPerCent,
    ).reduce((s, d) => s + d.amountCents, 0);
  const namedDeductions = NAMED.reduce(
    (s, m) => s + deductionsOf(m.memberNo, m.cbuPaidUpCentavos, m.loans, m.advances),
    0,
  );
  const bgFixedDeductions = bg.reduce(
    (s, b) =>
      s + deductionsOf(b.memberNo, 500_000, bgLoans.get(b.memberNo) ?? [], bgAdvances.get(b.memberNo) ?? []),
    0,
  );
  const target = REGISTER_DEDUCTIONS_CENTS - namedDeductions - bgFixedDeductions;
  const payers = chooseCbuPayers(
    new Map(bg.map((b) => [b.memberNo, bonusOf.get(b.memberNo) as number])),
    target,
    r.shuffle(bg.map((b) => b.memberNo)),
  );

  // ---------------- members
  const members: WorldMember[] = [];
  for (const m of NAMED) {
    members.push({
      id: uuidv7(isoMs("2019-06-01") + Number(m.memberNo.slice(2)), `member:${m.memberNo}`),
      memberNo: m.memberNo,
      displayName: m.displayName,
      nickname: m.nickname,
      consoleName: m.consoleName,
      addressAs: m.addressAs,
      nameOnSlip: m.nameOnSlip,
      gender: m.gender,
      lang: m.lang,
      rail: m.rail,
      receiverKind: m.receiverKind,
      receiverAlias: m.rail === "PAYPAL" ? receiverAlias(m.memberNo, m.receiverKind) : null,
      receiverMasked:
        m.rail === "PAYPAL" ? format.maskEmail(receiverAlias(m.memberNo, m.receiverKind)) : null,
      signsWith: m.signsWith,
      audioFirst: m.audioFirst,
      named: true,
      demoRole: m.demoRole,
      plots: m.plots.map((p) => ({
        ...p,
        memberNo: m.memberNo,
        registeredOn: p.registered ? "2019-06-01" : null,
      })),
      cbuPaidUpCentavos: m.cbuPaidUpCentavos,
      loans: m.loans,
      advances: m.advances,
      slipSerials: [],
      homeStation: "BODEGA",
    });
  }
  for (const b of bg) {
    const id = idOf.get(b.memberNo) as BgIdentity;
    const pays = payers.has(b.memberNo);
    members.push({
      id: uuidv7(isoMs("2019-06-01") + Number(b.memberNo.slice(2)), `member:${b.memberNo}`),
      memberNo: b.memberNo,
      displayName: id.displayName,
      nickname: null,
      consoleName: id.displayName,
      addressAs: addressAs(id.displayName, id.gender),
      nameOnSlip: id.displayName.toUpperCase(),
      gender: id.gender,
      lang: id.lang,
      rail: "CASH",
      receiverKind: "NONE",
      receiverAlias: null,
      receiverMasked: null,
      signsWith: id.signsWith,
      audioFirst: id.signsWith === "THUMBMARK",
      named: false,
      demoRole: null,
      plots: (bgPlots.get(b.memberNo) ?? []).map((p) => ({
        ...p,
        memberNo: b.memberNo,
        registeredOn: "2019-06-01",
      })),
      cbuPaidUpCentavos: pays ? (6 + r.int(0, 38)) * 10_000 : 500_000,
      loans: bgLoans.get(b.memberNo) ?? [],
      advances: bgAdvances.get(b.memberNo) ?? [],
      slipSerials: [],
      homeStation: id.homeStation,
    });
  }
  members.sort((a, b) => (a.memberNo < b.memberNo ? -1 : 1));
  const memberOf = new Map(members.map((m) => [m.memberNo, m]));

  // ---------------- slips (specs first, serials after)
  interface Draft {
    memberNo: string;
    spec: SlipSpec;
  }
  const drafts: Draft[] = NAMED.flatMap((m) => m.slips.map((spec) => ({ memberNo: m.memberNo, spec })));
  const counts = slipCounts(bg);
  bg.forEach((b, i) => {
    const plots = bgPlots.get(b.memberNo) ?? [];
    const n = counts[i] as number;
    const g1Slots = n - (b.g2D > 0 ? 1 : 0);
    const weights = splitGrams((b.kgD - b.g2D) * DKG, g1Slots, `split ${b.memberNo}`);
    weights.forEach((payableG, k) => {
      const plot = plots[k % plots.length] as { plotNo: string };
      drafts.push({
        memberNo: b.memberNo,
        spec: { serial: null, payableG, grade: "G1", plotNo: plot.plotNo },
      });
    });
    if (b.g2D > 0) {
      const plot = plots[0] as { plotNo: string };
      drafts.push({
        memberNo: b.memberNo,
        spec: { serial: null, payableG: b.g2D * DKG, grade: "G2", plotNo: plot.plotNo },
      });
    }
  });
  if (drafts.length !== 263) throw new Error(`expected 263 slips, got ${drafts.length}`);

  // The injection slip belongs to an off-rail (cash) member and sits in photo I.
  const injectionOwner = r.pick(
    bg.filter((b) => (idOf.get(b.memberNo) as BgIdentity).homeStation === "BODEGA"),
  ).memberNo;
  const injectionDraft = drafts.find((d) => d.memberNo === injectionOwner && d.spec.grade === "G1") as Draft;
  injectionDraft.spec = { ...injectionDraft.spec, serial: INJECTION_SERIAL };

  const fixed = new Set(drafts.filter((d) => d.spec.serial !== null).map((d) => d.spec.serial as string));
  const free = r.shuffle(
    Array.from({ length: SEASON.serialLast - SEASON.serialFirst + 1 }, (_, k) =>
      serialStr(SEASON.serialFirst + k),
    ).filter((s) => !fixed.has(s)),
  );
  let next = 0;
  for (const d of drafts) if (d.spec.serial === null) d.spec = { ...d.spec, serial: free[next++] as string };

  const bySerial = new Map(drafts.map((d) => [d.spec.serial as string, d]));
  const photoOf = new Map<string, { photoId: string; position: Position }>();
  const photoSlips = new Map<string, { serial: string; copy: CopyColor; position: Position }[]>();
  for (const [photoId, list] of Object.entries(REPLAY_LAYOUT)) {
    photoSlips.set(
      photoId,
      list.map((x, k) => {
        const serial = serialStr(x.serial);
        if (x.copy === "WHITE_ORIGINAL") photoOf.set(serial, { photoId, position: POSITIONS[k] as Position });
        return { serial, copy: x.copy, position: POSITIONS[k] as Position };
      }),
    );
  }
  const earlier = Array.from(
    { length: SEASON.serialLast - SEASON.serialFirst + 1 },
    (_, k) => SEASON.serialFirst + k,
  ).filter((s) => s < REPLAY_FIRST || s > REPLAY_LAST);
  if (earlier.length !== 54 * 4) throw new Error("earlier photos must hold 216 slips");
  for (let p = 0; p < 54; p++) {
    const photoId = `P${String(p + 1).padStart(2, "0")}`;
    const list = earlier.slice(p * 4, p * 4 + 4).map((s, k) => {
      const serial = serialStr(s);
      photoOf.set(serial, { photoId, position: POSITIONS[k] as Position });
      return { serial, copy: "WHITE_ORIGINAL" as CopyColor, position: POSITIONS[k] as Position };
    });
    photoSlips.set(photoId, list);
  }

  // ---------------- photos (documents) and slip images
  const replayIds = Object.keys(REPLAY_LAYOUT);
  const photoIds = [
    ...replayIds,
    ...Array.from({ length: 54 }, (_, p) => `P${String(p + 1).padStart(2, "0")}`),
  ];
  const photoDates = new Map<string, string>();
  for (const pid of photoIds) {
    const last = (photoSlips.get(pid) ?? [])
      .map((s) => slipDate(Number(s.serial)))
      .sort()
      .at(-1) as string;
    photoDates.set(pid, format.addDays(last, 1));
  }
  const documentId = new Map(
    photoIds.map((pid) => [pid, uuidv7(isoMs(photoDates.get(pid) as string, 9), `photo:${pid}`)]),
  );

  const slips: SnapshotSlip[] = [];
  for (const pid of photoIds) {
    for (const ps of photoSlips.get(pid) ?? []) {
      const d = bySerial.get(ps.serial) as Draft;
      const m = memberOf.get(d.memberNo) as WorldMember;
      const serialN = Number(ps.serial);
      const replay = serialN >= REPLAY_FIRST && serialN <= REPLAY_LAST;
      const station =
        d.spec.station ??
        (replay ? "BODEGA" : m.named ? "BODEGA" : (idOf.get(m.memberNo) as BgIdentity).homeStation);
      const netG = d.spec.payableG;
      const tareG = d.spec.tareG ?? (netG > 55_000 ? 600 : 300);
      const sacks = tareG >= 600 ? "2 PP" : "1 PP";
      const grossG = netG + tareG;
      const mcPctTenths = 58 + (rng(`mc ${ps.serial}`).int(0, 12) as number);
      const date = slipDate(serialN);
      const marks = (d.spec.marks ?? []).map((mk, k) => ({
        markId: `mark-${ps.serial}-${k + 1}`,
        text: mk.text,
        ruleId: mk.ruleId,
        writtenCentavos: parseWrittenCentavos(mk.text),
        documentRef: mk.documentRef ?? null,
      }));
      if (marks.length === 0 && station !== "BODEGA") {
        const hauling = mulDivHalfUp(netG, rules.hauling.centavosPerNetKg, 1000);
        const text = `Hauling ${format.money(hauling, "PHP")}`;
        marks.push({
          markId: `mark-${ps.serial}-1`,
          text,
          ruleId: "R2",
          writtenCentavos: hauling,
          documentRef: null,
        });
      }
      const copy = ps.copy;
      slips.push({
        rowId: uuidv7(isoMs(date, 3), `row:${pid}:${ps.serial}:${copy}`),
        documentId: documentId.get(pid) as string,
        serial: ps.serial,
        copy,
        photoId: pid,
        position: ps.position,
        replaySet: replayIds.includes(pid),
        slipDate: date,
        memberNo: d.memberNo,
        plotNo: d.spec.plotNo,
        station,
        sacks,
        grossG,
        tareG,
        netG,
        mcPctTenths,
        mcLessG: 0,
        payableG: netG,
        grade: d.spec.grade,
        clerkInitials: "JD",
        signature: m.signsWith === "THUMBMARK" ? "THUMBMARK" : "SIGNED",
        boxes: {
          "1": slipDateWritten(date),
          "2": d.memberNo,
          "3": m.nameOnSlip,
          "4": d.spec.plotNo,
          "5": sacks,
          "6": format.slipKg(grossG),
          "7": format.slipKg(tareG),
          "8": format.slipKg(netG),
          "9": `${Math.floor(mcPctTenths / 10)}.${mcPctTenths % 10}`,
          "10": "0.00",
          "11": format.slipKg(netG),
          "12": d.spec.grade,
          "13": marks.map((mk) => mk.text),
        },
        marks,
        marginNote: ps.serial === INJECTION_SERIAL ? INJECTION_TEXT : null,
        artifacts: d.spec.artifacts ?? [],
      });
    }
  }
  if (slips.length !== 264) throw new Error(`expected 264 slip images, got ${slips.length}`);
  for (const m of members) {
    m.slipSerials = [...new Set(slips.filter((s) => s.memberNo === m.memberNo).map((s) => s.serial))].sort();
  }

  const photos: SnapshotPhoto[] = photoIds.map((pid) => {
    const list = photoSlips.get(pid) ?? [];
    const manifest = {
      photoId: pid,
      slips: list.map((ps) => {
        const s = slips.find(
          (x) => x.photoId === pid && x.serial === ps.serial && x.copy === ps.copy,
        ) as SnapshotSlip;
        return {
          position: ps.position,
          serial: ps.serial,
          copy: ps.copy,
          boxes: s.boxes,
          marginNote: s.marginNote,
        };
      }),
    };
    const replay = replayIds.includes(pid);
    return {
      photoId: pid,
      documentId: documentId.get(pid) as string,
      set: replay ? "REPLAY" : "EARLIER",
      file: `media/photos/${pid}.webp`,
      slips: list.map((ps) => ({ position: ps.position, serial: ps.serial, copy: ps.copy })),
      capturedOn: photoDates.get(pid) as string,
      readOn: replay ? null : (photoDates.get(pid) as string),
      readProvenance: replay ? "replay" : "seeded",
      manifestSha256: jcsSha256(manifest),
    };
  });

  const logbook: SnapshotLogbookPage[] = [
    {
      page: 14,
      month: "2026-07",
      lines: Array.from({ length: 12 }, (_, k) => {
        const serial = serialStr(456 + k);
        const s = slips.find((x) => x.serial === serial && x.copy === "WHITE_ORIGINAL") as SnapshotSlip;
        return {
          lineNo: k + 1,
          serial,
          memberNo: s.memberNo,
          netKgText: format.slipKg(s.netG),
          remark: serial === "0458" ? "multa GA ₱200" : null,
        };
      }),
    },
  ];

  return { card, members, slips, photos, logbook, tune };
}

/** Register §2: ruled deductions retained by the co-op total US$58.53. */
export const REGISTER_DEDUCTIONS_CENTS = 5_853;

/** Seeded receiver aliases: the runtime maps member numbers to PP_RECEIVERS from env. */
export function receiverAlias(memberNo: string, kind: string): string {
  const local = memberNo.toLowerCase().replace("-", "");
  return kind === "NO_PAYPAL_ACCOUNT"
    ? `${local}.no-account@unclaimed.fairsplit.example`
    : `${local}@members.fairsplit.example`;
}

// ---------------------------------------------------------------- engine inputs

export interface EngineInputs {
  members: EngineMember[];
  rowsAtRead: EngineRow[];
  rowsAfterEntry: EngineRow[];
}

export function engineInputs(world: World): EngineInputs {
  const members: EngineMember[] = world.members.map((m) => ({
    memberNo: m.memberNo,
    rail: m.rail,
    registeredTrees: m.plots.filter((p) => p.registered).reduce((s, p) => s + p.trees, 0),
    cbuPaidUpCentavos: m.cbuPaidUpCentavos,
    loans: m.loans.map((l) => ({ ...l })),
    advances: m.advances.map((a) => ({ ...a })),
  }));
  const row = (s: SnapshotSlip, pending: boolean): EngineRow => ({
    rowId: s.rowId,
    documentId: s.documentId,
    photoId: s.photoId,
    serial: s.serial,
    copy: s.copy,
    memberNo: s.memberNo,
    slipDate: s.slipDate,
    station: s.station,
    netG: pending ? null : s.netG,
    payableG: pending ? null : s.payableG,
    grade: s.grade,
    plotNo: s.plotNo,
    pendingFields: pending
      ? [
          { fieldId: `field-${s.serial}-gross_kg`, field: "gross_kg", score: 0.4 },
          { fieldId: `field-${s.serial}-net_kg`, field: "net_kg", score: 0.4 },
        ]
      : [],
    enteredByHand: !pending && s.serial === BY_HAND_SERIAL,
    marks: s.marks.map((m) => ({
      markId: m.markId,
      text: m.text,
      ruleId: m.ruleId as EngineRow["marks"][number]["ruleId"],
      writtenCentavos: m.writtenCentavos,
      documentRef: m.documentRef,
    })),
    anomalies:
      s.marginNote !== null
        ? [
            {
              anomalyId: `anomaly-${s.serial}-1`,
              kind: "INSTRUCTION_LIKE_TEXT",
              quarantined: true,
              overlap: "NONE",
              source: "read_a",
            },
          ]
        : [],
  });
  return {
    members,
    rowsAtRead: world.slips.map((s) => row(s, s.serial === BY_HAND_SERIAL)),
    rowsAfterEntry: world.slips.map((s) => row(s, false)),
  };
}

export { DUPLICATE_SERIAL };
