// Vite's `import.meta.glob`, which Vitest provides, typed for the one use tests make of it: reading
// this package's own sources as text. The domain package does no file IO (dependency-cruiser's
// domain-is-pure), so tests read sources through the bundler instead of node:fs.
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | readonly string[],
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, T>;
}
