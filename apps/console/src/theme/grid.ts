// AG Grid Community 36.2.0 for Split review (W-TR-05, the runs slice), themed from the tokens (S2.7 SplitGrid):
// both modes come from @fairsplit/tokens/ag-grid, and <html data-ag-theme-mode> picks fs-tablea or fs-adlaw.
// Import this module only from features/split/SplitAgGrid.tsx, so AG Grid stays in its own lazy chunk (S2.11: the AG
// Grid chunk is lazy and at most 300 KB). Never jade as the accent; never a slab in a row.

import { TWEENS } from "@fairsplit/motion";
import { fsGridModes, fsGridTheme } from "@fairsplit/tokens/ag-grid";
import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  type GridOptions,
  HighlightChangesModule,
  ModuleRegistry,
  PinnedRowModule,
  RowApiModule,
  RowStyleModule,
  ScrollApiModule,
  TooltipModule,
  themeQuartz,
  ValidationModule,
} from "ag-grid-community";

// Only the modules Split review uses, not AllCommunityModule (filters, editors, export, pagination...), so the
// route's chunk stays inside the S2.11 budget: client-side rows and their API (row count, focus, scrolling to a
// row), the pinned totals row, row and cell classes (the canary hold rule, figures), header and cell tooltips, and
// the change wash. A grid option whose module is missing is reported by ValidationModule, which is registered in
// development and tests only and never ships.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  ScrollApiModule,
  PinnedRowModule,
  RowStyleModule,
  CellStyleModule,
  TooltipModule,
  HighlightChangesModule,
  ...(import.meta.env.PROD ? [] : [ValidationModule]),
]);

/** The console's grid theme; pass it as `<AgGridReact theme={gridTheme}>`. */
export const gridTheme = fsGridTheme(themeQuartz);

export { fsGridModes };

/**
 * S2.7's grid options for every console grid: no row animation, and the change wash timed by @fairsplit/motion
 * (150 ms in, 450 ms out). Rows that PayPal changed wash jade; rows the engine changed wash pencil: set
 * `--fs-flash` per row from `RunLine.changedBy` with `cellClassRules`.
 */
export const GRID_DEFAULTS = {
  animateRows: false,
  cellFlashDuration: TWEENS.flash.ms,
  cellFadeDuration: TWEENS.flashFade.ms,
  suppressCellFocus: false,
} as const satisfies GridOptions;

/** Row and header heights the grid tokens set (design §2.4: rows 40 px, headers 36 px). */
export const GRID_ROW_PX = 40;
export const GRID_HEADER_PX = 36;
