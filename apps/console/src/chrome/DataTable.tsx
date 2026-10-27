// Data mode's plain tables (W-TR-10, S1.7, S1.12). Every visualisation (the dial, the fan, the arc, the waffle,
// the seal) is hidden from screen readers and mirrored in a table: in Data mode the table replaces the
// visual on screen; otherwise it stays in the accessibility tree only. A table is a plain HTML table with a
// caption, column headers and figures aligned on the decimal point.

import type { ReactNode } from "react";
import { useDataMode } from "../lib/data-mode.js";

export interface DataColumn {
  readonly key: string;
  readonly label: string;
  /** Right-aligned, tabular figures. */
  readonly numeric?: boolean;
}

export interface DataRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

export interface DataTableProps {
  readonly caption: string;
  readonly columns: readonly DataColumn[];
  readonly rows: readonly DataRow[];
  readonly testId: string;
  /** The row that names the table's subject (first column) is a row header. Defaults to true. */
  readonly rowHeaders?: boolean;
}

export function DataTable({ caption, columns, rows, testId, rowHeaders = true }: DataTableProps) {
  return (
    <table className="fsc-datatable" data-testid={testId}>
      <caption className="fsc-datatable__caption fs-t-label">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className="fs-t-caption" data-numeric={c.numeric ? "" : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {columns.map((c, i) =>
              rowHeaders && i === 0 ? (
                <th key={c.key} scope="row" data-numeric={c.numeric ? "" : undefined}>
                  {row.cells[c.key]}
                </th>
              ) : (
                <td key={c.key} data-numeric={c.numeric ? "" : undefined}>
                  {row.cells[c.key]}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface MirroredProps {
  /** The picture: hidden from screen readers always, and from view in Data mode. */
  readonly visual: ReactNode;
  /** The same facts as a DataTable: on screen in Data mode, otherwise for screen readers only. */
  readonly table: ReactNode;
  readonly testId: string;
  readonly className?: string;
}

export function Mirrored({ visual, table, testId, className }: MirroredProps) {
  const { on } = useDataMode();
  return (
    <div
      className={["fsc-mirrored", className].filter(Boolean).join(" ")}
      data-datamode={on ? "" : undefined}
      data-testid={testId}
    >
      <div className="fsc-mirrored__visual" aria-hidden hidden={on}>
        {visual}
      </div>
      <div className={on ? "fsc-mirrored__table" : "fs-sr"}>{table}</div>
    </div>
  );
}
