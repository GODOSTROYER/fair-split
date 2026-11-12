/**
 * The web export (the judge's phone frames) loads the very files the Android build embeds, WS-DS's native cuts in
 * assets/fonts/native, under the same family names (fonts.ts), so a frame sets the same figures as the phone: the
 * tabular figures, the slashed zero, the grafted ₱. Round 3 loads three cuts (no Atkinson, no heavy condensed cut);
 * the mono is the browser's own. Round 4 adds the titles' face: the console's variable FS Sans, declared with its
 * whole weight range so titles and headings draw at 600 (`TITLE_WEB`); the app waits for it like the cuts, so a title
 * never flashes in another face. Metro reaches both folders through metro.config.js.
 */
import { FontDisplay, type FontSource } from "expo-font";
import { TITLE_WEB, TITLE_WEB_WEIGHTS } from "./fonts";

export const fontSources: Record<string, FontSource> = {
  "FSSans-SemiCondMedium": require("../../../../assets/fonts/native/FSSans-SemiCondMedium.ttf"),
  "FSSans-Regular": require("../../../../assets/fonts/native/FSSans-Regular.ttf"),
  "FSSans-SemiExpBold": require("../../../../assets/fonts/native/FSSans-SemiExpBold.ttf"),
  [TITLE_WEB]: {
    uri: require("../../../../assets/fonts/web/FSSans-VF.woff2"),
    weight: TITLE_WEB_WEIGHTS,
    display: FontDisplay.BLOCK,
  },
};
