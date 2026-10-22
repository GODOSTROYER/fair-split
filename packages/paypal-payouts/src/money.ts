// Wire format for US cents (display formatting is the domain formatter's job, register C-22).

const LOOSE_VALUE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** 6445n → "64.45". Payout amounts are always positive. */
export function centsToValue(cents: bigint): string {
  if (cents <= 0n) throw new RangeError(`A payout amount must be positive: ${cents}`);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Reads an amount PayPal sent back ("64.45", "64.5", "64"); null when unreadable. */
export function readValueCents(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const m = LOOSE_VALUE.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
}
