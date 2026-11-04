// Proof's instrument numeral (unslop spec §1.6): the six checks' count, "0/6" until this browser has checked and
// "6/6" once it has, drawn as a 5 x 7 dot matrix. One per screen, never money. Lit dots are ink (ink-3 while
// nothing is checked yet), unlit dots ink at 7 %, so the grid reads as a display. When the count changes after
// the first paint the new digits come in column by column (proof.css); history never animates, and reduced
// motion is instant. The words beside it carry the meaning, so the matrix itself is hidden from screen readers.

import { type CSSProperties, useRef } from "react";

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
};

export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly on: boolean;
  readonly column: number;
}

/** Every dot of `text` on the 5 x 7 grid, one empty column between glyphs; unknown characters are skipped. */
export function dotsOf(text: string): { readonly dots: readonly Dot[]; readonly columns: number } {
  const dots: Dot[] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const width = glyph[0]?.length ?? 0;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < width; col++) {
        dots.push({ x: x + col, y: row, on: glyph[row]?.[col] === "#", column: x + col });
      }
    }
    x += width + 1;
  }
  return { dots, columns: Math.max(0, x - 1) };
}

export interface DotMatrixProps {
  readonly value: string;
  /** The grid's pitch in px: 9 for Proof's header count (63 px tall). */
  readonly pitch?: number;
  /** "dim" before anything is checked: the lit dots read in ink-3. */
  readonly tone?: "ink" | "dim";
  readonly className?: string;
}

export function DotMatrix({ value, pitch = 9, tone = "ink", className }: DotMatrixProps) {
  const first = useRef(value);
  const moved = value !== first.current;
  const { dots, columns } = dotsOf(value);
  const width = columns * pitch;
  const height = 7 * pitch;
  const r = pitch * 0.37;
  return (
    <svg
      key={value}
      className={["pf-dots", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-moved={moved ? "" : undefined}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      focusable="false"
    >
      {dots.map((d) => (
        <circle
          key={`${d.x}-${d.y}`}
          cx={d.x * pitch + pitch / 2}
          cy={d.y * pitch + pitch / 2}
          r={r}
          className={d.on ? "pf-dots__on" : "pf-dots__off"}
          style={d.on ? ({ "--pf-c": d.column } as CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}
