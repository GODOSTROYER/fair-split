// W-JG-01 Judge stage, first view: SHELL PLACEHOLDER, replaced by the season slice (SPLIT.md). It already
// starts a judge session on the first press (createJudgeSession, then markPaid) so the shell's data path,
// SSE stream, run pill and ribbon can be exercised end to end before the real first view lands.

import { Slab, useT } from "@fairsplit/ui-web";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ScreenPlaceholder } from "../../chrome/ScreenPlaceholder.js";
import { useCommand, useJudgeSession, useSnapshot } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import type { JudgeScreenProps, StageExtrasProps } from "../contract.js";

export function Screen(_props: JudgeScreenProps) {
  const t = useT();
  const snapshot = useSnapshot().data;
  const session = useJudgeSession();
  const markPaid = useCommand("markPaid");
  const season = snapshot?.season.label ?? "";
  const label = t("W-JG-01.markPaid");
  const pressed = session.status === "starting" || session.status === "active";
  const start = async () => {
    try {
      const started = await session.start();
      markPaid.mutate({ params: { runSlug: started.runSlug }, body: {} });
    } catch {
      // A failed start shows on the stage's own strip, with its request ID and "Try again".
    }
  };
  const invoice = snapshot ? format.money(snapshot.run.invoice.amountCents) : "";
  return (
    <ScreenPlaceholder
      id="W-JG-01"
      title={t("W-JG-01.ready", { season })}
      lede="Mark Lantern Bay's invoice paid to start the run. The slips wait on the desk; Claude's reading replays once the money is in."
      mark={season}
      facts={
        snapshot
          ? [
              { label: "Invoice", value: invoice, state: "hollow" },
              {
                label: "Photos to read",
                value: String(snapshot.photos.filter((p) => p.set === "REPLAY").length),
              },
              { label: "Members", value: String(snapshot.figures.members) },
            ]
          : []
      }
      provenance="Seeded sample. The invoice stays hollow until PayPal confirms it."
      beds="stage"
    >
      <div className="fsc-ph__action">
        <Slab
          label={label}
          srLabel={`${label}, ${invoice}, changes a line`}
          depth="d2"
          tone="chalk"
          testId="W-JG-01.markPaid"
          unavailableReason={pressed ? "The run has started." : undefined}
          onCommit={() => void start()}
        />
        <CommandNotice error={markPaid.error} testId="W-JG-01.error" />
      </div>
    </ScreenPlaceholder>
  );
}

/** Always mounted inside the stage: "Play it for me", its cursor and "Try to break it" go here (ChromePortal). */
export function StageExtras(_props: StageExtrasProps) {
  return null;
}
