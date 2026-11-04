// Pure helpers for the judge-load soak: percentiles, summaries, CSV rows and the loopback source addresses that give
// every judge its own network. No I/O here (tested in apps/tasks/test/soak-stats.test.ts).

/** Nearest-rank percentile (p in 0..100) of the finite values; NaN when there are none. */
export function percentile(values: readonly number[], p: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (xs.length === 0) return Number.NaN;
  const k = Math.min(xs.length, Math.max(1, Math.ceil((p / 100) * xs.length)));
  return xs[k - 1] as number;
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(values: readonly number[]): Summary {
  const xs = values.filter((v) => Number.isFinite(v));
  const sum = xs.reduce((a, b) => a + b, 0);
  return {
    n: xs.length,
    p50: percentile(xs, 50),
    p95: percentile(xs, 95),
    p99: percentile(xs, 99),
    max: xs.length ? Math.max(...xs) : Number.NaN,
    mean: xs.length ? sum / xs.length : Number.NaN,
  };
}

/** One CSV cell: numbers rounded to `digits`, NaN and null empty, text quoted when it must be. */
export function cell(v: unknown, digits = 1): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? String(v) : v.toFixed(digits);
  }
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map((v) => cell(v)).join(",")}\n`;
}

/** Rows of objects as CSV with the given columns (a header line first). */
export function toCsv<T extends object>(columns: readonly (keyof T & string)[], rows: readonly T[]): string {
  return csvLine(columns) + rows.map((r) => csvLine(columns.map((c) => r[c]))).join("");
}

/**
 * The n-th judge's source address on the loopback network, 127.10.0.1 upwards (skipping .0 and .255 in the last
 * octet). Linux routes all of 127.0.0.0/8 to lo, so each judge connects from its own address and fs-api's per-IP
 * throttles see separate networks. `base` picks the second octet, so separate runs never reuse an address within the
 * hour the per-IP window remembers.
 */
export function judgeAddress(n: number, base = 10): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`judge index ${n}`);
  const perBlock = 254;
  const third = Math.floor(n / perBlock);
  const fourth = (n % perBlock) + 1;
  const second = base + Math.floor(third / 256);
  if (second > 255) throw new Error(`judge index ${n} past the loopback range`);
  return `127.${second}.${third % 256}.${fourth}`;
}

/** Counts of each value ("live:3 replay:7"), sorted by key. */
export function tally(values: readonly string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
}

/** `--key=value` and `--flag` arguments as a map. */
export function parseArgs(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/i.exec(a);
    if (m?.[1]) out.set(m[1], m[2] ?? "true");
  }
  return out;
}
