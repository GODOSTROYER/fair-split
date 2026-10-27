// Drawn placeholders for the evidence photos until WS-MEDIA's synthetic photos land (IC-11). They stay
// abstract on purpose: a printed weigh-slip form with its red serial, and blue ballpoint marks where Jessie's
// block capitals will be. Every tile still carries "Synthetic sample", in its alt text too.

export type CopyColour = "white" | "pink" | "yellow";

/** Ballpoint blue and the press's red serial: part of the drawn paper, not interface colours. */
const BALLPOINT = "#2B4BA0";
const SERIAL_RED = "#B23A2E";
const PRINT = "#6E6A64";
const COPY: Readonly<Record<CopyColour, string>> = {
  white: "var(--fs-copy-white)",
  pink: "var(--fs-copy-pink)",
  yellow: "var(--fs-copy-yellow)",
};

/** Seeded variation so every slip's "handwriting" bars differ but render the same way every time. */
function marks(seed: string): number[] {
  let x = [...seed].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0x7fffffff;
  return Array.from({ length: 8 }, () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return 0.45 + (x % 1000) / 1800;
  });
}

export interface SlipSheetProps {
  /** The printed serial; left as a red mark when the register does not say which slip this is. */
  readonly serial?: string;
  readonly copy?: CopyColour;
  readonly width?: number;
  /** The pink duplicate is fainter than the white original. */
  readonly faint?: boolean;
  /** Varies the drawn marks of a slip without a known serial. */
  readonly seed?: string;
}

export function SlipSheet({ serial, copy = "white", width = 120, faint = false, seed }: SlipSheetProps) {
  const w = 120;
  const h = 160;
  const m = marks(serial ?? seed ?? "slip");
  const ink = faint ? 0.55 : 0.92;
  const rows = [52, 70, 88, 106, 124];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={(width * h) / w}
      className="slip"
      aria-hidden
      style={{ display: "block" }}
    >
      <rect width={w} height={h} fill={COPY[copy]} />
      <rect x={10} y={10} width={58} height={4} fill={PRINT} opacity={0.55} />
      <rect x={10} y={18} width={38} height={3} fill={PRINT} opacity={0.4} />
      {serial ? (
        <text
          x={110}
          y={20}
          textAnchor="end"
          fill={SERIAL_RED}
          opacity={faint ? 0.6 : 0.9}
          style={{ fontFamily: "var(--fs-font-ui)", fontSize: 11, fontWeight: 700, fontStretch: "75%" }}
        >
          {serial}
        </text>
      ) : (
        <rect x={86} y={11} width={24} height={8} fill={SERIAL_RED} opacity={faint ? 0.35 : 0.55} />
      )}
      <line x1={10} x2={110} y1={32} y2={32} stroke={PRINT} strokeWidth={0.8} opacity={0.5} />
      {rows.map((y, i) => (
        <g key={y}>
          <rect x={10} y={y - 8} width={22} height={3} fill={PRINT} opacity={0.45} />
          <line x1={38} x2={110} y1={y} y2={y} stroke={PRINT} strokeWidth={0.6} opacity={0.45} />
          <path
            d={`M40 ${y - 3} l${(m[i] ?? 0.6) * 58} ${(i % 2 ? -1 : 1) * 1.2}`}
            stroke={BALLPOINT}
            strokeWidth={2.4}
            strokeLinecap="round"
            opacity={ink}
          />
        </g>
      ))}
      <path
        d={`M64 144 l${(m[6] ?? 0.6) * 40} -2`}
        stroke={BALLPOINT}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={ink * 0.9}
      />
      <rect x={10} y={140} width={30} height={3} fill={PRINT} opacity={0.4} />
    </svg>
  );
}

export interface PhotoTileProps {
  readonly photo: string;
  readonly serials: readonly (string | undefined)[];
  readonly copies?: readonly CopyColour[];
  readonly width?: number;
  readonly read?: boolean;
}

/** One photo: four slips on the bamboo mat, as the clerk photographs them. */
export function PhotoTile({ photo, serials, copies = [], width = 132, read = false }: PhotoTileProps) {
  const slip = (width - 18) / 2;
  return (
    <div className="photo" style={{ width }} data-read={read ? "" : undefined}>
      <div className="photo__mat">
        {serials.slice(0, 4).map((s, i) => (
          <SlipSheet
            key={i}
            serial={s}
            seed={`${photo}${i}`}
            copy={copies[i] ?? "white"}
            width={slip}
            faint={(copies[i] ?? "white") === "pink"}
          />
        ))}
      </div>
      <span className="photo__id fs-t-caption">Photo {photo}</span>
    </div>
  );
}

/**
 * Which slips the register places in a photo: only slip 0457, the white original in B and the pink
 * duplicate in D (H1). Every other slip waits for WS-MEDIA's reviewed fixtures.
 */
export function photoSerials(photo: string): { serials: (string | undefined)[]; copies: CopyColour[] } {
  const serials: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  const copies: CopyColour[] = ["white", "white", "white", "white"];
  if (photo === "B") serials[1] = "0457";
  if (photo === "D") {
    serials[2] = "0457";
    copies[2] = "pink";
  }
  return { serials, copies };
}
