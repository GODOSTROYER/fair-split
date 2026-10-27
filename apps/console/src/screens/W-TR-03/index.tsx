// W-TR-03 Reading room: SHELL PLACEHOLDER, replaced by the season slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import type { ReadingScreenProps } from "../contract.js";

export function Screen({ seasonCode, photo }: ReadingScreenProps) {
  const s = useSnapshot().data;
  const replay = s?.photos.filter((p) => p.set === "REPLAY") ?? [];
  return (
    <ScreenPlaceholder
      id="W-TR-03"
      title="Reading room"
      lede={
        photo
          ? `Photo ${photo} on the bench. Each slip prints into its bed as its row is read; doubt goes to a person.`
          : "The photos on the bench, read twice by Claude. Each slip prints into its bed as its row is read; doubt goes to a person."
      }
      mark={seasonCode}
      facts={[
        { label: "Photos in the replay", value: String(replay.length) },
        { label: "Slips", value: String(s?.slips.filter((x) => x.replaySet).length ?? 0) },
        { label: "Read earlier this season", value: String((s?.photos.length ?? 0) - replay.length) },
      ]}
      provenance="Read by Claude (claude-opus-5-5), replay of a recorded run. Amounts are computed by the engine, never by the model."
      beds="split"
    />
  );
}
