// The rate card's ID in the judge session's own workspace. A judge workspace is a clone of the showcase, and the
// clone mints its own rate card ID, so the seed's ID is not this workspace's: fs-api looks the card up in the
// workspace first and answers 404 before the ratified-card trigger can refuse (MM-4). The season read
// (GET /v1/seasons/:seasonCode, fs-api's SeasonView) names it. When the read is not there (an older API), the
// seed's ID is the best guess, and the server's answer is shown as it is.

import { z } from "zod";
import type { DataAdapter } from "../../data/adapter.js";

/** The part of fs-api's SeasonView the console reads (the rest is not relied on). */
const SeasonCardRead = z.looseObject({
  rateCard: z.looseObject({ id: z.string().min(1) }).nullable(),
});

export const SEASON_PATH = "/v1/seasons/:seasonCode";

export async function workspaceRateCardId(
  adapter: DataAdapter,
  seasonLabel: string,
  fallback: string,
): Promise<string> {
  try {
    const season = await adapter.api.request({
      path: SEASON_PATH,
      params: { seasonCode: seasonLabel },
      schema: SeasonCardRead,
      name: "season",
    });
    return season.rateCard?.id ?? fallback;
  } catch {
    return fallback;
  }
}
