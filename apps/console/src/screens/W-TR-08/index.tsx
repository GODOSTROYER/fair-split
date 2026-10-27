// W-TR-08 Run, fan-out and log: SHELL PLACEHOLDER, replaced by the runs slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useRunView, useSnapshot } from "../../data/hooks.js";
import { itemCounts } from "../../data/run-view.js";
import type { RunScreenProps } from "../contract.js";

export function Screen({ runSlug }: RunScreenProps) {
  const s = useSnapshot().data;
  const view = useRunView(runSlug).data;
  const counts = view ? itemCounts(view) : { total: 0, confirmed: 0 };
  const parked = view ? Object.values(view.items).filter((i) => i.status === "UNCLAIMED").length : 0;
  return (
    <ScreenPlaceholder
      id="W-TR-08"
      title="Run"
      lede="The split fan: PayPal threads drawn to 70% on the 201 and finished only by PayPal's notice, the cash band beside them, then the log in three lanes."
      mark={runSlug}
      markKind="slug"
      facts={[
        { label: "Items", value: String(counts.total || (s?.run.items.length ?? 0)) },
        {
          label: "Confirmed by PayPal",
          value: `${counts.confirmed} of ${counts.total || (s?.run.items.length ?? 0)}`,
        },
        { label: "Parked", value: String(parked) },
      ]}
      provenance="Live from the run's event stream."
      beds="fan"
    />
  );
}
