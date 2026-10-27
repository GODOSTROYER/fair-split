// W-PF-01 Proof: SHELL PLACEHOLDER, replaced by the proof slice (SPLIT.md). Public, Adlaw only, member IDs
// never names (C-23).

import { translate } from "@fairsplit/i18n";
import { Seal } from "@fairsplit/ui-web";
import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { ProofScreenProps } from "../contract.js";

export function Screen({ runSlug }: ProofScreenProps) {
  const s = useSnapshot().data;
  return (
    <ScreenPlaceholder
      id="W-PF-01"
      title={
        s
          ? translate("en", "W-PF-01.heroMarked", {
              amount: format.money(s.figures.invoiceCents),
              season: s.season.label,
            })
          : "Proof"
      }
      lede={translate("en", "W-PF-01.tagline")}
      mark={s?.lot.lotCode}
      facts={
        s
          ? [
              {
                label: "Lines explained",
                value: `${s.figures.members} of ${s.figures.members}`,
                state: "ink",
              },
              { label: "On PayPal", value: s.figures.display.proofShare ?? "", state: "ink" },
              { label: "Kept for members", value: format.money(s.figures.redirectedCents), state: "ink" },
            ]
          : []
      }
      provenance={`Run ${runSlug}. Six plates, each checked again in your browser.`}
      beds="proof"
    >
      {s && (
        <div className="fsc-ph__seal" aria-hidden>
          <Seal batchSha256={s.run.batchSha256} size={200} keys={2} />
        </div>
      )}
    </ScreenPlaceholder>
  );
}
