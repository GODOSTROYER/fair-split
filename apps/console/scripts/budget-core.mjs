// S2.11's JavaScript budgets, measured over a Vite manifest (`dist/.vite/manifest.json`). A route's initial
// download is the entry's static import closure plus the route chunk's. A lazy chunk (AG Grid in Split review's
// SplitAgGrid) is measured on its own: its static closure minus everything the route already downloaded, so the
// route's own code is never counted as the grid's, nor the grid's as the route's. `size(file)` gives a file's
// gzipped bytes; only JavaScript counts.

/**
 * S2.11's Proof fonts (≤80 KB): the browser fetches the root's face as soon as the stylesheet applies, so a cold
 * Proof load must set `<html data-face="proof">` before that, or it fetches the console's 120 KB face too.
 * index.html loads `/face.js` for it: a classic, blocking, same-origin script (fs-api's CSP allows no inline
 * script) in `<head>`, ahead of every stylesheet and module script. Returns what breaks that, or null.
 */
export function faceScriptProblem(html) {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1];
  if (head === undefined) return "index.html has no <head>";
  const tags = [...head.matchAll(/<(script|link)\b([^>]*)>/gi)].map((m) => ({
    name: m[1].toLowerCase(),
    attrs: m[2],
  }));
  const face = tags.findIndex((t) => t.name === "script" && /\bsrc="\/face\.js"/.test(t.attrs));
  if (face < 0) return "index.html does not load /face.js in <head>";
  if (/\b(?:async|defer)\b|\btype="module"/.test(tags[face].attrs)) {
    return "/face.js must be a classic, blocking script (no async, defer or type=module)";
  }
  const first = tags.findIndex(
    (t) =>
      (t.name === "link" && /\brel="stylesheet"/.test(t.attrs)) ||
      (t.name === "script" && /\btype="module"/.test(t.attrs)),
  );
  if (first >= 0 && first < face) return "a stylesheet or module script comes before /face.js";
  return null;
}

/** The JS a chunk pulls in before it runs: itself and its static imports, transitively. */
export function closure(manifest, key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const next of chunk.imports ?? []) closure(manifest, next, seen);
  return seen;
}

export function entryKeyOf(manifest) {
  return Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith("index.html")) ?? null;
}

/** A route's lazy component chunk (TanStack Router's auto code splitting). */
export function routeChunkOf(manifest, route) {
  return Object.keys(manifest).find((k) => k.includes(route) && k.includes("tsr-split")) ?? null;
}

function bytes(manifest, keys, size) {
  let total = 0;
  for (const key of keys) {
    const file = manifest[key]?.file;
    if (file?.endsWith(".js")) total += size(file);
  }
  return total;
}

/**
 * One row per measurement: `{ name, bytes, limit }`, with `bytes` null when the chunk is missing from the build.
 * A budget's `lazy` (a source path, e.g. `src/features/split/SplitAgGrid.tsx`) adds a row for that chunk's own
 * download, limited by `lazyLimit`.
 */
export function measureBudgets(manifest, size, budgets) {
  const entryKey = entryKeyOf(manifest);
  if (!entryKey) throw new Error("No entry in dist/.vite/manifest.json: build the console first.");
  const entry = closure(manifest, entryKey);
  const rows = [];
  for (const b of budgets) {
    const key = routeChunkOf(manifest, b.route);
    if (!key) {
      rows.push({ name: b.name, bytes: null, limit: b.limit });
      continue;
    }
    const initial = closure(manifest, key, new Set(entry));
    rows.push({ name: b.name, bytes: bytes(manifest, initial, size), limit: b.limit });
    if (b.lazy) {
      const lazyKey = manifest[b.lazy] ? b.lazy : null;
      const own = lazyKey ? [...closure(manifest, lazyKey)].filter((k) => !initial.has(k)) : null;
      rows.push({ name: b.lazyName, bytes: own ? bytes(manifest, own, size) : null, limit: b.lazyLimit });
    }
  }
  return rows;
}
