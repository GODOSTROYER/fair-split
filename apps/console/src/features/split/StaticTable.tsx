// The split as a plain table, drawn with the grid's own cell renderers, for as long as the grid's container has no
// measured size. AG Grid needs a sized container (it measures its viewport to place rows); until a ResizeObserver
// reports a width (one frame in a browser, never in a layout-less environment such as jsdom or a print preview),
// the same lines print here, with the same words, amounts, washes and test hooks, and the same row actions.

import type { ColDef } from "ag-grid-community";
import { type ComponentType, type KeyboardEvent, useState } from "react";
import { DetailView, type GridContext, type GridRow } from "./cells.js";
import { type HoldNoteRow, HoldNoteView } from "./HoldNote.js";
import type { SplitRow } from "./model.js";
import { SPLIT } from "./shared/copy.js";

type Renderer = ComponentType<{ readonly data: GridRow; readonly context: GridContext }>;

export interface StaticTableProps {
  readonly columns: readonly ColDef<GridRow>[];
  readonly rows: readonly GridRow[];
  readonly totals: GridRow;
  readonly context: GridContext;
  readonly openMember?: string | null;
  readonly onOpen: (row: SplitRow) => void;
  /** "Open H1" on the inline hold note. */
  readonly onOpenNote?: (note: HoldNoteRow) => void;
  /** Lines printed before "Show all": the table is a fallback, kept light where nothing is laid out. */
  readonly limit?: number;
}

export const STATIC_ROWS = 16;

function renderer(col: ColDef<GridRow>): Renderer | null {
  return (col.cellRenderer as Renderer | undefined) ?? null;
}

export function StaticTable({
  columns,
  rows,
  totals,
  context,
  openMember,
  onOpen,
  onOpenNote,
  limit = STATIC_ROWS,
}: StaticTableProps) {
  const [all, setAll] = useState(false);
  const shown = all || rows.length <= limit ? rows : rows.slice(0, limit);
  const cell = (col: ColDef<GridRow>, row: GridRow) => {
    const Cell = renderer(col);
    return Cell ? <Cell data={row} context={context} /> : null;
  };
  const onKey = (row: SplitRow) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(row);
    }
  };
  return (
    <>
      <table className="fsr-static" data-testid="W-TR-05.table">
        <caption className="fs-sr">{SPLIT.gridLabel}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.colId}
                scope="col"
                className="fs-t-label"
                data-col={col.colId}
                data-numeric={col.type === "rightAligned" ? "" : undefined}
              >
                {col.colId === "expand" ? <span className="fs-sr">{col.headerName}</span> : col.headerName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            if (row.kind === "note")
              return (
                <tr key={row.memberNo} className="fsr-row--note">
                  <td colSpan={columns.length}>
                    <HoldNoteView note={row} onOpen={() => onOpenNote?.(row)} />
                  </td>
                </tr>
              );
            if (row.kind === "detail")
              return (
                <tr key={row.memberNo} className="fsr-row--detail">
                  <td colSpan={columns.length}>
                    <DetailView detail={row} />
                  </td>
                </tr>
              );
            if (row.kind !== "line") return null;
            return (
              <tr
                key={row.memberNo}
                className={[
                  row.status.kind !== "line" ? "fsr-row--held" : "",
                  openMember === row.memberNo ? "fsr-row--open" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={onKey(row)}
                aria-label={
                  row.openHold ? SPLIT.openHold(row.openHold.label, row.name) : SPLIT.openLine(row.name)
                }
              >
                {columns.map((col) =>
                  col.colId === "member" ? (
                    <th key={col.colId} scope="row" data-col={col.colId}>
                      {cell(col, row)}
                    </th>
                  ) : (
                    <td
                      key={col.colId}
                      data-col={col.colId}
                      data-numeric={col.type === "rightAligned" ? "" : undefined}
                    >
                      {cell(col, row)}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="fsr-row--totals">
            {columns.map((col) =>
              col.colId === "member" ? (
                <th key={col.colId} scope="row" data-col={col.colId}>
                  {cell(col, totals)}
                </th>
              ) : (
                <td
                  key={col.colId}
                  data-col={col.colId}
                  data-numeric={col.type === "rightAligned" ? "" : undefined}
                >
                  {cell(col, totals)}
                </td>
              ),
            )}
          </tr>
        </tfoot>
      </table>
      {shown.length < rows.length && (
        <p className="fsr-static__more">
          <button
            type="button"
            className="fs-flat"
            onClick={() => setAll(true)}
            data-testid="W-TR-05.showAll"
          >
            {SPLIT.showAll(rows.length)}
          </button>
        </p>
      )}
    </>
  );
}
