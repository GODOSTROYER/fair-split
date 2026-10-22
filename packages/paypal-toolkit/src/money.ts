// Wire format for US cents. Display formatting belongs to the domain formatter (register C-22);
// this is only the decimal string PayPal's APIs take and return.

const WIRE_VALUE = /^(0|[1-9]\d*)\.(\d{2})$/;
const LOOSE_VALUE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** 288750n → "2887.50". Rejects negative amounts: nothing in an invoice or a payout is negative. */
export function centsToValue(cents: bigint): string {
  if (cents < 0n) throw new RangeError(`Amounts are never negative: ${cents}`);
  const whole = cents / 100n;
  const frac = cents % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/** "2887.50" → 288750n. Strict: exactly two decimals, no sign, no exponent. */
export function valueToCents(value: string): bigint {
  const m = WIRE_VALUE.exec(value);
  if (!m) throw new RangeError(`Not a two-decimal amount: ${JSON.stringify(value)}`);
  return BigInt(m[1] as string) * 100n + BigInt(m[2] as string);
}

/** Tolerant parse of an amount PayPal sent back ("4333.5", "60", "0.00"); null when unreadable. */
export function readValueCents(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = LOOSE_VALUE.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
}
