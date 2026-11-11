// W-JG-01's first view (S1.6, design §6 J1, plan "Judge Mode" step 0). UI gate round 5, on the one twelve-column
// grid, top to bottom:
// - The title row: "Season 2026-A" (the season the grey suffix) and the run's state as one chip on the same row,
//   "Awaiting payment", then "Funded" (MM-S floods it jade), then the settled run's words ("PayPal complete · cash
//   due"); its id line holds the run id once a session starts and the screen's one provenance phrase.
// - The invoice (its hero amount, its one micro-tag, its one press, its seeded lines folded) beside the pool it
//   funds (the pool's amount first, where the one jade arc from the invoice lands, the sum in words under it, and
//   the rate card that shares it as the card's foot). No invoice id until a session starts.
// - The slips as one 12-up strip of small prints, their counts' scope ("48 this run · 264 season") beside them.
// - The pipeline: Read, Check, Sign, Pay, Prove on one track, each step's dot its state only.
// No legend glyph anywhere on the screen. Nothing here calls the API: the snapshot and the first view are built
// locally (S3.9). The single press starts the judge session, then records Lantern Bay's payment; MM-S plays when
// the invoice reads back as paid, on the event, never on the press.

import { PAY_RUN_RANK, type PayRunState, webRoutes } from "@fairsplit/contracts";
import { Chip, Glyph, Slab, useT } from "@fairsplit/ui-web";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PROVENANCE } from "../../chrome/copy.js";
import { cashStillDue } from "../../chrome/next-step.js";
import { ScreenHead } from "../../chrome/ScreenGrid.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Stamp } from "../../chrome/Stamp.js";
import { isApiClientError } from "../../data/errors.js";
import { useCommand, useJudgeSession, usePaypalRail, useStageRun } from "../../data/hooks.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import { atLeast } from "../../data/run-view.js";
import { runLabel, seasonLabel, slipCounts } from "../../lib/display.js";
import { env } from "../../lib/env.js";
import { useFocusAfterRemoval } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useProofChecks } from "../../lib/proof-checks.js";
import { prefocusQuietly, usePrefocus } from "../../stage/context.js";
import { sealedText } from "../ratecard/model.js";
import { ExhibitLink } from "../reading/ExhibitLink.js";
import { photoIsRead, replayPhotos } from "../reading/model.js";
import { FIRST_VIEW_COPY } from "../season/copy.js";
import {
  FundedMark,
  FundingBlock,
  fundedSourceTitle,
  fundingValues,
  useFundingMoment,
} from "../season/funding.js";
import { gateBeds, SeasonGate } from "../season/gate.js";
import { isFunded } from "../season/model.js";
import { ContactSheet } from "../season/parts.js";
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
  const proof = useProofChecks(inSession ? (view?.runSlug ?? runSlug) : null);
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
      // Round 6: the step that is left is the top bar's pill (the card keeps no second link). The spent press hands
      // its focus there: with its ring after a key, quietly after a click or the pre-focus (round 3: one ring).
      const pill = document.querySelector<HTMLElement>('[data-testid="W-JG-01.runPill.next"]');
      if (!pill) return;
      if (wasKeyed(active)) pill.focus({ preventScroll: true });
      else prefocusQuietly(pill);
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
  // Round 6 (film U1): the record says whose money it is. Lantern Bay pays; the treasurer's part is recording that
  // payment (on the simulated PayPal sandbox: the amount above carries the tag), so it never reads "paid by Analyn".
  const recordText = FIRST_VIEW_COPY.recorded(
    snapshot.lot.buyer,
    treasurer?.shortName.split(" ")[0] ?? "the treasurer",
    paidAt ? format.time(paidAt).slice(0, 5) : null,
  );
  const record = (
    <span className="fsc-first__record">
      {treasurer && (
        <Stamp
          stamp={{
            initials: treasurer.initials,
            name: treasurer.name,
            at: paidAt ? format.time(paidAt) : "",
          }}
        />
      )}
      <span>{recordText}</span>
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
    // Funded: the title row's chip says it (round 5); the action keeps only the next step's link.
    funded: null,
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
  const replayed = payoutReplayed(view);
  // Cash at the bodega is due until every cash line is handed over: the state never reads done before then.
  const cashDue = settled && view !== undefined && cashStillDue(view, snapshot.figures.cashMembers);
  const stateKey = settled ? "settled" : funded || moment.playing ? "funded" : "ready";
  const status = settled
    ? null
    : markPaid.queuedMs === null
      ? statusLine[phase]
      : `You're next, about ${Math.ceil(markPaid.queuedMs / 1000)} s`;
  // Round 6: no link under the record. The top bar's pill is the one route forward ("Next: …"), said once.
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
          <Glyph name="rail" size={16} />
          <span>{status}</span>
        </p>
      ) : movedOn && !funded && !settled ? (
        <p className="fsc-first__note fs-t-caption">{FIRST_VIEW_COPY.movedOn}</p>
      ) : null}
      <CommandNotice
        error={isApiClientError(markPaid.error) && markPaid.error.status === 409 ? null : markPaid.error}
        testId="W-JG-01.error"
      />
    </div>
  );

  // The rate card as the pool card's foot (round 5: the rules that share the pool, a row over a rule, not a card):
  // its name, its hash in the mono and its seal date, then "Open".
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

  // The run's state, one chip on the title row (round 5). "Funded" is MM-S's own mark: its inset closes and jade
  // floods it on the invoice's event; its title (and its hidden words) say where the word came from.
  const values = fundingValues(moment, funded);
  const fundedTitle = fundedSourceTitle(rail, view);
  const stateChip =
    stateKey === "settled" ? (
      <Chip tone={cashDue ? "hatch" : replayed ? "neutral" : "jade"} glyph={cashDue ? "cash" : "rail"}>
        {FIRST_VIEW_COPY.settledStatus(replayed, cashDue)}
      </Chip>
    ) : stateKey === "funded" ? (
      <>
        <FundedMark
          inset={values.inset}
          flood={values.flood}
          landed={moment.phase === "funded"}
          title={fundedTitle}
          testId="W-JG-01.funded"
        />
        <span className="fs-sr" data-testid="W-JG-01.funded.source">
          {fundedTitle}
        </span>
      </>
    ) : (
      <Chip tone="neutral" glyph="ms:schedule">
        {FIRST_VIEW_COPY.awaiting}
      </Chip>
    );

  return (
    <ScreenRoot
      id="W-JG-01"
      state={inSession ? "session" : "ready"}
      labelledBy="fsc-first-title"
      className="fsc-first"
      grid
    >
      <ScreenHead
        title={FIRST_VIEW_COPY.title}
        suffix={<span data-testid="W-JG-01.mark">{seasonLabel(season)}</span>}
        titleId="fsc-first-title"
        status={
          <span className="fsc-first__state" data-testid="W-JG-01.title" data-state={stateKey}>
            {stateChip}
          </span>
        }
        meta={inSession && view ? runLabel(view.runSlug).text : undefined}
        provenance={PROVENANCE.seededSlips}
        testId="W-JG-01.head"
        className="fsc-first__head"
      />

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
        poolFoot={rateCard}
        fundedMark={false}
      />

      {/* Round 6: the pipeline is the second row, right under the two cards. */}
      <StoryTiles
        snapshot={snapshot}
        view={inSession ? view : undefined}
        progress={{ proofChecked: proof.checked && proof.matched === proof.total }}
      />

      {/* The slips (rounds 5 and 6): one 12-up strip ending the screen, its head over it ("Slips", the counts'
          scope, the recorded exhibit's link); each print opens in the reading room. */}
      <section className="fsc-first__desk" aria-labelledby="fsc-first-desk" data-testid="W-JG-01.desk">
        <header className="fsc-first__desk-head" title={FIRST_VIEW_COPY.deskNote(photos.length, funded)}>
          <h2 id="fsc-first-desk" className="fsc-first__desk-title fs-t-label">
            {FIRST_VIEW_COPY.desk}
          </h2>
          <span className="fsc-first__desk-note fs-t-caption" data-testid="W-JG-01.slips">
            {FIRST_VIEW_COPY.slipsMicro(photos.length, slips.text)}
          </span>
          <ExhibitLink season={season}>{FIRST_VIEW_COPY.exhibit}</ExhibitLink>
        </header>
        <ContactSheet
          snapshot={snapshot}
          photos={photos}
          readPhotos={readPhotos}
          hrefFor={(photo) => webRoutes.reading(season, photo)}
          testId="W-JG-01.photos"
          columns={12}
        />
      </section>
    </ScreenRoot>
  );
}
