// Resolves the colour specs in tokens.ts to concrete values: mixes are blended over their base in sRGB and
// emitted opaque, alpha colours keep their alpha. Everything the generator writes comes through here.

import { contrast, formatOklch, hexToOklch, mixHex, type Oklch, parseHex } from "./color.js";
import {
  COLOUR_NAMES,
  COLOURS,
  CONTRAST_RULES,
  type ColourName,
  type ColourSpec,
  THEMES,
  type ThemeName,
} from "./tokens.js";

export interface ResolvedColour {
  readonly hex: string;
  readonly oklch: Oklch;
  /** 1 for opaque colours. */
  readonly alpha: number;
  /** The CSS fallback value: lowercase hex (as Biome formats CSS), or rgb() with alpha. */
  readonly css: string;
  /** The OKLCH CSS value. */
  readonly cssOklch: string;
}

function resolveSpec(theme: ThemeName, spec: ColourSpec, seen: Set<ColourName>): ResolvedColour {
  if (spec.kind === "mix") {
    if (seen.has(spec.of) || seen.has(spec.over)) throw new Error(`Colour mix cycle in ${theme}`);
    const top = resolveColour(theme, spec.of, new Set([...seen, spec.of]));
    const under = resolveColour(theme, spec.over, new Set([...seen, spec.over]));
    const hex = mixHex(top.hex, under.hex, spec.amount);
    const oklch = hexToOklch(hex);
    return { hex, oklch, alpha: 1, css: hex.toLowerCase(), cssOklch: formatOklch(oklch) };
  }
  if (spec.kind === "alpha") {
    const [r, g, b] = parseHex(spec.hex);
    return {
      hex: spec.hex,
      oklch: spec.oklch,
      alpha: spec.alpha,
      css: `rgb(${r} ${g} ${b} / ${spec.alpha})`,
      cssOklch: formatOklch(spec.oklch, spec.alpha),
    };
  }
  return {
    hex: spec.hex,
    oklch: spec.oklch,
    alpha: 1,
    css: spec.hex.toLowerCase(),
    cssOklch: formatOklch(spec.oklch),
  };
}

export function resolveColour(
  theme: ThemeName,
  name: ColourName,
  seen = new Set<ColourName>([name]),
): ResolvedColour {
  return resolveSpec(theme, COLOURS[theme][name], seen);
}

export function resolveTheme(theme: ThemeName): Readonly<Record<ColourName, ResolvedColour>> {
  return Object.fromEntries(COLOUR_NAMES.map((n) => [n, resolveColour(theme, n)])) as Record<
    ColourName,
    ResolvedColour
  >;
}

export const RESOLVED: Readonly<Record<ThemeName, Readonly<Record<ColourName, ResolvedColour>>>> = {
  tablea: resolveTheme("tablea"),
  adlaw: resolveTheme("adlaw"),
};

export interface ContrastResult {
  readonly theme: ThemeName;
  readonly group: string;
  readonly fg: ColourName;
  readonly bg: ColourName;
  readonly fgHex: string;
  readonly bgHex: string;
  /** Rounded down to 2 decimals, so a printed pass is never a rounding artefact. */
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

/** Every declared pair in both themes, with its WCAG 2.x ratio. */
export function contrastResults(): ContrastResult[] {
  const out: ContrastResult[] = [];
  for (const theme of THEMES) {
    for (const rule of CONTRAST_RULES) {
      for (const fg of rule.fg) {
        for (const bg of rule.bg) {
          const f = RESOLVED[theme][fg];
          const b = RESOLVED[theme][bg];
          const ratio = contrast(f.hex, b.hex);
          out.push({
            theme,
            group: rule.group,
            fg,
            bg,
            fgHex: f.hex,
            bgHex: b.hex,
            ratio: Math.floor(ratio * 100) / 100,
            min: rule.min,
            pass: ratio >= rule.min,
          });
        }
      }
    }
  }
  return out;
}
