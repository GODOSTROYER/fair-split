// The reading room's two person-sized steps (S1.7 W-TR-03), each a d1 slab under the print beds (one at a time,
// so the screen never holds more than one slab):
//   `confirm-one`: "Claude's zoom read agrees with one of the two readings." One tap confirms the zoom's value:
//      `POST /v1/holds/:holdId/resolve {resolution: CONFIRM_AS_READ}` on the run's own LOW_CONFIDENCE hold for
//      the slip, and the value prints in the confirmer's ink with their stamp when `hold.resolved` arrives.
//   `blurred`: "Photo E is too blurred to read. Ask Jessie to rescan." "Request rescan" sends the request to the
//      clerk's phone; IC-01 has no route for it yet (reported to WS-API and WS-CORE), so the slab stands
//      unavailable and says so, and nothing pretends to have been sent.

import { webRoutes } from "@fairsplit/contracts";
import { Glyph, Slab } from "@fairsplit/ui-web";
import { useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { useCommand } from "../../data/hooks.js";
import type { RunHold } from "../../data/run-view.js";
import { READING_COPY } from "./copy.js";
import type { ReadingRow, ZoomAgreed } from "./model.js";
import "./reading.css";

/** Why the tap can't be taken yet, or undefined when it can. */
export function confirmUnavailable(hold: RunHold | undefined, inSession: boolean): string | undefined {
  if (!inSession) return READING_COPY.confirmNoSession;
  if (!hold) return READING_COPY.confirmNoHold;
  if (hold.state !== "OPEN") return READING_COPY.confirmDecided;
  return undefined;
}

export function ConfirmZoomRead({
  season,
  row,
  agreed,
  hold,
  inSession,
  testId,
}: {
  readonly season: string;
  readonly row: ReadingRow;
  readonly agreed: ZoomAgreed;
  readonly hold: RunHold | undefined;
  readonly inSession: boolean;
  readonly testId: string;
}) {
  // A refused tap puts the slab back at rest (remounted), so it can be pressed again.
  const [attempt, setAttempt] = useState(0);
  const resolve = useCommand("resolveHold", { onError: () => setAttempt((a) => a + 1) });
  const unavailable = confirmUnavailable(hold, inSession);
  const label = READING_COPY.confirm(agreed.value);
  return (
    <section
      className="fsc-read__act"
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      data-state={resolve.isPending ? "pending" : "open"}
    >
      <h2 id={`${testId}-title`} className="fsc-read__act-title fs-t-label">
        <Glyph name="pencil" size={16} />
        {READING_COPY.confirmTitle(row.serial, READING_COPY.field[agreed.field] ?? agreed.field)}
      </h2>
      <p className="fsc-read__act-line fs-t-figure">
        {READING_COPY.confirmReads(agreed.display, agreed.value)}
      </p>
      <div className="fsc-read__act-press">
        <Slab
          key={attempt}
          label={label}
          srLabel={READING_COPY.confirmSr(agreed.value, row.serial)}
          depth="d1"
          tone="chalk"
          testId={`${testId}.confirm`}
          {...(unavailable ? { unavailableReason: unavailable } : {})}
          onCommit={() => {
            if (!hold || unavailable) return;
            resolve.mutate({ params: { holdId: hold.holdId }, body: { resolution: "CONFIRM_AS_READ" } });
          }}
        />
        <AppLink href={webRoutes.byHand(season, row.serial)} className="fs-link fs-t-label">
          {READING_COPY.confirmByHand}
        </AppLink>
      </div>
      <CommandNotice error={resolve.error} testId={`${testId}.error`} />
    </section>
  );
}

export function RequestRescan({
  photoId,
  clerk,
  testId,
}: {
  readonly photoId: string;
  readonly clerk: string;
  readonly testId: string;
}) {
  return (
    <section className="fsc-read__act" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`} className="fsc-read__act-title fs-t-label">
        <Glyph name="ms:visibility" size={16} />
        {READING_COPY.rescanTitle(photoId)}
      </h2>
      <p className="fsc-read__act-line fs-t-caption">{READING_COPY.rescanLine(clerk)}</p>
      <div className="fsc-read__act-press">
        <Slab
          label={READING_COPY.rescan}
          srLabel={READING_COPY.rescanSr(photoId, clerk)}
          depth="d1"
          tone="chalk"
          testId={`${testId}.rescan`}
          unavailableReason={READING_COPY.rescanUnavailable(clerk)}
          onCommit={() => undefined}
        />
      </div>
    </section>
  );
}
