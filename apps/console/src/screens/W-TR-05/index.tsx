// W-TR-05 Split review: SHELL PLACEHOLDER, replaced by the runs slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { SplitScreenProps } from "../contract.js";

export function Screen({ runSlug }: SplitScreenProps) {
  const s = useSnapshot().data;
  return (
    <ScreenPlaceholder
      id="W-TR-05"
      title="Split review"
      lede="Every member's line in one grid, held lines marked, the mass-balance dial above. Gross equals the pool, to the cent."
      mark={runSlug}
      markKind="slug"
      facts={
        s
          ? [
              { label: "Lines", value: String(s.figures.members) },
              { label: "Gross, the pool", value: format.money(s.figures.grossCents) },
              { label: "Shrink, counted once", value: s.figures.display.shrinkOnce ?? "" },
              {
                label: `By PayPal, ${s.figures.onRailMembers} members`,
                value: format.money(s.figures.onRailNetCents),
              },
            ]
          : []
      }
      provenance={s ? `Computed by engine v1, rate card ${s.figures.display.rc}. Seeded sample.` : undefined}
      beds="grid"
    />
  );
}
