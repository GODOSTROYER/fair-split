// One theme per surface (S2.1, ADR-0016): every surface is Adlaw, shown as Hayag (day); Tablea, shown as Gabii
// (night), is an opt-in slot and never on the judge path. Nothing switches theme while a surface is open, so this
// sets the document's theme once for the surface's lifetime.

import { withoutTransitions } from "@fairsplit/motion/web";
import { type ReactNode, useLayoutEffect } from "react";
import { useProofFace } from "../lib/face.js";

export type SurfaceTheme = "tablea" | "adlaw";

export function useSurfaceTheme(theme: SurfaceTheme): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme ?? "adlaw";
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
  face,
  children,
  className,
}: {
  readonly theme: SurfaceTheme;
  /** Proof's surfaces read in their own subset face (lib/face.ts), the whole document while they are mounted. */
  readonly face?: "proof";
  readonly children: ReactNode;
  readonly className?: string;
}) {
  useSurfaceTheme(theme);
  useProofFace(face === "proof");
  return (
    <div className={className} data-surface={theme}>
      {children}
    </div>
  );
}
