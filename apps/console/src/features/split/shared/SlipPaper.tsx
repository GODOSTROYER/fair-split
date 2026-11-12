// A drawn stand-in for a slip crop until WS-MEDIA's synthetic photos and reviewed crop fixtures land (IC-11):
// the A6 triplicate form with its printed boxes, the press's red serial, and Jessie's entries in blue ballpoint
// block capitals, exactly as the seed records them (box 1–13). It is evidence, so it is Paper: the only thing
// that casts a shadow, tagged "Synthetic sample" in its corner and in its alt text. The pink duplicate prints
// fainter than the white original. Canary marks only what a person must look at: the box-13 line a hold points
// at (H3). MM-3 compares the two copies' fields beside the paper, never by drawing on it.

import type { SnapshotSlip } from "@fairsplit/contracts";
import { Paper } from "@fairsplit/ui-web";
import { useId } from "react";

/** The boxes a person compares or a hold points at. */
export type SlipBox = "serial" | "date" | "member" | "name" | "gross" | "tare" | "net" | "grade";

/** Paper colours and the press's inks: part of the drawn sheet, not interface colours. */
export const COPY_FILL: Readonly<Record<SnapshotSlip["copy"], string>> = {
  WHITE_ORIGINAL: "var(--fs-copy-white)",
  PINK_DUPLICATE: "var(--fs-copy-pink)",
  YELLOW_TRIPLICATE: "var(--fs-copy-yellow)",
  LOGBOOK_LINE: "var(--fs-copy-white)",
  UNKNOWN: "var(--fs-copy-white)",
};
/** Evidence ink drawn in code, from @fairsplit/tokens (--fs-evidence-*): the same on light paper in both themes. */
export const BALLPOINT = "var(--fs-evidence-ballpoint)";
export const SERIAL_RED = "var(--fs-evidence-serial)";
export const FORM_INK = "var(--fs-evidence-form)";

const W = 240;
const H = 300;
const VALUE_X = 96;
const VALUE_W = W - 110;

interface Row {
  readonly box: SlipBox | null;
  readonly label: string;
  readonly value: string;
  readonly y: number;
}

function rowsOf(slip: SnapshotSlip): Row[] {
  const b = slip.boxes;
  return [
    { box: "date", label: "1 Date", value: b["1"], y: 62 },
    { box: "member", label: "2 Member no.", value: b["2"], y: 84 },
    { box: "name", label: "3 Name", value: b["3"], y: 106 },
    { box: null, label: "4 Plot", value: b["4"], y: 128 },
    { box: null, label: "5 Sacks", value: b["5"], y: 150 },
    { box: "gross", label: "6 Gross kg", value: b["6"], y: 172 },
    { box: "tare", label: "7 Tare kg", value: b["7"], y: 194 },
    { box: "net", label: "8 Net kg", value: b["8"], y: 216 },
    { box: "grade", label: "12 Grade", value: b["12"], y: 238 },
  ];
}

export interface SlipPaperProps {
  readonly slip: SnapshotSlip;
  /** Rendered width in CSS px (the height follows the A6 form). */
  readonly width?: number;
  /** Alt text; Paper adds "Synthetic sample". */
  readonly alt: string;
  /** One box-13 line a hold points at, highlighted in full ("Multa (absent GA) ₱200"). */
  readonly markLine?: string | null;
  readonly testId?: string;
  readonly className?: string;
}

export function SlipPaper({ slip, width = 200, alt, markLine, testId, className }: SlipPaperProps) {
  const faint = slip.copy === "PINK_DUPLICATE";
  const ink = faint ? 0.62 : 0.94;
  const rows = rowsOf(slip);
  const marks = slip.boxes["13"];
  const stained = slip.artifacts.includes("WATER_STAIN");
  const stainId = `fsr-stain-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <Paper alt={alt} testId={testId} className={["fsr-slip", className].filter(Boolean).join(" ")}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={width}
        height={Math.round((width * H) / W)}
        aria-hidden
        focusable="false"
        className="fsr-slip__svg"
        data-copy={slip.copy}
      >
        <rect width={W} height={H} fill={COPY_FILL[slip.copy]} />
        <text x={14} y={22} fill={FORM_INK} className="fsr-slip__form fsr-slip__form--title">
          BULAWANON KAKAW GROWERS MPC
        </text>
        <text x={14} y={34} fill={FORM_INK} className="fsr-slip__form">
          Weigh slip, dried cacao
        </text>
        <text
          x={W - 14}
          y={28}
          textAnchor="end"
          fill={SERIAL_RED}
          opacity={faint ? 0.7 : 0.95}
          className="fsr-slip__serial"
        >
          {slip.serial}
        </text>
        <line x1={14} x2={W - 14} y1={44} y2={44} stroke={FORM_INK} strokeWidth={0.75} opacity={0.6} />
        {rows.map((row) => (
          <g key={row.label}>
            <text x={14} y={row.y} fill={FORM_INK} className="fsr-slip__form">
              {row.label}
            </text>
            <line
              x1={92}
              x2={W - 14}
              y1={row.y + 3}
              y2={row.y + 3}
              stroke={FORM_INK}
              strokeWidth={0.5}
              opacity={0.5}
            />
            <text x={VALUE_X} y={row.y} fill={BALLPOINT} opacity={ink} className="fsr-slip__hand">
              {row.value}
            </text>
          </g>
        ))}
        <text x={14} y={262} fill={FORM_INK} className="fsr-slip__form">
          13 Deductions
        </text>
        {marks.length === 0 ? (
          <text x={VALUE_X} y={262} fill={BALLPOINT} opacity={ink * 0.6} className="fsr-slip__hand">
            —
          </text>
        ) : (
          marks.map((text, i) => (
            <g key={text}>
              {markLine === text && (
                <rect
                  x={VALUE_X - 3}
                  y={262 + i * 16 - 5}
                  width={VALUE_W}
                  height={9}
                  className="fsr-slip__highlight"
                  data-box="mark"
                />
              )}
              <text
                x={VALUE_X}
                y={262 + i * 16}
                fill={BALLPOINT}
                opacity={ink}
                className="fsr-slip__hand fsr-slip__hand--small"
              >
                {text.toUpperCase()}
              </text>
            </g>
          ))
        )}
        <text x={14} y={H - 10} fill={FORM_INK} className="fsr-slip__form">
          Clerk {slip.clerkInitials}
        </text>
        {/* Round 6 (film U2): the water stain is a cool grey 45° hatch over a faint wash, never an ochre blot. */}
        {stained && (
          <g data-stain="" aria-hidden>
            <defs>
              <pattern
                id={stainId}
                width={5}
                height={5}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width={1.4} height={5} className="fsr-slip__stain-line" />
              </pattern>
            </defs>
            <ellipse cx={150} cy={190} rx={58} ry={34} className="fsr-slip__stain" />
            <ellipse cx={150} cy={190} rx={58} ry={34} fill={`url(#${stainId})`} />
          </g>
        )}
      </svg>
    </Paper>
  );
}

/** "white original", "pink duplicate", "yellow copy". */
export function copyWord(copy: SnapshotSlip["copy"]): string {
  switch (copy) {
    case "WHITE_ORIGINAL":
      return "white original";
    case "PINK_DUPLICATE":
      return "pink duplicate";
    case "YELLOW_TRIPLICATE":
      return "yellow copy";
    case "LOGBOOK_LINE":
      return "logbook line";
    case "UNKNOWN":
      return "copy";
  }
}
