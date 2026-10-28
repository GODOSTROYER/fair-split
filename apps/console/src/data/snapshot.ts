// IC-03: "Screens, mocks, the README and the film read its snapshot; no one hard-codes a figure." The
// showcase snapshot is the screens' read model until the API exposes season and run reads (a pending
// IC-08 addition). It is loaded lazily, validated once by @fairsplit/seed, and labelled `seeded`.

import type { SeasonSnapshot } from "@fairsplit/contracts";

let loading: Promise<SeasonSnapshot> | null = null;

/** The one season the seed ships. */
export const SHOWCASE_SEASON = "2026-A";

export class UnknownSeasonError extends Error {
  override readonly name = "UnknownSeasonError";
}

/** Loads the seeded season (a separate chunk, so the first paint does not wait on 700 KB of JSON). */
export async function loadSnapshot(season: string = SHOWCASE_SEASON): Promise<SeasonSnapshot> {
  if (season !== SHOWCASE_SEASON) throw new UnknownSeasonError(`No season ${season} in the seed.`);
  loading ??= import("@fairsplit/api-client/seed").then((seed) => seed.getSnapshot());
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}
