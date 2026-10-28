// S2.11's budget measurement (scripts/budget-core.mjs) over a manifest shaped like the console's build: Split
// review's initial JS counts the split route's own code, and the AG Grid row measures only the lazy SplitAgGrid
// chunk's own download (AG Grid and its theme), never the route chunk and never a chunk the route already loaded.

import { describe, expect, it } from "vitest";
import { type Manifest, measureBudgets } from "../scripts/budget-core.mjs";

const manifest: Manifest = {
  "index.html": { file: "assets/index.js", isEntry: true, imports: ["_react.js"] },
  "_react.js": { file: "assets/react.js" },
  "_format.js": { file: "assets/format.js" },
  "src/routes/_stage/runs/$runSlug/split.tsx?tsr-split=component": {
    file: "assets/split.js",
    isDynamicEntry: true,
    imports: ["index.html", "_format.js"],
    dynamicImports: ["src/features/split/SplitAgGrid.tsx"],
  },
  "src/features/split/SplitAgGrid.tsx": {
    file: "assets/SplitAgGrid.js",
    isDynamicEntry: true,
    imports: ["_ag-grid.js", "_format.js", "index.html"],
  },
  "_ag-grid.js": { file: "assets/ag-grid.js" },
  "src/styles.css": { file: "assets/index.css" },
};

const SIZE: Readonly<Record<string, number>> = {
  "assets/index.js": 100,
  "assets/react.js": 50,
  "assets/format.js": 7,
  "assets/split.js": 30,
  "assets/SplitAgGrid.js": 4,
  "assets/ag-grid.js": 200,
  "assets/index.css": 999,
};

describe("S2.11 budgets", () => {
  it("counts the split route's own code as the route's, and measures AG Grid's lazy chunk on its own", () => {
    const rows = measureBudgets(manifest, (file) => SIZE[file] ?? 0, [
      {
        name: "Split review",
        route: "routes/_stage/runs/$runSlug/split.tsx",
        limit: 300,
        lazy: "src/features/split/SplitAgGrid.tsx",
        lazyName: "AG Grid chunk (lazy)",
        lazyLimit: 300,
      },
    ]);
    expect(rows).toEqual([
      // The entry (100 + 50), the route chunk (30) and its own import (7): CSS never counts.
      { name: "Split review", bytes: 187, limit: 300 },
      // SplitAgGrid (4) and AG Grid (200): not the route, not format.js, which the route already loaded.
      { name: "AG Grid chunk (lazy)", bytes: 204, limit: 300 },
    ]);
  });

  it("says when a chunk is not in the build", () => {
    const rows = measureBudgets(manifest, () => 1, [
      { name: "Gone", route: "routes/gone.tsx", limit: 1 },
      {
        name: "Split review",
        route: "routes/_stage/runs/$runSlug/split.tsx",
        limit: 300,
        lazy: "src/features/split/Missing.tsx",
        lazyName: "lazy",
        lazyLimit: 1,
      },
    ]);
    expect(rows[0]).toEqual({ name: "Gone", bytes: null, limit: 1 });
    expect(rows[2]).toEqual({ name: "lazy", bytes: null, limit: 1 });
  });
});
