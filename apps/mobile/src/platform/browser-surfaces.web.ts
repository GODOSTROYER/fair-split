/**
 * The web frames' browser surfaces (UI gate round 3): one `<style>` in the document head, rewritten when the theme
 * changes, so the focus ring, caret, selection and scrollbars carry the palette instead of the browser's defaults.
 */
import { browserSurfacesCss, type SurfaceColours } from "../lib/browser-surfaces";

const ID = "fs-browser-surfaces";

export function applyBrowserSurfaces(colours: SurfaceColours): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(ID);
  if (!style) {
    style = document.createElement("style");
    style.id = ID;
    document.head.appendChild(style);
  }
  style.textContent = browserSurfacesCss(colours);
}
