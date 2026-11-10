// SplitGrid (S2.7, S1.7 W-TR-05): every member line in AG Grid Community, themed from the tokens. Ten columns by
// default (minimum confidence waits behind "All columns": sixty of the 64 lines were read earlier and have none);
// five in a narrow container (Member, Verified kg, Net, Rail, Status), and four beside an open drawer (Member, Net,
// Rail, Status), so the money, its rail and its state read at every width and Status always reads whole. The lines a person must still decide are pinned above the rest, in the order the run
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
import type { CustomCellRendererProps } from "ag-grid-react";
import { lazy, type RefObject, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusAndReveal } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useShortcut } from "../../lib/shortcuts.js";
import { NARROW_GRID_PX } from "../../stage/layout.js";
import {
  BonusCell,
  ConfidenceCell,
  CreditCell,
  type DetailRow,
  DetailView,
  ExpandCell,
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
import { type HoldNoteRow, HoldNoteView, holdNote } from "./HoldNote.js";
import type { SplitRow, SplitTotals } from "./model.js";
import { StaticTable } from "./StaticTable.js";
import { en, SPLIT } from "./shared/copy.js";

/** AG Grid and its theme, in their own chunk (S2.11): fetched only once a container is measured. */
const SplitAgGrid = lazy(() => import("./SplitAgGrid.js").then((m) => ({ default: m.SplitAgGrid })));

export type GridColumn =
  | "expand"
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

/**
 * S1.6: five columns when the container is under 1,180 px. Member, Net, Rail and Status hold at every desktop width
 * (UI gate round 1): the money, how it travels and its state; the other figures wait behind "Columns".
 */
export const NARROW_COLUMNS: readonly GridColumn[] = ["member", "kg", "net", "rail", "status"];
/** Beside an open drawer (a 560 px drawer pushes the grid under 760 px): Status keeps its words whole. */
export const SLIM_COLUMNS: readonly GridColumn[] = ["member", "net", "rail", "status"];
export const SLIM_BELOW_PX = 760;

/** The grid's column set: every column, the default ten, five in a narrow container, four beside a drawer. */
export type ColumnSet = "all" | "default" | "narrow" | "slim";

/** A set that hides the line's parts (premium, bonus, deductions) opens them under a line instead (round 3). */
export function opensParts(set: ColumnSet): boolean {
  return set === "narrow" || set === "slim";
}

/**
 * Columns whose every value is zero say nothing (round 3): Credit hides until a credit is applied or waits for
 * its hold. Every other money column always carries figures.
 */
export function zeroColumns(lines: readonly SplitRow[], totals: SplitTotals): ReadonlySet<GridColumn> {
  const credit = totals.creditsCents !== 0 || lines.some((r) => r.creditsCents !== 0 || r.pendingCredit);
  return new Set<GridColumn>(credit ? [] : ["credit"]);
}

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
/**
 * The set a container gets. `defaultFits` is the width the default set needs once its all-zero columns hide (round
 * 3): a container that holds it keeps every part in its columns (the 1,470 px laptop), and only a narrower one opens
 * a line's parts under it (the 1,280 px laptop).
 */
export function columnSetFor(width: number, showAll: boolean, defaultFits?: number): ColumnSet {
  if (showAll) return "all";
  if (width > 0 && width < SLIM_BELOW_PX) return "slim";
  if (width > 0 && width < NARROW_GRID_PX && !(defaultFits !== undefined && width >= defaultFits))
    return "narrow";
  return "default";
}

/** The grid's own chrome beside its columns: the vertical scrollbar and the wrapper's two borders. */
const GRID_CHROME_PX = 24;

/** The width a set of columns needs at their minimum (fixed widths, or a flex column's floor). */
export function minWidthOf(defs: readonly ColDef<GridRow>[]): number {
  return defs.reduce((sum, d) => sum + (d.width ?? d.minWidth ?? 0), GRID_CHROME_PX);
}

const lineOf = (row: GridRow | undefined): SplitRow | null => (row && row.kind === "line" ? row : null);

/** The lines with the inline hold note placed right under the held line it is about. */
function withNote(lines: readonly GridRow[], note: HoldNoteRow | null): GridRow[] {
  if (!note) return [...lines];
  const at = lines.findIndex((r) => r.kind === "line" && r.memberNo === note.forMember);
  if (at < 0) return [...lines];
  return [...lines.slice(0, at + 1), note, ...lines.slice(at + 1)];
}

/** Each opened line followed by its calculation (a full-width row), in a set that hides the line's parts. */
function withDetails(lines: readonly GridRow[], open: ReadonlySet<string>): GridRow[] {
  if (open.size === 0) return [...lines];
  return lines.flatMap((r): GridRow[] => {
    if (r.kind !== "line" || !open.has(r.memberNo)) return [r];
    const detail: DetailRow = {
      kind: "detail",
      memberNo: `${r.memberNo}:detail`,
      forMember: r.memberNo,
      line: r,
    };
    return [r, detail];
  });
}

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
    // A narrow grid's opener for a line's hidden parts: its header's words are for screen readers only.
    expand: {
      colId: "expand",
      headerName: SPLIT.partsColumn,
      headerClass: "fsr-ag-expand-head",
      cellRenderer: ExpandCell,
      width: 44,
      pinned: "left",
      lockPinned: true,
      cellClass: "fsr-ag-expand",
    },
    member: {
      colId: "member",
      headerName: en("W-TR-05.col.member"),
      cellRenderer: MemberCell,
      flex: 1.5,
      minWidth: 148,
      pinned: "left",
      lockPinned: true,
    },
    // The count alone, and room for the carbon-copy chip ("0457 ×2") beside it.
    slips: { colId: "slips", headerName: en("W-TR-05.col.slips"), cellRenderer: SlipsCell, width: 112 },
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
    // The console is English (round 3): "Deductions", never the Cebuano "Kaltas".
    kaltas: {
      colId: "kaltas",
      headerName: SPLIT.deductionsColumn,
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
    // The money column says its currency (round 3); the footer beneath it is the members' net total.
    net: { ...num, colId: "net", headerName: SPLIT.netColumn, cellRenderer: NetCell, width: 104 },
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

/**
 * In the five-column set Verified kg keeps a fixed width, so Member, Net and Status take the slack and no empty
 * band opens beside it (1,470 px). `flex: null` clears the default set's flex: AG Grid keeps a stateful attribute
 * that a new definition leaves undefined.
 */
export const NARROW_FIXED: Partial<Record<GridColumn, ColDef<GridRow>>> = {
  kg: { width: 150, flex: null, minWidth: undefined },
};

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
  const defs = useMemo(() => columnDefs(context.premiumRate), [context.premiumRate]);
  // Columns whose every value is zero are hidden (Credit, until a credit applies or waits).
  const hidden = useMemo(() => zeroColumns([...decisions, ...rows], totals), [decisions, rows, totals]);
  const defaultFits = useMemo(
    () => minWidthOf(DEFAULT.filter((c) => !hidden.has(c)).map((c) => defs[c])),
    [defs, hidden],
  );
  const set: ColumnSet = columns ?? columnSetFor(width, showAll, defaultFits);
  const parts = opensParts(set);
  const colDefs = useMemo(
    () =>
      [...(parts ? (["expand"] as const) : []), ...SETS[set]]
        .filter((c) => !hidden.has(c))
        .map((c) => (set === "narrow" ? { ...defs[c], ...NARROW_FIXED[c] } : defs[c])),
    [defs, set, parts, hidden],
  );
  // A narrow grid opens a line's hidden parts under it (round 3). Lines opened stay open across filters; a wider
  // grid shows every part in its columns, so nothing opens there.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const openParts = useMemo<ReadonlySet<string>>(() => (parts ? opened : new Set()), [parts, opened]);
  const toggleDetail = useCallback((memberNo: string) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(memberNo)) next.delete(memberNo);
      else next.add(memberNo);
      return next;
    });
  }, []);
  const gridContext = useMemo<GridContext>(() => ({ ...context, toggleDetail }), [context, toggleDetail]);
  // One grid row per line object: an unchanged line keeps its row, so AG Grid refreshes only the lines that moved.
  // An opened line is a row of its own (its chevron's state is its data), so AG Grid redraws that line alone.
  const wrapped = useRef(new WeakMap<SplitRow, GridRow>());
  const expandedRows = useRef(new WeakMap<SplitRow, GridRow>());
  const wrap1 = useCallback(
    (r: SplitRow): GridRow => {
      const expanded = openParts.has(r.memberNo);
      const cache = expanded ? expandedRows.current : wrapped.current;
      let row = cache.get(r);
      if (!row) {
        row = expanded ? { kind: "line" as const, ...r, expanded: true } : { kind: "line" as const, ...r };
        cache.set(r, row);
      }
      return row;
    },
    [openParts],
  );
  // The H1 note sits under its held line while that hold is open (the drawer stays the only place to decide).
  // The held lines may be pinned above the others as decisions: the note follows H1 wherever it is.
  const note = useMemo(
    () => holdNote([...decisions, ...rows], context.slip),
    [decisions, rows, context.slip],
  );
  // An opened line's parts sit right under it, before H1's note.
  const rowData = useMemo<GridRow[]>(
    () => withDetails(withNote(rows.map(wrap1), note), openParts),
    [rows, wrap1, note, openParts],
  );
  const topRows = useMemo<GridRow[]>(
    () => withDetails(withNote(decisions.map(wrap1), note), openParts),
    [decisions, wrap1, note, openParts],
  );
  const pinned = useMemo<GridRow[]>(
    () => [{ kind: "totals" as const, memberNo: "totals" as const, ...totals }],
    [totals],
  );
  const open = useRef(onOpen);
  open.current = onOpen;
  // The note's renderer is one stable function: a new fullWidthCellRenderer would make AG Grid redraw every row,
  // and a live wave would lose its slide. It reads the latest lines through a ref.
  const lines = useRef<readonly SplitRow[]>([]);
  lines.current = [...decisions, ...rows];
  const openNote = useCallback((n: HoldNoteRow) => {
    const row = lines.current.find((r) => r.memberNo === n.forMember);
    if (row) open.current(row);
  }, []);
  const noteRenderer = useCallback(
    (p: CustomCellRendererProps<GridRow>) =>
      // A full-width row is still a row: its content sits in one gridcell (axe aria-required-children), focusable by
      // script like AG Grid's own cells (tabindex -1).
      p.data?.kind === "note" ? (
        // biome-ignore lint/a11y/useSemanticElements: AG Grid's rows are divs; a <td> cannot sit in a div row.
        <div role="gridcell" tabIndex={-1} className="fsr-note__cell">
          <HoldNoteView note={p.data} onOpen={() => openNote(p.data as HoldNoteRow)} />
        </div>
      ) : p.data?.kind === "detail" ? (
        // biome-ignore lint/a11y/useSemanticElements: AG Grid's rows are divs; a <td> cannot sit in a div row.
        <div role="gridcell" tabIndex={-1} className="fsr-detail__cell">
          <DetailView detail={p.data} />
        </div>
      ) : null,
    [openNote],
  );

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
      "fsr-row--note": (p) => p.data?.kind === "note",
      "fsr-row--detail": (p) => p.data?.kind === "detail",
      "fsr-row--decision": (p) => p.node.rowPinned === "top",
    }),
    [openMember],
  );

  // A click on a line's parts opener only opens its parts (AG Grid hears the row's click before React does).
  const onRowClicked = useCallback((e: RowClickedEvent<GridRow>) => {
    const target = e.event?.target;
    if (target instanceof Element && target.closest(".fsr-expand")) return;
    const row = lineOf(e.data);
    if (row) open.current(row);
  }, []);

  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<GridRow> | FullWidthCellKeyDownEvent<GridRow>) => {
      const key = (e.event as KeyboardEvent | null | undefined)?.key;
      // On the opener's cell, Enter and Space open or close the line's parts.
      if ("column" in e && e.column?.getColId() === "expand" && (key === "Enter" || key === " ")) {
        const line = lineOf(e.data ?? undefined);
        if (line) {
          (e.event as KeyboardEvent | null | undefined)?.preventDefault();
          toggleDetail(line.memberNo);
        }
        return;
      }
      if (key !== "Enter") return;
      const row = lineOf(e.data ?? undefined);
      if (row) open.current(row);
    },
    [toggleDetail],
  );

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
          context={gridContext}
          {...(openMember !== undefined ? { openMember } : {})}
          onOpen={(row) => open.current(row)}
          onOpenNote={openNote}
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
      data-pinned={decisions.length > 0 ? decisions.length : undefined}
    >
      {measured ? (
        <Suspense fallback={staticFrame}>
          <section className="fsr-grid__frame" aria-label={SPLIT.gridLabel}>
            <SplitAgGrid
              rowData={rowData}
              columnDefs={colDefs}
              pinnedTopRowData={topRows}
              pinnedBottomRowData={pinned}
              context={gridContext}
              getRowId={rowId}
              rowClassRules={rowClassRules}
              onRowClicked={onRowClicked}
              onCellKeyDown={onCellKeyDown}
              defaultColDef={DEFAULT_COL}
              noRows={SPLIT.noMatch}
              onApi={onApi}
              noteRenderer={noteRenderer}
            />
          </section>
        </Suspense>
      ) : (
        staticFrame
      )}
    </div>
  );
}
