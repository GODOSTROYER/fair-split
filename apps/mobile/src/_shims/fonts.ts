/**
 * The app's faces (design §2.3, S2.3): WS-DS's native cuts in `assets/fonts/native` (assets/fonts/README.md).
 *
 * FS Sans is Mona Sans 2.027, renamed because its licence reserves "Mona", cut into four static instances: React
 * Native cannot drive font axes. Each cut has tabular figures and the slashed zero frozen into its cmap, overlaps
 * removed (a hollow amount's stroke draws no inner lines) and the Noto Sans ₱ grafted in at Mona's cap height.
 * Atkinson Hyperlegible Next sets statement prose only, and has no ₱: money in prose is always set in FS Sans.
 *
 * Each file's name is its family and PostScript name, so one name works everywhere: the Android build embeds the
 * files with the expo-font plugin (family = file name, app.config.ts), iOS reads the name from the font, and the web
 * export loads the same files under the same names (font-sources.web.ts). Pure data, tested in Node (fonts.test.ts).
 */
export const fontFamily = {
  /** amount-hero, amount-l and the receipt's total: width 75, weight 800. */
  amount: "FSSans-CondXBold",
  /** figure, hash, label: width 87.5, weight 500. */
  figure: "FSSans-SemiCondMedium",
  /** body, caption: width 100, weight 400. */
  ui: "FSSans-Regular",
  /** slab, titles, stamp: width 112.5, weight 700. */
  strong: "FSSans-SemiExpBold",
  /** Statement prose only. */
  statement: "AtkinsonNext-Regular",
  statementBold: "AtkinsonNext-Bold",
} as const;

export type FontRole = keyof typeof fontFamily;

/** Faces that have no ₱ (U+20B1): Atkinson. Every FS Sans cut carries the grafted Noto peso. */
const NO_PESO: ReadonlySet<string> = new Set<string>([fontFamily.statement, fontFamily.statementBold]);

/**
 * The face a ₱ is set in when it sits in text of `face`: null when the face has its own, else the figure face (money
 * is always FS Sans, even inside Atkinson prose).
 */
export function pesoFace(face: string | undefined): string | null {
  return face && NO_PESO.has(face) ? fontFamily.figure : null;
}

/**
 * Tabular lining figures wherever money, kilos or hashes appear. The cuts' default zero is already the slashed one;
 * Mona's stylistic set for a distinct zero would swap it for a straight bar, so no stylistic set is ever turned on.
 */
export const FIGURE_VARIANT = ["tabular-nums"] as const;
