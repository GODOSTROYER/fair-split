// The split's lines rest on whole rows (UI gate round 5, docs/DESIGN.md §3 "Scroll columns"): AG Grid 36 scrolls
// its own viewport, with the header and the pinned decisions as a sticky head and the members' total as a sticky
// foot, so the grid's frame is sized to the head, a whole number of 48 px lines and the foot (`wholeRowsHeight`),
// down to its cell's foot (the panel's foot less 32 px). A line never ends half-hidden under the total; each
// snaps under the head as it scrolls (split.css); and the frame says which edges have more beyond them, so the
// chrome's 24 px plate fades (theme/snap.css) show above the total and under the head only then.

import { type CSSProperties, type RefObject, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { scrollEdges, wholeRowsHeight } from "../../chrome/SnapScroll.js";

/** Every line, note and opened calculation is one 48 px row (SplitAgGrid's STACKED_ROW_PX). */
export const SPLIT_ROW_PX = 48;

const FRAME = ".fsr-grid__frame";
const VIEWPORT = ".ag-grid-viewport";
const HEAD = ".ag-grid-pinned-top-rows";
const FOOT = ".ag-grid-pinned-bottom-rows";

export interface WholeRows {
  /** How many lines the frame shows between its head and its foot. */
  readonly rows: number;
  /** The frame's height in px. */
  readonly height: number;
}

/**
 * The frame's height for a grid whose viewport has `head` and `foot` sticky parts, `chrome` px of its own outside
 * the viewport (borders, a horizontal scrollbar), `available` px in its cell and `lines` lines to scroll: whole
 * rows only, never more rows than there are lines (a filtered grid hugs its lines), at least one.
 */
export function splitFrameHeight({
  available,
  chrome,
  head,
  foot,
  lines,
  row = SPLIT_ROW_PX,
}: {
  readonly available: number;
  readonly chrome: number;
  readonly head: number;
  readonly foot: number;
  readonly lines: number;
  readonly row?: number;
}): WholeRows {
  const { rows } = wholeRowsHeight({ available: available - chrome, row, head, foot });
  const shown = Math.max(1, Math.min(rows, Math.max(1, lines)));
  return { rows: shown, height: chrome + head + shown * row + foot };
}

interface Fit {
  readonly height: number;
  /** Where the fades sit: under the sticky head, above the sticky foot (px from the frame's edges). */
  readonly fadeTop: number;
  readonly fadeBottom: number;
  readonly head: number;
  readonly foot: number;
}

/**
 * Sizes the grid's frame (`.fsr-grid__frame` inside `host`) to whole rows and marks its scrolled edges. `lines` is
 * how many rows scroll (the pinned ones excluded). Returns the frame's style and `remeasure`, for the moment AG Grid
 * has drawn.
 */
export function useWholeRows(
  host: RefObject<HTMLElement | null>,
  lines: number,
  active: boolean,
): { readonly style: CSSProperties | undefined; readonly remeasure: () => void } {
  const [tick, setTick] = useState(0);
  const [fit, setFit] = useState<Fit | null>(null);
  const remeasure = useCallback(() => setTick((t) => t + 1), []);

  useLayoutEffect(() => {
    const cell = host.current;
    if (!active || !cell) return;
    void tick;
    const viewport = cell.querySelector<HTMLElement>(VIEWPORT);
    const frame = cell.querySelector<HTMLElement>(FRAME);
    if (!frame || !viewport) return;

    const edges = () => {
      const more = scrollEdges(viewport);
      frame.toggleAttribute("data-more-start", more.start);
      frame.toggleAttribute("data-more-end", more.end);
    };
    const measure = () => {
      const head = cell.querySelector<HTMLElement>(HEAD)?.offsetHeight ?? 0;
      const foot = cell.querySelector<HTMLElement>(FOOT)?.offsetHeight ?? 0;
      const frameBox = frame.getBoundingClientRect();
      const box = viewport.getBoundingClientRect();
      const chrome = frame.offsetHeight - viewport.clientHeight;
      const { height } = splitFrameHeight({ available: cell.clientHeight, chrome, head, foot, lines });
      // The fades sit inside the sticky head and foot, measured from the frame's own edges.
      const next: Fit = {
        height,
        fadeTop: Math.round(box.top - frameBox.top + viewport.clientTop + head),
        fadeBottom: Math.round(
          frameBox.bottom - (box.top + viewport.clientTop + viewport.clientHeight) + foot,
        ),
        head,
        foot,
      };
      setFit((prior) =>
        prior &&
        prior.height === next.height &&
        prior.fadeTop === next.fadeTop &&
        prior.fadeBottom === next.fadeBottom &&
        prior.head === next.head &&
        prior.foot === next.foot
          ? prior
          : next,
      );
      edges();
    };

    measure();
    viewport.addEventListener("scroll", edges, { passive: true });
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(cell);
      for (const part of [HEAD, FOOT]) {
        const el = cell.querySelector<HTMLElement>(part);
        if (el) observer.observe(el);
      }
    }
    return () => {
      viewport.removeEventListener("scroll", edges);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [host, lines, active, tick]);

  const style = useMemo<CSSProperties | undefined>(
    () =>
      active && fit
        ? ({
            height: `${fit.height}px`,
            "--fsc-snap-head": `${fit.fadeTop}px`,
            "--fsc-snap-foot": `${fit.fadeBottom}px`,
            "--fsr-snap-head": `${fit.head}px`,
            "--fsr-snap-foot": `${fit.foot}px`,
          } as CSSProperties)
        : undefined,
    [active, fit],
  );
  return { style, remeasure };
}
