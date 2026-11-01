// E-19 figures: every money or kilo figure in public copy equals one in IC-03. The allowed set is computed from
// the seed snapshot itself (imported, never copied): every cents, centavos and grams field, the peso estimate of
// every cents field at the run's fixed rate, and every figure written inside the snapshot's own strings.
import { getSnapshot } from "@fairsplit/seed";

export type Unit = "USD" | "PHP" | "KG";

export interface Figure {
  readonly unit: Unit;
  /** Dollars, pesos or kilograms. */
  readonly value: number;
  /** The figure as written. */
  readonly text: string;
}

const MONEY = /(US\$|\$|₱|\bPHP\s?|\bUSD\s?)\s?(\d[\d,]*(?:\.\d+)?)/g;
const KILOS = /(\d[\d,]*(?:\.\d+)?)\s?(?:kg|kilos?|kilograms?)\b/gi;

const num = (s: string): number => Number(s.replace(/,/g, ""));

/** Every money and kilo figure written in `text`. */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(MONEY)) {
    const sign = (m[1] ?? "").trim();
    out.push({
      unit: sign === "₱" || sign === "PHP" ? "PHP" : "USD",
      value: num(m[2] ?? ""),
      text: m[0].trim(),
    });
  }
  for (const m of text.matchAll(KILOS)) out.push({ unit: "KG", value: num(m[1] ?? ""), text: m[0] });
  return out;
}

/** A comparison key: the value to 1/10,000 of its unit, so 0.29523 and 4,333.50 both compare exactly. */
const key = (value: number): number => Math.round(value * 10_000);

export interface FigureSet {
  has(f: Figure): boolean;
  readonly size: number;
}

let cached: FigureSet | undefined;

/** The IC-03 figures: what public copy may print. */
export function ic03Figures(): FigureSet {
  if (cached) return cached;
  const snapshot = getSnapshot();
  const sets: Record<Unit, Set<number>> = { USD: new Set(), PHP: new Set(), KG: new Set() };
  const { num: fxNum, den: fxDen } = snapshot.fx.centavosPerCent;
  const addCents = (cents: number) => {
    sets.USD.add(key(cents / 100));
    const pesos = (cents * fxNum) / fxDen / 100;
    sets.PHP.add(key(Math.round(pesos * 100) / 100));
    sets.PHP.add(key(Math.round(pesos)));
  };
  const walk = (value: unknown, name: string) => {
    if (Array.isArray(value)) for (const v of value) walk(v, name);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
    else if (typeof value === "number") {
      if (/centavos/i.test(name)) sets.PHP.add(key(value / 100));
      else if (/cents/i.test(name)) addCents(value);
      else if (/G$|GPer/.test(name)) sets.KG.add(key(value / 1000));
    } else if (typeof value === "string") {
      for (const f of figuresIn(value)) sets[f.unit].add(key(f.value));
    }
  };
  walk(snapshot, "");
  cached = {
    has: (f) => sets[f.unit].has(key(f.value)),
    size: sets.USD.size + sets.PHP.size + sets.KG.size,
  };
  return cached;
}
