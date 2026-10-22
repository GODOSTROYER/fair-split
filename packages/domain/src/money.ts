// Integer money. Every amount is integer minor units (US cents or PHP centavos) held in a JS number
// that must be a safe integer; products that could overflow are computed exactly with BigInt.
// Register §2 arithmetic: pool shares use largest-remainder rounding with ties to the lower member
// number; deductions round half-up per component; caps round down.

export type Cents = number;
export type Centavos = number;

export function assertSafeInt(n: number, what = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
  return n;
}

export function assertNonNeg(n: number, what = "amount"): number {
  assertSafeInt(n, what);
  if (n < 0) throw new RangeError(`${what} must be non-negative, got ${n}`);
  return n;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += assertSafeInt(v);
  return assertSafeInt(total, "sum");
}

function toNumber(b: bigint, what: string): number {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} overflows a safe integer`);
  return n;
}

/** floor(a × b / c) for non-negative integers, exact. */
export function mulDivFloor(a: number, b: number, c: number): number {
  assertNonNeg(a, "a");
  assertNonNeg(b, "b");
  if (!Number.isSafeInteger(c) || c <= 0) throw new RangeError("divisor must be a positive safe integer");
  return toNumber((BigInt(a) * BigInt(b)) / BigInt(c), "mulDivFloor");
}

/** round-half-up(a × b / c) for non-negative integers, exact. */
export function mulDivHalfUp(a: number, b: number, c: number): number {
  assertNonNeg(a, "a");
  assertNonNeg(b, "b");
  if (!Number.isSafeInteger(c) || c <= 0) throw new RangeError("divisor must be a positive safe integer");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return toNumber((2n * num + den) / (2n * den), "mulDivHalfUp");
}

/** `bp` basis points of an amount, rounded half-up (a deduction component). */
export function bpHalfUp(amount: number, bp: number): number {
  return mulDivHalfUp(amount, bp, 10_000);
}

/** `bp` basis points of an amount, rounded down (a cap). */
export function bpFloor(amount: number, bp: number): number {
  return mulDivFloor(amount, bp, 10_000);
}

/** A rate as centavos per cent: ₱62.50 per US$ is 6,250 centavos per 100 cents = 125/2. */
export interface FxRate {
  readonly num: number;
  readonly den: number;
}

export type Rounding = "halfUp" | "floor";

/** PHP centavos to US cents at the run's fixed rate. */
export function centavosToCents(centavos: number, fx: FxRate, rounding: Rounding): number {
  return rounding === "halfUp"
    ? mulDivHalfUp(centavos, fx.den, fx.num)
    : mulDivFloor(centavos, fx.den, fx.num);
}

/** US cents to PHP centavos at the run's fixed rate. */
export function centsToCentavos(cents: number, fx: FxRate, rounding: Rounding): number {
  return rounding === "halfUp" ? mulDivHalfUp(cents, fx.num, fx.den) : mulDivFloor(cents, fx.num, fx.den);
}

export interface Weighted {
  readonly id: string;
  readonly weight: number;
}

export interface Allocation {
  readonly id: string;
  readonly amount: number;
  readonly floor: number;
  /** Exact remainder numerator; the remainder is `remainder / totalWeight`. */
  readonly remainder: bigint;
  readonly roundedUp: boolean;
}

export interface LargestRemainderResult {
  readonly total: number;
  readonly totalWeight: number;
  readonly allocations: readonly Allocation[];
  /** How many shares were rounded up (Σ remainders / totalWeight). */
  readonly roundUps: number;
}

/**
 * Splits `total` across `weights` pro rata with largest-remainder rounding, so shares sum to the
 * total exactly. Remainders are compared exactly (common denominator); ties go to the lower ID,
 * which for zero-padded member numbers ("M-007" < "M-014") is the lower member number.
 * Each share is the floor or the ceiling of its exact pro-rata value.
 */
export function largestRemainder(total: number, weights: readonly Weighted[]): LargestRemainderResult {
  assertNonNeg(total, "total");
  const ids = new Set<string>();
  let totalWeight = 0n;
  for (const w of weights) {
    assertNonNeg(w.weight, `weight of ${w.id}`);
    if (ids.has(w.id)) throw new Error(`duplicate id ${w.id}`);
    ids.add(w.id);
    totalWeight += BigInt(w.weight);
  }
  if (totalWeight === 0n) {
    if (total !== 0) throw new RangeError("cannot split a non-zero total over zero weight");
    return {
      total,
      totalWeight: 0,
      allocations: weights.map((w) => ({ id: w.id, amount: 0, floor: 0, remainder: 0n, roundedUp: false })),
      roundUps: 0,
    };
  }
  const t = BigInt(total);
  const base = weights.map((w) => {
    const product = t * BigInt(w.weight);
    return { id: w.id, floor: product / totalWeight, remainder: product % totalWeight };
  });
  let floors = 0n;
  for (const b of base) floors += b.floor;
  const roundUps = Number(t - floors);
  const order = [...base].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const up = new Set(order.slice(0, roundUps).map((b) => b.id));
  const allocations = base.map((b) => {
    const roundedUp = up.has(b.id);
    const floor = toNumber(b.floor, "share");
    return { id: b.id, floor, amount: floor + (roundedUp ? 1 : 0), remainder: b.remainder, roundedUp };
  });
  return { total, totalWeight: toNumber(totalWeight, "totalWeight"), allocations, roundUps };
}

/** Parses a decimal money string ("2887.50", "64.5", "64") into minor units without floats. */
export function parseDecimalMinor(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").padEnd(2, "0");
  const value = Number(whole) * 100 + Number(frac);
  return Number.isSafeInteger(value) ? value : null;
}

/** Minor units as a plain decimal string with two places ("288750" → "2887.50"). */
export function minorToDecimal(minor: number): string {
  assertSafeInt(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const s = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}
