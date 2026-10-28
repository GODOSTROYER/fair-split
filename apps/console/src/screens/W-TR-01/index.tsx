// W-TR-01 Season (S1.7): the stencilled season, the run strip, the invoice Claude drafted beside the pool it
// funds, and MM-S when the invoice reads back as paid. The screen is the season slice's (features/season);
// this module keeps the route contract (screens/contract.ts).

import { SeasonScreen } from "../../features/season/SeasonScreen.js";
import type { SeasonScreenProps } from "../contract.js";

export function Screen({ seasonCode }: SeasonScreenProps) {
  return <SeasonScreen seasonCode={seasonCode} />;
}
