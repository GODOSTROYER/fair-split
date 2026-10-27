// W-OP-01 Ops: SHELL PLACEHOLDER, replaced by the proof slice (SPLIT.md). Read-only for judges.

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { Wordmark } from "../../chrome/Wordmark.js";
import type { OpsScreenProps } from "../contract.js";

export function Screen(_props: OpsScreenProps) {
  return (
    <div className="fsc-ops">
      <Wordmark />
      <ScreenPlaceholder
        id="W-OP-01"
        title="Ops"
        lede="Health checks, the outbox, PayPal's notices and the three kill switches, with the treasurer's key registration. Read-only for judges."
        beds="ops"
      />
    </div>
  );
}
