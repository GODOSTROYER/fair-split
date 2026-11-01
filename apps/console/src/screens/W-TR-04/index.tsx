// W-TR-04 By hand (S1.7): slip 0462's stained digit, the crop at three times, logbook page 14 as the second
// witness, one keystroke into the masked field or "Use logbook line 7", and the value in the treasurer's ink
// when the server confirms it. The screen is the season slice's (features/byhand); this module keeps the route
// contract (screens/contract.ts).

import { ByHand } from "../../features/byhand/ByHand.js";
import { gateBeds, SeasonGate } from "../../features/season/gate.js";
import type { ByHandScreenProps } from "../contract.js";

export function Screen({ seasonCode, slipNo }: ByHandScreenProps) {
  return (
    <SeasonGate id="W-TR-04" seasonCode={seasonCode} beds={gateBeds.byHand}>
      {(snapshot) => <ByHand snapshot={snapshot} serial={slipNo} />}
    </SeasonGate>
  );
}
