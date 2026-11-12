// @fairsplit/tokens: the one hand-edited source of Fair Split's design tokens (design §2, S2 §2.1–2.5).
// `pnpm --filter @fairsplit/tokens build` turns it into theme.web.css (--fs-* under [data-theme]),
// tokens.native.ts (hex), fonts.css, tailwind.css, m3.ts, ag-grid.ts and contrast.json in src/generated/.
//
// Colours are OKLCH with their sRGB hex fallback. The hex values are design direction v2's (ADR-0016,
// research/theme-1104/decision.md §6); a test proves each OKLCH triple rounds to its hex, so the two can never
// drift apart.
//
// Palette v2, "Hayag": white and porcelain surfaces with a cool blue-black ink, and one job per colour.
// - Jade means money: raised, this control moves the co-op's money; flush, the simulated PayPal confirmed it;
//   a dashed jade outline, it is in flight. Never decoration, a heading, the seal or a check result.
// - The canary role means a person must decide. UI gate round 6 (the owner's rule: no brown, no amber): on Hayag
//   it is the person's own colour, ballpoint indigo, so "a person did this" and "a person must do this" are one hue
//   and no amber is left on any surface. Never an error. (Gabii, the film's night cards, keeps its marigold.)
// - Ballpoint indigo (pod, the chalk slab) is a person's hand: their decision slabs, stamps, the seal's
//   linework, the focus ring and a selection, and what waits for a person (the canary role). Never money, never
//   the machine (the dial reads in ink).
// - Graphite pencil is the machine; ink is a checked fact; red is only PayPal saying no.
// - Hatch plus the word is cash or unavailable; dashed steel is "not real, or not yet" (honesty labels).
// One morning wash behind the heroes, one jade halo for one beat after the simulated PayPal confirms, the film's
// night glows on Gabii cards: no other gradient, no glass, no gradient text and no noise.
//
// UI gate round 2 (unslop, 5 Nov 2026): one amber for holds (the dot, the gauge arc, the 3 px held-row rule and
// the filled H-tag), never a text colour or a fill, so nothing reads brown; hold copy is ink and held rows have
// no cream wash. Every button is one flat primary (the indigo face) or one outline secondary: the money slab
// wears the same indigo face, because green is only money the simulated PayPal confirmed. One numeral voice:
// money, figures and hashes are FS Sans semi-condensed, and there is no outline face any more.
//
// UI gate round 3 (the owner's "one family + mono", docs/DESIGN.md): FS Sans sets every heading, label, body line and
// number, numbers in tabular figures (one money style); one monospace sets hashes, IDs and timestamps, nothing
// else. No dot-matrix, stencil, outline or condensed display face, and no Atkinson: a member's statement is FS Sans
// too. Five size steps (TYPE_STEPS): id 12 (the mono), label 14, body 16, title 24, hero 56; the phone sets
// 13 / 15 / 17 / 24 / 48 sp. Dashed lines mean simulated, and nothing else.

import { DEPTH, EASE, SPRINGS, TWEENS } from "@fairsplit/motion/presets";
import type { Oklch } from "./color.js";

export const THEMES = ["tablea", "adlaw"] as const;
export type ThemeName = (typeof THEMES)[number];

/**
 * The slot keys stay `tablea` and `adlaw` (more than 270 places read them); only their values and display names
 * changed with design direction v2 (ADR-0016). Adlaw is Hayag (day), the default everywhere; Tablea is Gabii
 * (night), the film's cards and an opt-in night console, never on the judge path.
 */
export const THEME_INFO: Readonly<
  Record<ThemeName, { scheme: "dark" | "light"; display: string; use: string }>
> = {
  tablea: {
    scheme: "dark",
    display: "Gabii (night)",
    use: "Gabii (night): the film's cards and an opt-in night console",
  },
  adlaw: {
    scheme: "light",
    display: "Hayag (day)",
    use: "Hayag (day): default for the console, the judge stage, Proof and the app",
  },
};

export interface SolidColour {
  readonly kind: "solid";
  readonly hex: string;
  readonly oklch: Oklch;
}
export interface MixColour {
  /** S2 "mix n%": `of` blended over `over` in sRGB, rounded, emitted opaque (AG Grid needs opaque fills). */
  readonly kind: "mix";
  readonly of: ColourName;
  readonly over: ColourName;
  readonly amount: number;
}
export interface AlphaColour {
  readonly kind: "alpha";
  readonly hex: string;
  readonly oklch: Oklch;
  readonly alpha: number;
}
export type ColourSpec = SolidColour | MixColour | AlphaColour;

const ok = (hex: string, l: number, c: number, h: number): SolidColour => ({
  kind: "solid",
  hex,
  oklch: [l, c, h],
});
const mix = (of: ColourName, amount: number, over: ColourName = "plate"): MixColour => ({
  kind: "mix",
  of,
  over,
  amount,
});
const alpha = (base: SolidColour, a: number): AlphaColour => ({
  kind: "alpha",
  hex: base.hex,
  oklch: base.oklch,
  alpha: a,
});

// Shared sRGB values (identical in both themes, or reused within one).
const WHITE = ok("#FFFFFF", 1, 0, 0);
const COPY_PINK = ok("#F4C9D4", 0.8761, 0.0506, 1.07);
const COPY_YELLOW = ok("#F5E27A", 0.9071, 0.1267, 99.17);
/** Marigold: a person must decide (ΔE 7.4 from PayPal's button yellow #FFC439). */
const MARIGOLD = ok("#FFA41B", 0.7915, 0.1672, 68.93);
/** Hayag's cool blue-black ink, also the words printed on evidence paper in both themes. */
const HAYAG_INK = ok("#0B1220", 0.1831, 0.0309, 263.38);
const HAYAG_JADE = ok("#14CC90", 0.7489, 0.1591, 162.96);
const HAYAG_JADE_LIP = ok("#0A9467", 0.5904, 0.126, 162.79);
const HAYAG_JADE_DEEP = ok("#06724F", 0.4892, 0.1038, 163.13);
/** Ballpoint indigo: a person's hand (ΔE 13.6 and 23.2° of hue from PayPal blue #0070E0). */
const BALLPOINT = ok("#4A2FD6", 0.4625, 0.2354, 279.25);
const BALLPOINT_LIP = ok("#3722B0", 0.3932, 0.2068, 277.75);
const BALLPOINT_EDGE = ok("#29188A", 0.3283, 0.1733, 277.69);
/** Hayag's ink-2: secondary text, 9.8:1 on plate (statement-safe). */
const HAYAG_INK_2 = ok("#3A4456", 0.3852, 0.0335, 262.09);
const GABII_GROUND = ok("#090D18", 0.161, 0.0243, 268.23);
const GABII_JADE = ok("#3DE6AE", 0.827, 0.1574, 165.68);
const GABII_ON_JADE = ok("#04170F", 0.185, 0.0313, 164.49);
const GABII_INK = ok("#F4F6FA", 0.9728, 0.0057, 264.53);
const GABII_INK_2 = ok("#C3C9D6", 0.8352, 0.0193, 265.96);
const GABII_CHALK = ok("#5B43EA", 0.5197, 0.2367, 280.8);
const GABII_CHALK_LIP = ok("#4630C9", 0.4474, 0.2205, 279.17);
const GABII_CHALK_EDGE = ok("#2E1E94", 0.3507, 0.1791, 277.94);

export const COLOUR_NAMES = [
  "ground",
  "plate",
  "plate-2",
  "rule",
  "ink",
  "ink-2",
  "ink-3",
  "pencil",
  "pencil-faint",
  "jade",
  "on-jade",
  "jade-text",
  "jade-flush-border",
  "jade-wash",
  "canary",
  "on-canary",
  "canary-text",
  "canary-wash",
  "canary-border",
  "red",
  "red-face",
  "on-red-face",
  "red-wash",
  "pod",
  "hatch",
  "steel-line",
  "steel-face",
  "copy-white",
  "copy-pink",
  "copy-yellow",
  "pencil-wash",
  "scrim",
  "highlight",
  "drawer-highlight",
  "slab-chalk-face",
  "slab-chalk-right",
  "slab-chalk-bottom",
  "slab-chalk-label",
  "slab-jade-face",
  "slab-jade-right",
  "slab-jade-bottom",
  "slab-jade-label",
  "paper-ink",
  "bezel",
  "rule-strong",
  "pod-wash",
  "jade-halo",
  "statement-ink",
  "statement-ink-2",
] as const;

export type ColourName = (typeof COLOUR_NAMES)[number];

/** What each colour is for. A colour that appears without its state being true is a bug. */
export const COLOUR_ROLES: Readonly<Record<ColourName, string>> = {
  ground: "Page background",
  plate: "Content surfaces, panels and the statement card",
  "plate-2": "Table headers, inspectors and bolted faces",
  rule: "1 px separators between rows",
  ink: "Body text and checked facts (Matches, the Proof pill, the Sample badge)",
  "ink-2": "Secondary text",
  "ink-3": "Metadata and icons only; never statement copy",
  pencil: "The machine: Claude's readings and the engine's figures (graphite), until people sign",
  "pencil-faint": "Low-confidence values in a You cell (replaces pencil at 60%)",
  jade: "Money only. Raised: this will move money. Flush: the simulated PayPal confirmed it",
  "on-jade": "Text on a jade face",
  "jade-text": "Jade as text",
  "jade-flush-border": "Border of flush jade faces; dashed 1.5 px, money in flight",
  "jade-wash": "Grid flash for a PayPal-driven change",
  canary: "A person must decide: indigo on Hayag (round 6: no amber), marigold on Gabii. Never an error",
  "on-canary": "Text on a canary face",
  "canary-text": "Words beside a hold: ink on Hayag (the dot carries the meaning; the hue is never text)",
  "canary-wash":
    "Behind a held row or a You cell: no fill on Hayag (no cream); the dot and the outline carry it",
  "canary-border": "A hold's outline and dot, a parked thread: the canary hue as a line",
  red: "Only PayPal DENIED, FAILED, BLOCKED, an unexpected RETURNED and ERRPYO codes",
  "red-face": "A red face (the batch-denied banner)",
  "on-red-face": "Text on a red face",
  "red-wash": "Background behind red copy",
  pod: "A person's hand: focus ring, dial needle, seal linework, selection",
  hatch: "Cash at the bodega, or unavailable; always with a word",
  "steel-line": "Dashed honesty outline, input outlines (3:1), bolted edges",
  "steel-face": "Ground of the steel hatch",
  "copy-white": "The white original copy (evidence tags and favicons only)",
  "copy-pink": "The pink duplicate copy (evidence tags and favicons only)",
  "copy-yellow": "The yellow copy (evidence tags and favicons only)",
  "pencil-wash": "Grid flash for an engine recompute",
  scrim: "Behind drawers and dialogs: a neutral slate veil, so nothing under it turns khaki",
  highlight: "1 px inner top highlight on slab faces",
  "drawer-highlight": "1 px top highlight on drawers",
  "slab-chalk-face": "The person's decision slab (indigo in both themes); stamps",
  "slab-chalk-right": "The person's decision slab: its bottom lip",
  "slab-chalk-bottom": "The person's decision slab: the 1 px under-edge of its lip",
  "slab-chalk-label": "The person's decision slab: its label, and a stamp's initials",
  "slab-jade-face":
    "The money slab's face: the same flat indigo primary as every decision (green is only confirmed money)",
  "slab-jade-right": "The money slab's hold fill (its progress while held)",
  "slab-jade-bottom": "The money slab's under-edge (the slot stays; the slab is flat)",
  "slab-jade-label": "The money slab's label",
  "paper-ink": "Words printed on evidence paper (the Synthetic sample tag); paper is light in both themes",
  bezel: "Phone frames on the Judge stage (graphite chrome, not the app)",
  "rule-strong":
    "Decorative outlines (chips, slip thumbnails, the dial's inner band); never a control's only boundary",
  "pod-wash": "A row or cell a person has selected",
  "jade-halo": "The one earned glow: a 6 to 8 px ring on a Bayad na face, one beat after PayPal confirms",
  "statement-ink": "A member's statement: its words and figures (7:1 or better on its card)",
  "statement-ink-2": "A member's statement: secondary words and metadata (7:1 or better; never ink-3)",
};

export const COLOURS: Readonly<Record<ThemeName, Readonly<Record<ColourName, ColourSpec>>>> = {
  // Gabii (night): the film's title, chapter and architecture cards, and an opt-in night console.
  tablea: {
    ground: GABII_GROUND,
    plate: ok("#10172A", 0.2085, 0.0394, 267.61),
    "plate-2": ok("#172036", 0.2468, 0.0441, 266.33),
    rule: ok("#25304A", 0.312, 0.0494, 266.1),
    ink: GABII_INK,
    "ink-2": GABII_INK_2,
    "ink-3": ok("#8E98AE", 0.679, 0.0345, 266.04),
    pencil: ok("#A7B4CB", 0.7673, 0.036, 261.93),
    "pencil-faint": ok("#8E9BB4", 0.6877, 0.0398, 263.53),
    jade: GABII_JADE,
    "on-jade": GABII_ON_JADE,
    "jade-text": ok("#55EDBB", 0.8527, 0.1472, 167.4),
    "jade-flush-border": GABII_JADE,
    "jade-wash": mix("jade", 0.14),
    canary: MARIGOLD,
    "on-canary": GABII_GROUND,
    "canary-text": ok("#FFB65C", 0.8283, 0.1355, 69.65),
    "canary-wash": mix("canary", 0.14),
    "canary-border": MARIGOLD,
    red: ok("#FF7A72", 0.7331, 0.1637, 25.38),
    "red-face": ok("#D2394A", 0.5787, 0.1887, 19.5),
    "on-red-face": WHITE,
    "red-wash": mix("red", 0.12),
    pod: ok("#9C8CFF", 0.7043, 0.1642, 287.8),
    hatch: ok("#46557A", 0.453, 0.0638, 266.94),
    "steel-line": ok("#8996B4", 0.6732, 0.047, 266.69),
    "steel-face": ok("#222C44", 0.2958, 0.0461, 266.35),
    "copy-white": WHITE,
    "copy-pink": COPY_PINK,
    "copy-yellow": COPY_YELLOW,
    "pencil-wash": mix("pencil", 0.12),
    scrim: alpha(ok("#04060C", 0.1225, 0.016, 265.21), 0.7),
    highlight: alpha(WHITE, 0.16),
    "drawer-highlight": alpha(WHITE, 0.08),
    "slab-chalk-face": GABII_CHALK,
    "slab-chalk-right": GABII_CHALK_LIP,
    "slab-chalk-bottom": GABII_CHALK_EDGE,
    "slab-chalk-label": WHITE,
    "slab-jade-face": GABII_CHALK,
    "slab-jade-right": GABII_CHALK_LIP,
    "slab-jade-bottom": GABII_CHALK_EDGE,
    "slab-jade-label": WHITE,
    "paper-ink": HAYAG_INK,
    bezel: ok("#05070C", 0.1284, 0.0129, 263.62),
    "rule-strong": ok("#3A4763", 0.3989, 0.0505, 264.99),
    "pod-wash": mix("pod", 0.14),
    "jade-halo": alpha(GABII_JADE, 0.22),
    "statement-ink": GABII_INK,
    "statement-ink-2": GABII_INK_2,
  },
  // Hayag (day): the default for the console, the judge stage, Proof and the app.
  adlaw: {
    ground: ok("#F3F5F8", 0.9695, 0.0045, 258.32),
    plate: WHITE,
    "plate-2": ok("#F7F8FA", 0.9789, 0.0029, 264.54),
    rule: ok("#E3E7EE", 0.9269, 0.0104, 261.79),
    ink: HAYAG_INK,
    "ink-2": HAYAG_INK_2,
    "ink-3": ok("#5A6476", 0.5014, 0.0313, 262.21),
    pencil: ok("#4A5A73", 0.4643, 0.0455, 259.2),
    "pencil-faint": ok("#5D6A80", 0.5217, 0.0383, 260.92),
    jade: HAYAG_JADE,
    "on-jade": HAYAG_INK,
    "jade-text": HAYAG_JADE_DEEP,
    "jade-flush-border": HAYAG_JADE_LIP,
    "jade-wash": mix("jade", 0.14),
    // Round 6: a person's decision is the person's colour (no amber on Hayag): the held dot, a hold tag's outline,
    // the parked thread, the "needs you" chip's ring. White on its face; its words stay ink.
    canary: BALLPOINT,
    "on-canary": WHITE,
    "canary-text": HAYAG_INK,
    "canary-wash": WHITE,
    "canary-border": BALLPOINT,
    red: ok("#CF2A27", 0.5562, 0.2008, 27.48),
    "red-face": ok("#D42A26", 0.5652, 0.2055, 27.78),
    "on-red-face": WHITE,
    "red-wash": ok("#FDECEB", 0.9563, 0.0186, 21.57),
    pod: BALLPOINT,
    hatch: ok("#A4AEBC", 0.7474, 0.0231, 256.75),
    "steel-line": ok("#7E8898", 0.624, 0.0268, 259.81),
    "steel-face": ok("#E6EAF0", 0.9357, 0.0092, 258.34),
    "copy-white": WHITE,
    "copy-pink": COPY_PINK,
    "copy-yellow": COPY_YELLOW,
    "pencil-wash": mix("pencil", 0.1),
    scrim: alpha(HAYAG_INK_2, 0.4),
    highlight: alpha(WHITE, 0.45),
    "drawer-highlight": alpha(WHITE, 1),
    "slab-chalk-face": BALLPOINT,
    "slab-chalk-right": BALLPOINT_LIP,
    "slab-chalk-bottom": BALLPOINT_EDGE,
    "slab-chalk-label": WHITE,
    "slab-jade-face": BALLPOINT,
    "slab-jade-right": BALLPOINT_LIP,
    "slab-jade-bottom": BALLPOINT_EDGE,
    "slab-jade-label": WHITE,
    "paper-ink": HAYAG_INK,
    bezel: ok("#141A24", 0.2166, 0.0218, 260.51),
    "rule-strong": ok("#CBD2DC", 0.8614, 0.0158, 257.2),
    "pod-wash": mix("pod", 0.08),
    "jade-halo": alpha(HAYAG_JADE, 0.16),
    "statement-ink": HAYAG_INK,
    "statement-ink-2": HAYAG_INK_2,
  },
};

/** Contrast floors that fail CI (design §2.7, S2 §2.2). Pairs are [foreground, background]. */
export interface ContrastRule {
  readonly group: string;
  readonly min: number;
  readonly fg: readonly ColourName[];
  readonly bg: readonly ColourName[];
  readonly why: string;
}

const SURFACES = ["ground", "plate", "plate-2"] as const satisfies readonly ColourName[];

export const CONTRAST_RULES: readonly ContrastRule[] = [
  {
    group: "console-text",
    min: 4.5,
    fg: ["ink", "ink-2", "ink-3", "pencil", "pencil-faint", "jade-text", "canary-text", "red"],
    bg: SURFACES,
    why: "Console text on every surface it can sit on (WCAG 2.2 AA)",
  },
  { group: "statement", min: 7, fg: ["ink", "ink-2"], bg: ["plate"], why: "Statement copy at 7:1" },
  {
    group: "statement",
    min: 7,
    fg: ["statement-ink", "statement-ink-2"],
    bg: SURFACES,
    why: "Every word on a member's statement at 7:1, on any surface the card can sit on",
  },
  { group: "face", min: 4.5, fg: ["on-jade"], bg: ["jade"], why: "Text on a jade face" },
  { group: "face", min: 4.5, fg: ["on-canary"], bg: ["canary"], why: "Text on a canary face" },
  { group: "face", min: 4.5, fg: ["on-red-face"], bg: ["red-face"], why: "Text on a red face" },
  { group: "face", min: 4.5, fg: ["slab-chalk-label"], bg: ["slab-chalk-face"], why: "Chalk slab label" },
  { group: "face", min: 4.5, fg: ["slab-jade-label"], bg: ["slab-jade-face"], why: "Jade slab label" },
  {
    group: "wash",
    min: 4.5,
    fg: ["ink", "ink-2"],
    bg: ["jade-wash", "pencil-wash", "canary-wash", "red-wash"],
    why: "Text stays legible while a grid cell flashes or a row is held",
  },
  { group: "wash", min: 4.5, fg: ["red"], bg: ["red-wash"], why: "Red copy on its wash" },
  { group: "face", min: 4.5, fg: ["paper-ink"], bg: ["copy-white"], why: "Tags printed on evidence paper" },
  { group: "non-text", min: 3, fg: ["pod"], bg: SURFACES, why: "Focus ring and needle on every surface" },
  {
    group: "non-text",
    min: 3,
    fg: ["jade-flush-border"],
    bg: ["plate"],
    why: "Flush jade faces keep a visible edge",
  },
  {
    group: "amber",
    min: 1.8,
    fg: ["canary-border"],
    bg: ["plate"],
    why: "The one amber (dot, arc, held rule) reads on video; it always sits beside its word and glyph",
  },
  {
    group: "hatch",
    min: 1.8,
    fg: ["steel-line"],
    bg: ["steel-face"],
    why: "The steel hatch on bolted edges reads on video",
  },
  { group: "hatch", min: 1.8, fg: ["hatch"], bg: SURFACES, why: "Hatching reads on video (1080p capture)" },
  // Design direction v2 (ADR-0016, decision.md §10).
  {
    group: "wash",
    min: 4.5,
    fg: ["ink", "ink-2"],
    bg: ["pod-wash"],
    why: "Text stays legible on a row a person selected",
  },
  { group: "wash", min: 4.5, fg: ["jade-text"], bg: ["jade-wash"], why: "Jade text on its wash" },
  { group: "wash", min: 4.5, fg: ["canary-text"], bg: ["canary-wash"], why: "Marigold text on a held row" },
  {
    group: "non-text",
    min: 3,
    fg: ["steel-line"],
    bg: SURFACES,
    why: "Honesty dash and input outlines, WCAG 1.4.11",
  },
  {
    group: "amber",
    min: 1.8,
    fg: ["canary-border"],
    bg: ["canary-wash"],
    why: "The held row's amber rule on its row; the word Held carries the state",
  },
  { group: "non-text", min: 3, fg: ["pod"], bg: ["pod-wash"], why: "Focus ring on a selected row" },
];

// ------------------------------------------------------------------------------------------- typography

export type FontFamilyRole = "ui" | "mono" | "statement" | "mark" | "hollow";

/**
 * CSS stacks: one family and one mono (UI gate round 3). FS Sans sets the interface, a member's statement and every
 * number; the mono sets hashes, IDs and timestamps only (no font file: the platform's own mono, so nothing new
 * downloads). `statement` and `hollow` stay as slots so consumers compile, and resolve to FS Sans; `mark` (the
 * season and lot ids) resolves to the mono.
 */
export const FONT_STACKS: Readonly<Record<FontFamilyRole, string>> = {
  ui: '"FS Sans", system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", "SF Mono", "Roboto Mono", Menlo, Consolas, monospace',
  statement: '"FS Sans", system-ui, sans-serif',
  mark: 'ui-monospace, "Cascadia Mono", "SF Mono", "Roboto Mono", Menlo, Consolas, monospace',
  hollow: '"FS Sans", system-ui, sans-serif',
};

/**
 * The five size steps (UI gate round 3). Every type role sits on one of them, with weight doing the rest of the
 * work (430 reading text, 520 labels, 600 titles and headings, 500 numerals). `id` is the mono's step: hashes, IDs
 * and timestamps, never words. The phone (sp) sets the three small steps one larger, for daylight on budget phones.
 */
export const TYPE_STEPS = {
  web: { id: 12, label: 14, body: 16, title: 24, hero: 56 },
  app: { id: 13, label: 15, body: 17, title: 24, hero: 48 },
} as const;

/** The roles set in the mono (hashes, IDs, timestamps); every other role is FS Sans with tabular figures. */
export const MONO_ROLES = ["id", "hash", "mark"] as const;

/**
 * Text-size floors (UI gate round 3): secondary words 13 px or more on the console (they sit on the label step,
 * 14), ids 12 or more (the mono), and body text and a member's statement 16 or more.
 */
export const TEXT_FLOORS = { secondary: 13, id: 12, body: 16 } as const;

/** Native static cuts (React Native cannot drive font axes). File name = PostScript name. */
export const NATIVE_FONTS = {
  condXBold: "FSSans-CondXBold",
  semiCondMedium: "FSSans-SemiCondMedium",
  regular: "FSSans-Regular",
  semiExpBold: "FSSans-SemiExpBold",
} as const;

/** The phone's mono: the platform's own (Android's monospace, the web export's generic), no file to embed. */
export const NATIVE_MONO = "monospace";

export type NativeFont = (typeof NATIVE_FONTS)[keyof typeof NATIVE_FONTS] | typeof NATIVE_MONO;

/**
 * How a role sets its figures. Every FS Sans role sets tabular lining figures (one money style, UI gate round 3):
 * Mona Sans's tabular zero carries a slash, which is the one numeral look on every surface (the phone's static cuts
 * have it frozen in). The mono roles need no setting.
 */
export type Numerals = "tabular";

export interface TypeRole {
  readonly family: FontFamilyRole;
  /** font-stretch, percent (FS Sans only; the mono has one width). */
  readonly stretch: number;
  readonly weight: number;
  /** px on the console and Proof: always one of TYPE_STEPS.web. */
  readonly size: number;
  readonly line: number;
  /** Letter spacing in em (the large steps tighten a little). */
  readonly tracking?: number;
  /** Every FS Sans role sets tabular figures; the mono roles leave it unset. */
  readonly numerals?: Numerals;
  readonly native: NativeFont | null;
  /** App (sp) size: always one of TYPE_STEPS.app. */
  readonly app: { readonly size: number; readonly line: number; readonly maxFontSizeMultiplier?: number };
  readonly proof?: { readonly size: number; readonly line: number; readonly stretch?: number };
  readonly use: string;
}

// The six roles on the five steps. Every other role below is an alias that keeps a name consumers already use.
// Round 6: one numeral face. On the web every figure (hero, amount, grid figure) is FS Sans at the text's own width
// (100) in tabular lining figures, so a number never reads as a second, condensed face beside its label; the phone
// keeps its static semi-condensed cut (`native`) until WS-DS's font build cuts a 500 at width 100.
const HERO = {
  family: "ui",
  stretch: 100,
  weight: 500,
  size: TYPE_STEPS.web.hero,
  line: 60,
  tracking: -0.02,
  numerals: "tabular",
  native: NATIVE_FONTS.semiCondMedium,
  app: { size: TYPE_STEPS.app.hero, line: 52, maxFontSizeMultiplier: 1.5 },
} as const;
const TITLE = {
  family: "ui",
  stretch: 100,
  weight: 600,
  size: TYPE_STEPS.web.title,
  line: 30,
  tracking: -0.015,
  numerals: "tabular",
  native: NATIVE_FONTS.semiExpBold,
  app: { size: TYPE_STEPS.app.title, line: 30 },
} as const;
const HEADING = {
  family: "ui",
  stretch: 100,
  weight: 600,
  size: TYPE_STEPS.web.body,
  line: 24,
  numerals: "tabular",
  native: NATIVE_FONTS.semiExpBold,
  app: { size: TYPE_STEPS.app.body, line: 24 },
} as const;
const BODY = {
  family: "ui",
  stretch: 100,
  weight: 430,
  size: TYPE_STEPS.web.body,
  line: 24,
  numerals: "tabular",
  native: NATIVE_FONTS.regular,
  app: { size: TYPE_STEPS.app.body, line: 24 },
} as const;
const SECONDARY = {
  family: "ui",
  stretch: 100,
  weight: 430,
  size: TYPE_STEPS.web.label,
  line: 20,
  numerals: "tabular",
  native: NATIVE_FONTS.regular,
  app: { size: TYPE_STEPS.app.label, line: 20 },
} as const;
const ID = {
  family: "mono",
  stretch: 100,
  weight: 400,
  size: TYPE_STEPS.web.id,
  line: 16,
  native: NATIVE_MONO,
  app: { size: TYPE_STEPS.app.id, line: 18 },
} as const;

export const TYPE_ROLES = {
  hero: {
    ...HERO,
    use: "The one hero numeral a screen: a money hero, or the one hero count (48/48, 7/8, 6/6); US$ small and raised",
  },
  title: { ...TITLE, use: "Screen, sheet and drawer titles; the stage and Proof headlines" },
  heading: { ...HEADING, use: "A heading inside a screen or drawer: the body step at title weight" },
  body: { ...BODY, use: "Body text and the panel's one line of prose (the 16 px floor)" },
  label: {
    family: "ui",
    stretch: 100,
    weight: 520,
    size: TYPE_STEPS.web.label,
    line: 20,
    numerals: "tabular",
    native: NATIVE_FONTS.semiCondMedium,
    app: { size: TYPE_STEPS.app.label, line: 20 },
    use: "Control labels, column headers and status words",
  },
  id: { ...ID, use: "Hashes, IDs and timestamps: the mono, never words, never money" },
  // Aliases: the names the surfaces already use, each on one of the five steps.
  display: { ...TITLE, use: "The stage headline: the title step (alias)" },
  "amount-hero": { ...HERO, use: "A money hero: the hero step (alias)" },
  "amount-l": {
    ...HERO,
    size: TYPE_STEPS.web.title,
    line: 30,
    tracking: -0.01,
    app: { size: TYPE_STEPS.app.title, line: 30 },
    use: "An amount at the title step: inspector, drawer and receipt totals",
  },
  "title-1": { ...TITLE, use: "Screen titles (alias of title)" },
  "title-2": { ...HEADING, use: "Section and drawer headings (alias of heading)" },
  lede: { ...BODY, use: "The panel's one line of prose (alias of body)" },
  figure: {
    ...SECONDARY,
    stretch: 100,
    weight: 500,
    native: NATIVE_FONTS.semiCondMedium,
    use: "Amounts and quantities in grids and lists: the label step in the numeral's width and weight",
  },
  micro: {
    ...SECONDARY,
    use: "Short data joined by ' · ' and secondary words (the label step; ids inside use id)",
  },
  caption: { ...SECONDARY, use: "Secondary words (the 13 px floor; they sit on the label step)" },
  hash: { ...ID, use: "Hashes in groups of four (alias of id)" },
  slab: {
    family: "ui",
    stretch: 100,
    weight: 600,
    size: TYPE_STEPS.web.body,
    line: 20,
    numerals: "tabular",
    native: NATIVE_FONTS.semiExpBold,
    app: { size: TYPE_STEPS.app.body, line: 20 },
    proof: { size: 16, line: 20, stretch: 100 },
    use: "Button labels: the one primary and the one secondary (the body step)",
  },
  stamp: {
    family: "ui",
    stretch: 112.5,
    weight: 700,
    size: TYPE_STEPS.web.id,
    line: 12,
    native: NATIVE_FONTS.semiExpBold,
    app: { size: TYPE_STEPS.app.id, line: 13 },
    use: "Initials inside a 22 px indigo stamp (the id step's size; never words)",
  },
  "statement-lead": { ...TITLE, use: "The member's name heading her statement (the title step)" },
  "statement-body": { ...BODY, use: "Statement prose: FS Sans on the body step, never below 16" },
  "statement-status": {
    ...HEADING,
    line: 22,
    app: { size: TYPE_STEPS.app.body, line: 22 },
    use: "Bayad na and Gisusi pa inside their pills (the body step at title weight)",
  },
  mark: { ...ID, use: "Season and lot ids (2026-A, LB-PH-2026-03): the mono (alias of id)" },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof TYPE_ROLES;

/**
 * Retired (UI gate round 2): money is never drawn in outline; an approved amount not yet in the member's hands is
 * solid ink, and its status pill says where it is. Kept so `--fs-hollow-stroke` consumers still compile.
 */
export const HOLLOW = { minSize: 28, stroke: 1.25 } as const;

// ------------------------------------------------------------------------------- space, radii, depth

/**
 * A 4-based scale. Names are the pixel values. 20 is a panel's padding (round 3); 2 and 6 live only inside
 * components 24 px tall or smaller (pills, tags).
 */
export const SPACE = [2, 4, 8, 12, 16, 20, 24, 32, 48, 64, 96] as const;

/**
 * One radius scale on the 4 px grid (UI gate round 2). 0: evidence paper and slip thumbnails. 2: hairline plates.
 * cell 6: grid, deduction and slip chips, keys, tags. control 12: every button (the one primary and the one
 * secondary) and input. card 16: cards and tiles. panel 24: panels and the statement card. pill 999: status
 * pills, the honesty tag and segmented controls.
 */
export const RADII = { 0: 0, 2: 2, cell: 6, control: 12, card: 16, panel: 24, pill: 999 } as const;

/** Slab lip depth equals consequence: d1 reversible, d2 changes a line, d3 moves money or signs. */
export { DEPTH };

export interface ShadowSet {
  /** Evidence paper: still the strongest shadow, so paper feels physical. */
  readonly paper: string;
  /** Chips, tiles and inline cards. */
  readonly e1: string;
  /** Panels and notifications. */
  readonly e2: string;
  /** Drawers and dialogs. */
  readonly e3: string;
  /** The jade halo, one beat after the simulated PayPal confirms. */
  readonly halo: string;
}

/** Elevation (decision.md §8): paper keeps the strongest shadow; e1 to e3 lift chips, panels and drawers. */
export const SHADOWS: Readonly<Record<ThemeName, ShadowSet>> = {
  tablea: {
    paper: "0 1px 1px rgb(0 0 0 / 0.4), 0 14px 30px -12px rgb(0 0 0 / 0.65)",
    e1: "inset 0 1px 0 rgb(255 255 255 / 0.05), 0 1px 0 rgb(0 0 0 / 0.4), 0 10px 30px -14px rgb(0 0 0 / 0.7)",
    e2: "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 24px 60px -20px rgb(0 0 0 / 0.8)",
    e3: "inset 0 1px 0 rgb(255 255 255 / 0.08), 0 40px 90px -30px rgb(0 0 0 / 0.85)",
    halo: "0 0 0 6px rgb(61 230 174 / 0.22)",
  },
  adlaw: {
    paper:
      "0 1px 1px rgb(11 18 32 / 0.08), 0 14px 28px -12px rgb(11 18 32 / 0.28), 0 0 0 1px rgb(11 18 32 / 0.05)",
    e1: "0 1px 2px rgb(11 18 32 / 0.05), 0 0 0 1px rgb(11 18 32 / 0.04)",
    e2: "0 1px 2px rgb(11 18 32 / 0.05), 0 12px 32px -12px rgb(11 18 32 / 0.16)",
    e3: "0 2px 6px rgb(11 18 32 / 0.06), 0 28px 64px -20px rgb(11 18 32 / 0.3)",
    halo: "0 0 0 6px rgb(20 204 144 / 0.16)",
  },
};

/**
 * The wash per theme. Hayag has none (UI gate round 3: no decorative colour on a product surface; jade means money
 * the simulated PayPal confirmed and nothing else). Gabii keeps the film's night glows for its cards.
 */
export const WASH: Readonly<Record<ThemeName, string>> = {
  tablea:
    "radial-gradient(36% 150% at 0% 100%, rgb(61 230 174 / 0.2), transparent 70%), radial-gradient(34% 140% at 52% 0%, rgb(91 67 234 / 0.3), transparent 72%)",
  adlaw: "none",
};

/**
 * Evidence paper's drop shadow as a CSS filter, for paper drawn without a box (a slip cut out on a desk photo).
 * The same depth as `paper`, in each theme's shadow colour.
 */
export const PAPER_DROP: Readonly<Record<ThemeName, string>> = {
  tablea: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.35)) drop-shadow(0 6px 10px rgb(0 0 0 / 0.3))",
  adlaw: "drop-shadow(0 1px 1px rgb(11 18 32 / 0.18)) drop-shadow(0 8px 14px rgb(11 18 32 / 0.18))",
};

/**
 * Evidence drawn in code (the slips' printed form, Jessie's ballpoint capitals, the red serial, a water stain):
 * the same in both themes, because paper is light in both. Evidence only, never UI chrome (ADR-0016).
 */
export const EVIDENCE = {
  ballpoint: "#2B4BA0",
  serial: "#B23A2E",
  // Round 6 (film U2, the owner's no-brown rule): the printed form is a cool neutral (ink-3) and a water stain is the
  // tokens' cool hatch grey, drawn as a hatch; no ochre, tan or warm grey on any evidence drawn in code.
  form: "#5A6476",
  stain: "#A4AEBC",
} as const;

export const LAYERS = {
  sticky: 10,
  dock: 20,
  scrim: 29,
  drawer: 30,
  popover: 40,
  snackbar: 50,
  dialog: 60,
  flight: 70,
} as const;

/**
 * Layout constants. columns and gutter: the one 12-column grid every console screen sits on (UI gate round 4);
 * headGap: content starts 32 px under a screen's title row, top-aligned, never centred in a tall panel; bar: the
 * stage's top bar (56 px), under which every drawer and sheet starts; phoneRail: the stage's folded phone (56 px);
 * toast: the one event toast (40 px tall, in the top bar's status area); seal: the seal on Approve and on the Chair's
 * phone (180 px, the same drawing on both). On the phone, cosignSeal: the seal on the Chair's co-sign card (140 px,
 * so the card ends 16 px above its sticky button); statusChip: the status pill (32 px, the label step); fade: the
 * 24 px fade under the status inset (the tab bar keeps its 12 px fade above it).
 * Round 5 (nothing clipped at any width): console fade, the 24 px fade a scroll column shows at an edge with more
 * beyond it (above a sticky total, under a sticky head); console end, the 32 px a scroll column, a log or a card keeps
 * clear of its panel's foot; console peek, the rows a log shows before its "All N events" disclosure. On the phone,
 * end: a screen's last line (a sticky footer's included) ends 24 px above the bezel.
 */
export const LAYOUT = {
  console: {
    columns: 12,
    gutter: 24,
    headGap: 32,
    bar: 56,
    rail: 220,
    drawer: 560,
    approve: 640,
    row: 40,
    header: 36,
    dock: 420,
    phoneRail: 56,
    toast: 40,
    seal: 180,
    fade: 24,
    end: 32,
    peek: 4,
  },
  app: {
    gutter: 16,
    rhythm: 8,
    section: 24,
    target: 48,
    primary: 56,
    hero: 64,
    seal: 180,
    cosignSeal: 140,
    statusChip: 32,
    fade: 24,
    end: 24,
  },
  proof: { column: 680, measure: 72, gutter: 16 },
} as const;

/** Materials (design §2.5, S2 §2.5; ADR-0016). */
export const MATERIALS = {
  hatch: { angle: -45, line: 1.5, gap: 6 },
  steel: { angle: -45, line: 1.5, gap: 4, boltSize: 4, boltInset: 6 },
  focus: { width: 2, offset: 2 },
  /** The initials stamp: 22 px, its initials on the id step (12 px), so nothing on the stage reads under 12. */
  stamp: { size: 22 },
  youCell: { outline: 1.5 },
  /** Noise is gone (ADR-0016); the key stays so consumers compile. */
  noise: { size: 128, opacity: 0 },
  /** A member's statement never drops below the body step's 16 px (FS Sans; UI gate round 3). */
  statementMin: 16,
} as const;

// ------------------------------------------------------------------------------------------- motion

/** Motion variables come from @fairsplit/motion so the CSS and the JS presets cannot disagree. */
export const MOTION = { springs: SPRINGS, tweens: TWEENS, ease: EASE } as const;

/** Material 3 roles for Android system chrome. Primary is ink; jade and canary have no role at all. */
export const M3_ROLES = {
  primary: "ink",
  onPrimary: "plate",
  surface: "ground",
  surfaceContainer: "plate",
  surfaceContainerHigh: "plate-2",
  onSurface: "ink",
  onSurfaceVariant: "ink-2",
  outline: "rule",
  secondaryContainer: "plate-2",
  error: "red",
} as const satisfies Record<string, ColourName>;
