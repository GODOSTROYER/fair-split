/**
 * TEMPORARY SHIM: replace with @fairsplit/tokens (generated `tokens.native.ts`) after WS-DS merges.
 *
 * Mirrors design direction v2 (ADR-0016, "Hayag"), C-18 (React Native StyleSheet with `tokens.native.ts`) and the
 * IC-09 shape: `tablea` and `adlaw` objects of hex, numbers and font names for `FsThemeProvider` / `useFs()`. The
 * slot keys stay: `adlaw` is Hayag (day), the app's default; `tablea` is Gabii (night), the theme switch's other
 * slot. Every colour role equals the generated module's (tokens.drift.test.ts reads that file and holds the two
 * together); `hollowFill` and `ballpoint` are the app's own.
 */

export type ThemeName = "adlaw" | "tablea";

export interface SlabFace {
  face: string;
  /** The slab's bottom lip (v2: the lip replaces the skewed right and bottom edges). */
  edgeRight: string;
  /** The lip's 1 px under-edge. */
  edgeBottom: string;
  label: string;
}

export interface FsColors {
  ground: string;
  plate: string;
  plate2: string;
  rule: string;
  ink: string;
  ink2: string;
  ink3: string;
  pencil: string;
  pencilFaint: string;
  jade: string;
  onJade: string;
  jadeText: string;
  jadeFlushBorder: string;
  jadeWash: string;
  canary: string;
  onCanary: string;
  canaryText: string;
  canaryWash: string;
  canaryBorder: string;
  red: string;
  redFace: string;
  onRedFace: string;
  redWash: string;
  /** A person's hand: the focus ring, the needle, selection (ballpoint indigo in v2). */
  pod: string;
  hatch: string;
  steelLine: string;
  steelFace: string;
  copyWhite: string;
  copyPink: string;
  copyYellow: string;
  pencilWash: string;
  scrim: string;
  highlight: string;
  drawerHighlight: string;
  slabChalkFace: string;
  slabChalkRight: string;
  slabChalkBottom: string;
  slabChalkLabel: string;
  slabJadeFace: string;
  slabJadeRight: string;
  slabJadeBottom: string;
  slabJadeLabel: string;
  paperInk: string;
  bezel: string;
  /** Decorative outlines (chips, slip thumbnails); never a control's only boundary. */
  ruleStrong: string;
  /** A row or cell a person has selected. */
  podWash: string;
  /** The one earned glow: a ring on a Bayad na face, one beat after the simulated PayPal confirms. */
  jadeHalo: string;
  /** A member's statement: its words and figures (7:1 or better on its card, UI gate round 2). */
  statementInk: string;
  /** A member's statement: secondary words and metadata (7:1 or better; never ink3). */
  statementInk2: string;
  /**
   * Money in flight on member surfaces (S2.2 "hollow-fill"): ink mixed 65% over plate, drawn with a 2 px ink stroke
   * so a hollow amount stays legible in daylight yet reads clearly lighter than landed ink.
   */
  hollowFill: string;
  /** Hand-written ballpoint blue on synthetic slips only (Jessie's capitals). Never UI. */
  ballpoint: string;
}

/** Elevation for RN `boxShadow` (New Architecture; the web export reads it as CSS). */
export interface FsShadows {
  /** Evidence paper: still the strongest shadow. */
  paper: string;
  /** Chips, tiles, inline cards. */
  e1: string;
  /** Panels and the statement card. */
  e2: string;
  /** Sheets and dialogs. */
  e3: string;
  /** The jade halo ring, one beat after the simulated PayPal confirms. */
  halo: string;
}

export interface FsTokens {
  name: ThemeName;
  /** "Hayag (day)" or "Gabii (night)". */
  display: string;
  dark: boolean;
  color: FsColors;
  slab: { chalk: SlabFace; jade: SlabFace };
  /** Evidence paper's shadow (kept for the callers that read it by this name). */
  shadowPaper: string;
  shadow: FsShadows;
}

const HAYAG_PAPER =
  "0px 1px 1px rgba(11, 18, 32, 0.08), 0px 14px 28px -12px rgba(11, 18, 32, 0.28), 0px 0px 0px 1px rgba(11, 18, 32, 0.05)";

export const adlaw: FsTokens = {
  name: "adlaw",
  display: "Hayag (day)",
  dark: false,
  color: {
    ground: "#F3F5F8",
    plate: "#FFFFFF",
    plate2: "#F7F8FA",
    rule: "#E3E7EE",
    ink: "#0B1220",
    ink2: "#3A4456",
    ink3: "#5A6476",
    pencil: "#4A5A73",
    pencilFaint: "#5D6A80",
    jade: "#14CC90",
    onJade: "#0B1220",
    jadeText: "#06724F",
    jadeFlushBorder: "#0A9467",
    jadeWash: "#DEF8EF",
    // Round 6 (no amber on Hayag): what waits for a person is the person's colour, ballpoint indigo.
    canary: "#4A2FD6",
    onCanary: "#FFFFFF",
    canaryText: "#0B1220",
    canaryWash: "#FFFFFF",
    canaryBorder: "#4A2FD6",
    red: "#CF2A27",
    redFace: "#D42A26",
    onRedFace: "#FFFFFF",
    redWash: "#FDECEB",
    pod: "#4A2FD6",
    hatch: "#A4AEBC",
    steelLine: "#7E8898",
    steelFace: "#E6EAF0",
    copyWhite: "#FFFFFF",
    copyPink: "#F4C9D4",
    copyYellow: "#F5E27A",
    pencilWash: "#EDEFF1",
    scrim: "rgba(58, 68, 86, 0.4)",
    highlight: "rgba(255, 255, 255, 0.45)",
    drawerHighlight: "#FFFFFF",
    slabChalkFace: "#4A2FD6",
    slabChalkRight: "#3722B0",
    slabChalkBottom: "#29188A",
    slabChalkLabel: "#FFFFFF",
    slabJadeFace: "#4A2FD6",
    slabJadeRight: "#3722B0",
    slabJadeBottom: "#29188A",
    slabJadeLabel: "#FFFFFF",
    paperInk: "#0B1220",
    bezel: "#141A24",
    ruleStrong: "#CBD2DC",
    podWash: "#F1EEFC",
    jadeHalo: "rgba(20, 204, 144, 0.16)",
    statementInk: "#0B1220",
    statementInk2: "#3A4456",
    hollowFill: "#60656E",
    ballpoint: "#1E3A8A",
  },
  slab: {
    // The person's decision slab is ballpoint indigo with a white label (ADR-0016).
    chalk: { face: "#4A2FD6", edgeRight: "#3722B0", edgeBottom: "#29188A", label: "#FFFFFF" },
    // UI gate round 2: no green button. The money slab wears the same indigo face; jade is confirmed money only.
    jade: { face: "#4A2FD6", edgeRight: "#3722B0", edgeBottom: "#29188A", label: "#FFFFFF" },
  },
  shadowPaper: HAYAG_PAPER,
  shadow: {
    paper: HAYAG_PAPER,
    e1: "0px 1px 2px rgba(11, 18, 32, 0.05), 0px 0px 0px 1px rgba(11, 18, 32, 0.04)",
    e2: "0px 1px 2px rgba(11, 18, 32, 0.05), 0px 12px 32px -12px rgba(11, 18, 32, 0.16)",
    e3: "0px 2px 6px rgba(11, 18, 32, 0.06), 0px 28px 64px -20px rgba(11, 18, 32, 0.3)",
    halo: "0px 0px 0px 6px rgba(20, 204, 144, 0.16)",
  },
};

const GABII_PAPER = "0px 1px 1px rgba(0, 0, 0, 0.4), 0px 14px 30px -12px rgba(0, 0, 0, 0.65)";

export const tablea: FsTokens = {
  name: "tablea",
  display: "Gabii (night)",
  dark: true,
  color: {
    ground: "#090D18",
    plate: "#10172A",
    plate2: "#172036",
    rule: "#25304A",
    ink: "#F4F6FA",
    ink2: "#C3C9D6",
    ink3: "#8E98AE",
    pencil: "#A7B4CB",
    pencilFaint: "#8E9BB4",
    jade: "#3DE6AE",
    onJade: "#04170F",
    jadeText: "#55EDBB",
    jadeFlushBorder: "#3DE6AE",
    jadeWash: "#16343C",
    canary: "#FFA41B",
    onCanary: "#090D18",
    canaryText: "#FFB65C",
    canaryWash: "#312B28",
    canaryBorder: "#FFA41B",
    red: "#FF7A72",
    redFace: "#D2394A",
    onRedFace: "#FFFFFF",
    redWash: "#2D2333",
    pod: "#9C8CFF",
    hatch: "#46557A",
    steelLine: "#8996B4",
    steelFace: "#222C44",
    copyWhite: "#FFFFFF",
    copyPink: "#F4C9D4",
    copyYellow: "#F5E27A",
    pencilWash: "#222A3D",
    scrim: "rgba(4, 6, 12, 0.7)",
    highlight: "rgba(255, 255, 255, 0.16)",
    drawerHighlight: "rgba(255, 255, 255, 0.08)",
    slabChalkFace: "#5B43EA",
    slabChalkRight: "#4630C9",
    slabChalkBottom: "#2E1E94",
    slabChalkLabel: "#FFFFFF",
    slabJadeFace: "#5B43EA",
    slabJadeRight: "#4630C9",
    slabJadeBottom: "#2E1E94",
    slabJadeLabel: "#FFFFFF",
    paperInk: "#0B1220",
    bezel: "#05070C",
    ruleStrong: "#3A4763",
    podWash: "#242748",
    jadeHalo: "rgba(61, 230, 174, 0.22)",
    statementInk: "#F4F6FA",
    statementInk2: "#C3C9D6",
    hollowFill: "#A4A8B1",
    ballpoint: "#1E3A8A",
  },
  slab: {
    chalk: { face: "#5B43EA", edgeRight: "#4630C9", edgeBottom: "#2E1E94", label: "#FFFFFF" },
    jade: { face: "#5B43EA", edgeRight: "#4630C9", edgeBottom: "#2E1E94", label: "#FFFFFF" },
  },
  shadowPaper: GABII_PAPER,
  shadow: {
    paper: GABII_PAPER,
    e1: "inset 0px 1px 0px rgba(255, 255, 255, 0.05), 0px 1px 0px rgba(0, 0, 0, 0.4), 0px 10px 30px -14px rgba(0, 0, 0, 0.7)",
    e2: "inset 0px 1px 0px rgba(255, 255, 255, 0.07), 0px 24px 60px -20px rgba(0, 0, 0, 0.8)",
    e3: "inset 0px 1px 0px rgba(255, 255, 255, 0.08), 0px 40px 90px -30px rgba(0, 0, 0, 0.85)",
    halo: "0px 0px 0px 6px rgba(61, 230, 174, 0.22)",
  },
};

export const themes: Readonly<Record<ThemeName, FsTokens>> = { adlaw, tablea };

/** 4-based scale (design §2.4). */
export const space = {
  s2: 2,
  s4: 4,
  s8: 8,
  s12: 12,
  s16: 16,
  s24: 24,
  s32: 32,
  s48: 48,
  s64: 64,
  s96: 96,
} as const;

/**
 * One radius scale (ADR-0016; UI gate round 2): none for evidence paper and slip thumbnails, plate 2 for hairline
 * plates, cell 6 for chips and keys, control 12 for every button and input, card 16 for cards, panel 24 for the
 * statement card, pill for pills and segmented controls.
 */
export const radius = { none: 0, plate: 2, cell: 6, control: 12, card: 16, panel: 24, pill: 999 } as const;

/** App targets (design §2.4): ≥48 dp, primary 56 dp, Paminawa and Pirmahi 64 dp, play/pause 72 dp. */
export const target = { min: 48, primary: 56, hero: 64, play: 72 } as const;

/**
 * The generated `layout` (UI gate rounds 3 and 4): the seal is 180 on the Chair's phone, as on the console's Approve;
 * 140 on the Chair's co-sign card (it ends 16 px above its sticky button); the status pill is 32 (the label step);
 * the fade under the status inset is 24.
 */
export const layout = { seal: 180, cosignSeal: 140, statusChip: 32, fade: 24, end: 24 } as const;

/** The generated `typeSteps` (UI gate round 3, docs/DESIGN.md §1): the phone's five size steps in sp. */
export const typeSteps = { id: 13, label: 15, body: 17, title: 24, hero: 48 } as const;

/** Slab lip depth in px (depth equals consequence): d1 reversible, d2 changes a line, d3 moves money or signs. */
export const slabDepth = { d1: 3, d2: 5, d3: 8 } as const;

/** Layers (S2.4): what sits above what, so sheets, snackbars and dialogs never fight. */
export const layer = {
  sticky: 10,
  dock: 20,
  scrim: 29,
  drawer: 30,
  popover: 40,
  snackbar: 50,
  dialog: 60,
  flight: 70,
} as const;

/** Motion presets moved to `motion.ts` (the @fairsplit/motion shim): springs, tweens, timelines, feedback. */

/**
 * Material 3 roles for Android system chrome (S2.1 `m3.ts`): primary is ink, surfaces are ground, plate and plate-2,
 * the outline is the rule, error is red. Jade and canary get no role, so money's colour can never leak into a
 * navigation indicator or a focus state.
 */
export function m3(t: FsTokens) {
  return {
    primary: t.color.ink,
    onPrimary: t.color.plate,
    surface: t.color.ground,
    onSurface: t.color.ink,
    onSurfaceVariant: t.color.ink2,
    surfaceContainer: t.color.plate,
    surfaceContainerHigh: t.color.plate2,
    outline: t.color.rule,
    error: t.color.red,
    scrim: t.color.scrim,
  } as const;
}
