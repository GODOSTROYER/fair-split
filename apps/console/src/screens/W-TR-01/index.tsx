// W-TR-01 Season: SHELL PLACEHOLDER, replaced by the season slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { SeasonScreenProps } from "../contract.js";

export function Screen({ seasonCode }: SeasonScreenProps) {
  const s = useSnapshot().data;
  return (
    <ScreenPlaceholder
      id="W-TR-01"
      title={`Season ${seasonCode}`}
      lede="The run strip from ratified to paid, the pools Lantern Bay funds, and the invoice plate that stays hollow until PayPal confirms it."
      mark={seasonCode}
      facts={
        s
          ? [
              { label: "Invoice", value: format.money(s.figures.invoiceCents), state: "hollow" },
              { label: "Premium, never deducted", value: format.money(s.figures.premiumPoolCents) },
              { label: "Quality bonus", value: format.money(s.figures.bonusPoolCents) },
              { label: "Disbursement", value: format.money(s.figures.disbursementCents) },
            ]
          : []
      }
      provenance={
        s ? `Seeded sample. Quote computed by engine v1, rate card ${s.figures.display.rc}.` : undefined
      }
      beds="season"
    />
  );
}
