// <Glyph>: the domain glyphs and Material Symbols from @fairsplit/tokens/glyphs, in currentColor. Icons are
// decoration beside a word, so they are hidden from screen readers unless given a label.

import { GLYPHS, type GlyphName } from "@fairsplit/tokens/glyphs";
import { useId } from "react";

export type { GlyphName } from "@fairsplit/tokens/glyphs";

export interface GlyphProps {
  readonly name: GlyphName;
  readonly size?: number;
  /** Only when the glyph stands alone; usually the adjacent word carries the meaning. */
  readonly label?: string;
  readonly className?: string;
}

export function Glyph({ name, size = 20, label, className }: GlyphProps) {
  const id = useId().replaceAll(":", "");
  const glyph = GLYPHS[name];
  const cuts = glyph.elements.filter((e) => e.mode === "cut");
  const maskId = `fs-glyph-${id}`;
  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: glyph.stroke,
    strokeLinecap: "square" as const,
    strokeLinejoin: "miter" as const,
  };
  return (
    <svg
      className={className ? `fs-glyph ${className}` : "fs-glyph"}
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-glyph={name}
    >
      {cuts.length > 0 && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="white" />
            {cuts.map((c) => (
              <path key={c.d} d={c.d} {...strokeProps} stroke="black" />
            ))}
          </mask>
        </defs>
      )}
      <g mask={cuts.length > 0 ? `url(#${maskId})` : undefined}>
        {glyph.elements.map((el, i) => {
          const key = `${el.mode}-${i}`;
          if (el.mode === "fill") return <path key={key} d={el.d} fill="currentColor" />;
          if (el.mode === "stroke") return <path key={key} d={el.d} {...strokeProps} />;
          return null;
        })}
      </g>
    </svg>
  );
}
