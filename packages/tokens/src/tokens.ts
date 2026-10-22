// @fairsplit/tokens: the one hand-edited source of Fair Split's design tokens (design §2, S2 §2.1–2.5).
// `pnpm --filter @fairsplit/tokens build` turns it into theme.web.css (--fs-* under [data-theme]),
// tokens.native.ts (hex), fonts.css, tailwind.css, m3.ts, ag-grid.ts and contrast.json in src/generated/.
//
// Colours are OKLCH with their sRGB hex fallback. The hex values are the design's (with S2 §2.2's contrast
// corrections); a test proves each OKLCH triple rounds to its hex, so the two can never drift apart.
//
// Restrained palette: neutrals cover about 90% of every screen and each semantic hue has exactly one job.
// Jade means money (raised: will move money; flush: PayPal confirmed it). Canary means a person must decide.
// Red is only for PayPal failures. Pod is the focus ring and the needle. No purple, no gradients, no glows.

import { DEPTH, EASE, SPRINGS, TWEENS } from "@fairsplit/motion/presets";
import type { Oklch } from "./color.js";

export const THEMES = ["tablea", "adlaw"] as const;
export type ThemeName = (typeof THEMES)[number];

/** Tablea is the console default (dark cacao lacquer); Adlaw is the app default and the only Proof theme. */
export const THEME_INFO: Readonly<Record<ThemeName, { scheme: "dark" | "light"; use: string }>> = {
  tablea: {
    scheme: "dark",
    use: "Console default. The colour of a roasted cacao tablet, never neutral black.",
  },
  adlaw: { scheme: "light", use: "App default and the only theme on Proof. Daylight on a budget phone." },
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
const JADE = ok("#2FD3A0", 0.7738, 0.1495, 166.4);
const CANARY = ok("#F2DA4E", 0.8837, 0.1564, 99.39);
const TABLEA_GROUND = ok("#201712", 0.2141, 0.0175, 50.49);
const ADLAW_INK = ok("#1C1511", 0.203, 0.0139, 51.37);
const CHALK = ok("#F4EDE4", 0.9491, 0.0142, 74.42);
const COPY_PINK = ok("#F4C9D4", 0.8761, 0.0506, 1.07);
const COPY_YELLOW = ok("#F5E27A", 0.9071, 0.1267, 99.17);
const SLAB_JADE_RIGHT = ok("#1F9E78", 0.6242, 0.1202, 167.06);
const SLAB_JADE_BOTTOM = ok("#12704F", 0.485, 0.0985, 163.33);

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
] as const;

export type ColourName = (typeof COLOUR_NAMES)[number];

/** What each colour is for. A colour that appears without its state being true is a bug. */
export const COLOUR_ROLES: Readonly<Record<ColourName, string>> = {
  ground: "Page background",
  plate: "Content surfaces and the statement card",
  "plate-2": "Inspectors, drawers and bolted faces",
  rule: "1 px separators",
  ink: "Body text, human decisions, the chalk slab face",
  "ink-2": "Secondary text",
  "ink-3": "Metadata and icons only; never statement copy",
  pencil: "Claude's readings and the engine's figures (cool graphite)",
  "pencil-faint": "Low-confidence values in a You cell (replaces pencil at 60%)",
  jade: "Money. Raised: this will move money. Flush: PayPal confirmed it",
  "on-jade": "Text on a jade face",
  "jade-text": "Jade as text",
  "jade-flush-border": "1 px border on flush jade faces",
  "jade-wash": "Grid flash for a PayPal-driven change",
  canary: "A person must decide. Never an error, never a button",
  "on-canary": "Text on a canary face",
  "canary-text": "Canary as text",
  "canary-wash": "Background of a held row or a You cell",
  "canary-border": "1 px border on canary faces",
  red: "Only PayPal DENIED, FAILED, BLOCKED, an unexpected RETURNED and ERRPYO codes",
  "red-face": "A red face (the batch-denied banner)",
  "on-red-face": "Text on a red face",
  "red-wash": "Background behind red copy",
  pod: "The focus ring and the dial needle, nothing else",
  hatch: "Cash at the bodega, or unavailable; always with a word",
  "steel-line": "Hatch lines on the edges of bolted items",
  "steel-face": "Ground of the steel hatch",
  "copy-white": "The white original copy (evidence tags and favicons only)",
  "copy-pink": "The pink duplicate copy (evidence tags and favicons only)",
  "copy-yellow": "The yellow copy (evidence tags and favicons only)",
  "pencil-wash": "Grid flash for an engine recompute",
  scrim: "Behind drawers",
  highlight: "1 px inner top highlight on slab faces",
  "drawer-highlight": "1 px top highlight on drawers",
  "slab-chalk-face": "Chalk slab face (an ink face on Adlaw)",
  "slab-chalk-right": "Chalk slab right edge",
  "slab-chalk-bottom": "Chalk slab bottom edge",
  "slab-chalk-label": "Chalk slab label",
  "slab-jade-face": "Jade slab face: the only control that moves money",
  "slab-jade-right": "Jade slab right edge",
  "slab-jade-bottom": "Jade slab bottom edge",
  "slab-jade-label": "Jade slab label",
};

export const COLOURS: Readonly<Record<ThemeName, Readonly<Record<ColourName, ColourSpec>>>> = {
  tablea: {
    ground: TABLEA_GROUND,
    plate: ok("#2A1F18", 0.2502, 0.0214, 53.96),
    "plate-2": ok("#33271F", 0.284, 0.023, 55.29),
    rule: ok("#4A392D", 0.3596, 0.0313, 56.74),
    ink: CHALK,
    "ink-2": ok("#BDB1A4", 0.7668, 0.0228, 69.7),
    "ink-3": ok("#9C9085", 0.6607, 0.0215, 64.99),
    pencil: ok("#A9B1B8", 0.7562, 0.0135, 244.31),
    "pencil-faint": ok("#909498", 0.6645, 0.0075, 247.94),
    jade: JADE,
    "on-jade": TABLEA_GROUND,
    "jade-text": JADE,
    "jade-flush-border": JADE,
    "jade-wash": mix("jade", 0.18),
    canary: CANARY,
    "on-canary": TABLEA_GROUND,
    "canary-text": CANARY,
    "canary-wash": mix("canary", 0.12),
    "canary-border": CANARY,
    red: ok("#FF5A47", 0.6857, 0.2038, 29.77),
    "red-face": ok("#D63A2C", 0.5823, 0.195, 29.43),
    "on-red-face": WHITE,
    // S2 says 14%; at 14% red copy on its own wash measures 4.29:1, so Tablea uses 10% (4.56:1).
    "red-wash": mix("red", 0.1),
    pod: ok("#FF8A2A", 0.7487, 0.173, 53.99),
    hatch: ok("#624E41", 0.4408, 0.034, 54.66),
    "steel-line": ok("#7C8288", 0.6035, 0.0116, 248.02),
    "steel-face": ok("#3B3F43", 0.3654, 0.0087, 248.07),
    "copy-white": WHITE,
    "copy-pink": COPY_PINK,
    "copy-yellow": COPY_YELLOW,
    "pencil-wash": mix("pencil", 0.12),
    scrim: alpha(ok("#100B08", 0.155, 0.0109, 53.75), 0.64),
    highlight: alpha(WHITE, 0.18),
    "drawer-highlight": alpha(WHITE, 0.08),
    "slab-chalk-face": CHALK,
    "slab-chalk-right": ok("#B9AFA4", 0.7592, 0.0193, 70.17),
    "slab-chalk-bottom": ok("#8A8178", 0.6085, 0.0173, 67.49),
    "slab-chalk-label": TABLEA_GROUND,
    "slab-jade-face": JADE,
    "slab-jade-right": SLAB_JADE_RIGHT,
    "slab-jade-bottom": SLAB_JADE_BOTTOM,
    "slab-jade-label": TABLEA_GROUND,
  },
  adlaw: {
    ground: ok("#EEEEEA", 0.948, 0.0053, 106.5),
    plate: WHITE,
    "plate-2": ok("#F6F6F3", 0.9723, 0.004, 106.47),
    rule: ok("#D8D4CD", 0.8711, 0.0105, 81.79),
    ink: ADLAW_INK,
    "ink-2": ok("#4E453E", 0.3972, 0.0169, 60.17),
    "ink-3": ok("#6F665E", 0.5162, 0.0169, 64.11),
    pencil: ok("#4C5761", 0.4509, 0.0215, 245.73),
    "pencil-faint": ok("#5E6871", 0.5119, 0.0188, 245.32),
    jade: JADE,
    "on-jade": ADLAW_INK,
    "jade-text": ok("#0A7553", 0.4992, 0.1035, 164.13),
    "jade-flush-border": ok("#0F6F53", 0.4828, 0.0945, 167.04),
    "jade-wash": mix("jade", 0.16),
    canary: CANARY,
    "on-canary": ADLAW_INK,
    "canary-text": ok("#7F6200", 0.5111, 0.1045, 88.33),
    "canary-wash": ok("#FFF3BF", 0.961, 0.0679, 96.59),
    "canary-border": ok("#7F6200", 0.5111, 0.1045, 88.33),
    red: ok("#BF2A1C", 0.5263, 0.1872, 29.93),
    "red-face": ok("#BF2A1C", 0.5263, 0.1872, 29.93),
    "on-red-face": WHITE,
    "red-wash": ok("#FCE6E3", 0.9418, 0.0245, 26.92),
    pod: ok("#C85A00", 0.5958, 0.161, 48.52),
    hatch: ok("#B7B0A7", 0.7604, 0.015, 74.39),
    "steel-line": ok("#8A9096", 0.6503, 0.0114, 248),
    "steel-face": ok("#D5D8DB", 0.8808, 0.0053, 247.88),
    "copy-white": WHITE,
    "copy-pink": COPY_PINK,
    "copy-yellow": COPY_YELLOW,
    "pencil-wash": mix("pencil", 0.1),
    scrim: alpha(ADLAW_INK, 0.4),
    highlight: alpha(WHITE, 0.18),
    "drawer-highlight": alpha(WHITE, 0.08),
    "slab-chalk-face": ADLAW_INK,
    "slab-chalk-right": ok("#4A3F38", 0.3768, 0.0193, 54.46),
    "slab-chalk-bottom": ok("#2B2420", 0.2668, 0.0129, 51.62),
    "slab-chalk-label": WHITE,
    "slab-jade-face": JADE,
    "slab-jade-right": SLAB_JADE_RIGHT,
    "slab-jade-bottom": SLAB_JADE_BOTTOM,
    "slab-jade-label": ADLAW_INK,
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
  { group: "non-text", min: 3, fg: ["pod"], bg: SURFACES, why: "Focus ring and needle on every surface" },
  {
    group: "non-text",
    min: 3,
    fg: ["jade-flush-border", "canary-border"],
    bg: ["plate"],
    why: "Flush jade and canary faces keep a visible edge",
  },
  {
    group: "hatch",
    min: 1.8,
    fg: ["steel-line"],
    bg: ["steel-face"],
    why: "The steel hatch on bolted edges reads on video",
  },
  { group: "hatch", min: 1.8, fg: ["hatch"], bg: SURFACES, why: "Hatching reads on video (1080p capture)" },
];

// ------------------------------------------------------------------------------------------- typography

export type FontFamilyRole = "ui" | "statement" | "mark" | "hollow";

/** CSS stacks. Money is always FS Sans, even inside Atkinson prose. No monospace anywhere. */
export const FONT_STACKS: Readonly<Record<FontFamilyRole, string>> = {
  ui: '"FS Sans", system-ui, sans-serif',
  statement: '"Atkinson Hyperlegible Next", "FS Sans", system-ui, sans-serif',
  mark: '"FS Stencil", "FS Sans", system-ui, sans-serif',
  hollow: '"FS Numerals Hollow", "FS Sans", system-ui, sans-serif',
};

/** Native static cuts (React Native cannot drive font axes). File name = PostScript name. */
export const NATIVE_FONTS = {
  condXBold: "FSSans-CondXBold",
  semiCondMedium: "FSSans-SemiCondMedium",
  regular: "FSSans-Regular",
  semiExpBold: "FSSans-SemiExpBold",
  statement: "AtkinsonNext-Regular",
  statementBold: "AtkinsonNext-Bold",
} as const;

export type NativeFont = (typeof NATIVE_FONTS)[keyof typeof NATIVE_FONTS];

export interface TypeRole {
  readonly family: FontFamilyRole;
  /** font-stretch, percent. */
  readonly stretch: number;
  readonly weight: number;
  readonly size: number;
  readonly line: number;
  /** Tabular figures with the slashed zero (Mona's zero.tf) wherever money, kilos or hashes appear. */
  readonly figures: boolean;
  readonly native: NativeFont | null;
  /** App (sp) size where it differs from the console. */
  readonly app?: { readonly size: number; readonly line: number; readonly maxFontSizeMultiplier?: number };
  readonly proof?: { readonly size: number; readonly line: number; readonly stretch?: number };
  readonly use: string;
}

export const TYPE_ROLES = {
  "amount-hero": {
    family: "ui",
    stretch: 75,
    weight: 800,
    size: 72,
    line: 72,
    figures: true,
    native: NATIVE_FONTS.condXBold,
    app: { size: 48, line: 52, maxFontSizeMultiplier: 1.5 },
    use: "Money being decided or received",
  },
  "amount-l": {
    family: "ui",
    stretch: 75,
    weight: 760,
    size: 32,
    line: 36,
    figures: true,
    native: NATIVE_FONTS.condXBold,
    use: "Inspector and drawer effects",
  },
  "title-1": {
    family: "ui",
    stretch: 100,
    weight: 660,
    size: 28,
    line: 34,
    figures: false,
    native: NATIVE_FONTS.semiExpBold,
    use: "Screen titles",
  },
  "title-2": {
    family: "ui",
    stretch: 100,
    weight: 600,
    size: 20,
    line: 26,
    figures: false,
    native: NATIVE_FONTS.semiExpBold,
    use: "Drawer and section titles",
  },
  body: {
    family: "ui",
    stretch: 100,
    weight: 450,
    size: 14,
    line: 20,
    figures: false,
    native: NATIVE_FONTS.regular,
    use: "UI text",
  },
  figure: {
    family: "ui",
    stretch: 87.5,
    weight: 500,
    size: 14,
    line: 20,
    figures: true,
    native: NATIVE_FONTS.semiCondMedium,
    use: "Grid and list numbers",
  },
  label: {
    family: "ui",
    stretch: 100,
    weight: 560,
    size: 13,
    line: 16,
    figures: false,
    native: NATIVE_FONTS.regular,
    use: "Control labels",
  },
  caption: {
    family: "ui",
    stretch: 100,
    weight: 450,
    size: 12,
    line: 16,
    figures: false,
    native: NATIVE_FONTS.regular,
    use: "Provenance footers and IDs",
  },
  hash: {
    family: "ui",
    stretch: 75,
    weight: 520,
    size: 13,
    line: 16,
    figures: true,
    native: NATIVE_FONTS.semiCondMedium,
    use: "Hashes and item IDs, in groups of four",
  },
  slab: {
    family: "ui",
    stretch: 112.5,
    weight: 700,
    size: 17,
    line: 20,
    figures: true,
    native: NATIVE_FONTS.semiExpBold,
    proof: { size: 17, line: 20, stretch: 100 },
    use: "Slab labels (Proof clamps the width to 100%)",
  },
  stamp: {
    family: "ui",
    stretch: 112.5,
    weight: 700,
    size: 10,
    line: 10,
    figures: false,
    native: NATIVE_FONTS.semiExpBold,
    use: "Initials inside an 18 px ink stamp",
  },
  "statement-lead": {
    family: "statement",
    stretch: 100,
    weight: 400,
    size: 22,
    line: 30,
    figures: false,
    native: NATIVE_FONTS.statement,
    use: "The greeting on a statement",
  },
  "statement-body": {
    family: "statement",
    stretch: 100,
    weight: 400,
    size: 19,
    line: 28,
    figures: false,
    native: NATIVE_FONTS.statement,
    use: "Statement prose, never below 18",
  },
  mark: {
    family: "mark",
    stretch: 100,
    weight: 800,
    size: 20,
    line: 20,
    figures: false,
    native: null,
    proof: { size: 40, line: 40 },
    use: "Season and lot marks only (web only)",
  },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof TYPE_ROLES;

/** Hollow amounts (≥ 28 px, approved but not yet in the member's hands): a 1.25 px text stroke. */
export const HOLLOW = { minSize: 28, stroke: 1.25 } as const;

// ------------------------------------------------------------------------------- space, radii, depth

/** A 4-based scale. Names are the pixel values. */
export const SPACE = [2, 4, 8, 12, 16, 24, 32, 48, 64, 96] as const;

/** 0: slabs, tiles, evidence, the statement card. 2: plates, chips, inputs. */
export const RADII = { 0: 0, 2: 2 } as const;

/** Slab edge depth equals consequence: d1 reversible, d2 changes a line, d3 moves money or signs. */
export { DEPTH };

/** Evidence casts the only shadow in the product. */
export const SHADOWS: Readonly<Record<ThemeName, { readonly paper: string }>> = {
  tablea: { paper: "0 1px 1px rgb(0 0 0 / 0.35), 0 12px 28px -10px rgb(0 0 0 / 0.55)" },
  adlaw: { paper: "0 1px 1px rgb(28 21 17 / 0.1), 0 10px 24px -10px rgb(28 21 17 / 0.22)" },
};

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

export const LAYOUT = {
  console: { columns: 12, gutter: 24, rail: 220, drawer: 560, approve: 640, row: 40, header: 36, dock: 420 },
  app: { gutter: 16, rhythm: 8, section: 24, target: 48, primary: 56, hero: 64 },
  proof: { column: 680, measure: 72, gutter: 16 },
} as const;

/** Materials (design §2.5, S2 §2.5). */
export const MATERIALS = {
  hatch: { angle: -45, line: 1.5, gap: 6 },
  steel: { angle: -45, line: 1.5, gap: 4, boltSize: 4, boltInset: 6 },
  focus: { width: 2, offset: 2 },
  stamp: { size: 18 },
  youCell: { outline: 1.5 },
  noise: { size: 128, opacity: 0.03 },
  /** Statement copy: Atkinson never drops below 18 px. */
  statementMin: 18,
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
