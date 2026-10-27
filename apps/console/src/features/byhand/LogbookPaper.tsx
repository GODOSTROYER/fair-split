// Logbook page 14, the clerk's ledger and the by-hand field's second witness (design §6 C4): a ruled page with
// Jessie's capitals in each column, drawn from the seed until WS-MEDIA's photograph lands. The line that names
// the slip carries the reading band. On W-TR-04 the paper is cropped to the lines around the slip's own (lines
// 5 to 9 for line 7) and to the columns they use, so the witness line reads at the same size as the slip's
// crop above it. Evidence only: the drawing is aria-hidden; its Paper says what it shows.

import type { SnapshotLogbookPage } from "@fairsplit/contracts";
import { memo } from "react";
import { handRun } from "../reading/hand.js";

const W = 420;
const ROW = 22;
const TOP = 46;
/** A cropped strip has no page heading: the column labels sit at its top edge. */
const STRIP_TOP = 28;
const COLUMNS = [
  { key: "line", label: "Line", x: 10 },
  { key: "serial", label: "Slip no.", x: 44 },
  { key: "member", label: "Member", x: 112 },
  { key: "net", label: "Net kg", x: 196 },
  { key: "remark", label: "Remarks", x: 262 },
] as const;
/** Where a strip ends when none of its lines has a remark: just inside the Remarks column's rule. */
const NO_REMARKS_W = 254;

export interface LogbookLines {
  readonly from: number;
  readonly to: number;
}

/** The lines around `lineNo` (two either side), kept inside the page. */
export function logbookWindow(page: SnapshotLogbookPage, lineNo: number, reach = 2): LogbookLines {
  const numbers = page.lines.map((l) => l.lineNo);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  const span = reach * 2;
  const from = Math.max(first, Math.min(lineNo - reach, last - span));
  return { from, to: Math.min(last, from + span) };
}

export const LogbookPaper = memo(function LogbookPaper({
  page,
  highlight,
  lines: crop = null,
}: {
  readonly page: SnapshotLogbookPage;
  /** The line number the band marks. */
  readonly highlight: number | null;
  /** Crop the page to these lines (the strip under the by-hand crop); the whole page when absent. */
  readonly lines?: LogbookLines | null;
}) {
  const shown = crop ? page.lines.filter((l) => l.lineNo >= crop.from && l.lineNo <= crop.to) : page.lines;
  const strip = crop !== null;
  const top = strip ? STRIP_TOP : TOP;
  const width = strip && shown.every((l) => !l.remark) ? NO_REMARKS_W : W;
  const columns = COLUMNS.filter((c) => c.x < width);
  const height = top + shown.length * ROW + (strip ? 6 : 16);
  const [year = "", month = ""] = page.month.split("-");
  return (
    <svg
      className="fsc-logbook"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
      data-lines={crop ? `${crop.from}-${crop.to}` : undefined}
    >
      <rect className="fsc-logbook__sheet" width={width} height={height} />
      {!strip && (
        <>
          <path
            className="fsc-slip__hand"
            d={handRun(`${month}/${year}`, { size: 9, seed: `logbook:${page.page}:month` }).d}
            transform="translate(12 10)"
          />
          <text className="fsc-logbook__print" x={W - 12} y={19} textAnchor="end">
            {`Page ${page.page}`}
          </text>
        </>
      )}
      {columns.map((c) => (
        <text key={c.key} className="fsc-logbook__print fsc-logbook__print--head" x={c.x} y={top - 8}>
          {c.label}
        </text>
      ))}
      <line
        className="fsc-logbook__rule fsc-logbook__rule--head"
        x1={6}
        x2={width - 6}
        y1={top - 3}
        y2={top - 3}
      />
      {columns.slice(1).map((c) => (
        <line
          key={c.key}
          className="fsc-logbook__rule"
          x1={c.x - 5}
          x2={c.x - 5}
          y1={top - 18}
          y2={height - (strip ? 2 : 10)}
        />
      ))}
      {shown.map((line, i) => {
        const y = top + i * ROW;
        const on = highlight === line.lineNo;
        const cells: readonly [string, string][] = [
          ["line", String(line.lineNo)],
          ["serial", line.serial],
          ["member", line.memberNo],
          ["net", line.netKgText],
          ["remark", line.remark ?? ""],
        ];
        return (
          <g key={line.lineNo} data-line={line.lineNo} data-band={on ? "" : undefined}>
            {on && <rect className="fsc-logbook__band" x={4} y={y} width={width - 8} height={ROW} />}
            <line className="fsc-logbook__rule" x1={6} x2={width - 6} y1={y + ROW} y2={y + ROW} />
            {cells.map(([key, text]) => {
              const col = columns.find((c) => c.key === key);
              if (!col || !text) return null;
              return (
                <path
                  key={key}
                  className="fsc-slip__hand"
                  d={handRun(text, { size: 9, seed: `logbook:${page.page}:${line.lineNo}:${key}` }).d}
                  transform={`translate(${col.x} ${y + 6})`}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});
