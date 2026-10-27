// W-TR-07 Approve: SHELL PLACEHOLDER, replaced by the runs slice (SPLIT.md).

import { Seal } from "@fairsplit/ui-web";
import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { RunScreenProps } from "../contract.js";

export function Screen({ runSlug }: RunScreenProps) {
  const s = useSnapshot().data;
  const f = s?.figures;
  return (
    <ScreenPlaceholder
      id="W-TR-07"
      title="Approve"
      lede="One column: the seal grown from the batch hash, the batch in pencil, why it is safe, and the one slab that moves money. Two keys sign it."
      mark={runSlug}
      markKind="slug"
      facts={
        f
          ? [
              { label: `${f.batchItemCount} payouts by PayPal`, value: format.money(f.batchTotalCents) },
              { label: `${f.cashMembers} in cash at the bodega`, value: format.money(f.cashNetCents) },
            ]
          : []
      }
      provenance={
        s ? `Batch ${format.hashGroups(s.run.batchSha256)}, the showcase run. Seeded sample.` : undefined
      }
      beds="column"
    >
      {s && (
        <div className="fsc-ph__seal" aria-hidden>
          <Seal batchSha256={s.run.batchSha256} size={160} keys={0} />
        </div>
      )}
    </ScreenPlaceholder>
  );
}
