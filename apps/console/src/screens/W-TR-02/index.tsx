// W-TR-02 Rate card (S1.7): BR 2026-04 as paper, Schedule A printed flat, the hash plate bolted, and MM-4
// Bolted when anyone tries to add a deduction mid-season. The screen is the season slice's
// (features/ratecard); this module keeps the route contract (screens/contract.ts).

import { RateCard } from "../../features/ratecard/RateCard.js";
import { gateBeds, SeasonGate } from "../../features/season/gate.js";
import type { SeasonScreenProps } from "../contract.js";

export function Screen({ seasonCode }: SeasonScreenProps) {
  return (
    <SeasonGate id="W-TR-02" seasonCode={seasonCode} beds={gateBeds.rateCard}>
      {(snapshot) => <RateCard snapshot={snapshot} />}
    </SeasonGate>
  );
}
