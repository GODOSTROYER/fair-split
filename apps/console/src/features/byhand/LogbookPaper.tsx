// Logbook page 14, the clerk's ledger and the by-hand field's second witness (design §6 C4): a ruled page with
// Jessie's capitals in each column, drawn from the seed until WS-MEDIA's photograph lands. The line that names
// the slip carries the reading band. Evidence only: the drawing is aria-hidden; its Paper says what it shows.

import type { SnapshotLogbookPage } from "@fairsplit/contracts";
import { memo } from "react";
import { handRun } from "../reading/hand.js";

const W = 420;
const ROW = 22;
const TOP = 46;
const COLUMNS = [
  { key: "line", label: "Line", x: 10 },
  { key: "serial", label: "Slip no.", x: 44 },
  { key: "member", label: "Member", x: 112 },
  { key: "net", label: "Net kg", x: 196 },
  { key: "remark", label: "Remarks", x: 262 },
] as const;

export const LogbookPaper = memo(function LogbookPaper({
  page,
  highlight,
}: {
  readonly page: SnapshotLogbookPage;
  /** The line number the band marks. */
  readonly highlight: number | null;
}) {
  const height = TOP + page.lines.length * ROW + 16;
  const [year = "", month = ""] = page.month.split("-");
  return (
    <svg
      className="fsc-logbook"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
    >
      <rect className="fsc-logbook__sheet" width={W} height={height} />
      <path
        className="fsc-slip__hand"
        d={handRun(`${month}/${year}`, { size: 9, seed: `logbook:${page.page}:month` }).d}
        transform="translate(12 10)"
      />
      <text className="fsc-logbook__print" x={W - 12} y={19} textAnchor="end">
        {`Page ${page.page}`}
      </text>
      {COLUMNS.map((c) => (
        <text key={c.key} className="fsc-logbook__print fsc-logbook__print--head" x={c.x} y={TOP - 8}>
          {c.label}
        </text>
      ))}
      <line
        className="fsc-logbook__rule fsc-logbook__rule--head"
        x1={6}
        x2={W - 6}
        y1={TOP - 3}
        y2={TOP - 3}
      />
      {COLUMNS.slice(1).map((c) => (
        <line
          key={c.key}
          className="fsc-logbook__rule"
          x1={c.x - 5}
          x2={c.x - 5}
          y1={TOP - 18}
          y2={height - 10}
        />
      ))}
      {page.lines.map((line, i) => {
        const y = TOP + i * ROW;
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
            {on && <rect className="fsc-logbook__band" x={4} y={y} width={W - 8} height={ROW} />}
            <line className="fsc-logbook__rule" x1={6} x2={W - 6} y1={y + ROW} y2={y + ROW} />
            {cells.map(([key, text]) => {
              const col = COLUMNS.find((c) => c.key === key);
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
