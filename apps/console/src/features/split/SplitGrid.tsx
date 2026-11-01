// SplitGrid (S2.7, S1.7 W-TR-05): every member line in AG Grid Community, themed from the tokens. Ten columns by
// default (minimum confidence waits behind "All columns": sixty of the 64 lines were read earlier and have none);
// five in a narrow container (Member, Verified kg, Kaltas, Net, Status), and four beside an open drawer, so
// Status always reads whole. The lines a person must still decide are pinned above the rest, in the order the run
// pill walks them, and the totals are pinned beneath. Held rows carry a 3 px canary rule. A row opens its hold
// (W-TR-06) or its line (W-TR-09) on click or Enter. AG Grid is its own lazy chunk (./SplitAgGrid.tsx, with
// theme/grid.ts): it loads once the container has a size, and the static table prints the lines until it has.

import type {
  CellKeyDownEvent,
  ColDef,
  FullWidthCellKeyDownEvent,
  GridApi,
  RowClassRules,
  RowClickedEvent,
} from "ag-grid-community";
import { lazy, type RefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusAndReveal } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useShortcut } from "../../lib/shortcuts.js";
import { NARROW_GRID_PX } from "../../stage/layout.js";
import {
  BonusCell,
  ConfidenceCell,
  CreditCell,
  type GridContext,
  type GridRow,
  KaltasCell,
  KgCell,
  MemberCell,
  NetCell,
  PremiumCell,
  RailCell,
  SlipsCell,
  StatusCell,
} from "./cells.js";
import type { SplitRow, SplitTotals } from "./model.js";
import { StaticTable } from "./StaticTable.js";
import { en, SPLIT } from "./shared/copy.js";

/** AG Grid and its theme, in their own chunk (S2.11): fetched only once a container is measured. */
const SplitAgGrid = lazy(() => import("./SplitAgGrid.js").then((m) => ({ default: m.SplitAgGrid })));

export type GridColumn =
  | "member"
  | "slips"
  | "kg"
  | "confidence"
  | "premium"
  | "bonus"
  | "kaltas"
  | "credit"
  | "net"
  | "rail"
  | "status";

/** S1.6: five columns when the container is under 1,180 px. */
export const NARROW_COLUMNS: readonly GridColumn[] = ["member", "kg", "kaltas", "net", "status"];
/** Beside an open drawer (a 560 px drawer pushes the grid under 760 px): Status keeps its words whole. */
export const SLIM_COLUMNS: readonly GridColumn[] = ["member", "kg", "net", "status"];
export const SLIM_BELOW_PX = 760;

/** The grid's column set: every column, the default ten, five in a narrow container, four beside a drawer. */
export type ColumnSet = "all" | "default" | "narrow" | "slim";

export interface SplitGridProps {
  readonly rows: readonly SplitRow[];
  /** Lines a person must still decide, pinned above the rest (they are not repeated among `rows`). */
  readonly pinned?: readonly SplitRow[];
  readonly totals: SplitTotals;
  readonly context: GridContext;
  /** The member whose line or hold is open beside the grid. */
  readonly openMember?: string | null;
  readonly onOpen: (row: SplitRow) => void;
  /** Forces a column set (tests, galleries); defaults to the container's width. */
  readonly columns?: "all" | "narrow";
  /** "All columns" is on (the screen's toggle): every column, whatever the width. */
  readonly showAll?: boolean;
}

/** The set a container of `width` px shows when nothing forces one (0: not measured yet). */
export function columnSetFor(width: number, showAll: boolean): ColumnSet {
  if (showAll) return "all";
  if (width > 0 && width < SLIM_BELOW_PX) return "slim";
  if (width > 0 && width < NARROW_GRID_PX) return "narrow";
  return "default";
}

const lineOf = (row: GridRow | undefined): SplitRow | null => (row && row.kind === "line" ? row : null);

/** Stable across renders: AG Grid treats a new defaultColDef as new columns and a new getRowId as a new grid. */
const DEFAULT_COL: ColDef<GridRow> = {
  sortable: false,
  resizable: false,
  suppressMovable: true,
  suppressHeaderMenuButton: true,
};

const rowId = (p: { readonly data: GridRow }) => p.data.memberNo;

function columnDefs(premiumRate: string): Record<GridColumn, ColDef<GridRow>> {
  const num = { type: "rightAligned", cellClass: "fsr-ag-num" } as const;
  return {
    member: {
      colId: "member",
      headerName: en("W-TR-05.col.member"),
      cellRenderer: MemberCell,
      flex: 1.5,
      minWidth: 148,
      pinned: "left",
      lockPinned: true,
    },
    slips: { colId: "slips", headerName: en("W-TR-05.col.slips"), cellRenderer: SlipsCell, width: 68 },
    kg: { colId: "kg", headerName: en("W-TR-05.col.kg"), cellRenderer: KgCell, minWidth: 116, flex: 1 },
    confidence: {
      colId: "confidence",
      headerName: en("W-TR-05.col.confidence"),
      cellRenderer: ConfidenceCell,
      width: 104,
    },
    premium: {
      ...num,
      colId: "premium",
      headerName: en("W-TR-05.col.premium"),
      headerTooltip: "Never deducted (R0)",
      cellRenderer: PremiumCell,
      width: 92,
      tooltip: (p) => {
        const row = lineOf(p.data);
        return row ? `${format.kg(row.verifiedG)} × ${premiumRate}, R0, engine v1.` : null;
      },
    },
    bonus: {
      ...num,
      colId: "bonus",
      headerName: en("W-TR-05.col.bonus"),
      cellRenderer: BonusCell,
      width: 84,
    },
    kaltas: {
      colId: "kaltas",
      headerName: en("W-TR-05.col.kaltas"),
      cellRenderer: KaltasCell,
      minWidth: 128,
      flex: 1,
    },
    credit: {
      ...num,
      colId: "credit",
      headerName: en("W-TR-05.col.credit"),
      cellRenderer: CreditCell,
      width: 72,
    },
    net: { ...num, colId: "net", headerName: en("W-TR-05.col.net"), cellRenderer: NetCell, width: 96 },
    rail: { colId: "rail", headerName: en("W-TR-05.col.rail"), cellRenderer: RailCell, width: 84 },
    status: {
      colId: "status",
      headerName: en("W-TR-05.col.status"),
      cellRenderer: StatusCell,
      minWidth: 152,
      flex: 1.3,
    },
  };
}

const ALL: readonly GridColumn[] = [
  "member",
  "slips",
  "kg",
  "confidence",
  "premium",
  "bonus",
  "kaltas",
  "credit",
  "net",
  "rail",
  "status",
];

/** Minimum confidence waits behind "All columns": 60 of 64 lines were read earlier and show none. */
const DEFAULT: readonly GridColumn[] = ALL.filter((c) => c !== "confidence");

const SETS: Readonly<Record<ColumnSet, readonly GridColumn[]>> = {
  all: ALL,
  default: DEFAULT,
  narrow: NARROW_COLUMNS,
  slim: SLIM_COLUMNS,
};

/** Watches the grid's container: under 1,180 px it shows five columns (S1.6). 0 means "not measured". */
function useContainerWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function SplitGrid({
  rows,
  pinned: decisions = [],
  totals,
  context,
  openMember,
  onOpen,
  columns,
  showAll = false,
}: SplitGridProps) {
  const [wrap, width] = useContainerWidth();
  // AG Grid places rows by measuring its viewport: it mounts once the container has a size (a frame in a
  // browser). Until then, and wherever nothing is laid out, the same lines print as a plain table.
  const measured = width > 0;
  const set: ColumnSet = columns ?? columnSetFor(width, showAll);
  const defs = useMemo(() => columnDefs(context.premiumRate), [context.premiumRate]);
  const colDefs = useMemo(() => SETS[set].map((c) => defs[c]), [defs, set]);
  // One grid row per line object: an unchanged line keeps its row, so AG Grid refreshes only the lines that moved.
  const wrapped = useRef(new WeakMap<SplitRow, GridRow>());
  const wrap1 = useCallback((r: SplitRow): GridRow => {
    let row = wrapped.current.get(r);
    if (!row) {
      row = { kind: "line" as const, ...r };
      wrapped.current.set(r, row);
    }
    return row;
  }, []);
  const rowData = useMemo<GridRow[]>(() => rows.map(wrap1), [rows, wrap1]);
  const topRows = useMemo<GridRow[]>(() => decisions.map(wrap1), [decisions, wrap1]);
  const pinned = useMemo<GridRow[]>(
    () => [{ kind: "totals" as const, memberNo: "totals" as const, ...totals }],
    [totals],
  );
  const open = useRef(onOpen);
  open.current = onOpen;

  const rowClassRules = useMemo<RowClassRules<GridRow>>(
    () => ({
      "fsr-row--held": (p) => {
        const row = lineOf(p.data);
        return row !== null && row.status.kind !== "line";
      },
      "fsr-row--open": (p) => {
        const row = lineOf(p.data);
        return row !== null && openMember !== null && openMember !== undefined && row.memberNo === openMember;
      },
      "fsr-row--totals": (p) => p.data?.kind === "totals",
      "fsr-row--decision": (p) => p.node.rowPinned === "top",
    }),
    [openMember],
  );

  const onRowClicked = useCallback((e: RowClickedEvent<GridRow>) => {
    const row = lineOf(e.data);
    if (row) open.current(row);
  }, []);

  const onCellKeyDown = useCallback((e: CellKeyDownEvent<GridRow> | FullWidthCellKeyDownEvent<GridRow>) => {
    const key = (e.event as KeyboardEvent | null | undefined)?.key;
    if (key !== "Enter") return;
    const row = lineOf(e.data ?? undefined);
    if (row) open.current(row);
  }, []);

  const gridApi = useRef<GridApi<GridRow> | null>(null);
  const onApi = useCallback((api: GridApi<GridRow> | null) => {
    gridApi.current = api;
  }, []);
  const moveRow = useCallback(
    (step: 1 | -1) => {
      const api = gridApi.current;
      if (!api) {
        // The static table: move focus between its rows.
        const trs = [...(wrap.current?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? [])];
        if (trs.length === 0) return;
        const at = trs.findIndex((tr) => tr === document.activeElement);
        const next =
          at < 0 ? (step > 0 ? 0 : trs.length - 1) : Math.max(0, Math.min(trs.length - 1, at + step));
        const tr = trs[next];
        if (tr) focusAndReveal(tr);
        return;
      }
      const focused = api.getFocusedCell();
      const count = api.getDisplayedRowCount();
      if (count === 0) return;
      const index = focused && focused.rowPinned == null ? focused.rowIndex + step : step > 0 ? 0 : count - 1;
      const next = Math.max(0, Math.min(count - 1, index));
      api.ensureIndexVisible(next);
      api.setFocusedCell(next, focused?.column ?? "member");
    },
    [wrap],
  );
  useShortcut({
    id: "split.next-row",
    keys: "J",
    label: "Next line",
    group: "Review",
    scope: wrap,
    run: () => moveRow(1),
  });
  useShortcut({
    id: "split.previous-row",
    keys: "K",
    label: "Previous line",
    group: "Review",
    scope: wrap,
    run: () => moveRow(-1),
  });

  // The lines as a plain table: before the container is measured, and while AG Grid's chunk loads.
  const staticFrame = (
    <section className="fsr-grid__frame fsr-grid__frame--static" aria-label={SPLIT.gridLabel}>
      {rowData.length + topRows.length === 0 ? (
        <p className="fs-t-body fsr-muted">{SPLIT.noMatch}</p>
      ) : (
        <StaticTable
          columns={colDefs}
          rows={[...topRows, ...rowData]}
          totals={pinned[0] as GridRow}
          context={context}
          {...(openMember !== undefined ? { openMember } : {})}
          onOpen={(row) => open.current(row)}
        />
      )}
    </section>
  );

  return (
    <div
      className="fsr-grid"
      ref={wrap}
      data-testid="W-TR-05.grid"
      data-columns={set}
      data-pinned={topRows.length > 0 ? topRows.length : undefined}
    >
      {measured ? (
        <Suspense fallback={staticFrame}>
          <section className="fsr-grid__frame" aria-label={SPLIT.gridLabel}>
            <SplitAgGrid
              rowData={rowData}
              columnDefs={colDefs}
              pinnedTopRowData={topRows}
              pinnedBottomRowData={pinned}
              context={context}
              getRowId={rowId}
              rowClassRules={rowClassRules}
              onRowClicked={onRowClicked}
              onCellKeyDown={onCellKeyDown}
              defaultColDef={DEFAULT_COL}
              noRows={SPLIT.noMatch}
              onApi={onApi}
            />
          </section>
        </Suspense>
      ) : (
        staticFrame
      )}
    </div>
  );
}
