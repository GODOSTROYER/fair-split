// W-TR-03 Reading room (S1.7): photos A to L on the filmstrip, the photo on the bench, the print beds, and
// MM-2 "Paper prints itself" as each `extract.row` of the recorded run lands. The screen is the season slice's
// (features/reading); this module keeps the route contract (screens/contract.ts).

import { ReadingRoom } from "../../features/reading/ReadingRoom.js";
import { gateBeds, SeasonGate } from "../../features/season/gate.js";
import type { ReadingScreenProps } from "../contract.js";

export function Screen({ seasonCode, photo }: ReadingScreenProps) {
  return (
    <SeasonGate id="W-TR-03" seasonCode={seasonCode} beds={gateBeds.reading}>
      {(snapshot) => <ReadingRoom snapshot={snapshot} requested={photo} />}
    </SeasonGate>
  );
}
