// W-JG-01's first view (S1.6, design §6 J1, plan "Judge Mode" step 0). UI gate round 3: the heading says where the
// run is, factually ("Invoice sent. Awaiting payment.", then "Invoice marked paid. Pool funded.", then the payouts
// and the cash still due), the past in grey and the present in ink, with one meta line under it (the season, the
// co-op, the run's facts; nothing above the heading). Then the rate card's chip (its hash in the mono); the invoice with its one amount (the one micro-tag beside it), its one press
// and its seeded lines folded at the foot; the pool as one line, "Invoice − costs = Pool"; the twelve slip photos
// with their counts' scope ("48 this run · 264 season"); and the five steps as numbers, the pay split planned in
// grey until the run settles. No legend row: the marks' words are their tooltips, and What's real holds the
// legend. Nothing here calls the API: the snapshot and the first view are built locally (S3.9). The single press
// starts the judge session, then records Lantern Bay's payment; MM-S plays when the invoice reads back as paid, on
// the event, never on the press.

import { PAY_RUN_RANK, type PayRunState, webRoutes } from "@fairsplit/contracts";
import { Glyph, HONESTY, LegendGlyph, Slab, useT } from "@fairsplit/ui-web";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { cashStillDue } from "../../chrome/next-step.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Stamp } from "../../chrome/Stamp.js";
import { isApiClientError } from "../../data/errors.js";
import { useCommand, useJudgeSession, usePaypalRail, useStageRun } from "../../data/hooks.js";
import { payoutReplayed, payoutStatus } from "../../data/payout-replay.js";
import { atLeast } from "../../data/run-view.js";
import { seasonLabel, slipCounts } from "../../lib/display.js";
import { env } from "../../lib/env.js";
import { useFocusAfterRemoval } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { prefocusQuietly, useNextStep, usePrefocus } from "../../stage/context.js";
import { sealedText } from "../ratecard/model.js";
import { ExhibitLink } from "../reading/ExhibitLink.js";
import { photoIsRead, replayPhotos } from "../reading/model.js";
import { FIRST_VIEW_COPY, type FirstViewTitle } from "../season/copy.js";
import { FundingBlock, useFundingMoment } from "../season/funding.js";
import { gateBeds, SeasonGate } from "../season/gate.js";
import { isFunded } from "../season/model.js";
import { ContactSheet } from "../season/parts.js";
import { splitRows } from "../split/model.js";
import { StoryTiles } from "./StoryTiles.js";
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

/** Whether the focused control wears the keyboard's ring (and not the quiet pre-focus's absence of one). */
function wasKeyed(el: HTMLElement): boolean {
  if (el.dataset.prefocused !== undefined) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

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
  useEffect(() => {
    if (!movedOn) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-testid="W-JG-01.markPaid"]')) {
      const continueLink = actionEl?.querySelector<HTMLElement>('[data-testid="W-JG-01.continue"]');
      if (!continueLink) return;
      // One ring, on keyboard focus only (round 3): a press made with a key hands its ring on; a click, or the
      // quiet pre-focus, hands the focus on without one until a key is pressed.
      if (wasKeyed(active)) continueLink.focus({ preventScroll: true });
      else prefocusQuietly(continueLink);
    }
  }, [movedOn, actionEl]);

  if (!snapshot) return null;
  const season = snapshot.season.label;
  // The face carries the short action; its accessible name keeps the whole catalog string.
  const label = t("W-JG-01.markPaidLabel");
  const srLabel = t("W-JG-01.markPaid");
  const cents = snapshot.run.invoice.amountCents;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER");
  const paidAt = view?.events.find(
    (event) =>
      event.type === "invoice.state" &&
      (event.payload.to === "PAID" || event.payload.to === "MARKED_AS_PAID"),
  )?.at;
  const recordText = `Marked paid by ${treasurer?.shortName.split(" ")[0] ?? "Analyn"}${paidAt ? `, ${format.time(paidAt).slice(0, 5)}` : ""}`;
  const record = (
    <span>
      {treasurer && (
        <Stamp
          stamp={{
            initials: treasurer.initials,
            name: treasurer.name,
            at: paidAt ? format.time(paidAt) : "",
          }}
        />
      )}{" "}
      {recordText}
    </span>
  );
  const photos = replayPhotos(snapshot);
  const slips = slipCounts(snapshot);
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
    session.setPressing(true);
    try {
      await press();
    } finally {
      inFlight.current = false;
      session.setPressing(false);
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
    await markPaid.mutateAsync({ params: { runSlug: started.runSlug }, body: {} }).catch(() => undefined);
  };

  let slab: ReactNode;
  if (movedOn && !pressed) {
    // Returning to a run that is already funded: the press is spent, drawn flush and still.
    slab = (
      <Slab
        label={label}
        glyph="thumbmark"
        width="100%"
        srLabel={`${recordText}. ${FIRST_VIEW_COPY.movedOn}`}
        record={record}
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
        glyph="thumbmark"
        width="100%"
        srLabel={
          movedOn
            ? recordText
            : `${srLabel}, ${format.amountSpoken(cents, "en")}, ${FIRST_VIEW_COPY.srConsequence}`
        }
        record={record}
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

  const settled = view?.state === "SETTLED" || view?.state === "CLOSED";
  const runLines = view ? splitRows(snapshot, view) : [];
  // Each PayPal line asks the shared payout policy: only this run's confirmed money counts as paid by PayPal.
  const payouts = runLines
    .filter((line) => line.rail === "PAYPAL" && !line.movedToCash)
    .map((line) => payoutStatus({ state: line.state, view, memberNo: line.memberNo }));
  const replayedPayouts = payouts.some((payout) => payout.replayed);
  // Cash at the bodega is due until every cash line is handed over: the heading never reads done before then.
  const cashDue = settled && view !== undefined && cashStillDue(view, snapshot.figures.cashMembers);
  const title: FirstViewTitle = settled
    ? FIRST_VIEW_COPY.titleSettled({
        replayed: replayedPayouts,
        paypal: replayedPayouts
          ? payouts.length
          : payouts.filter((payout) => payout.amountState === "landed").length,
        cash: runLines.filter((line) => line.rail === "CASH" || line.movedToCash).length,
        cashDue,
      })
    : funded
      ? FIRST_VIEW_COPY.titleFunded(view?.invoice.status === "MARKED_AS_PAID")
      : FIRST_VIEW_COPY.titleReady;
  const status = settled
    ? FIRST_VIEW_COPY.settledStatus(payoutReplayed(view), cashDue)
    : markPaid.queuedMs === null
      ? statusLine[phase]
      : `You're next, about ${Math.ceil(markPaid.queuedMs / 1000)} s`;
  // Settled with cash due, the link names the step left ("Review cash handover"); otherwise "Next step".
  const nextWords = next?.stateWord ? next.text : FIRST_VIEW_COPY.openNext;
  const action = (
    <div
      className="fsc-first__action"
      ref={actionRef}
      data-testid="W-JG-01.action"
      data-state={phase}
      aria-busy={phase === "starting" || phase === "recording" ? true : undefined}
    >
      <div className="fsc-first__slab">{slab}</div>
      {status ? (
        <p className="fsc-first__status fs-t-label" role="status" data-testid="W-JG-01.status">
          <Glyph name={phase === "funded" && !cashDue ? "ms:check" : "rail"} size={16} />
          <span>{status}</span>
          {phase === "funded" && next && next.id !== "mark-paid" && (
            <AppLink href={next.to} className="fs-link" data-testid="W-JG-01.continue">
              {nextWords}
            </AppLink>
          )}
        </p>
      ) : movedOn ? (
        <p className="fsc-first__note fs-t-caption">{FIRST_VIEW_COPY.movedOn}</p>
      ) : null}
      <CommandNotice
        error={isApiClientError(markPaid.error) && markPaid.error.status === 409 ? null : markPaid.error}
        testId="W-JG-01.error"
      />
    </div>
  );

  // The rate card as the quiet card under the invoice (round 4): its name, its hash in the mono and its seal date,
  // then "Open". The title row keeps only the heading and its one meta line.
  const rateCard = (
    <AppLink
      href={webRoutes.rateCard(season)}
      className="fsc-first__card"
      aria-label={`${FIRST_VIEW_COPY.openCard}: ${sealedText(snapshot.rateCard)}`}
      data-testid="W-JG-01.rules"
    >
      <Glyph name="ms:lock" size={16} />
      <span className="fs-t-label">{FIRST_VIEW_COPY.card}</span>
      {/* The hash in the mono (an id), its seal date in words. */}
      <span className="fsc-first__card-hash" data-testid="W-JG-01.rules.sealed">
        <span className="fs-t-id">{format.hashGroups(snapshot.rateCard.sha256)}</span>
        <span className="fs-t-caption">
          {FIRST_VIEW_COPY.cardSealedOn(format.dateShort(snapshot.rateCard.canonical.ratifiedOn))}
        </span>
      </span>
      <span className="fsc-first__card-open fs-t-label" aria-hidden>
        {FIRST_VIEW_COPY.open}
      </span>
    </AppLink>
  );

  return (
    <ScreenRoot
      id="W-JG-01"
      state={inSession ? "session" : "ready"}
      labelledBy="fsc-first-title"
      className="fsc-first"
      grid
    >
      <header className="fsc-first__head">
        <div className="fsc-first__titles">
          <h1
            id="fsc-first-title"
            className="fs-t-title fsc-first__title"
            data-testid="W-JG-01.title"
            data-state={settled ? "settled" : funded ? "funded" : "ready"}
          >
            <span className="fsc-first__title-done">{title.done}</span>{" "}
            <span className="fsc-first__title-now">{title.now}</span>
          </h1>
          {/* One meta line under the heading (round 3: no eyebrow above it): the season and the co-op, then the
              run's facts. */}
          <p className="fsc-first__meta fs-t-caption">
            <span className="fsc-first__season" data-testid="W-JG-01.mark">
              {FIRST_VIEW_COPY.season(seasonLabel(season))}
              <span className="fsc-first__sep" aria-hidden>
                {" · "}
              </span>
              <span className="fs-sr">, </span>
              {t("W-TR-01.coop")}
            </span>
            {/* The dot holds to the co-op's name, so a wrapped line starts with the facts, never with a dot. */}
            <span className="fsc-first__sep" aria-hidden>
              {" · "}
            </span>
            <span className="fs-sr">, </span>
            <span
              className="fsc-first__facts"
              title={FIRST_VIEW_COPY.lede(snapshot.figures.members, snapshot.lot.buyer)}
              data-testid="W-JG-01.facts"
            >
              {FIRST_VIEW_COPY.facts(snapshot.figures.members)}
            </span>
          </p>
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
        under={rateCard}
        desk={
          <section className="fsc-first__desk" aria-labelledby="fsc-first-desk" data-testid="W-JG-01.desk">
            <header className="fsc-first__desk-head" title={FIRST_VIEW_COPY.deskNote(photos.length, funded)}>
              <h2 id="fsc-first-desk" className="fsc-first__desk-title fs-t-label">
                {FIRST_VIEW_COPY.desk}
              </h2>
              <span className="fsc-first__desk-note fs-t-caption" data-testid="W-JG-01.slips">
                {FIRST_VIEW_COPY.slipsMicro(photos.length, slips.text)}
              </span>
              <span className="fsc-first__synthetic" data-testid="W-JG-01.synthetic">
                <LegendGlyph {...HONESTY.syntheticSample} />
              </span>
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
              <ExhibitLink season={season}>{FIRST_VIEW_COPY.exhibit}</ExhibitLink>
            </div>
          </section>
        }
      />
      <StoryTiles snapshot={snapshot} view={view} />
    </ScreenRoot>
  );
}
