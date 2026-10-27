// W-TR-06 Hold drawer: SHELL PLACEHOLDER, replaced by the runs slice (SPLIT.md). The split route renders it
// beside W-TR-05 while `?hold=` is set; the shared StageDrawer gives it the stage's push or overlay frame.

import { HOLD_GATE_LABELS, HOLD_KIND_LABELS, pickLabel } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { StageDrawer } from "../../chrome/StageDrawer.js";
import { useSnapshot } from "../../data/hooks.js";
import type { HoldDrawerProps } from "../contract.js";

export function Screen({ runSlug, holdId }: HoldDrawerProps) {
  const navigate = useNavigate();
  const s = useSnapshot().data;
  const hold = s?.holds.find((h) => h.label === holdId || h.key === holdId);
  const close = () => void navigate({ to: "/runs/$runSlug/split", params: { runSlug }, search: {} });
  return (
    <StageDrawer
      label={hold ? `Hold ${hold.label}` : `Hold ${holdId}`}
      meta={hold ? pickLabel(HOLD_GATE_LABELS[hold.gate], "en") : null}
      onClose={close}
      testId="W-TR-06.drawer"
    >
      <ScreenRoot
        id="W-TR-06"
        state="placeholder"
        className="fsc-ph fsc-ph--drawer"
        labelledBy="W-TR-06-title"
      >
        <header className="fsc-ph__head">
          <p className="fsc-ph__slug fs-t-hash">
            {hold ? `${hold.label}, ${pickLabel(HOLD_KIND_LABELS[hold.kind], "en")}` : holdId}
          </p>
          <h2 id="W-TR-06-title" className="fs-t-title-2">
            {hold ? hold.engineLine : "No hold with that name in this run."}
          </h2>
          {hold?.claudeLine && (
            <p className="fsc-ph__pencil">
              <Glyph name="pencil" size={16} />
              <span>Claude: {hold.claudeLine}</span>
            </p>
          )}
        </header>
        <div className="fsc-ph__beds" aria-hidden>
          <PrintBed shape="photo" height={180} />
          <PrintBed shape="line" count={3} />
          <PrintBed shape="slab" />
        </div>
        <p className="fsc-ph__note fs-t-caption" data-slice="runs">
          The hold card prints here: the engine's line, Claude's line in pencil, the evidence, the gate and
          one slab.
        </p>
      </ScreenRoot>
    </StageDrawer>
  );
}
