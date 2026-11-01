// Loading, drawn the way S1 draws it: dashed print beds at their final size, never a shimmer, never a spinner.
// A screen renders beds where its print will land while its data is not in yet, so nothing moves when it
// arrives. Beds are decoration for sighted readers; the screen's `data-state="loading"` carries the meaning.

import type { CSSProperties } from "react";

export type PrintBedShape = "row" | "line" | "block" | "photo" | "plate" | "seal" | "slab";

export interface PrintBedProps {
  readonly shape?: PrintBedShape;
  /** CSS length; defaults by shape (rows fill their column). */
  readonly width?: number | string;
  readonly height?: number | string;
  /** Repeat the bed this many times (rows of a grid, photos on a sheet). */
  readonly count?: number;
  /** What will print here, in caption type at the bed's corner: "Photo B", "Invoice". One per bed. */
  readonly labels?: readonly string[];
  readonly className?: string;
}

export function PrintBed({ shape = "row", width, height, count, labels, className }: PrintBedProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  const total = Math.max(1, count ?? labels?.length ?? 1);
  const beds = Array.from({ length: total }, (_, i) => i);
  return (
    <>
      {beds.map((i) => (
        <span
          key={i}
          className={["fsc-bed", `fsc-bed--${shape}`, className].filter(Boolean).join(" ")}
          style={style}
          aria-hidden
          data-bed={shape}
        >
          {labels?.[i] && <span className="fsc-bed__label fs-t-caption">{labels[i]}</span>}
        </span>
      ))}
    </>
  );
}
