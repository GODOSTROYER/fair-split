// S2.11's budget measurement (scripts/budget-core.mjs) over a manifest shaped like the console's build: Split
// review's initial JS counts the split route's own code, and the AG Grid row measures only the lazy SplitAgGrid
// chunk's own download (AG Grid and its theme), never the route chunk and never a chunk the route already loaded.
// And Proof's fonts: the built index.html flags Proof's face (/face.js) before any stylesheet or module script.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { faceScriptProblem, type Manifest, measureBudgets } from "../scripts/budget-core.mjs";

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

/** index.html as `vite build` writes it: the entry script, its preloads and the stylesheet end the <head>. */
function built(head: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    "    <title>Fair Split: co-op payroll</title>",
    head,
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    "  </body>",
    "</html>",
  ].join("\n");
}

const ENTRY = [
  '    <script type="module" crossorigin src="/assets/index-CEBgsz7u.js"></script>',
  '    <link rel="modulepreload" crossorigin href="/assets/jsx-runtime-de8dDx6i.js">',
  '    <link rel="stylesheet" crossorigin href="/assets/index-Dk3Lx9aZ.css">',
].join("\n");

const FACE = '    <script src="/face.js"></script>';

describe("S2.11 Proof's face, in the built index.html", () => {
  it("passes when /face.js is a classic, blocking script ahead of the stylesheet and the entry", () => {
    expect(faceScriptProblem(built(`${FACE}\n${ENTRY}`))).toBeNull();
    // The source: Vite writes the entry and the stylesheet after everything the source's <head> holds.
    expect(faceScriptProblem(readFileSync(resolve(process.cwd(), "index.html"), "utf8"))).toBeNull();
  });

  it("fails when the face script is missing, deferred, a module, or after the stylesheet", () => {
    expect(faceScriptProblem(built(ENTRY))).toMatch(/does not load \/face\.js/);
    for (const kind of ["defer", "async", 'type="module"']) {
      expect(faceScriptProblem(built(`    <script ${kind} src="/face.js"></script>\n${ENTRY}`))).toMatch(
        /classic, blocking/,
      );
    }
    expect(faceScriptProblem(built(`${ENTRY}\n${FACE}`))).toMatch(/before \/face\.js/);
    expect(faceScriptProblem(`<body>${FACE}</body>`)).toMatch(/<head>/);
  });
});
