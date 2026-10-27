// W-BR-01 Proof with the brand header, entered by the signed brand link: SHELL PLACEHOLDER, replaced by the
// proof slice (SPLIT.md). The token is never shown, logged or kept in history.

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import type { BrandEntryProps } from "../contract.js";

export function Screen(_props: BrandEntryProps) {
  const s = useSnapshot().data;
  return (
    <ScreenPlaceholder
      id="W-BR-01"
      title={s ? `Proof for ${s.payer.shortName}` : "Proof for the brand"}
      lede="The brand's view of Proof: the invoice status strip, member names and masked emails under the data-sharing agreement, and the export with hashes."
      mark={s?.lot.lotCode}
      beds="proof"
    />
  );
}
