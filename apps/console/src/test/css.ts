// A stylesheet as a browser would cascade it, for what jsdom leaves out: jsdom matches no media query but
// "screen", runs no transition and lets a hidden control take focus, so a test that needs to know where a rule
// lands in a browser (whether a panel is visible the moment it rises, say) reads the source here. It parses the
// file's rules (inside @media, @supports and @layer; never @starting-style or @keyframes), evaluates the media
// queries for one medium, and picks the winner by specificity, then order.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CssRule {
  /** One selector of the rule's list. */
  readonly selector: string;
  /** The enclosing media queries' texts, outermost first. */
  readonly media: readonly string[];
  readonly declarations: Readonly<Record<string, string>>;
  /** Source order of the rule. */
  readonly order: number;
}

export interface Medium {
  readonly width: number;
  readonly motion: "full" | "reduced";
}

/** Splits `text` on `separator` where it is outside parentheses and brackets. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of splitTop(body, ";")) {
    const colon = d.indexOf(":");
    if (colon < 0) continue;
    out[d.slice(0, colon).trim()] = d
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ");
  }
  return out;
}

/** The rules of a stylesheet (path relative to the console's root). */
export function readRules(path: string): CssRule[] {
  const text = readFileSync(resolve(process.cwd(), path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const walk = (src: string, media: readonly string[]) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) return;
      let prelude = src.slice(i, open);
      prelude = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(open + 1, j - 1);
      if (prelude.startsWith("@media")) walk(inner, [...media, prelude.slice("@media".length).trim()]);
      else if (prelude.startsWith("@supports") || prelude.startsWith("@layer")) walk(inner, media);
      else if (!prelude.startsWith("@")) {
        const declarations = declarationsOf(inner);
        for (const selector of splitTop(prelude, ",")) {
          rules.push({ selector, media, declarations, order: rules.length });
        }
      }
      i = j;
    }
  };
  walk(text, []);
  return rules;
}

function featureMatches(feature: string, medium: Medium): boolean {
  const f = feature.trim();
  if (f === "screen" || f === "all") return true;
  if (f === "print") return false;
  const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(f);
  if (!m) throw new Error(`css.ts cannot evaluate the media feature "${f}"`);
  const [, name, value] = m;
  const px = () => Number.parseFloat(value ?? "");
  switch (name) {
    case "min-width":
      return medium.width >= px();
    case "max-width":
      return medium.width <= px();
    case "prefers-reduced-motion":
      return (value === "reduce") === (medium.motion === "reduced");
    case "prefers-color-scheme":
      return value === "light";
    case "forced-colors":
      return value === "none";
    case "hover":
      return value === "hover";
    case "pointer":
      return value === "fine";
    default:
      throw new Error(`css.ts cannot evaluate the media feature "${f}"`);
  }
}

/** Whether a media query list applies to `medium` (light, a fine pointer, no forced colors). */
export function mediaMatches(query: string, medium: Medium): boolean {
  return splitTop(query, ",").some((q) =>
    q
      .split(/\s+and\s+/)
      .filter((f) => f.trim() !== "")
      .every((f) => featureMatches(f, medium)),
  );
}

/** Specificity as [ids, classes/attributes/pseudo-classes, types]; :not() and :is() count their argument. */
export function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/::[\w-]+(\([^)]*\))?/g, "").replace(/:(not|is|where|has)\(/g, "(");
  const attributes = s.match(/\[[^\]]*\]/g)?.length ?? 0;
  const bare = s.replace(/\[[^\]]*\]/g, "");
  const ids = bare.match(/#[\w-]+/g)?.length ?? 0;
  const classes = (bare.match(/\.[\w-]+/g)?.length ?? 0) + attributes + (bare.match(/:[\w-]+/g)?.length ?? 0);
  const types = bare.match(/(^|[\s>+~(])[a-z][\w-]*/gi)?.length ?? 0;
  return [ids, classes, types];
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Whether a rule of specificity `spec` at `order` beats one of `than` at `thanOrder`. */
function outranks(
  spec: readonly number[],
  order: number,
  than: readonly number[],
  thanOrder: number,
): boolean {
  for (let i = 0; i < 3; i++) {
    const a = spec[i] ?? 0;
    const b = than[i] ?? 0;
    if (a !== b) return a > b;
  }
  return order > thanOrder;
}

/** The value of `property` the cascade gives `element` from `rules` in `medium` (undefined when none sets it). */
export function cascaded(
  rules: readonly CssRule[],
  element: Element,
  property: string,
  medium: Medium,
): string | undefined {
  let best: { spec: [number, number, number]; order: number; value: string } | undefined;
  for (const rule of rules) {
    const value = rule.declarations[property];
    if (value === undefined || !matches(element, rule.selector)) continue;
    if (!rule.media.every((q) => mediaMatches(q, medium))) continue;
    const spec = specificity(rule.selector);
    if (!best || outranks(spec, rule.order, best.spec, best.order)) best = { spec, order: rule.order, value };
  }
  return best?.value;
}

/**
 * The delay a `transition` value gives `property` (the second time in its item: "0s", a number of ms, or a
 * var() of a duration token), or null when it starts at once. Undefined when the transition leaves it out.
 */
export function transitionDelay(transition: string, property: string): string | null | undefined {
  const item = splitTop(transition, ",").find((t) => t.split(/\s+/)[0] === property);
  if (!item) return undefined;
  const times = splitTop(item, " ").filter(
    (t) => /^-?[\d.]+m?s$/.test(t) || /^var\(--[\w-]*(dur|delay)[\w-]*\)$/.test(t),
  );
  const delay = times[1];
  return delay === undefined || /^0m?s$/.test(delay) ? null : delay;
}
