// The instrument numeral (unslop spec §1.6; UI gate round 3): one hero count a screen, drawn as a 5 × 7 dot grid
// per digit. Lit dots take the colour around them; unlit dots sit at 5% of it, so the grid reads as a display
// without reading as noise. It is for what an instrument reads (48/48, 2.05 → 1.62, 7/8, 6/6) and never for money.
// A digit changes column by column, 24 ms apart, with a 120 ms fade; reduced motion is instant (styles.css). The SVG
// is an image with the spoken value as its name, or hidden when the words beside it already say it.

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

/** Unlit dots, as a share of the lit colour (round 3: 5%, down from 7%). */
export const DOT_MATRIX_UNLIT = 0.05;

/** The characters the matrix can draw; anything else is dropped (units are set beside it in type). */
export function drawable(text: string): string {
  return [...text].filter((ch) => GLYPHS[ch] !== undefined).join("");
}

export interface MatrixDot {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly on: boolean;
  /** The dot's column inside its glyph: a changing digit sweeps left to right, 24 ms a column. */
  readonly column: number;
}

/** Every dot of `text` at `pitch`, and the drawing's size. */
export function dotsOf(text: string, pitch: number): { dots: MatrixDot[]; width: number; height: number } {
  const dots: MatrixDot[] = [];
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
  /** What the instrument reads: digits, ".", "/" and "%" ("48/48", "2.05", "7/8"). */
  readonly value: string;
  /** Dot pitch in px: 6 in a dial, 7 for a console reading, 9 for a header counter. */
  readonly pitch?: number;
  /** The spoken value ("48 of 48 slips read", "2.05 percent"). */
  readonly label: string;
  /**
   * The lit dots' colour: ink (a checked reading), dim (ink-3: nothing checked yet), over (marigold: over a limit, a
   * person must decide).
   */
  readonly tone?: "ink" | "dim" | "over";
  /** The words sit beside it already (a screen-reader sentence): the drawing is hidden from assistive tech. */
  readonly decorative?: boolean;
  readonly testId?: string;
  readonly className?: string;
}

export function DotMatrix({
  value,
  pitch = 7,
  label,
  tone = "ink",
  decorative = false,
  testId,
  className,
}: DotMatrixProps) {
  const { dots, width, height } = dotsOf(value, pitch);
  const r = pitch * 0.37;
  return (
    <svg
      className={["fs-dm", className].filter(Boolean).join(" ")}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-value={drawable(value)}
      data-tone={tone}
      data-testid={testId}
      focusable="false"
    >
      {dots.map((d) => (
        <circle
          key={d.key}
          className="fs-dm__dot"
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
