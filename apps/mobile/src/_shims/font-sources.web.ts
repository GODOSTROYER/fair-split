/**
 * TEMPORARY SHIM (see fonts.ts): the web export loads the same files at runtime under the same family names.
 */
export const fontSources: Record<string, number> = {
  MonaSans_400Regular: require("@expo-google-fonts/mona-sans/400Regular/MonaSans_400Regular.ttf"),
  MonaSans_500Medium: require("@expo-google-fonts/mona-sans/500Medium/MonaSans_500Medium.ttf"),
  MonaSans_700Bold: require("@expo-google-fonts/mona-sans/700Bold/MonaSans_700Bold.ttf"),
  MonaSans_800ExtraBold: require("@expo-google-fonts/mona-sans/800ExtraBold/MonaSans_800ExtraBold.ttf"),
  AtkinsonHyperlegibleNext_400Regular: require("@expo-google-fonts/atkinson-hyperlegible-next/400Regular/AtkinsonHyperlegibleNext_400Regular.ttf"),
  AtkinsonHyperlegibleNext_700Bold: require("@expo-google-fonts/atkinson-hyperlegible-next/700Bold/AtkinsonHyperlegibleNext_700Bold.ttf"),
};
