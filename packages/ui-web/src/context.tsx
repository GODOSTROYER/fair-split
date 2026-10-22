// Surface-wide settings every primitive reads: the language its fixed words render in, and which motion
// renderer runs (full, reduced or low tier). "system" follows prefers-reduced-motion and the device tier.

import { type Lang, type MessageKey, translate as translateIn, type Values } from "@fairsplit/i18n";
import { motionTier, prefersReducedMotion } from "@fairsplit/motion/web";
import { MotionConfig } from "motion/react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type MotionMode = "full" | "reduced" | "low";
export type MotionPreference = MotionMode | "system";

interface UiSettings {
  readonly lang: Lang;
  readonly motion: MotionMode;
}

const UiContext = createContext<UiSettings>({ lang: "en", motion: "full" });

function systemMode(): MotionMode {
  if (prefersReducedMotion()) return "reduced";
  return motionTier() === "low" ? "low" : "full";
}

/** Follows the system's reduced-motion setting live (it can change while the page is open). */
function useSystemMotion(enabled: boolean): MotionMode {
  const [mode, setMode] = useState<MotionMode>(() => (enabled ? systemMode() : "full"));
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(systemMode());
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [enabled]);
  return mode;
}

export interface UiProviderProps {
  readonly lang?: Lang;
  readonly motion?: MotionPreference;
  readonly children: ReactNode;
}

/**
 * Wraps a surface. Motion's own reducedMotion follows the resolved mode as a safety net (S2 §2.8); the
 * primitives render their reduced variants themselves.
 */
export function UiProvider({ lang = "en", motion = "system", children }: UiProviderProps) {
  const system = useSystemMotion(motion === "system");
  const resolved: MotionMode = motion === "system" ? system : motion;
  const value = useMemo(() => ({ lang, motion: resolved }), [lang, resolved]);
  return (
    <UiContext.Provider value={value}>
      <MotionConfig reducedMotion={resolved === "reduced" ? "always" : "never"}>{children}</MotionConfig>
    </UiContext.Provider>
  );
}

export function useMotionMode(): MotionMode {
  return useContext(UiContext).motion;
}

export function useLang(): Lang {
  return useContext(UiContext).lang;
}

/** Fixed microcopy in the surface's language. UI code holds no user-facing literals. */
export function useT(): (key: MessageKey, values?: Values) => string {
  const lang = useLang();
  return useMemo(() => (key: MessageKey, values?: Values) => translateIn(lang, key, values), [lang]);
}
