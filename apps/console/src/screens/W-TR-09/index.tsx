// W-TR-09 Member line (in the stage drawer while `?member=` is set) and the 80 mm print: SHELL PLACEHOLDERS,
// replaced by the runs slice (SPLIT.md).

import { useNavigate } from "@tanstack/react-router";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { StageDrawer } from "../../chrome/StageDrawer.js";
import { useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { MemberLineProps, PrintScreenProps } from "../contract.js";

export function Screen({ runSlug, memberNo }: MemberLineProps) {
  const navigate = useNavigate();
  const s = useSnapshot().data;
  const member = s?.members.find((m) => m.memberNo === memberNo);
  const line = s?.checkpoints.resolved.lines.find((l) => l.memberNo === memberNo);
  const close = () => void navigate({ to: "/runs/$runSlug/split", params: { runSlug }, search: {} });
  return (
    <StageDrawer
      label={member ? `${member.displayName}'s line` : `Line ${memberNo}`}
      meta={memberNo}
      onClose={close}
      testId="W-TR-09.drawer"
    >
      <ScreenRoot
        id="W-TR-09"
        state="placeholder"
        className="fsc-ph fsc-ph--drawer"
        labelledBy="W-TR-09-title"
      >
        <header className="fsc-ph__head">
          <h2 id="W-TR-09-title" className="fs-t-title-2">
            {member?.displayName ?? "No member with that number."}
          </h2>
          {line && (
            <p className="fsc-ph__figure fs-t-amount-l" data-amount-state="pencil">
              {format.money(line.netCents)}
            </p>
          )}
        </header>
        <div className="fsc-ph__beds" aria-hidden>
          <PrintBed shape="block" height={56} />
          <PrintBed shape="line" count={4} />
          <PrintBed shape="block" height={96} />
        </div>
        <p className="fsc-ph__note fs-t-caption" data-slice="runs">
          The member line prints here: the ReceiptBar, the slips with crops, the line's history and an SMS
          preview, not sent.
        </p>
      </ScreenRoot>
    </StageDrawer>
  );
}

export function PrintScreen({ runSlug, memberNo }: PrintScreenProps) {
  const s = useSnapshot().data;
  const member = s?.members.find((m) => m.memberNo === memberNo);
  return (
    <ScreenPlaceholder
      id="W-TR-09"
      title={member ? `Statement for ${member.displayName}` : `Statement ${memberNo}`}
      lede="An 80 mm statement for the bodega: exact pesos at the run's rate, the seal in black, a QR to the member's link, and a Nadawat box."
      mark={runSlug}
      markKind="slug"
      beds="print"
    />
  );
}
