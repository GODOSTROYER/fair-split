/**
 * TEMPORARY SHIM: replace with @fairsplit/tokens (generated `tokens.native.ts`) after WS-DS merges.
 *
 * Mirrors design direction §2 with the contrast corrections in S2.2 (ink-3, hatch, pencil-faint, canary-border),
 * C-18 (React Native StyleSheet with `tokens.native.ts`) and the IC-09 shape: `tablea` and `adlaw` objects of hex,
 * numbers and font names for `FsThemeProvider` / `useFs()`.
 */

export type ThemeName = "adlaw" | "tablea";

export interface SlabFace {
  face: string;
  edgeRight: string;
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
  pod: string;
  hatch: string;
  steelLine: string;
  steelFace: string;
  copyWhite: string;
  copyPink: string;
  copyYellow: string;
  scrim: string;
  pencilWash: string;
  /**
   * Money in flight on member surfaces (S2.2 "hollow-fill"): ink mixed 65% over plate, drawn with a 2 px ink stroke
   * so a hollow amount stays legible in daylight yet reads clearly lighter than landed ink.
   */
  hollowFill: string;
  /** Hand-written ballpoint blue on synthetic slips only (Jessie's capitals). Never UI. */
  ballpoint: string;
}

export interface FsTokens {
  name: ThemeName;
  dark: boolean;
  color: FsColors;
  slab: { chalk: SlabFace; jade: SlabFace };
  /** Evidence casts the only shadow (design §2.4); RN `boxShadow` needs the New Architecture. */
  shadowPaper: string;
}

export const adlaw: FsTokens = {
  name: "adlaw",
  dark: false,
  color: {
    ground: "#EEEEEA",
    plate: "#FFFFFF",
    plate2: "#F6F6F3",
    rule: "#D8D4CD",
    ink: "#1C1511",
    ink2: "#4E453E",
    ink3: "#6F665E",
    pencil: "#4C5761",
    pencilFaint: "#5E6871",
    jade: "#2FD3A0",
    onJade: "#1C1511",
    jadeText: "#0A7553",
    jadeFlushBorder: "#0F6F53",
    jadeWash: "#DEF8F0",
    canary: "#F2DA4E",
    onCanary: "#1C1511",
    canaryText: "#7F6200",
    canaryWash: "#FFF3BF",
    canaryBorder: "#7F6200",
    red: "#BF2A1C",
    redFace: "#BF2A1C",
    onRedFace: "#FFFFFF",
    redWash: "#FCE6E3",
    pod: "#C85A00",
    hatch: "#B7B0A7",
    steelLine: "#8A9096",
    steelFace: "#D5D8DB",
    copyWhite: "#FFFFFF",
    copyPink: "#F4C9D4",
    copyYellow: "#F5E27A",
    scrim: "rgba(28, 21, 17, 0.40)",
    pencilWash: "#EDEEEF",
    hollowFill: "#6B6764",
    ballpoint: "#1E3A8A",
  },
  slab: {
    // Adlaw's chalk slab is the ink face (design §2.5).
    chalk: { face: "#1C1511", edgeRight: "#4A3F38", edgeBottom: "#2B2420", label: "#FFFFFF" },
    jade: { face: "#2FD3A0", edgeRight: "#1F9E78", edgeBottom: "#12704F", label: "#1C1511" },
  },
  shadowPaper: "0px 1px 1px rgba(28, 21, 17, 0.10), 0px 10px 24px -10px rgba(28, 21, 17, 0.22)",
};

export const tablea: FsTokens = {
  name: "tablea",
  dark: true,
  color: {
    ground: "#201712",
    plate: "#2A1F18",
    plate2: "#33271F",
    rule: "#4A392D",
    ink: "#F4EDE4",
    ink2: "#BDB1A4",
    ink3: "#9C9085",
    pencil: "#A9B1B8",
    pencilFaint: "#909498",
    jade: "#2FD3A0",
    onJade: "#201712",
    jadeText: "#2FD3A0",
    jadeFlushBorder: "#2FD3A0",
    jadeWash: "#2B3F30",
    canary: "#F2DA4E",
    onCanary: "#201712",
    canaryText: "#F2DA4E",
    canaryWash: "#42351E",
    canaryBorder: "#F2DA4E",
    red: "#FF5A47",
    redFace: "#D63A2C",
    onRedFace: "#FFFFFF",
    redWash: "#48271F",
    pod: "#FF8A2A",
    hatch: "#624E41",
    steelLine: "#7C8288",
    steelFace: "#3B3F43",
    copyWhite: "#FFFFFF",
    copyPink: "#F4C9D4",
    copyYellow: "#F5E27A",
    scrim: "rgba(16, 11, 8, 0.64)",
    pencilWash: "#39312B",
    hollowFill: "#ADA59D",
    ballpoint: "#1E3A8A",
  },
  slab: {
    chalk: { face: "#F4EDE4", edgeRight: "#B9AFA4", edgeBottom: "#8A8178", label: "#201712" },
    jade: { face: "#2FD3A0", edgeRight: "#1F9E78", edgeBottom: "#12704F", label: "#201712" },
  },
  shadowPaper: "0px 1px 1px rgba(0, 0, 0, 0.35), 0px 12px 28px -10px rgba(0, 0, 0, 0.55)",
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

/** Radii: 0 for slabs, tiles, evidence and the statement card; 2 for plates, chips and inputs. */
export const radius = { none: 0, plate: 2 } as const;

/** App targets (design §2.4): ≥48 dp, primary 56 dp, Paminawa and Pirmahi 64 dp, play/pause 72 dp. */
export const target = { min: 48, primary: 56, hero: 64, play: 72 } as const;

/** Slab edge depth in px: d1 reversible, d2 changes a line, d3 moves money or signs. */
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
