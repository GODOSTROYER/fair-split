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
  RowClassRules,
  RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect } from "react";
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
}

export function SplitAgGrid({ noRows, onApi, ...props }: SplitAgGridProps) {
  const onGridReady = useCallback((e: GridReadyEvent<GridRow>) => onApi(e.api), [onApi]);
  useEffect(() => () => onApi(null), [onApi]);
  return (
    <AgGridReact<GridRow>
      {...props}
      theme={gridTheme}
      onGridReady={onGridReady}
      rowHeight={GRID_ROW_PX}
      headerHeight={GRID_HEADER_PX}
      suppressColumnVirtualisation
      ensureDomOrder
      enableBrowserTooltips
      overlayNoRowsTemplate={`<span class="fs-t-body">${noRows}</span>`}
      {...GRID_DEFAULTS}
    />
  );
}
