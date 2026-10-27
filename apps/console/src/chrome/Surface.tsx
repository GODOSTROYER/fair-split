// One theme per surface (S2.1): the console and stage are Tablea; Proof is Adlaw only. Nothing switches
// theme while a surface is open, so this sets the document's theme once for the surface's lifetime.

import { withoutTransitions } from "@fairsplit/motion/web";
import { type ReactNode, useLayoutEffect } from "react";

export type SurfaceTheme = "tablea" | "adlaw";

export function useSurfaceTheme(theme: SurfaceTheme): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme ?? "tablea";
    if (previous !== theme) {
      withoutTransitions(() => {
        root.dataset.theme = theme;
        root.dataset.agThemeMode = `fs-${theme}`;
      });
    }
    return () => {
      if (root.dataset.theme !== previous) {
        root.dataset.theme = previous;
        root.dataset.agThemeMode = `fs-${previous}`;
      }
    };
  }, [theme]);
}

export function Surface({
  theme,
  children,
  className,
}: {
  readonly theme: SurfaceTheme;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  useSurfaceTheme(theme);
  return (
    <div className={className} data-surface={theme}>
      {children}
    </div>
  );
}
