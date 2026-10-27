// W-JG-01's first view (S1.6, design §6 J1, plan "Judge Mode" step 0): "Season 2026-A is ready to pay." The
// twelve replay photos lie on the lacquer as a paper contact sheet, the bolted BR 2026-04 plate carries its
// hash, and the invoice plate holds Claude's recorded draft in pencil with US$4,333.50 hollow. Nothing here
// calls the API: the snapshot and the first view are built locally (S3.9). The single d2 slab is the first
// press: it starts the judge session, then records Lantern Bay's payment; MM-S plays when the invoice reads
// back as paid, on the event, never on the press.

import { webRoutes } from "@fairsplit/contracts";
import { Glyph, InkStamp, Slab, useT } from "@fairsplit/ui-web";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { useCommand, useJudgeSession, usePaypalRail, useStageRun } from "../../data/hooks.js";
import { atLeast } from "../../data/run-view.js";
import { env } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { useNextStep, usePrefocus } from "../../stage/context.js";
import { HashPlate } from "../ratecard/parts.js";
import { photoIsRead, replayPhotos } from "../reading/model.js";
import { FIRST_VIEW_COPY } from "../season/copy.js";
import { FundingBlock, useFundingMoment } from "../season/funding.js";
import { gateBeds, SeasonGate } from "../season/gate.js";
import { isFunded } from "../season/model.js";
import { ContactSheet, SeasonMark } from "../season/parts.js";
import "./judge.css";

export function FirstView() {
  return (
    <SeasonGate id="W-JG-01" beds={gateBeds.judge}>
      {() => <Desk />}
    </SeasonGate>
  );
}

type PressPhase = "idle" | "starting" | "recording" | "funded" | "failed";

function Desk() {
  const t = useT();
  const { runSlug, view, inSession, snapshot } = useStageRun();
  const session = useJudgeSession();
  const rail = usePaypalRail() ?? env.paypalRail;
  const markPaid = useCommand("markPaid");
  const moment = useFundingMoment(inSession ? runSlug : null, view);
  const next = useNextStep();
  const slabArea = useRef<HTMLDivElement>(null);
  // The slab is remounted (at rest) after a failure, so the judge can press again.
  const [attempt, setAttempt] = useState(0);
  const [pressed, setPressed] = useState(false);

  const funded = isFunded(view);
  const movedOn = inSession && view !== undefined && atLeast(view, "FUNDED");
  const sessionFailed = session.status === "failed";
  const commandFailed = markPaid.isError;

  useEffect(() => {
    if (!pressed || (!sessionFailed && !commandFailed)) return;
    setPressed(false);
    setAttempt((a) => a + 1);
  }, [pressed, sessionFailed, commandFailed]);

  // After Reset the first view returns: the slab is pressable again.
  useEffect(() => {
    if (inSession || session.status !== "none") return;
    setPressed(false);
    markPaid.reset();
  }, [inSession, session.status, markPaid.reset]);

  usePrefocus(slabArea, "W-JG-01", !pressed && !movedOn);

  if (!snapshot) return null;
  const season = snapshot.season.label;
  const label = t("W-JG-01.markPaid");
  const cents = snapshot.run.invoice.amountCents;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER");
  const photos = replayPhotos(snapshot);
  const readPhotos = new Set(
    photos.filter((photo) => photoIsRead({ view, snapshot, photo })).map((p) => p.photoId),
  );

  const phase: PressPhase = funded
    ? "funded"
    : session.status === "starting"
      ? "starting"
      : pressed || markPaid.isPending || (inSession && markPaid.isSuccess)
        ? "recording"
        : sessionFailed || commandFailed
          ? "failed"
          : "idle";

  const statusLine: Readonly<Record<PressPhase, string | null>> = {
    idle: null,
    starting: FIRST_VIEW_COPY.starting,
    recording: FIRST_VIEW_COPY.pending,
    funded: FIRST_VIEW_COPY.funded,
    failed: null,
  };

  const start = async () => {
    setPressed(true);
    try {
      const started = await session.start();
      markPaid.mutate({ params: { runSlug: started.runSlug }, body: {} });
    } catch {
      // A failed start shows on the stage's own strip, with its request ID and "Try again".
    }
  };

  let slab: ReactNode;
  if (movedOn && !pressed) {
    // Returning to a run that is already funded: the press is spent, drawn flush and still.
    slab = (
      <Slab
        label={label}
        srLabel={`${label}. ${FIRST_VIEW_COPY.movedOn}`}
        depth="d2"
        tone="chalk"
        testId="W-JG-01.markPaid"
        frame={{ state: "committed", travel: 5 }}
        onCommit={() => undefined}
      />
    );
  } else {
    slab = (
      <Slab
        key={attempt}
        label={label}
        srLabel={`${label}, ${format.amountSpoken(cents, "en")}, ${FIRST_VIEW_COPY.srConsequence}`}
        depth="d2"
        tone="chalk"
        testId="W-JG-01.markPaid"
        onCommit={() => void start()}
      />
    );
  }

  const status = statusLine[phase];
  const action = (
    <div className="fsc-first__action" ref={slabArea} data-testid="W-JG-01.action" data-state={phase}>
      <div className="fsc-first__slab">
        {slab}
        {(pressed || movedOn) && treasurer && (
          <span className="fsc-first__stamp fs-t-caption">
            <InkStamp
              stamp={{
                initials: treasurer.initials,
                name: treasurer.name,
                at: view?.lastEventAt
                  ? format.time(view.lastEventAt)
                  : FIRST_VIEW_COPY.stamp(treasurer.shortName),
              }}
            />
            {FIRST_VIEW_COPY.stamp(treasurer.shortName)}
          </span>
        )}
      </div>
      {status ? (
        <p className="fsc-first__status fs-t-label" role="status" data-testid="W-JG-01.status">
          <Glyph name={phase === "funded" ? "ms:check" : "rail"} size={16} />
          <span>{status}</span>
          {phase === "funded" && next && next.id !== "mark-paid" && (
            <AppLink href={next.to} className="fs-link" data-testid="W-JG-01.continue">
              {FIRST_VIEW_COPY.openNext}
            </AppLink>
          )}
        </p>
      ) : (
        <p className="fsc-first__note fs-t-caption">
          {movedOn ? FIRST_VIEW_COPY.movedOn : FIRST_VIEW_COPY.pressNote(rail)}
        </p>
      )}
      <CommandNotice error={markPaid.error} testId="W-JG-01.error" />
    </div>
  );

  return (
    <ScreenRoot
      id="W-JG-01"
      state={inSession ? "session" : "ready"}
      labelledBy="fsc-first-title"
      className="fsc-first"
    >
      <header className="fsc-first__head">
        <div className="fsc-first__titles">
          <SeasonMark snapshot={snapshot} testId="W-JG-01.mark" />
          <h1 id="fsc-first-title" className="fs-t-title-1 fsc-first__title">
            {t("W-JG-01.ready", { season })}
          </h1>
          <p className="fsc-first__lede">
            {FIRST_VIEW_COPY.lede(snapshot.figures.members, snapshot.lot.buyer)}
          </p>
        </div>
        <div className="fsc-first__rules">
          <HashPlate snapshot={snapshot} testId="W-JG-01.rules" compact />
          <AppLink href={webRoutes.rateCard(season)} className="fs-link fs-t-caption fsc-first__rules-link">
            {FIRST_VIEW_COPY.openCard}
          </AppLink>
        </div>
      </header>

      <FundingBlock
        snapshot={snapshot}
        view={view}
        moment={moment}
        rail={rail}
        layout="row"
        screen="W-JG-01"
        totalRole="amount-hero"
        action={action}
        compact
      />

      <section className="fsc-first__desk" aria-labelledby="fsc-first-desk" data-testid="W-JG-01.desk">
        <header className="fsc-first__desk-head">
          <h2 id="fsc-first-desk" className="fsc-section-title fs-t-label">
            {FIRST_VIEW_COPY.desk}
          </h2>
          <p className="fs-t-caption fsc-first__desk-note">{FIRST_VIEW_COPY.deskNote(photos.length)}</p>
        </header>
        <ContactSheet
          snapshot={snapshot}
          photos={photos}
          readPhotos={readPhotos}
          hrefFor={(photo) => webRoutes.reading(season, photo)}
          testId="W-JG-01.photos"
          columns={6}
        />
      </section>
    </ScreenRoot>
  );
}
