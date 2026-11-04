// The instrument numeral (unslop spec §1.6, reel 2's hero number): a 5 × 7 dot grid per digit, lit dots in ink and
// unlit dots at 7% of it, so the matrix reads as a display. It is for what an instrument reads (the reading room's
// slip counter, the split's mass balance) and never for money. One per screen. A digit changes column by column,
// 24 ms apart, with a 120 ms fade; reduced motion is instant (dot-matrix.css). It is drawn in currentColor, so it
// takes its colour from the tokens around it. The SVG is an image with the spoken value as its name.

import "./dot-matrix.css";

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
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
};

const ROWS = 7;

/** The characters the matrix can draw; anything else is dropped (units are set beside it in type). */
export function drawable(text: string): string {
  return [...text].filter((ch) => GLYPHS[ch] !== undefined).join("");
}

interface Dot {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly on: boolean;
  /** The dot's column inside its glyph: a changing digit sweeps left to right, 24 ms a column. */
  readonly column: number;
}

/** Every dot of `text` at `pitch`, and the drawing's size. Exported for tests. */
export function dotsOf(text: string, pitch: number): { dots: Dot[]; width: number; height: number } {
  const dots: Dot[] = [];
  let x = 0;
  [...drawable(text)].forEach((ch, index) => {
    const glyph = GLYPHS[ch] ?? [];
    const w = glyph[0]?.length ?? 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < w; col++) {
        dots.push({
          key: `${index}-${row}-${col}`,
          cx: (x + col) * pitch + pitch / 2,
          cy: row * pitch + pitch / 2,
          on: glyph[row]?.[col] === "#",
          column: col,
        });
      }
    }
    x += w + 1;
  });
  return { dots, width: Math.max(0, (x - 1) * pitch), height: ROWS * pitch };
}

export interface DotMatrixProps {
  /** What the instrument reads: digits, ".", "/" and "%" ("48/48", "2.05"). */
  readonly value: string;
  /** Dot pitch in px: 6 in a dial, 7 for a console reading, 9 for a header counter. */
  readonly pitch?: number;
  /** The spoken value ("48 of 48 slips read", "2.05 percent"). */
  readonly label: string;
  /** The words sit beside it already (a screen-reader sentence): the drawing is hidden from assistive tech. */
  readonly decorative?: boolean;
  readonly testId?: string;
  readonly className?: string;
}

export function DotMatrix({
  value,
  pitch = 7,
  label,
  decorative = false,
  testId,
  className,
}: DotMatrixProps) {
  const { dots, width, height } = dotsOf(value, pitch);
  const r = pitch * 0.37;
  return (
    <svg
      className={["fsr-dm", className].filter(Boolean).join(" ")}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-value={drawable(value)}
      data-testid={testId}
      focusable="false"
    >
      {dots.map((d) => (
        <circle
          key={d.key}
          className="fsr-dm__dot"
          cx={d.cx}
          cy={d.cy}
          r={r}
          data-on={d.on ? "" : undefined}
          style={{ transitionDelay: `${d.column * 24}ms` }}
        />
      ))}
    </svg>
  );
}
