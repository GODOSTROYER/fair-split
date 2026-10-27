// Property worlds for the engine (I3 and "a held line's money is never redistributed"). Random co-ops
// exercise every engine path: pink copies of the same serial, re-shoots (dHash), kilos still waiting
// for a person (read but doubtful, or unread), a doubtful name, R1–R4 and unruled marks (exact,
// wrong, without their document), quarantined text over the data, and random resolutions.
import type {
  EngineHold,
  EngineInput,
  EngineOutput,
  EngineResolution,
  EngineRow,
} from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AT, input, member } from "./__fixtures__/world.js";
import { ALLOWED_RESOLUTIONS, computeLines, conserve, lineSha256 } from "./engine.js";

const MEMBER_COUNT = 8;
const memberNoOf = (i: number) => `M-${String((i % MEMBER_COUNT) + 1).padStart(3, "0")}`;

const arbMark = fc.oneof(
  fc.record({
    kind: fc.constant("multa" as const),
    centavos: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
  }),
  fc.record({ kind: fc.constant("hauling" as const), exact: fc.boolean() }),
  fc.record({
    kind: fc.constantFrom("loan" as const, "advance" as const),
    centavos: fc.integer({ min: 0, max: 300_000 }),
    ref: fc.constantFrom("own" as const, "other" as const, "none" as const),
  }),
  fc.record({ kind: fc.constant("cbu" as const), centavos: fc.integer({ min: 1, max: 20_000 }) }),
);

const arbRow = fc.record({
  member: fc.nat({ max: MEMBER_COUNT - 1 }),
  g: fc.integer({ min: 0, max: 400_000 }),
  g2: fc.boolean(),
  station: fc.constantFrom("BODEGA" as const, "PUROK_2" as const, "PUROK_4" as const),
  marks: fc.array(arbMark, { maxLength: 2 }),
  pending: fc.constantFrom("none", "none", "none", "kilo", "unread", "name"),
  anomaly: fc.constantFrom("none", "none", "NONE", "FIELD", "KILO_FIELD", "UNLOCATED"),
  copy: fc.constantFrom("none", "none", "none", "pink", "pinkOtherKilos"),
});

const arbMember = fc.record({
  paypal: fc.boolean(),
  paidUp: fc.integer({ min: 0, max: 600_000 }),
  loan: fc.integer({ min: 0, max: 200_000 }),
  atd: fc.boolean(),
  advance: fc.integer({ min: 0, max: 200_000 }),
  voucher: fc.boolean(),
  trees: fc.integer({ min: 0, max: 400 }),
});

const arbWorld = fc.record({
  members: fc.array(arbMember, { minLength: MEMBER_COUNT, maxLength: MEMBER_COUNT }),
  rows: fc.array(arbRow, { minLength: 1, maxLength: 20 }),
  reshoots: fc.array(
    fc.record({ a: fc.nat({ max: 30 }), b: fc.nat({ max: 30 }), d: fc.integer({ min: 0, max: 12 }) }),
    { maxLength: 3 },
  ),
  shippedKg: fc.integer({ min: 1, max: 8_000 }),
  choices: fc.array(fc.nat({ max: 999 }), { minLength: 48, maxLength: 48 }),
});

type World = typeof arbWorld extends fc.Arbitrary<infer W> ? W : never;
type Mark = EngineRow["marks"][number];

function markFor(
  m: World["rows"][number]["marks"][number],
  markId: string,
  row: World["rows"][number],
): Mark {
  switch (m.kind) {
    case "multa":
      return { markId, text: "Multa", ruleId: "NO_MATCH", writtenCentavos: m.centavos, documentRef: null };
    case "hauling":
      return {
        markId,
        text: "Hauling",
        ruleId: "R2",
        writtenCentavos: Math.round((row.g * 150) / 1000) + (m.exact ? 0 : 100),
        documentRef: null,
      };
    case "cbu":
      return { markId, text: "CBU", ruleId: "R1", writtenCentavos: m.centavos, documentRef: null };
    default: {
      const own = m.kind === "loan" ? `ATD-${row.member}` : `CA-${row.member}`;
      return {
        markId,
        text: m.kind === "loan" ? "Loan" : "Advance",
        ruleId: m.kind === "loan" ? "R3" : "R4",
        writtenCentavos: m.centavos,
        documentRef: m.ref === "own" ? own : m.ref === "other" ? "XX-9" : null,
      };
    }
  }
}

function buildWorld(w: World): EngineInput {
  const members = w.members.map((m, i) =>
    member(memberNoOf(i), {
      rail: m.paypal ? "PAYPAL" : "CASH",
      cbuPaidUpCentavos: m.paidUp,
      registeredTrees: m.trees,
      loans: [{ ref: `ATD-${i}`, outstandingCentavos: m.loan, authorityToDeduct: m.atd }],
      advances: [{ voucherNo: m.voucher ? `CA-${i}` : null, outstandingCentavos: m.advance }],
    }),
  );
  const rows: EngineRow[] = [];
  w.rows.forEach((r, k) => {
    const unread = r.pending === "unread";
    const base: EngineRow = {
      rowId: `r${String(k).padStart(2, "0")}`,
      documentId: `d${k}`,
      photoId: null,
      serial: String(301 + k).padStart(4, "0"),
      copy: "WHITE_ORIGINAL",
      memberNo: memberNoOf(r.member),
      slipDate: "2026-05-01",
      station: r.station,
      netG: unread ? null : r.g,
      payableG: unread ? null : r.g,
      grade: r.g2 ? "G2" : "G1",
      plotNo: null,
      pendingFields:
        r.pending === "kilo" || unread
          ? [{ fieldId: `f${k}`, field: "net_kg", score: 0.4 }]
          : r.pending === "name"
            ? [{ fieldId: `f${k}`, field: "member_name", score: 0.6 }]
            : [],
      enteredByHand: false,
      marks: r.marks.map((m, j) => markFor(m, `m${k}-${j}`, r)),
      anomalies:
        r.anomaly === "none"
          ? []
          : [
              {
                anomalyId: `a${k}`,
                kind: "INSTRUCTION_LIKE_TEXT",
                quarantined: true,
                overlap: r.anomaly,
                source: "screen",
              },
            ],
    };
    rows.push(base);
    if (r.copy !== "none") {
      const g = r.copy === "pink" ? r.g : r.g + 1_000;
      rows.push({
        ...base,
        rowId: `${base.rowId}p`,
        documentId: `${base.documentId}p`,
        copy: "PINK_DUPLICATE",
        netG: unread ? null : g,
        payableG: unread ? null : g,
        marks: [],
        anomalies: [],
      });
    }
  });
  const nearDuplicates = w.reshoots
    .map((x) => ({
      rowA: rows[x.a % rows.length]?.rowId ?? "",
      rowB: rows[x.b % rows.length]?.rowId ?? "",
      dhashDistance: x.d,
    }))
    .filter((x) => x.rowA !== x.rowB);
  return input(members, rows, {
    nearDuplicates,
    lot: {
      lotCode: "L",
      shippedG: w.shippedKg * 1000,
      grade1ShippedG: w.shippedKg * 900,
      sacks: 1,
      sackKind: "jute",
      shippedOn: "2026-09-18",
    },
  });
}

const RESOLUTION_KINDS = [
  "COUNT_ONCE",
  "TWO_DELIVERIES",
  "REGISTER_PLOT",
  "RETURN_AS_CREDIT",
  "APPLY_RULE",
  "EXCLUDE_LINE",
  "CONFIRM_AS_READ",
] as const;
type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

function resolutionFor(h: EngineHold, kind: ResolutionKind, pick: number): EngineResolution {
  const base = { holdKey: h.key, by: "AS", at: AT };
  switch (kind) {
    case "TWO_DELIVERIES":
      return { ...base, resolution: kind, reason: "two loads" };
    case "EXCLUDE_LINE":
      return { ...base, resolution: kind, reason: "carry over" };
    case "REGISTER_PLOT":
      return {
        ...base,
        resolution: kind,
        plot: { plotNo: "P-001-B", areaHa: "0.50", trees: 1 + (pick % 400) },
      };
    case "APPLY_RULE":
      return { ...base, resolution: kind, ruleId: (["R1", "R2", "R3", "R4"] as const)[pick % 4] ?? "R2" };
    default:
      return { ...base, resolution: kind };
  }
}

/** Random resolutions for the holds of `out`: mostly allowed ones, sometimes a disallowed one (ignored). */
function randomResolutions(
  out: EngineOutput,
  choices: readonly number[],
  accept: (h: EngineHold, kind: ResolutionKind) => boolean = () => true,
): EngineResolution[] {
  const res: EngineResolution[] = [];
  out.holds.forEach((h, i) => {
    const c = choices[i % choices.length] ?? 0;
    if (h.kind === "MASS_BALANCE" || c % 3 === 0) return;
    const allowed = ALLOWED_RESOLUTIONS[h.kind] as readonly ResolutionKind[];
    const kind = c % 10 === 1 ? RESOLUTION_KINDS[c % RESOLUTION_KINDS.length] : allowed[c % allowed.length];
    if (kind && accept(h, kind)) res.push(resolutionFor(h, kind, c));
  });
  return res;
}

const priorOf = (out: EngineOutput) =>
  out.holds.map((h) => ({ key: h.key, kind: h.kind, gate: h.gate, memberNo: h.memberNo }));

const lineOf = (out: EngineOutput, no: string) => {
  const l = out.lines.find((x) => x.memberNo === no);
  if (!l) throw new Error(`no line ${no}`);
  return l;
};

const CARD_SHA = input([], []).card.sha256;

function expectConserved(out: EngineOutput) {
  const c = out.conservation;
  // The lines always add up: gross = net + deductions − credits, and every net cent has one place.
  expect(c.premiumSumCents + c.bonusSumCents).toBe(c.grossCents);
  expect(c.netCents + c.deductionsCents - c.creditsCents).toBe(c.grossCents);
  expect(c.onRailNetCents + c.offRailNetCents + c.carriedNetCents).toBe(c.netCents);
  // Each pool is shared to the cent whenever verified kilos exist to share it by; otherwise it
  // stays unallocated, conservation says so, and approval waits.
  const splittable =
    (c.premiumPoolCents === 0 || out.massBalance.verifiedG > 0) &&
    (c.bonusPoolCents === 0 || out.massBalance.grade1G > 0);
  expect(c.balanced).toBe(splittable);
  if (splittable) {
    expect(c.premiumSumCents).toBe(c.premiumPoolCents);
    expect(c.bonusSumCents).toBe(c.bonusPoolCents);
    expect(c.netCents + c.deductionsCents - c.creditsCents).toBe(c.poolCents);
  } else {
    expect(out.approvalBlocked).toBe(true);
  }
  const net = (pred: (l: EngineOutput["lines"][number]) => boolean) =>
    out.lines.filter(pred).reduce((s, l) => s + l.netCents, 0);
  expect(c.carriedNetCents).toBe(net((l) => l.state === "HELD" || l.state === "EXCLUDED"));
  expect(c.onRailNetCents).toBe(net((l) => l.state === "READY" && l.rail === "PAYPAL"));
  expect(c.offRailNetCents).toBe(net((l) => l.state === "READY" && l.rail === "CASH"));
  for (const l of out.lines) {
    expect(Number.isSafeInteger(l.netCents)).toBe(true);
    expect(l.deductionsCents).toBeLessThanOrEqual(l.bonusCents);
    expect(l.netCents).toBeGreaterThanOrEqual(l.premiumCents);
    const { lineSha256: h, ...rest } = l;
    expect(lineSha256(rest, CARD_SHA)).toBe(h);
    const open = out.holds.filter((x) => x.memberNo === l.memberNo && x.state === "OPEN");
    if (l.state !== "EXCLUDED") expect(l.state).toBe(open.length > 0 ? "HELD" : "READY");
  }
  expect(conserve(out.lines, c.premiumPoolCents, c.bonusPoolCents)).toEqual(c);
  const blocking = out.holds
    .filter((h) => h.state === "OPEN" && h.gate === "BLOCKS_APPROVAL")
    .map((h) => h.key);
  expect(out.blockingHoldKeys).toEqual(blocking);
  expect(out.approvalBlocked).toBe(blocking.length > 0 || out.massBalance.status !== "INSIDE" || !c.balanced);
}

const hasG1 = (inp: EngineInput) => inp.rows.some((r) => r.grade === "G1" && (r.payableG ?? 0) > 0);

describe("inv.i3.conservation", () => {
  it("money is conserved to the cent for any world and any resolutions (fast-check)", () => {
    fc.assert(
      fc.property(arbWorld, (w) => {
        const inp = buildWorld(w);
        fc.pre(hasG1(inp));
        const first = computeLines(inp, { validate: false });
        expectConserved(first);
        const second = computeLines(
          { ...inp, resolutions: randomResolutions(first, w.choices), priorHolds: priorOf(first) },
          { validate: false },
        );
        expectConserved(second);
      }),
      { numRuns: 200 },
    );
  });

  it("resolving a hold never moves money between members, except COUNT_ONCE or a person confirming kilos", () => {
    const kiloNeutral = (h: EngineHold, kind: ResolutionKind) =>
      kind !== "COUNT_ONCE" && !(h.kind === "LOW_CONFIDENCE" && kind === "CONFIRM_AS_READ");
    fc.assert(
      fc.property(arbWorld, (w) => {
        const inp = buildWorld(w);
        fc.pre(hasG1(inp));
        const open = computeLines(inp, { validate: false });
        const resolutions = randomResolutions(open, w.choices, kiloNeutral);
        const after = computeLines({ ...inp, resolutions, priorHolds: priorOf(open) }, { validate: false });
        const owners = new Set(resolutions.map((r) => open.holds.find((h) => h.key === r.holdKey)?.memberNo));
        for (const l of after.lines) {
          const before = lineOf(open, l.memberNo);
          expect([l.verifiedG, l.premiumCents, l.bonusCents]).toEqual([
            before.verifiedG,
            before.premiumCents,
            before.bonusCents,
          ]);
          expect(l.deductions).toEqual(before.deductions);
          if (owners.has(l.memberNo)) {
            expect(l.netCents - before.netCents).toBe(l.creditsCents - before.creditsCents);
          } else {
            expect(l).toEqual(before);
          }
        }
        expect(after.massBalance.verifiedG).toBe(open.massBalance.verifiedG);
      }),
      { numRuns: 200 },
    );
  });

  it("a held or excluded line keeps its whole share and is carried, never paid", () => {
    fc.assert(
      fc.property(arbWorld, (w) => {
        const inp = buildWorld(w);
        fc.pre(hasG1(inp));
        const first = computeLines(inp, { validate: false });
        const out = computeLines(
          { ...inp, resolutions: randomResolutions(first, w.choices), priorHolds: priorOf(first) },
          { validate: false },
        );
        const carried = out.lines.filter((l) => l.state !== "READY");
        for (const l of carried) {
          expect(l.premiumCents + l.bonusCents).toBe(l.grossCents);
          expect(l.netCents).toBe(l.grossCents - l.deductionsCents + l.creditsCents);
        }
        expect(out.conservation.carriedNetCents).toBe(carried.reduce((s, l) => s + l.netCents, 0));
        expect(out.conservation.onRailNetCents + out.conservation.offRailNetCents).toBe(
          out.lines.filter((l) => l.state === "READY").reduce((s, l) => s + l.netCents, 0),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("the property worlds reach every engine path", () => {
  it("raises every hold kind and applies every resolution kind across a fixed sample", () => {
    const kinds = new Set<string>();
    const applied = new Set<string>();
    let excluded = 0;
    let unsplittable = 0;
    for (const w of fc.sample(arbWorld, { seed: 2026, numRuns: 400 })) {
      const inp = buildWorld(w);
      const first = computeLines(inp, { validate: false });
      for (const h of first.holds) kinds.add(h.kind);
      const out = computeLines(
        { ...inp, resolutions: randomResolutions(first, w.choices), priorHolds: priorOf(first) },
        { validate: false },
      );
      for (const h of out.holds) if (h.resolution && h.state !== "OPEN") applied.add(h.resolution.kind);
      excluded += out.lines.filter((l) => l.state === "EXCLUDED").length;
      if (!out.conservation.balanced) unsplittable++;
    }
    expect([...kinds].sort()).toEqual(
      [
        "DUPLICATE_SLIP",
        "IMPLAUSIBLE_YIELD",
        "LOW_CONFIDENCE",
        "MASS_BALANCE",
        "NO_RULE",
        "RATE_MISMATCH",
        "SUSPECTED_INJECTION",
      ].sort(),
    );
    for (const r of [
      "COUNT_ONCE",
      "TWO_DELIVERIES",
      "REGISTER_PLOT",
      "RETURN_AS_CREDIT",
      "APPLY_RULE",
      "EXCLUDE_LINE",
      "CONFIRM_AS_READ",
    ]) {
      expect(applied.has(r), r).toBe(true);
    }
    expect(excluded).toBeGreaterThan(0);
    expect(unsplittable).toBeGreaterThan(0);
  });
});
