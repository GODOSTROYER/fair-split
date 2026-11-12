/**
 * The browser's own surfaces in the web frames, themed from the palette (UI gate round 3, docs/DESIGN.md §5; the console's
 * ui-web base layer): one focus ring (2 px indigo, 2 px offset, keyboard only), the caret and native controls in the
 * action indigo, a selection in the pod wash, thin scrollbars in the rule colour, and tabular lining figures. Native
 * Android draws its own focus highlight, so only the web export injects this (`platform/browser-surfaces.web.ts`).
 * Pure, tested in Node.
 */

export interface SurfaceColours {
  pod: string;
  podWash: string;
  ink: string;
  ruleStrong: string;
}

export function browserSurfacesCss(c: SurfaceColours): string {
  return [
    `:root{caret-color:${c.pod};accent-color:${c.pod};font-variant-numeric:tabular-nums lining-nums;text-underline-offset:3px}`,
    `::selection{background:${c.podWash};color:${c.ink}}`,
    `*{scrollbar-width:thin;scrollbar-color:${c.ruleStrong} transparent}`,
    `:focus:not(:focus-visible){outline:none}`,
    `:focus-visible{outline:2px solid ${c.pod};outline-offset:2px}`,
  ].join("\n");
}
