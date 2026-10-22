/**
 * Theme, type scale and motion preferences for the app (C-18: React Native StyleSheet with token objects).
 * `FsThemeProvider` / `useFs()` match the IC-09 names so the swap to @fairsplit/ui-native is mechanical.
 */
import * as Device from "expo-device";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform, type TextStyle } from "react-native";
import { fontFamily } from "../_shims/fonts";
import { type FsTokens, type ThemeName, themes } from "../_shims/tokens.native";
import { webQuery } from "../platform/query";

const MONEY: TextStyle["fontVariant"] = ["tabular-nums", "stylistic-eight"];

/**
 * App type roles (design §2.3). Console roles are 14/20; the app leads with legibility for members on budget
 * phones in daylight, so UI body is 16/22 and statement prose is never below 18.
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
  /** System "Remove animations" / Reduce Motion / prefers-reduced-motion. */
  reduced: boolean;
  /** ≤3 GB phones (expo-device) or slow browsers: no flights, seals fade in, digits change instantly. */
  low: boolean;
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

function detectLowTier(): boolean {
  if (webQuery("tier") === "low") return true;
  if (Platform.OS === "web") {
    const nav = (typeof navigator !== "undefined" ? navigator : {}) as {
      deviceMemory?: number;
      hardwareConcurrency?: number;
    };
    return (nav.deviceMemory ?? 8) <= 4 && (nav.hardwareConcurrency ?? 8) <= 4;
  }
  // S2.8: low when totalMemory ≤ 3.3e9 bytes (nominal 2–3 GB phones). Unverified on real 3 GB devices until S7.
  return Device.totalMemory !== null && Device.totalMemory <= 3.3e9;
}

function useMotionPrefs(): MotionPrefs {
  const [reduced, setReduced] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [low] = useState(detectLowTier);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => {});
    // react-native-web cannot detect a screen reader (it answers true); web users get the visible
    // "Can't hold?" route instead, so only native reads this.
    if (Platform.OS !== "web") {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((v) => alive && setScreenReader(v))
        .catch(() => {});
    }
    const a = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const b = AccessibilityInfo.addEventListener("screenReaderChanged", (v: boolean) => {
      if (Platform.OS !== "web") setScreenReader(v);
    });
    return () => {
      alive = false;
      a.remove();
      b.remove();
    };
  }, []);
  return useMemo(() => ({ reduced, low, screenReader }), [reduced, low, screenReader]);
}

export function FsThemeProvider({ name, children }: { name: ThemeName; children: ReactNode }) {
  const motion = useMotionPrefs();
  const value = useMemo(() => ({ t: themes[name], name, motion }), [name, motion]);
  return <FsContext.Provider value={value}>{children}</FsContext.Provider>;
}

export function useFs(): FsContextValue {
  return useContext(FsContext);
}

/** Stage frames pass `?theme=adlaw|tablea` (S2.1). */
export function themeFromQuery(): ThemeName | null {
  const q = webQuery("theme");
  return q === "adlaw" || q === "tablea" ? q : null;
}
