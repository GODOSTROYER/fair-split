// Types for budget-core.mjs (the console's tests import it).

export interface ManifestChunk {
  readonly file: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
}

export type Manifest = Readonly<Record<string, ManifestChunk>>;

export interface Budget {
  readonly name: string;
  /** The route's source path, as the manifest keys it (e.g. `routes/proof/$runSlug.tsx`). */
  readonly route: string;
  readonly limit: number;
  /** A lazy chunk the route loads, measured on its own (its source path as the manifest keys it). */
  readonly lazy?: string;
  readonly lazyName?: string;
  readonly lazyLimit?: number;
}

export interface Measured {
  readonly name: string;
  /** Gzipped JavaScript bytes, or null when the chunk is not in the build. */
  readonly bytes: number | null;
  readonly limit: number;
}

/** What keeps index.html from flagging Proof's face before its stylesheet applies (`/face.js`), or null. */
export function faceScriptProblem(html: string): string | null;
export function closure(manifest: Manifest, key: string, seen?: Set<string>): Set<string>;
export function entryKeyOf(manifest: Manifest): string | null;
export function routeChunkOf(manifest: Manifest, route: string): string | null;
export function measureBudgets(
  manifest: Manifest,
  size: (file: string) => number,
  budgets: readonly Budget[],
): Measured[];
