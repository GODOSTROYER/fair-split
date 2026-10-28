// S2.11's JavaScript budgets, measured on a built console (`pnpm build`, then `pnpm budget`): for each route the
// initial download is the entry's static import closure plus the route chunk's, gzipped (level 9). Proof is a
// public, mobile-first page (≤110 KB gz); every console route ≤300 KB gz; AG Grid lives in Split review's own
// lazy chunk (≤300 KB gz). It reads dist/.vite/manifest.json, prints a table, and exits 1 when a budget breaks.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));

const KB = 1000;
const gz = new Map();
function gzipped(file) {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file)), { level: 9 }).length);
  return gz.get(file);
}

/** The JS a chunk pulls in before it runs: itself and its static imports, transitively. */
function closure(key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const next of chunk.imports ?? []) closure(next, seen);
  return seen;
}

function bytes(keys) {
  let total = 0;
  for (const key of keys) {
    const file = manifest[key]?.file;
    if (file?.endsWith(".js")) total += gzipped(file);
  }
  return total;
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith("index.html"));
if (!entryKey) throw new Error("No entry in dist/.vite/manifest.json: build the console first.");
const entry = closure(entryKey);

/** A route's lazy component chunk (TanStack Router's auto code splitting). */
function routeChunk(route) {
  return Object.keys(manifest).find((k) => k.includes(route) && k.includes("tsr-split"));
}

const BUDGETS = [
  { name: "Proof /proof/:runSlug (initial JS)", route: "routes/proof/$runSlug.tsx", limit: 110 * KB },
  { name: "Judge stage /judge (initial JS)", route: "routes/_stage/judge.tsx", limit: 300 * KB },
  {
    name: "Split review (initial JS, AG Grid excluded)",
    route: "routes/_stage/runs/$runSlug/split.tsx",
    limit: 300 * KB,
    grid: true,
  },
];

let failed = false;
const rows = [["budget", "measured", "limit", ""]];
for (const b of BUDGETS) {
  const key = routeChunk(b.route);
  if (!key) {
    rows.push([b.name, "no chunk", `${b.limit / KB} KB`, "?"]);
    continue;
  }
  const keys = closure(key, new Set(entry));
  const total = bytes(keys) - (b.grid ? gzipped(manifest[key].file) : 0);
  const ok = total <= b.limit;
  failed ||= !ok;
  rows.push([b.name, `${(total / KB).toFixed(1)} KB`, `${b.limit / KB} KB`, ok ? "ok" : "OVER"]);
  if (b.grid) {
    const grid = gzipped(manifest[key].file);
    const gridOk = grid <= 300 * KB;
    failed ||= !gridOk;
    rows.push(["  AG Grid chunk (lazy)", `${(grid / KB).toFixed(1)} KB`, "300 KB", gridOk ? "ok" : "OVER"]);
  }
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join("  "));
process.exit(failed ? 1 : 0);
