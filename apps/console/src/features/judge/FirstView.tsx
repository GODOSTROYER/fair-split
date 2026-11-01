// W-JG-01's first view (S1.6, design §6 J1, plan "Judge Mode" step 0): "Season 2026-A is ready to pay." It
// leads with paper on lacquer (design §1, signature 1): the twelve replay photos lie as a contact sheet beside
// the invoice plate, under the pool's one-line strip, with the evidence shadow, inside the first screen. The
// bolted BR 2026-04 plate carries its hash, and the invoice plate holds Claude's recorded draft in pencil with
// US$4,333.50 hollow. Nothing here calls the API: the snapshot and the first view are built locally (S3.9).
// The single d2 slab is the first press: it starts the judge session, then records Lantern Bay's payment; MM-S
// plays when the invoice reads back as paid, on the event, never on the press, and the title says it's funded.

import { PAY_RUN_RANK, type PayRunState, webRoutes } from "@fairsplit/contracts";
import { Glyph, Slab, useT } from "@fairsplit/ui-web";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Stamp } from "../../chrome/Stamp.js";
import { isApiClientError } from "../../data/errors.js";
import { useCommand, useJudgeSession, usePaypalRail, useStageRun } from "../../data/hooks.js";
import { atLeast } from "../../data/run-view.js";
import { env } from "../../lib/env.js";
import { useFocusAfterRemoval } from "../../lib/focus.js";
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

/** The run states in which the press records Lantern Bay's payment (DRAFT and QUOTED only after a deadline). */
const AWAITS_PAYMENT: ReadonlySet<string> = new Set(["DRAFT", "QUOTED", "INVOICED"]);

/** FUNDED or later on the way to payroll: a resumed run there reads back as funded once its stream replays. */
function reachedFunding(state: PayRunState): boolean {
  return PAY_RUN_RANK[state] < 99 && PAY_RUN_RANK[state] >= PAY_RUN_RANK.FUNDED;
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
  // One press at a time: while it waits for the session's invoice and the payment's answer, another press (a
  // second click, autoplay's next tick) records nothing twice.
  const inFlight = useRef(false);

  const funded = isFunded(view);
  const movedOn = inSession && view !== undefined && atLeast(view, "FUNDED");
  const sessionFailed = session.status === "failed";
  const commandFailed = markPaid.isError;

  // A press that is spent: ui-web's Slab stays committed once pressed, until it is remounted at rest (a new key).
  const spent = useRef(false);
  const rest = useCallback(() => {
    spent.current = false;
    setPressed(false);
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!pressed || (!sessionFailed && !commandFailed)) return;
    rest();
  }, [pressed, sessionFailed, commandFailed, rest]);

  // After Reset (or a session the server ended) the first view returns: the slab is pressable again. A press still
  // spent (the judge still on /judge) is remounted at rest; one a failure already put back at rest stays as it is,
  // with the focus Reset handed it.
  useEffect(() => {
    if (inSession || (session.status !== "none" && session.status !== "ended")) return;
    setPressed(false);
    markPaid.reset();
    if (spent.current) rest();
  }, [inSession, session.status, markPaid.reset, rest]);

  usePrefocus(slabArea, "W-JG-01", !pressed && !movedOn);
  // The slab remounted at rest (above, or after a failure) takes the focus the spent one held, in that commit.
  const [actionEl, setActionEl] = useState<HTMLDivElement | null>(null);
  const actionRef = useCallback((el: HTMLDivElement | null) => {
    slabArea.current = el;
    setActionEl(el);
  }, []);
  useFocusAfterRemoval(actionEl, () => actionEl?.querySelector<HTMLElement>(".fs-slab__face") ?? null);

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
    if (inFlight.current || markPaid.isPending) return;
    inFlight.current = true;
    try {
      await press();
    } finally {
      inFlight.current = false;
    }
  };
  const press = async () => {
    // This press owns the command's answer from here: an earlier press's error must not read as this one's and
    // put its slab back at rest while it is in flight (a second click would then commit that fresh slab, and
    // send nothing).
    markPaid.reset();
    setPressed(true);
    let started: Awaited<ReturnType<typeof session.start>>;
    try {
      started = await session.start();
    } catch {
      // A failed start shows on the stage's own strip, with its request ID and "Try again".
      return;
    }
    // fs-api makes the session's run in DRAFT and invoices it in Claude's turn after answering: record the
    // payment only once the run reads INVOICED. A resumed session already past it has nothing to record; its
    // stream replays where the run is. Reset meanwhile ends the press.
    const readiness = await session.whenInvoiced(started);
    // A press that ends without recording anything: the slab is remounted at rest (rest), to be pressed again.
    if (readiness === "ended") {
      rest();
      return;
    }
    if (readiness !== null && !AWAITS_PAYMENT.has(readiness)) {
      // Funded or later, the stream replays it and the title reads funded. A run that ended without funding
      // (its invoice cancelled, denied, halted) never will: the press is over, and the slab rests again.
      if (!reachedFunding(readiness)) rest();
      return;
    }
    markPaid.mutate({ params: { runSlug: started.runSlug }, body: {} });
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
        onCommit={() => {
          // Every commit spends this slab, a press that gets through or one ignored while another is in flight:
          // Reset, an ended session or the press's own failure remounts it at rest.
          spent.current = true;
          void start();
        }}
      />
    );
  }

  const status =
    markPaid.queuedMs === null
      ? statusLine[phase]
      : `You're next, about ${Math.ceil(markPaid.queuedMs / 1000)} s`;
  const action = (
    <div
      className="fsc-first__action"
      ref={actionRef}
      data-testid="W-JG-01.action"
      data-state={phase}
      aria-busy={phase === "starting" || phase === "recording" ? true : undefined}
    >
      <div className="fsc-first__slab">
        {slab}
        {(pressed || movedOn) && treasurer && (
          <span className="fsc-first__stamp fs-t-caption">
            <Stamp
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
      <CommandNotice
        error={isApiClientError(markPaid.error) && markPaid.error.status === 409 ? null : markPaid.error}
        testId="W-JG-01.error"
      />
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
          <h1 id="fsc-first-title" className="fs-t-title-1 fsc-first__title" data-testid="W-JG-01.title">
            {funded ? FIRST_VIEW_COPY.titleFunded(season) : t("W-JG-01.ready", { season })}
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
        layout="desk"
        screen="W-JG-01"
        totalRole="amount-hero"
        action={action}
        compact
        desk={
          <section className="fsc-first__desk" aria-labelledby="fsc-first-desk" data-testid="W-JG-01.desk">
            <header className="fsc-first__desk-head">
              <h2 id="fsc-first-desk" className="fsc-section-title fs-t-label">
                {FIRST_VIEW_COPY.desk}
              </h2>
              <p className="fs-t-caption fsc-first__desk-note">
                {FIRST_VIEW_COPY.deskNote(photos.length, funded)}
              </p>
            </header>
            <div className="fsc-first__sheet">
              <ContactSheet
                snapshot={snapshot}
                photos={photos}
                readPhotos={readPhotos}
                hrefFor={(photo) => webRoutes.reading(season, photo)}
                testId="W-JG-01.photos"
                columns={6}
              />
              <p className="fsc-first__synthetic fs-t-caption" data-testid="W-JG-01.synthetic">
                <Glyph name="triplicate-slip" size={14} />
                {FIRST_VIEW_COPY.synthetic}
              </p>
            </div>
          </section>
        }
      />
    </ScreenRoot>
  );
}
