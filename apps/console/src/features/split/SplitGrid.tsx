// SplitGrid (S2.7, S1.7 W-TR-05): every member line in AG Grid Community, themed from the tokens. Ten columns by
// default (minimum confidence waits behind "All columns": sixty of the 64 lines were read earlier and have none);
// five in a narrow container (Member, Verified kg, Net, Rail, Status), and four beside an open drawer (Member, Net,
// Rail, Status), so the money, its rail and its state read at every width and Status always reads whole. The lines
// a person must still decide are pinned above the rest, in the order the run pill walks them, and the totals are
// pinned beneath. Round 5: the lines between rest on whole rows (./whole-rows.ts), a 24 px fade above the total
// while more lie below; the number columns share the room Deductions leaves (it stops at 180 px); no rule beside
// Member; the scrollbar overlays the lines, so every row ends on the header's edge; a narrow grid gives the hold
// notes' rows to the lines. A row opens its hold (W-TR-06) or its line (W-TR-09) on click or Enter. AG Grid is its
// own lazy chunk (./SplitAgGrid.tsx, with theme/grid.ts): it loads once the container has a size, and the static
// table prints the lines until it has.

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
  duplicateLook,
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
import { type HoldNoteRow, HoldNoteView, holdNotes } from "./HoldNote.js";
import type { SplitRow, SplitTotals } from "./model.js";
import { StaticTable } from "./StaticTable.js";
import { en, SPLIT } from "./shared/copy.js";
import { useWholeRows } from "./whole-rows.js";

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
export type ColumnSet = "all" | "default" | "compact" | "narrow" | "slim";

/**
 * A set that hides the line's parts (premium, bonus, deductions) opens them under a line instead (round 3). Beside
 * an open drawer (slim) the drawer shows the line, and the opener's 44 px would push Status past the grid's edge
 * (round 4: nothing clipped), so only the narrow set has it.
 */
export function opensParts(set: ColumnSet): boolean {
  return set === "narrow";
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
export function columnSetFor(
  width: number,
  showAll: boolean,
  defaultFits?: number,
  compactFits?: number,
): ColumnSet {
  if (showAll) return "all";
  if (width > 0 && width < SLIM_BELOW_PX) return "slim";
  if (width > 0 && width < NARROW_GRID_PX && !(defaultFits !== undefined && width >= defaultFits))
    // Round 6: the 1,280 px laptop keeps the line's evidence in its columns (premium, bonus, deductions) at their
    // compact widths; only a container too narrow even for those opens a line's parts under it.
    return compactFits !== undefined && width >= compactFits ? "compact" : "narrow";
  return "default";
}

/**
 * The grid's own chrome beside its columns: the wrapper's two borders and a margin for the overlay scrollbar (the
 * lines' scrollbar overlays them, round 5, so the columns fill the width).
 */
const GRID_CHROME_PX = 24;

/** The width a set of columns needs at their minimum (fixed widths, or a flex column's floor). */
export function minWidthOf(defs: readonly ColDef<GridRow>[]): number {
  return defs.reduce((sum, d) => sum + (d.width ?? d.minWidth ?? 0), GRID_CHROME_PX);
}

const lineOf = (row: GridRow | undefined): SplitRow | null => (row && row.kind === "line" ? row : null);

/** The lines with each inline hold note placed right under the held line it is about. */
function withNotes(lines: readonly GridRow[], notes: readonly HoldNoteRow[]): GridRow[] {
  if (notes.length === 0) return [...lines];
  return lines.flatMap((r): GridRow[] => {
    if (r.kind !== "line") return [r];
    const note = notes.find((n) => n.forMember === r.memberNo);
    return note ? [r, note] : [r];
  });
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

/**
 * Slips is as wide as its badge needs: "0457 ×2" fits the count's column, "0457 counted once" (round 4) takes 48 px
 * more, and only once a line shows it, so the default set still fits the 1,470 px laptop before then.
 */
export const SLIPS_PX = { count: 112, countedOnce: 176 } as const;

/**
 * Deductions holds its chips ("CBU −1.37", a second chip at most) and never grows past 180 px (round 5): the width
 * the panel has beyond the columns' floors spreads across the number columns instead, so no dead gap opens between
 * Deductions and Net at 1,920.
 */
export const DEDUCTIONS_PX = { min: 128, max: 180 } as const;

/** Member is pinned (it stays put as a narrow grid scrolls sideways): a name's width, the same in every set. */
export const MEMBER_PX = 184;

/**
 * The compact set's floors (round 7): the 1,280 px laptop's 910 px holds a whole name (Member keeps its width), the
 * kilos, the premium, the deductions, a credit, the net, the rail and the state. Bonus waits behind "Columns" (the
 * total still sums it). Beside a drawer the slim set takes the same floors.
 */
export const COMPACT_PX = {
  kg: 88,
  premium: 88,
  deductions: 112,
  credit: 104,
  net: 100,
  rail: 80,
  status: 116,
} as const;

/** Net never grows past this (round 6), so no wide gap opens between Deductions and Net at 1,920. */
export const NET_MAX_PX = 136;

function columnDefs(
  premiumRate: string,
  slipsWide: boolean,
  compact = false,
): Record<GridColumn, ColDef<GridRow>> {
  // A number column (rounds 4 and 5): right-aligned tabular figures, its floor its old fixed width, and a share of
  // the room left over, so the figures sit evenly across the row.
  const num = { type: "rightAligned", cellClass: "fsr-ag-num", flex: 1 } as const;
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
    // Pinned, so it never flexes (AG Grid flexes the scrolling columns only): one fixed width that holds a name.
    member: {
      colId: "member",
      headerName: en("W-TR-05.col.member"),
      cellRenderer: MemberCell,
      width: MEMBER_PX,
      pinned: "left",
      lockPinned: true,
    },
    // The count alone, and room for the duplicate badge beside it ("0457 ×2", then "0457 counted once").
    slips: {
      colId: "slips",
      headerName: en("W-TR-05.col.slips"),
      cellRenderer: SlipsCell,
      width: slipsWide ? SLIPS_PX.countedOnce : SLIPS_PX.count,
    },
    kg: {
      ...num,
      colId: "kg",
      headerName: en("W-TR-05.col.kg"),
      cellRenderer: KgCell,
      minWidth: compact ? COMPACT_PX.kg : 112,
    },
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
      minWidth: compact ? COMPACT_PX.premium : 92,
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
      minWidth: 84,
    },
    // The console is English (round 3): "Deductions", never the Cebuano "Kaltas".
    kaltas: {
      colId: "kaltas",
      headerName: SPLIT.deductionsColumn,
      cellRenderer: KaltasCell,
      flex: 1,
      minWidth: compact ? COMPACT_PX.deductions : DEDUCTIONS_PX.min,
      maxWidth: DEDUCTIONS_PX.max,
    },
    credit: {
      ...num,
      colId: "credit",
      headerName: en("W-TR-05.col.credit"),
      cellRenderer: CreditCell,
      // Room for a credit that waits for its hold ("Waits for H3") as well as the figure.
      minWidth: compact ? COMPACT_PX.credit : 120,
    },
    // The money column says its currency (round 3); the footer beneath it is the members' net total.
    net: {
      ...num,
      colId: "net",
      headerName: SPLIT.netColumn,
      cellRenderer: NetCell,
      minWidth: compact ? COMPACT_PX.net : 104,
      maxWidth: NET_MAX_PX,
    },
    rail: {
      colId: "rail",
      headerName: en("W-TR-05.col.rail"),
      cellRenderer: RailCell,
      width: compact ? COMPACT_PX.rail : 84,
    },
    status: {
      colId: "status",
      headerName: en("W-TR-05.col.status"),
      cellRenderer: StatusCell,
      minWidth: compact ? COMPACT_PX.status : 152,
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

/** The 1,280 px laptop (round 7): a whole name and the money's parts; the slip count and Bonus wait behind "Columns". */
export const COMPACT_COLUMNS: readonly GridColumn[] = [
  "member",
  "kg",
  "premium",
  "kaltas",
  "credit",
  "net",
  "rail",
  "status",
];

const SETS: Readonly<Record<ColumnSet, readonly GridColumn[]>> = {
  all: ALL,
  default: DEFAULT,
  compact: COMPACT_COLUMNS,
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
  const slipsWide = useMemo(
    () => [...decisions, ...rows].some((r) => duplicateLook(r)?.state === "once"),
    [decisions, rows],
  );
  const defs = useMemo(() => columnDefs(context.premiumRate, slipsWide), [context.premiumRate, slipsWide]);
  // Columns whose every value is zero are hidden (Credit, until a credit applies or waits).
  const hidden = useMemo(() => zeroColumns([...decisions, ...rows], totals), [decisions, rows, totals]);
  const defaultFits = useMemo(
    () => minWidthOf(DEFAULT.filter((c) => !hidden.has(c)).map((c) => defs[c])),
    [defs, hidden],
  );
  const compactDefs = useMemo(() => columnDefs(context.premiumRate, false, true), [context.premiumRate]);
  const compactFits = useMemo(
    () => minWidthOf(COMPACT_COLUMNS.filter((c) => !hidden.has(c)).map((c) => compactDefs[c])),
    [compactDefs, hidden],
  );
  const set: ColumnSet = columns ?? columnSetFor(width, showAll, defaultFits, compactFits);
  const parts = opensParts(set);
  const colDefs = useMemo(
    () =>
      [...(parts ? (["expand"] as const) : []), ...SETS[set]]
        .filter((c) => !hidden.has(c))
        .map((c) => (set === "compact" || set === "slim" ? compactDefs[c] : defs[c])),
    [defs, compactDefs, set, parts, hidden],
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
  // H1's and H2's notes sit under their held lines while those holds are open (the drawer stays the only place to
  // decide). The held lines may be pinned above the others as decisions: each note follows its line wherever it is.
  // A narrow grid (the 1,280 px laptop, or beside a drawer) gives their rows to the lines (round 5): the held line's
  // status says "Held H1" and the bench links the next hold.
  // Round 7: the 1,280 px laptop (the compact set) keeps them: the evidence and its "Open H1" are why the screen
  // exists; only the slim and narrow sets (beside a drawer) give their rows to the lines.
  const roomy = set === "default" || set === "all" || set === "compact";
  const notes = useMemo(
    () => (roomy ? holdNotes([...decisions, ...rows], context.yieldLimit, context.slip) : []),
    [roomy, decisions, rows, context.yieldLimit, context.slip],
  );
  // An opened line's parts sit right under it, before its hold's note.
  const rowData = useMemo<GridRow[]>(
    () => withDetails(withNotes(rows.map(wrap1), notes), openParts),
    [rows, wrap1, notes, openParts],
  );
  const topRows = useMemo<GridRow[]>(
    () => withDetails(withNotes(decisions.map(wrap1), notes), openParts),
    [decisions, wrap1, notes, openParts],
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

  // The lines rest on whole rows between the pinned head and the total (round 5): the frame is sized once AG Grid has
  // drawn, and again whenever the panel, the pinned decisions or the lines change.
  const { style: frameStyle, remeasure } = useWholeRows(wrap, rowData.length, measured);
  const gridApi = useRef<GridApi<GridRow> | null>(null);
  const onApi = useCallback(
    (api: GridApi<GridRow> | null) => {
      gridApi.current = api;
      if (api) requestAnimationFrame(() => remeasure());
    },
    [remeasure],
  );
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
          <section className="fsr-grid__frame fsc-snap" aria-label={SPLIT.gridLabel} style={frameStyle}>
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
            {/* A 24 px plate fade under the head and above the total, only where more lines lie beyond. */}
            <span className="fsc-snap__fade" data-edge="start" aria-hidden />
            <span className="fsc-snap__fade" data-edge="end" aria-hidden />
          </section>
        </Suspense>
      ) : (
        staticFrame
      )}
    </div>
  );
}
