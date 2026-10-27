// W-TR-04 By hand: SHELL PLACEHOLDER, replaced by the season slice (SPLIT.md).

import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useSnapshot } from "../../data/hooks.js";
import type { ByHandScreenProps } from "../contract.js";

export function Screen({ seasonCode, slipNo }: ByHandScreenProps) {
  const s = useSnapshot().data;
  const slip = s?.slips.find((x) => x.serial === slipNo);
  const member = slip ? s?.members.find((m) => m.memberNo === slip.memberNo) : undefined;
  const logbook = s?.logbook.find((p) => p.lines.some((l) => l.serial === slipNo));
  const line = logbook?.lines.find((l) => l.serial === slipNo);
  return (
    <ScreenPlaceholder
      id="W-TR-04"
      title={`Slip ${slipNo}, by hand`}
      lede="One field at a time: the crop at three times its size, the logbook line beneath as a second witness, and one keystroke into the masked digit."
      mark={seasonCode}
      facts={[
        { label: "Member", value: member ? `${member.displayName}, ${member.memberNo}` : "Unknown slip" },
        ...(line && logbook
          ? [{ label: `Logbook page ${logbook.page}, line ${line.lineNo}`, value: `${line.netKgText} kg` }]
          : []),
      ]}
      provenance="The logbook is the clerk's ledger, photographed. Seeded sample."
      beds="focus"
    />
  );
}
