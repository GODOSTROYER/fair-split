/**
 * Theme, type scale and motion preferences for the app (C-18: React Native StyleSheet with token objects).
 * `FsThemeProvider` / `useFs()` match the IC-09 names so the swap to @fairsplit/ui-native is mechanical.
 *
 * One theme per surface (approved plan, ADR-0016): the app is Adlaw, shown as Hayag (day), light, for daylight reading
 * on a budget phone; Tablea, shown as Gabii (night), is the theme switch's other slot (`?theme=tablea`).
 */
import * as Device from "expo-device";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform, type TextStyle } from "react-native";
import { FIGURE_VARIANT, fontFamily, MONO_IOS, MONO_NATIVE, MONO_WEB, TITLE_WEB } from "../_shims/fonts";
import { type FsTokens, type ThemeName, themes, typeSteps } from "../_shims/tokens.native";
import { bootQuery } from "../platform/query";

/** Every FS Sans role sets tabular lining figures (UI gate round 3: one money style, columns that line up). */
const TABULAR: TextStyle["fontVariant"] = [...FIGURE_VARIANT];

/** The one mono, for hashes, IDs and timestamps only: the platform's own (docs/DESIGN.md §1, `monoFamily`). */
export const MONO_FAMILY = Platform.select({ web: MONO_WEB, ios: MONO_IOS, default: MONO_NATIVE });

/**
 * The phone's five size steps in sp (docs/DESIGN.md §1, the generated tokens' `typeSteps`): hero 48, title 24, heading and
 * body 17, label 15, id 13. Weight carries the rest: 400 reading, 500 labels and numerals, 600 titles and headings.
 * One step over the console's 12/14/16 below the title, for members on budget phones in daylight; a member's
 * statement is body (17, never below 16) in statement ink (7:1).
 */
export const TYPE_STEPS = typeSteps;

/**
 * Titles, headings and button labels (UI gate round 4): 600 at width 100, the console's own. The web frames set them
 * in the console's variable FS Sans (`TITLE_WEB`); native keeps the 700 cut until WS-DS cuts the static 600.
 */
const STRONG: TextStyle = Platform.select({
  web: { fontFamily: TITLE_WEB, fontWeight: "600" },
  default: { fontFamily: fontFamily.strong },
});
/** A person's initials: the same face at 700 (docs/DESIGN.md §1 `stamp`). */
const STAMP_FACE: TextStyle = Platform.select({
  web: { fontFamily: TITLE_WEB, fontWeight: "700" },
  default: { fontFamily: fontFamily.strong },
});

const HERO = {
  fontFamily: fontFamily.figure,
  fontSize: TYPE_STEPS.hero,
  lineHeight: 52,
  fontVariant: TABULAR,
};
const TITLE: TextStyle = {
  ...STRONG,
  fontSize: TYPE_STEPS.title,
  lineHeight: 30,
  letterSpacing: Platform.OS === "web" ? -0.36 : 0,
  fontVariant: TABULAR,
};
const TITLE_FIGURE = {
  fontFamily: fontFamily.figure,
  fontSize: TYPE_STEPS.title,
  lineHeight: 30,
  fontVariant: TABULAR,
};
const HEADING: TextStyle = {
  ...STRONG,
  fontSize: TYPE_STEPS.body,
  lineHeight: 24,
  fontVariant: TABULAR,
};
const BODY = { fontFamily: fontFamily.ui, fontSize: TYPE_STEPS.body, lineHeight: 24, fontVariant: TABULAR };
const LABEL = {
  fontFamily: fontFamily.figure,
  fontSize: TYPE_STEPS.label,
  lineHeight: 20,
  fontVariant: TABULAR,
};
/** Secondary words and short data joined by " · " (the console's `caption` and `micro`, 14/20 at 430). */
const SECONDARY = {
  fontFamily: fontFamily.ui,
  fontSize: TYPE_STEPS.label,
  lineHeight: 20,
  fontVariant: TABULAR,
};
const ID = { fontFamily: MONO_FAMILY, fontSize: TYPE_STEPS.id, lineHeight: 18 };

/**
 * App type roles on the five steps. The old role names stay as aliases, so a screen keeps its words and gains the
 * system: `amount*` are numerals on the hero and title steps, `title1` is a screen title, `title2` and `bodyStrong` a
 * heading, the `statement*` roles are FS Sans on the body and title steps, `figure*` and `label` the label step,
 * `caption` and `micro` secondary words, `hash` the mono, `stamp` initials.
 */
export const typeScale = {
  // Money is never bold: the figure cut (87.5/500) set large, its size and the small raised "US$" do the work.
  amountHero: HERO,
  amountL: TITLE_FIGURE,
  amountM: TITLE_FIGURE,
  title1: TITLE,
  title2: HEADING,
  body: BODY,
  bodyStrong: HEADING,
  figure: LABEL,
  figureS: LABEL,
  label: LABEL,
  caption: SECONDARY,
  micro: SECONDARY,
  /** Hashes, IDs and timestamps: the mono, never words and never money. */
  hash: ID,
  /** A button's label (the slab, the flat buttons). */
  slab: { ...STRONG, fontSize: TYPE_STEPS.body, lineHeight: 20, fontVariant: TABULAR },
  /** A person's initials inside an ink stamp. */
  stamp: { ...STAMP_FACE, fontSize: TYPE_STEPS.id, lineHeight: TYPE_STEPS.id },
  /** Paminawa's read-along prose: the title step in the reading weight (a transcript is read, not scanned). */
  statementLead: { ...TITLE, fontFamily: fontFamily.ui, fontWeight: "400", letterSpacing: 0 },
  statementBody: BODY,
  statementStrong: HEADING,
  /** "Bayad na" and "Gisusi pa" inside their pills (ADR-0016). */
  statementStatus: HEADING,
  /** The member's name as the statement's factual header (a header, not a greeting). */
  statementName: TITLE,
} satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof typeScale;

export interface MotionPrefs {
  /**
   * System "Remove animations" / Reduce Motion / prefers-reduced-motion, a stage frame's `fs.prefs`, or
   * `?motion=reduced`. Phases stay identical; spatial travel goes, colour and opacity change over 150 ms.
   */
  reduced: boolean;
  /** ≤3.3 GB phones (expo-device), `?tier=low`, or a stage frame's low tier: at most three animations at once. */
  low: boolean;
  /** TalkBack or VoiceOver on (native only; the web never detects a screen reader, S2.0 rule 8). */
  screenReader: boolean;
}

interface FsContextValue {
  t: FsTokens;
  name: ThemeName;
  motion: MotionPrefs;
}

const FsContext = createContext<FsContextValue>({
  t: themes.adlaw,
  name: "adlaw",
  motion: { reduced: false, low: false, screenReader: false },
});

/** S2.8: low when totalMemory ≤ 3.3e9 bytes (nominal 2–3 GB phones); no web heuristic beyond `?tier=low`. */
function detectLowTier(): boolean {
  if (bootQuery("tier") === "low") return true;
  if (Platform.OS === "web") return false;
  return Device.totalMemory !== null && Device.totalMemory <= 3.3e9;
}

/** Overrides from the judge stage (`fs.prefs`) or the URL (`?motion=reduced|full`, used by tests). */
export interface MotionOverride {
  reduced?: boolean;
  low?: boolean;
}

function useMotionPrefs(override: MotionOverride | undefined): MotionPrefs {
  const [systemReduced, setSystemReduced] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [lowDevice] = useState(detectLowTier);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setSystemReduced(v))
      .catch(() => {});
    // react-native-web cannot detect a screen reader (it answers true); web users get the visible
    // "Can't hold?" route instead, so only native reads this.
    if (Platform.OS !== "web") {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((v) => alive && setScreenReader(v))
        .catch(() => {});
    }
    // `useReducedMotion()` reads once at launch; listening keeps a mid-session change honest (S2.8).
    const a = AccessibilityInfo.addEventListener("reduceMotionChanged", setSystemReduced);
    const b = AccessibilityInfo.addEventListener("screenReaderChanged", (v: boolean) => {
      if (Platform.OS !== "web") setScreenReader(v);
    });
    return () => {
      alive = false;
      a.remove();
      b.remove();
    };
  }, []);
  // Read from the URL the app was opened with: the index redirect drops the query right after the first render.
  const query = bootQuery("motion");
  const reduced =
    query === "reduced" ? true : query === "full" ? false : (override?.reduced ?? false) || systemReduced;
  const low = lowDevice || (override?.low ?? false);
  return useMemo(() => ({ reduced, low, screenReader }), [reduced, low, screenReader]);
}

export function FsThemeProvider({
  name,
  motion: override,
  children,
}: {
  name: ThemeName;
  motion?: MotionOverride;
  children: ReactNode;
}) {
  const motion = useMotionPrefs(override);
  const value = useMemo(() => ({ t: themes[name], name, motion }), [name, motion]);
  return <FsContext.Provider value={value}>{children}</FsContext.Provider>;
}

/** Tokens (`t.color.ink`, `t.slab.jade`…), the theme name and the motion preferences. */
export function useFs(): FsContextValue {
  return useContext(FsContext);
}

/** Stage frames may pass `?theme=adlaw|tablea` (S3.8: a frame reads only `?theme=&tier=` from its URL). */
export function themeFromQuery(): ThemeName | null {
  const q = bootQuery("theme");
  return q === "adlaw" || q === "tablea" ? q : null;
}
