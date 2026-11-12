// Nothing clipped at any width (UI gate round 5, docs/DESIGN.md §3 "Scroll columns"). A table body, a log or a column
// that scrolls on its own sits in a SnapScroll:
// - its edges fade (24 px, LAYOUT.console.fade) only where there is more beyond them: under a sticky head, above a
//   sticky total, at the column's foot. The fade is a plate veil outside the scroller, so the one focus ring is never
//   masked away;
// - with `row`, it rests on whole rows: each row snaps to the top (under the sticky head), and with `fill` or `rows`
//   its height is the head, a whole number of rows and the foot, so the last row on view is never cut in half;
// - with `fill`, it reaches down to its panel's foot and stops `end` px above it (32 by default, LAYOUT.console.end);
// - with `end`, the content keeps that much room at its foot, so its last line never sits on the edge.
// A sticky head and a sticky foot mark themselves `data-snap-head` and `data-snap-foot` (a <thead>, a <tfoot>, a
// summary row); the fades sit inside them. It is a ScrollRegion: a named region in the tab order (WCAG 2.1.1).

import { LAYOUT } from "@fairsplit/tokens";
import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useRef } from "react";

/** The edge fade (24 px) and the room a column keeps above its panel's foot (32 px). */
export const SNAP = { fade: LAYOUT.console.fade, end: LAYOUT.console.end } as const;

/** How many rows a log shows before its "All N events" disclosure (round 5: four). */
export const PEEK_ROWS = LAYOUT.console.peek;

/**
 * The height that shows a whole number of rows: the head, as many `row`-tall rows as fit in `available`, and the
 * foot. At least one row (a column never collapses to its head). Pure, so a test can hold it to whole rows.
 */
export function wholeRowsHeight({
  available,
  row,
  head = 0,
  foot = 0,
}: {
  readonly available: number;
  readonly row: number;
  readonly head?: number;
  readonly foot?: number;
}): { readonly rows: number; readonly height: number } {
  if (!(row > 0)) return { rows: 0, height: Math.max(0, available) };
  const rows = Math.max(1, Math.floor((available - head - foot) / row));
  return { rows, height: head + rows * row + foot };
}

/** Where an element's scroll box has more content: above its top edge, below its bottom edge. */
export function scrollEdges(el: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): { readonly start: boolean; readonly end: boolean } {
  const slack = 1;
  return {
    start: el.scrollTop > slack,
    end: el.scrollTop + el.clientHeight < el.scrollHeight - slack,
  };
}

/** The nearest ancestor that scrolls (the console's screen panel, a drawer's body), else the viewport. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** Marks the frame with the edges that have more beyond them; the fades follow. */
function edgesOf(box: HTMLElement, el: HTMLElement): void {
  const edges = scrollEdges(el);
  box.toggleAttribute("data-more-start", edges.start);
  box.toggleAttribute("data-more-end", edges.end);
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export interface SnapScrollProps {
  /** The ID of the heading that names it, or… */
  readonly labelledBy?: string;
  /** …its name, when no heading is near. */
  readonly label?: string;
  /** Rest on whole rows of this height (px): each row snaps under the sticky head. */
  readonly row?: number;
  /** Show exactly this many rows (with `row`): the height is the head, these rows and the foot. */
  readonly rows?: number;
  /** Reach down to the panel's foot, `end` px above it, on whole rows (with `row`). */
  readonly fill?: boolean;
  /** Room at the content's foot and, with `fill`, above the panel's foot (px; 32 by default). */
  readonly end?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function SnapScroll({
  labelledBy,
  label,
  row,
  rows,
  fill = false,
  end = SNAP.end,
  className,
  style,
  testId,
  children,
}: SnapScrollProps) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);

  // The edges with more beyond them, and the sticky head's and foot's heights (the fades sit inside them).
  const measure = useCallback(() => {
    const box = frame.current;
    const el = scroller.current;
    if (!box || !el) return;
    const head = el.querySelector<HTMLElement>("[data-snap-head]")?.offsetHeight ?? 0;
    const foot = el.querySelector<HTMLElement>("[data-snap-foot]")?.offsetHeight ?? 0;
    box.style.setProperty("--fsc-snap-head", `${head}px`);
    box.style.setProperty("--fsc-snap-foot", `${foot}px`);
    if (row && (fill || rows)) {
      let available = rows ? head + rows * row + foot : 0;
      if (!rows) {
        // Down to the panel's foot, less its own bottom padding and `end` px of room.
        const panel = scrollParent(box);
        const bottom = panel
          ? panel.getBoundingClientRect().bottom - px(getComputedStyle(panel).paddingBottom)
          : window.innerHeight;
        available = bottom - end - box.getBoundingClientRect().top;
      }
      const { height } = wholeRowsHeight({ available, row, head, foot });
      el.style.maxHeight = `${height}px`;
    }
    edgesOf(box, el);
  }, [row, rows, fill, end]);

  // On scroll only the edges change (cheap: no style reads up the tree).
  const onScroll = useCallback(() => {
    if (frame.current && scroller.current) edgesOf(frame.current, scroller.current);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    const box = frame.current;
    if (!el || !box) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    const panel = fill ? scrollParent(box) : null;
    if (panel) observer.observe(panel);
    for (const child of Array.from(el.children)) observer.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, fill]);

  return (
    <div
      ref={frame}
      className={["fsc-snap", className].filter(Boolean).join(" ")}
      data-row={row}
      style={{ ...style, ...(row ? { "--fsc-snap-row": `${row}px` } : {}) } as CSSProperties}
      data-testid={testId}
    >
      <section
        ref={scroller}
        className="fsc-snap__scroller"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must take focus to scroll by keyboard.
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        data-scroll-region=""
        data-snap={row ? "rows" : undefined}
        style={{ "--fsc-snap-end": `${end}px` } as CSSProperties}
        onScroll={onScroll}
      >
        {children}
      </section>
      <span className="fsc-snap__fade" data-edge="start" aria-hidden />
      <span className="fsc-snap__fade" data-edge="end" aria-hidden />
    </div>
  );
}
