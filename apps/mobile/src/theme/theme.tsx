/**
 * Theme, type scale and motion preferences for the app (C-18: React Native StyleSheet with token objects).
 * `FsThemeProvider` / `useFs()` match the IC-09 names so the swap to @fairsplit/ui-native is mechanical.
 *
 * One theme per surface (approved plan): the app is Adlaw, light, for daylight reading on a budget phone; Tablea
 * exists for the console and for a stage frame that asks for it (`?theme=tablea`).
 */
import * as Device from "expo-device";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform, type TextStyle } from "react-native";
import { FIGURE_VARIANT, fontFamily } from "../_shims/fonts";
import { type FsTokens, type ThemeName, themes } from "../_shims/tokens.native";
import { webQuery } from "../platform/query";

const MONEY: TextStyle["fontVariant"] = [...FIGURE_VARIANT];

/**
 * App type roles (design §2.3). Console roles are 14/20; the app leads with legibility for members on budget
 * phones in daylight, so UI body is 16/22 and statement prose is never below 18 (19/28).
 */
export const typeScale = {
  amountHero: { fontFamily: fontFamily.amount, fontSize: 48, lineHeight: 52, fontVariant: MONEY },
  amountL: { fontFamily: fontFamily.amount, fontSize: 32, lineHeight: 36, fontVariant: MONEY },
  amountM: { fontFamily: fontFamily.amount, fontSize: 22, lineHeight: 26, fontVariant: MONEY },
  title1: { fontFamily: fontFamily.strong, fontSize: 28, lineHeight: 34 },
  title2: { fontFamily: fontFamily.strong, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fontFamily.ui, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.strong, fontSize: 16, lineHeight: 22 },
  figure: { fontFamily: fontFamily.figure, fontSize: 16, lineHeight: 22, fontVariant: MONEY },
  figureS: { fontFamily: fontFamily.figure, fontSize: 14, lineHeight: 20, fontVariant: MONEY },
  label: { fontFamily: fontFamily.figure, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fontFamily.ui, fontSize: 12, lineHeight: 16 },
  hash: { fontFamily: fontFamily.figure, fontSize: 13, lineHeight: 18, fontVariant: MONEY },
  slab: { fontFamily: fontFamily.strong, fontSize: 17, lineHeight: 20 },
  statementLead: { fontFamily: fontFamily.statement, fontSize: 22, lineHeight: 30 },
  statementBody: { fontFamily: fontFamily.statement, fontSize: 19, lineHeight: 28 },
  statementStrong: { fontFamily: fontFamily.statementBold, fontSize: 19, lineHeight: 28 },
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
  if (webQuery("tier") === "low") return true;
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
  const query = webQuery("motion");
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
  const q = webQuery("theme");
  return q === "adlaw" || q === "tablea" ? q : null;
}
