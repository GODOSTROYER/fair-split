// Proof's own face (S2.11: Proof's fonts ≤80 KB, "66 + 2 + 4"). On Proof's surfaces (W-PF-01 `/proof/:runSlug`
// and the brand's W-BR-01 `/b/:token`) the whole document reads in the FSSans-Proof subset, never the console's
// 120 KB variable face: `<html data-face="proof">` points the --fs-font-* tokens at it (theme/surfaces.css).
// The browser fetches the root element's face as soon as the stylesheet applies, before main.tsx runs, so a cold
// Proof load sets the flag from `public/face.js` (a classic script index.html loads ahead of the stylesheet, with
// the same paths as `isProofPath`); `bootFace` (main.tsx) sets it again before the first render. After that the
// Proof surface owns it while it is mounted (`useProofFace`), and leaving Proof for the console clears it
// (`useFaceFollows`).

import { useRouterState } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

const ATTRIBUTE = "face";
const PROOF = "proof";

/** `/proof/:runSlug` and `/b/:token`, Proof's two surfaces. */
export function isProofPath(pathname: string): boolean {
  return /^\/(?:proof|b)\/[^/]+\/?$/.test(pathname);
}

export function setProofFace(on: boolean, root: HTMLElement = document.documentElement): void {
  if (on) root.dataset[ATTRIBUTE] = PROOF;
  else delete root.dataset[ATTRIBUTE];
}

export function hasProofFace(root: HTMLElement = document.documentElement): boolean {
  return root.dataset[ATTRIBUTE] === PROOF;
}

/** The lot mark's face (theme/surfaces.css: FS Stencil 800, inline, font-display: block). */
export const MARK_FACE = '800 1em "FS Stencil"';

/** Starts the lot mark's face loading now, not at the hero's first layout (a browser loads a face on first use). */
export function loadMarkFace(): void {
  const fonts = (document as { fonts?: { load?: (font: string) => Promise<unknown> } }).fonts;
  fonts?.load?.(MARK_FACE)?.catch(() => undefined);
}

/**
 * Before the first render: a cold load of a Proof URL reads in the subset from its first layout, and its lot
 * mark's face is loading (a data: URI: ready long before the bundle that draws the hero arrives).
 */
export function bootFace(pathname: string, root: HTMLElement = document.documentElement): void {
  const proof = isProofPath(pathname);
  setProofFace(proof, root);
  if (proof) loadMarkFace();
}

/** A Proof surface holds the subset while it is mounted (set and cleared before paint). */
export function useProofFace(on: boolean): void {
  useLayoutEffect(() => {
    if (!on) return;
    setProofFace(true);
    loadMarkFace();
    return () => setProofFace(false);
  }, [on]);
}

/**
 * At the root: once a navigation has landed off Proof's paths, the console's face is back (a cold Proof URL that
 * ended on the not-found or error page set the flag at boot, with no Proof surface to clear it).
 */
export function useFaceFollows(): void {
  const pathname = useRouterState({ select: (s) => s.resolvedLocation?.pathname });
  useLayoutEffect(() => {
    if (pathname !== undefined && !isProofPath(pathname)) setProofFace(false);
  }, [pathname]);
}
