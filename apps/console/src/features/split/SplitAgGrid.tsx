// SplitGrid's AG Grid half (S2.7): AG Grid Community, its registered modules and its token theme (theme/grid.ts)
// live in this module's own chunk, loaded with React.lazy once the grid's container has a measured size (S2.11:
// the AG Grid chunk is lazy and at most 300 KB). The split screen's own code, its static table and its cell
// renderers never wait for it.

import type {
  CellKeyDownEvent,
  ColDef,
  FullWidthCellKeyDownEvent,
  GridApi,
  GridReadyEvent,
  IsFullWidthRowParams,
  RowClassRules,
  RowClickedEvent,
} from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { AgGridReact } from "ag-grid-react";
import { type ReactNode, useCallback, useEffect } from "react";
import { GRID_DEFAULTS, GRID_HEADER_PX, GRID_ROW_PX, gridTheme } from "../../theme/grid.js";
import type { GridContext, GridRow } from "./cells.js";

export interface SplitAgGridProps {
  readonly rowData: GridRow[];
  readonly columnDefs: ColDef<GridRow>[];
  readonly pinnedTopRowData: GridRow[];
  readonly pinnedBottomRowData: GridRow[];
  readonly context: GridContext;
  readonly getRowId: (p: { readonly data: GridRow }) => string;
  readonly rowClassRules: RowClassRules<GridRow>;
  readonly defaultColDef: ColDef<GridRow>;
  readonly onRowClicked: (e: RowClickedEvent<GridRow>) => void;
  readonly onCellKeyDown: (e: CellKeyDownEvent<GridRow> | FullWidthCellKeyDownEvent<GridRow>) => void;
  /** Printed when no line matches the filter. */
  readonly noRows: string;
  /** The grid's API once it is ready (J and K move through the rows with it), and null once it is gone. */
  readonly onApi: (api: GridApi<GridRow> | null) => void;
  /** Draws the inline hold note (a full-width row under H1). */
  readonly noteRenderer: (props: CustomCellRendererProps<GridRow>) => ReactNode;
}

/**
 * Every line stacks the member's name over their number, so the split's rows are DESIGN.md §4's 48 px (a table's
 * 40 px row, plus room for the second line; UI gate round 4), the header the grid's 36.
 */
const STACKED_ROW_PX = GRID_ROW_PX + 8;

/**
 * The hold notes under H1 and H2 and a narrow grid's opened line parts span the grid; every other row is cells. All
 * keep the split's one row height, so adding or removing one never changes another row's height (AG Grid would
 * redraw the rows, and a live wave would lose its slide).
 */
const isFullWidthRow = (p: IsFullWidthRowParams<GridRow>) => {
  const kind = p.rowNode.data?.kind;
  return kind === "note" || kind === "detail";
};

export function SplitAgGrid({ noRows, onApi, noteRenderer, ...props }: SplitAgGridProps) {
  const onGridReady = useCallback((e: GridReadyEvent<GridRow>) => onApi(e.api), [onApi]);
  useEffect(() => () => onApi(null), [onApi]);
  return (
    <AgGridReact<GridRow>
      {...props}
      theme={gridTheme}
      onGridReady={onGridReady}
      rowHeight={STACKED_ROW_PX}
      isFullWidthRow={isFullWidthRow}
      fullWidthCellRenderer={noteRenderer}
      headerHeight={GRID_HEADER_PX}
      suppressColumnVirtualisation
      ensureDomOrder
      enableBrowserTooltips
      overlayNoRowsTemplate={`<span class="fs-t-body">${noRows}</span>`}
      {...GRID_DEFAULTS}
    />
  );
}
