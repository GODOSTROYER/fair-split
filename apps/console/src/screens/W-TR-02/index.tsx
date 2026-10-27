// W-TR-02 Rate card: SHELL PLACEHOLDER, replaced by the season slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { SeasonScreenProps } from "../contract.js";

export function Screen(_props: SeasonScreenProps) {
  const s = useSnapshot().data;
  const card = s?.rateCard;
  return (
    <ScreenPlaceholder
      id="W-TR-02"
      title="Rate card"
      lede="The Board's resolution as paper, Schedule A printed flat beside it, and the hash plate bolted down. Adding a deduction is refused, citing the hash."
      mark={card ? `sha256 ${format.hashGroups(card.sha256)}` : undefined}
      markKind="slug"
      facts={
        card
          ? [
              { label: "Resolution", value: card.canonical.resolutionNo, state: "ink" },
              { label: "Ratified", value: format.date(card.canonical.ratifiedOn), state: "ink" },
              { label: "Rules", value: String(card.canonical.terms.length), state: "ink" },
            ]
          : []
      }
      provenance="Read by Claude (claude-opus-5-5), ratified by the Secretary and the Chair. Seeded sample."
      beds="plates"
    />
  );
}
