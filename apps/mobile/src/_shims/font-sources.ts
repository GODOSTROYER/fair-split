/**
 * Native builds embed the font files at build time (the expo-font plugin in app.config.ts, from assets/fonts/native),
 * so nothing loads at runtime. The web export loads the same files (font-sources.web.ts).
 */
export const fontSources: Record<string, number> = {};
