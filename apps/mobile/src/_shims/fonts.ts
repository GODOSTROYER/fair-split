/**
 * The app's faces (design §2.3, S2.3; UI gate round 3, docs/DESIGN.md §1: one family and one mono): WS-DS's native cuts
 * in `assets/fonts/native` (assets/fonts/README.md), and the platform's own monospace.
 *
 * FS Sans is Mona Sans 2.027, renamed because its licence reserves "Mona", cut into static instances: React Native
 * cannot drive font axes. Each cut has tabular figures and the slashed zero frozen into its cmap, overlaps removed
 * and the Noto Sans ₱ grafted in at Mona's cap height. FS Sans sets every heading, label, body line, a member's
 * statement and every number; round 3 retires Atkinson (statement prose) and the heavy condensed cut (75/800), so the
 * app embeds three cuts. The mono sets hashes, IDs and timestamps only, and has no file: the platform's own
 * (`monospace` on Android, the same stack as the console's `--fs-font-mono` in the web frames).
 *
 * Each file's name is its family and PostScript name, so one name works everywhere: the Android build embeds the
 * files with the expo-font plugin (family = file name, app.config.ts), iOS reads the name from the font, and the web
 * export loads the same files under the same names (font-sources.web.ts). Pure data, tested in Node (fonts.test.ts).
 */
export const fontFamily = {
  /** hero, amounts, figures and labels: width 87.5, weight 500. */
  figure: "FSSans-SemiCondMedium",
  /** body, statement prose, secondary words: width 100, weight 400. */
  ui: "FSSans-Regular",
  /** titles, headings, button labels, stamps: width 112.5, weight 700. */
  strong: "FSSans-SemiExpBold",
} as const;

export type FontRole = keyof typeof fontFamily;

/**
 * Titles and headings in the web frames (UI gate round 4, docs/DESIGN.md §1: titles 600 at width 100, like the
 * console's): WS-DS's own variable FS Sans, the very file the console sets them in (assets/fonts/web/FSSans-VF.woff2),
 * loaded under this family with its whole weight range, so `fontWeight: "600"` draws the 600 instance (no faux bold).
 * Native builds keep `fontFamily.strong` until WS-DS's font build cuts the static 600 (`FSSans-SemiBold`).
 */
export const TITLE_WEB = "FSSans-Title";
/** The variable file's weight axis, declared on its `@font-face` (expo-font's `weight` range). */
export const TITLE_WEB_WEIGHTS = "200 900";

/** The mono on Android (the generated tokens' `monoFamily`): nothing to embed. */
export const MONO_NATIVE = "monospace";
/** The mono in the web frames: the console's `--fs-font-mono` stack, so a hash reads the same in both. */
export const MONO_WEB = 'ui-monospace, "Cascadia Mono", "SF Mono", "Roboto Mono", Menlo, Consolas, monospace';
/** The mono on iOS, which has no generic `monospace` family. */
export const MONO_IOS = "Menlo";

/**
 * The mono faces may have no ₱ (U+20B1); every FS Sans cut carries the grafted Noto peso. The web titles' variable
 * file has none either (the console adds its peso by `unicode-range`), so a ₱ in a title takes the figure cut's.
 */
const NO_PESO: ReadonlySet<string> = new Set<string>([MONO_NATIVE, MONO_WEB, MONO_IOS, TITLE_WEB]);

/**
 * The face a ₱ is set in when it sits in text of `face`: null when the face has its own, else the figure face (money
 * is always FS Sans, even inside an id line).
 */
export function pesoFace(face: string | undefined): string | null {
  return face && NO_PESO.has(face) ? fontFamily.figure : null;
}

/**
 * Tabular lining figures wherever money, kilos or hashes appear. The cuts' default zero is already the slashed one;
 * Mona's stylistic set for a distinct zero would swap it for a straight bar, so no stylistic set is ever turned on.
 */
export const FIGURE_VARIANT = ["tabular-nums"] as const;
