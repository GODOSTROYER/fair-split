// Proof's own line glyphs, drawn in the token glyph set's style (24 px grid, 2 px stroke, square caps,
// currentColor) for marks the set does not have yet: a key (the sample-keys chip) and zoom in and out (the slip
// crop). Never a unicode character standing in for an icon (round 3). Each is decorative: the control or the words
// beside it carry the meaning. Reported to WS-DS so the set can adopt them.

import type { ReactNode } from "react";

interface LineGlyphProps {
  readonly size?: number;
  readonly className?: string;
}

function LineGlyph({ size = 16, className, children }: LineGlyphProps & { readonly children: ReactNode }) {
  return (
    <svg
      className={["fs-glyph", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
        {children}
      </g>
    </svg>
  );
}

/** A key: the sample-keys chip's mark. */
export function KeyGlyph({ size = 16, className }: LineGlyphProps) {
  return (
    <LineGlyph size={size} className={className}>
      <circle cx={8} cy={12} r={4} />
      <path d="M12 12h9M18 12v3.5M21 12v2.5" />
    </LineGlyph>
  );
}

/** Zoom in (a plus) or out (a minus), for the slip crop's buttons. */
export function ZoomGlyph({ dir, size = 16, className }: LineGlyphProps & { readonly dir: "in" | "out" }) {
  return (
    <LineGlyph size={size} className={className}>
      <path d={dir === "in" ? "M5 12h14M12 5v14" : "M5 12h14"} />
    </LineGlyph>
  );
}
