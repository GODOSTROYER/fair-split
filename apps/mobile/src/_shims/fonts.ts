/**
 * TEMPORARY SHIM: replace with WS-DS's native cuts (FS Sans CondXBold / SemiCondMedium / Regular / SemiExpBold and
 * Atkinson Next Regular / Bold from assets/fonts, S2.3) after WS-DS merges.
 *
 * Until then: Mona Sans and Atkinson Hyperlegible Next static instances from Google Fonts (SIL OFL 1.1, unmodified,
 * so the Reserved Font Name allows their own names). Neither has ₱; Android and browsers fall back per glyph.
 * Native embeds them at build time (expo-font plugin, file name = family); web loads them at runtime.
 */
export const fontFamily = {
  /** amount-hero, amount-l (FS Sans CondXBold stand-in). */
  amount: "MonaSans_800ExtraBold",
  /** figure, hash, label (FS Sans SemiCondMedium stand-in). */
  figure: "MonaSans_500Medium",
  /** body, caption. */
  ui: "MonaSans_400Regular",
  /** slab, titles, stamp (FS Sans SemiExpBold stand-in). */
  strong: "MonaSans_700Bold",
  /** statement prose only. */
  statement: "AtkinsonHyperlegibleNext_400Regular",
  statementBold: "AtkinsonHyperlegibleNext_700Bold",
} as const;

export type FontRole = keyof typeof fontFamily;
