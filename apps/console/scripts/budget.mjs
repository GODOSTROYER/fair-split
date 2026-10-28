// S2.11's JavaScript budgets, measured on a built console (`pnpm build`, then `pnpm budget`): for each route the
// initial download is the entry's static import closure plus the route chunk's, gzipped (level 9). Proof is a
// public, mobile-first page (≤110 KB gz); every console route ≤300 KB gz; AG Grid is Split review's own lazy
// chunk (SplitAgGrid, ≤300 KB gz), measured apart from the route's code. It reads dist/.vite/manifest.json,
// prints a table, and exits 1 when a budget breaks. The measuring is ./budget-core.mjs (tested by the console).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { measureBudgets } from "./budget-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));

const KB = 1000;
const gz = new Map();
function gzipped(file) {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file)), { level: 9 }).length);
  return gz.get(file);
}

const BUDGETS = [
  { name: "Proof /proof/:runSlug (initial JS)", route: "routes/proof/$runSlug.tsx", limit: 110 * KB },
  { name: "Judge stage /judge (initial JS)", route: "routes/_stage/judge.tsx", limit: 300 * KB },
  {
    name: "Split review (initial JS, AG Grid excluded)",
    route: "routes/_stage/runs/$runSlug/split.tsx",
    limit: 300 * KB,
    lazy: "src/features/split/SplitAgGrid.tsx",
    lazyName: "  AG Grid chunk (lazy)",
    lazyLimit: 300 * KB,
  },
];

let failed = false;
const rows = [["budget", "measured", "limit", ""]];
for (const m of measureBudgets(manifest, gzipped, BUDGETS)) {
  const ok = m.bytes !== null && m.bytes <= m.limit;
  failed ||= m.bytes !== null && !ok;
  const measured = m.bytes === null ? "no chunk" : `${(m.bytes / KB).toFixed(1)} KB`;
  rows.push([m.name, measured, `${m.limit / KB} KB`, m.bytes === null ? "?" : ok ? "ok" : "OVER"]);
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join("  "));
process.exit(failed ? 1 : 0);
