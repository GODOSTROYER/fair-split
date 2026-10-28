/**
 * The web export (the judge's phone frames) loads the very files the Android build embeds, WS-DS's native cuts in
 * assets/fonts/native, under the same family names (fonts.ts), so a frame sets the same figures as the phone: the
 * condensed amounts, the slashed zero, the grafted ₱. Metro reaches the folder through metro.config.js.
 */
export const fontSources: Record<string, number> = {
  "FSSans-CondXBold": require("../../../../assets/fonts/native/FSSans-CondXBold.ttf"),
  "FSSans-SemiCondMedium": require("../../../../assets/fonts/native/FSSans-SemiCondMedium.ttf"),
  "FSSans-Regular": require("../../../../assets/fonts/native/FSSans-Regular.ttf"),
  "FSSans-SemiExpBold": require("../../../../assets/fonts/native/FSSans-SemiExpBold.ttf"),
  "AtkinsonNext-Regular": require("../../../../assets/fonts/native/AtkinsonNext-Regular.ttf"),
  "AtkinsonNext-Bold": require("../../../../assets/fonts/native/AtkinsonNext-Bold.ttf"),
};
