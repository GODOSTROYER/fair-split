// Money is integer cents end to end; PayPal's decimal strings are parsed and printed only at the edge.

/** Parses a PayPal amount string ("4333.50", "1.0", ".5", "-1.09") into integer cents; null if it has
 * more than two decimals or is not a number. */
export function toCents(value: string): number | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, whole = "", frac = ""] = m;
  if (whole === "" && frac === "") return null;
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null;
  const cents = Number(whole || "0") * 100 + Number(`${frac}00`.slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" ? -cents : cents;
}

/** Prints integer cents as PayPal's two-decimal string ("4333.50", "-1.09"). */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Invoicing / reporting money shape. */
export function money(currency: string, cents: number): { currency_code: string; value: string } {
  return { currency_code: currency, value: fromCents(cents) };
}

/** Payouts money shape (`currency`, not `currency_code`). */
export function payoutMoney(currency: string, cents: number): { currency: string; value: string } {
  return { currency, value: fromCents(cents) };
}

/** Multiplies cents by a decimal quantity string (up to 5 decimals), rounding half up. */
export function multiplyQuantity(cents: number, quantity: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,5}))?$/.exec(quantity.trim());
  if (!m) return null;
  const scaled = BigInt(m[1] ?? "0") * 100000n + BigInt(`${m[2] ?? ""}00000`.slice(0, 5));
  const product = BigInt(cents) * scaled;
  const q = product / 100000n;
  const r = product % 100000n;
  return Number(r * 2n >= 100000n ? q + 1n : q);
}

/** Percentage (decimal string, e.g. "7.25") of cents, rounded half up. */
export function percentOf(cents: number, percent: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(percent.trim());
  if (!m) return null;
  const milli = BigInt(m[1] ?? "0") * 1000n + BigInt(`${m[2] ?? ""}000`.slice(0, 3));
  const product = BigInt(cents) * milli;
  const denom = 100000n;
  const q = product / denom;
  const r = product % denom;
  return Number(r * 2n >= denom ? q + 1n : q);
}
