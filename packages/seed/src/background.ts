// The 55 background members. Register §2: "The generator adjusts the 55 background members until
// these exact lines come out." A seeded local search moves kilos between background members (both
// totals stay fixed) until largest-remainder rounding gives every named member the shares the
// register's lines imply, in the final scenario and with slip 0457 counted twice.
import { largestRemainder } from "@fairsplit/domain";
import { DUPLICATE_SERIAL, LOT } from "./constants.js";
import { DUPLICATE_SHARE_TARGET, NAMED, NAMED_SHARE_TARGETS } from "./named.js";
import { type Rng, rng } from "./prng.js";

/** Kilos are tuned in 100 g units ("dkg"). */
export const DKG = 100;

export interface BgKilos {
  memberNo: string;
  kgD: number;
  /** Grade 2 kilos (dkg); 0 for members who delivered only Grade 1. */
  g2D: number;
}

export interface Totals {
  verifiedD: number;
  grade1D: number;
}

/** Register §2: 9,780.6 kg verified, 9,388.0 kg Grade 1 (slip 0457 counted once). */
export const FINAL_TOTALS: Totals = { verifiedD: 97_806, grade1D: 93_880 };

interface NamedKilos {
  memberNo: string;
  kgD: number;
  g1D: number;
}

export function namedKilos(): NamedKilos[] {
  return NAMED.map((m) => {
    const kg = m.slips.reduce((s, x) => s + x.payableG, 0);
    const g1 = m.slips.filter((x) => x.grade === "G1").reduce((s, x) => s + x.payableG, 0);
    if (kg % DKG !== 0 || g1 % DKG !== 0) throw new Error(`${m.memberNo} kilos are not whole 0.1 kg`);
    return { memberNo: m.memberNo, kgD: kg / DKG, g1D: g1 / DKG };
  });
}

export function backgroundNumbers(): string[] {
  const named = new Set(NAMED.map((m) => m.memberNo));
  const out: string[] = [];
  for (let n = 1; n <= 64; n++) {
    const no = `M-${String(n).padStart(3, "0")}`;
    if (!named.has(no)) out.push(no);
  }
  return out;
}

function duplicateKgD(): number {
  for (const m of NAMED) {
    const s = m.slips.find((x) => x.serial === DUPLICATE_SERIAL);
    if (s) return s.payableG / DKG;
  }
  throw new Error("duplicate slip not found");
}

interface Target {
  memberNo: string;
  pool: "premium" | "bonus";
  scenario: "final" | "dup";
  cents: number;
}

function targets(): Target[] {
  const out: Target[] = [];
  for (const [memberNo, t] of Object.entries(NAMED_SHARE_TARGETS)) {
    out.push({ memberNo, pool: "premium", scenario: "final", cents: t.premiumCents });
    out.push({ memberNo, pool: "bonus", scenario: "final", cents: t.bonusCents });
  }
  out.push({
    memberNo: DUPLICATE_SHARE_TARGET.memberNo,
    pool: "premium",
    scenario: "dup",
    cents: DUPLICATE_SHARE_TARGET.premiumCents,
  });
  out.push({
    memberNo: DUPLICATE_SHARE_TARGET.memberNo,
    pool: "bonus",
    scenario: "dup",
    cents: DUPLICATE_SHARE_TARGET.bonusCents,
  });
  return out;
}

export interface Pools {
  premiumCents: number;
  bonusCents: number;
}

/**
 * Penalty: for each named target, how far the member's remainder rank sits on the wrong side of
 * the largest-remainder cut. Zero means every target share comes out exactly.
 */
export function penalty(bg: readonly BgKilos[], pools: Pools): number {
  const named = namedKilos();
  const dupD = duplicateKgD();
  let total = 0;
  for (const scenario of ["final", "dup"] as const) {
    const weightsKg = [
      ...named.map((n) => ({
        id: n.memberNo,
        weight: n.kgD + (scenario === "dup" && n.memberNo === DUPLICATE_SHARE_TARGET.memberNo ? dupD : 0),
      })),
      ...bg.map((b) => ({ id: b.memberNo, weight: b.kgD })),
    ];
    const weightsG1 = [
      ...named.map((n) => ({
        id: n.memberNo,
        weight: n.g1D + (scenario === "dup" && n.memberNo === DUPLICATE_SHARE_TARGET.memberNo ? dupD : 0),
      })),
      ...bg.map((b) => ({ id: b.memberNo, weight: b.kgD - b.g2D })),
    ];
    for (const pool of ["premium", "bonus"] as const) {
      const lr = largestRemainder(
        pool === "premium" ? pools.premiumCents : pools.bonusCents,
        pool === "premium" ? weightsKg : weightsG1,
      );
      const order = [...lr.allocations].sort((a, b) => {
        if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      const pos = new Map(order.map((a, i) => [a.id, i]));
      for (const t of targets()) {
        if (t.scenario !== scenario || t.pool !== pool) continue;
        const a = lr.allocations.find((x) => x.id === t.memberNo);
        if (!a) throw new Error(`no allocation for ${t.memberNo}`);
        if (t.cents !== a.floor && t.cents !== a.floor + 1) {
          throw new Error(`target for ${t.memberNo} ${pool}/${scenario} is not reachable by rounding`);
        }
        const wantUp = t.cents === a.floor + 1;
        const p = pos.get(t.memberNo) as number;
        if (wantUp && p >= lr.roundUps) total += p - lr.roundUps + 1;
        if (!wantUp && p < lr.roundUps) total += lr.roundUps - p;
      }
    }
  }
  return total;
}

const KG_MIN_D = 550;
const KG_MAX_D = 2_750;
const G2_MIN_D = 120;
const G2_MAX_D = 450;
const G1_MIN_D = 350;

function valid(b: BgKilos): boolean {
  if (b.kgD < KG_MIN_D || b.kgD > KG_MAX_D) return false;
  if (b.g2D === 0) return true;
  return b.g2D >= G2_MIN_D && b.g2D <= G2_MAX_D && b.kgD - b.g2D >= G1_MIN_D;
}

/** Splits `total` into integer parts proportional to `weights` (largest remainder). */
function apportion(total: number, weights: number[]): number[] {
  const lr = largestRemainder(
    total,
    weights.map((w, i) => ({ id: String(i).padStart(4, "0"), weight: w })),
  );
  return lr.allocations.map((a) => a.amount);
}

/** A first draft of background kilos that already meets both totals exactly. */
export function draftBackground(r: Rng, totalD: number, g2TotalD: number): BgKilos[] {
  const numbers = backgroundNumbers();
  const raw = numbers.map(() => 800 + r.int(0, 1_400) + r.int(0, 600));
  const kg = apportion(totalD, raw);
  // Keep every member inside the plausible range, moving the excess to members with room.
  for (let guard = 0; guard < 10_000; guard++) {
    const hi = kg.findIndex((v) => v > KG_MAX_D);
    const lo = kg.findIndex((v) => v < KG_MIN_D);
    if (hi < 0 && lo < 0) break;
    if (hi >= 0) {
      const j = kg.findIndex((v) => v < KG_MAX_D - 50);
      kg[hi] = (kg[hi] as number) - 50;
      kg[j] = (kg[j] as number) + 50;
    }
    if (lo >= 0) {
      const j = kg.findIndex((v) => v > KG_MIN_D + 400);
      kg[lo] = (kg[lo] as number) + 50;
      kg[j] = (kg[j] as number) - 50;
    }
  }
  const roomy = numbers.map((_, i) => i).filter((i) => (kg[i] as number) >= 1_000);
  const g2Members = r.shuffle(roomy).slice(0, 12);
  const g2 = apportion(
    g2TotalD,
    g2Members.map(() => 10 + r.int(0, 20)),
  );
  const out: BgKilos[] = numbers.map((memberNo, i) => ({ memberNo, kgD: kg[i] as number, g2D: 0 }));
  g2Members.forEach((idx, k) => {
    (out[idx] as BgKilos).g2D = g2[k] as number;
  });
  for (const b of out) if (!valid(b)) throw new Error(`draft out of range for ${b.memberNo}`);
  return out;
}

export interface TuneResult {
  background: BgKilos[];
  attempt: number;
  steps: number;
}

/**
 * Seeded local search. Moves keep Σ kg and Σ Grade-1 kg fixed:
 *   transfer: d dkg of kilos from member j to member i (their Grade-1 kilos move with them);
 *   regrade:  d dkg of Grade 2 from member k to member m (kilos unchanged, Grade 1 moves back).
 * A move is kept when the penalty does not rise. Attempts restart from a fresh draft.
 */
export function tuneBackground(
  pools: Pools,
  firstAttempt = 0,
  maxAttempts = 40,
  maxSteps = 6_000,
): TuneResult {
  const named = namedKilos();
  const bgTotalD = FINAL_TOTALS.verifiedD - named.reduce((s, n) => s + n.kgD, 0);
  const bgG1D = FINAL_TOTALS.grade1D - named.reduce((s, n) => s + n.g1D, 0);
  const g2TotalD = bgTotalD - bgG1D;
  for (let attempt = firstAttempt; attempt < firstAttempt + maxAttempts; attempt++) {
    const r = rng(`fair-split seed v1 background attempt ${attempt}`);
    let bg: BgKilos[];
    try {
      bg = draftBackground(r, bgTotalD, g2TotalD);
    } catch {
      continue;
    }
    let score = penalty(bg, pools);
    let steps = 0;
    const steps_d = [1, 1, 2, 3, 4, 5, 7, 10, 15];
    while (score > 0 && steps < maxSteps) {
      steps++;
      const d = r.pick(steps_d);
      const i = r.int(0, bg.length - 1);
      const j = r.int(0, bg.length - 1);
      if (i === j) continue;
      const a = bg[i] as BgKilos;
      const b = bg[j] as BgKilos;
      const regrade = a.g2D > 0 && b.g2D > 0 && r.next() < 0.5;
      const before = { a: { ...a }, b: { ...b } };
      if (regrade) {
        a.g2D -= d;
        b.g2D += d;
      } else {
        a.kgD += d;
        b.kgD -= d;
      }
      if (!valid(a) || !valid(b)) {
        Object.assign(a, before.a);
        Object.assign(b, before.b);
        continue;
      }
      const next = penalty(bg, pools);
      if (next <= score) score = next;
      else {
        Object.assign(a, before.a);
        Object.assign(b, before.b);
      }
    }
    if (score === 0) return { background: bg, attempt, steps };
  }
  throw new Error("background tuning did not converge");
}

/** Lot sanity: the shipped figures the totals are measured against. */
export const SHIPPED = { shippedD: LOT.shippedG / DKG, grade1ShippedD: LOT.grade1ShippedG / DKG };
