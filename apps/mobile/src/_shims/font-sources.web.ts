/**
 * The web export (the judge's phone frames) loads the very files the Android build embeds, WS-DS's native cuts in
 * assets/fonts/native, under the same family names (fonts.ts), so a frame sets the same figures as the phone: the
 * tabular figures, the slashed zero, the grafted ₱. Round 3 loads three cuts (no Atkinson, no heavy condensed cut);
 * the mono is the browser's own. Metro reaches the folder through metro.config.js.
 */
export const fontSources: Record<string, number> = {
  "FSSans-SemiCondMedium": require("../../../../assets/fonts/native/FSSans-SemiCondMedium.ttf"),
  "FSSans-Regular": require("../../../../assets/fonts/native/FSSans-Regular.ttf"),
  "FSSans-SemiExpBold": require("../../../../assets/fonts/native/FSSans-SemiExpBold.ttf"),
};
