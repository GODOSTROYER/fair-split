// Factory helpers. Placeholder until the seed snapshot (IC-03, packages/seed/snapshot/season-2026A.json)
// is frozen on 24 Oct. No figure is ever hard-coded here; everything will be read from the snapshot.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEED_SNAPSHOT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../seed/snapshot/season-2026A.json",
);

export class SeedSnapshotUnavailableError extends Error {
  override name = "SeedSnapshotUnavailableError";
  constructor(readonly path: string) {
    super(`Seed snapshot not found at ${path}. It is produced by packages/seed (IC-03, frozen 24 Oct).`);
  }
}

export function hasSeedSnapshot(path = SEED_SNAPSHOT_PATH): boolean {
  return existsSync(path);
}

/** Reads the seed snapshot as untyped JSON. The typed shape comes from @fairsplit/contracts once frozen. */
export function loadSeedSnapshot(path = SEED_SNAPSHOT_PATH): unknown {
  if (!existsSync(path)) throw new SeedSnapshotUnavailableError(path);
  return JSON.parse(readFileSync(path, "utf8"));
}

export interface Factories {
  /** The raw snapshot the factories read from. */
  readonly snapshot: unknown;
}

/**
 * Builds factories over the seed snapshot. Today it only exposes the snapshot; member, run and line
 * builders land once the contracts and the snapshot are frozen.
 */
export function createFactories(path = SEED_SNAPSHOT_PATH): Factories {
  return { snapshot: loadSeedSnapshot(path) };
}
