// W-TR-08 Run (S1.7, design §6 C8; UI gate rounds 4 and 5): on the one 12-column grid, top-aligned under the title
// row ("Run 2026-A", the run's state as one chip, the run id and the screen's one provenance phrase). The fan is the
// single hero, full width (MM-6, "Honest fan-out"): the 180-unit seal, eight threads to eight named rows, and the
// cash as one hatched ribbon into one labelled row. The run's one count sits right above the seal: "7/8" and
// "confirmed" while PayPal works, and once every payout is settled "7 PayPal  57 cash" (a 12 px jade dot before
// "PayPal", a 12 px hatch swatch before "cash", 32 px apart; never "7/8" after the move to cash) with "Review cash
// handover" under it as the screen's one primary while the cash is due; the run's one micro-tag beside the PayPal
// count. Beneath the fan Rhea's decision when she is parked (her move to cash is then said once, on her row of the
// fan, with her amount), then the last four events and "All N events" (columns 1–8, ending 32 px above the panel's
// foot) and the latency dots with their median (9–12). Round 5: no money bar restates the fan; what the holds kept
// for members is a caption on the cash row. PayPal's 201 draws eight threads to 70% in neutral: sent, not paid. Each
// verified SUCCESS finishes its thread and floods its marker jade, one scale note each, landings at least 250 ms
// apart. Rhea's item parks: her path runs on to her own marker in marigold, never red, and a slab moves her to cash.
// A repeated delivery logs one quiet row and moves nothing. History is drawn in place; only live events animate. The
// event toast folds into the top bar's Next pill, so nothing covers the log.

import { webRoutes } from "@fairsplit/contracts";
import {
  Chip,
  type ChipTone,
  feedback,
  Glyph,
  type GlyphName,
  MicroTag,
  Numeral,
  Slab,
  StateDot,
  Swatch,
} from "@fairsplit/ui-web";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PROVENANCE, railTag } from "../../chrome/copy.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { RunRouteGate } from "../../chrome/Fallbacks.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { Cell, ScreenHead } from "../../chrome/ScreenGrid.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { describeEvent, type LogRow } from "../../data/describe.js";
import { useCommand, useDescribeContext, usePaypalRail } from "../../data/hooks.js";
import { payoutReplayed, payoutStatus } from "../../data/payout-replay.js";
import {
  type FanoutState,
  fanoutState,
  fanView,
  isPostedRun,
  latency,
  parkedThread,
  postedAt,
  restingPhase,
  shareCounts,
  summaryFacts,
} from "../../features/fanout/model.js";
import { PrimaryLink } from "../../features/fanout/PrimaryLink.js";
import { LatencyDots, RunLog } from "../../features/fanout/RunLog.js";
import { SplitFan } from "../../features/fanout/SplitFan.js";
import { seededLog } from "../../features/fanout/seeded.js";
import { en, FANOUT } from "../../features/split/shared/copy.js";
import { cashDayForRun, useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { useMomentScript, usePhaseSync } from "../../features/split/shared/script.js";
import { runLabel } from "../../lib/display.js";
import { useFocusAfterRemoval } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import type { ScreenState } from "../../lib/screens.js";
import { useOptionalStage, usePrefocus } from "../../stage/context.js";
import type { RunScreenProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/fanout/fanout.css";

/** PayPal's thread completes, then the stub takes its press: the note sounds with the press (MM-6, +300 ms). */
const NOTE_AFTER_MS = 300;

export function Screen({ runSlug }: RunScreenProps) {
  const data = useRunData(runSlug);
  const { snapshot, view } = data;
  const replayed = payoutReplayed(view);
  const describe = useDescribeContext();
  const rail = usePaypalRail() ?? "simulator";
  const stage = useOptionalStage();
  const moment = useMoment("MM-6");
  const script = useMomentScript(moment);
  const [landings, setLandings] = useState<ReadonlyMap<string, number>>(new Map());
  const [drawing, setDrawing] = useState(false);
  const [slabKey, setSlabKey] = useState(0);
  const [resendAsked, setResendAsked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const notes = useRef(0);
  const pressedCash = useRef<string | null>(null);
  const drawnBy = useRef<string | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const slabRef = useRef<HTMLDivElement>(null);
  // "Pay in cash" goes away once the line moves: focus goes to the run's next action, "Review cash handover".
  const [fanRoot, setFanRoot] = useState<HTMLElement | null>(null);
  const attachMomentRoot = moment.rootProps.ref;
  const fanRef = useCallback(
    (node: HTMLElement | null) => {
      setFanRoot(node);
      const detach = attachMomentRoot(node);
      return () => {
        detach?.();
        setFanRoot((current) => (current === node ? null : current));
      };
    },
    [attachMomentRoot],
  );
  // Between PayPal's return and the line's own move, neither card nor action may be drawn: then the run's status
  // row takes focus, at the top, so the fan stays in view.
  useFocusAfterRemoval(fanRoot, () => [
    fanRoot?.querySelector<HTMLElement>('[data-testid="W-TR-08.cashReview"]') ?? null,
    fanRoot?.querySelector<HTMLElement>('[data-testid="W-TR-08.status"]') ?? null,
  ]);
  const payCash = useCommand("payCash");

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current.clear();
    },
    [],
  );

  const land = useCallback((memberNo: string, delay: number) => {
    setLandings((prev) => new Map(prev).set(memberNo, delay));
  }, []);

  const live = useLiveEvents(data.live ? runSlug : null, (event) => {
    if (event.type === "item.updated") {
      if (payoutStatus({ itemStatus: event.payload.to, provenance: event.provenance }).replayed) return;
      const p = event.payload;
      const evidence = { eventId: event.id, kind: "sse" as const };
      if (p.to === "PENDING" && p.source === "post_response") {
        // PayPal's 201: the threads draw to 70% together, staggered. The batch's first accepted item is the
        // evidence, so the act plays once per batch however many items PayPal accepted.
        if (drawnBy.current === null) {
          drawnBy.current = event.id;
          setDrawing(true);
          script.run("posted", { eventId: event.id, kind: "http" });
        }
      } else if (p.to === "SUCCESS") {
        const delay = stage?.director.space("item") ?? 0;
        land(p.memberNo, delay);
        const index = notes.current++;
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          feedback.play("item.paid.console", { index });
        }, delay + NOTE_AFTER_MS);
        timers.current.add(timer);
        script.run("item-success", evidence, { skipFeedback: ["item.paid.console"] });
      } else if (p.to === "UNCLAIMED" || p.to === "ONHOLD") {
        // C-07: UNCLAIMED is a decision for a person, not a failure: a canary cap, no thud.
        land(p.memberNo, 0);
        script.run("item-parked", evidence, { skipFeedback: ["paypal.failure"] });
      } else if (p.to === "FAILED" || p.to === "BLOCKED" || (p.to === "RETURNED" && p.source !== "cancel")) {
        land(p.memberNo, 0);
        script.run("item-parked", evidence);
      } else if (p.to === "RETURNED" && p.source === "cancel") {
        land(p.memberNo, 0);
        script.run("to-cash", evidence, {
          skipFeedback: pressedCash.current === p.memberNo ? ["slab.d2.commit"] : [],
        });
      }
    } else if (event.type === "run.state") {
      if (event.payload.to === "SETTLED") script.run("settled", { eventId: event.id, kind: "sse" });
      if (event.payload.to === "DENIED") script.run("denied", { eventId: event.id, kind: "sse" });
    }
  });

  const fan = useMemo(() => (snapshot && view ? fanView(snapshot, view) : null), [snapshot, view]);
  const state = view && fan ? fanoutState(view, fan) : null;
  const resting = view && fan ? restingPhase(view, fan) : null;
  usePhaseSync(moment, resting, script.busy);

  // The waiting line's elapsed time ticks once a second while PayPal confirms (S1.7 "an elapsed timer runs").
  const posted = view ? postedAt(view) : null;
  const waiting = state === "waiting" && posted !== null && view !== undefined && isPostedRun(view);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const parked = fan ? parkedThread(fan) : null;
  usePrefocus(slabRef, "W-TR-08", parked !== null);

  const rows = useMemo<LogRow[]>(() => {
    if (!view || !describe) return [];
    if (view.events.length === 0 && view.origin === "showcase" && snapshot)
      return seededLog(snapshot, describe);
    return view.events.map((e) => describeEvent(e, describe)).filter((r): r is LogRow => r !== null);
  }, [view, describe, snapshot]);

  // The title row (round 5): "Run 2026-A", the run's state as one chip, the run id and the one provenance phrase.
  const runId = runLabel(runSlug);
  const head = (status?: ReactNode) => (
    <ScreenHead
      title={FANOUT.title}
      suffix={runId.season || undefined}
      status={status}
      titleId="W-TR-08-title"
      // One run id everywhere (round 5): "2026-A · r37", as Season, Reading room and Split review read it.
      meta={runId.text}
      provenance={PROVENANCE.simulatedPaypal}
      testId="W-TR-08.head"
    />
  );
  const title = head();

  if (data.access !== "allowed") return <RunRouteGate data={data} />;
  if (data.error && !view) {
    return (
      <ScreenRoot id="W-TR-08" state="error" grid className="fsr-fanout-screen" labelledBy="W-TR-08-title">
        {title}
        <CommandNotice error={data.error} testId="W-TR-08.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  }
  if (!snapshot || !view || !fan || !state) {
    return (
      <ScreenRoot id="W-TR-08" state="loading" grid className="fsr-fanout-screen" labelledBy="W-TR-08-title">
        {title}
        <div className="fsr-fanout__beds" aria-hidden data-testid="W-TR-08.loading">
          <PrintBed shape="block" height={360} />
          <PrintBed shape="row" count={6} />
        </div>
        <p className="fs-sr" role="status">
          {FANOUT.loading}
        </p>
      </ScreenRoot>
    );
  }

  const cashDay = format.dateShort(cashDayForRun(snapshot, view));
  const isPosted = isPostedRun(view);
  const summary = summaryFacts(snapshot, fan);
  const counts = shareCounts(fan);
  const parkedLineId = parked ? (view.lines[parked.memberNo]?.lineId ?? null) : null;
  const screenState: ScreenState<"W-TR-08"> = state;
  const lat = latency(view, fan);
  const tag = railTag(rail);

  // The status: the run's one hero, then one fact beneath it. Never a sentence about the rail: the micro-tag says it
  // once, beside the PayPal count. While PayPal works the hero is the count (confirmed of sent). Once every payout is
  // settled it is the two outcomes, "7 PayPal  57 cash" (a jade dot before the money PayPal confirmed, a hatch swatch
  // before the cash), never "7/8" after the move to cash; the cash's day beside it, and "Review cash handover" as the
  // screen's one primary until the cash is attested: PayPal complete, cash due, never "done". Whether a person must
  // decide is the run's state, said once on the title row.
  const cashDue = fan.cash.members > 0 && fan.cash.amountState !== "attested";
  const status = (() => {
    if (state === "denied") return null;
    if (!isPosted) return { kind: "line", text: FANOUT.notPosted, link: true } as const;
    if (replayed) return { kind: "line", text: FANOUT.replayedStatus } as const;
    const count = `${counts.confirmed}/${counts.sent}`;
    if (state === "done")
      return {
        kind: "settled",
        settled: { paypal: counts.confirmed, cash: summary.cash },
        due: cashDue ? FANOUT.dueOn(cashDay) : FANOUT.cashHandedOver,
      } as const;
    if (state === "parked") return { kind: "count", count, unit: FANOUT.confirmedWord } as const;
    return {
      kind: "count",
      count,
      unit: FANOUT.confirmedWord,
      micro: posted
        ? FANOUT.posted(format.time(posted), format.elapsedClock(now - Date.parse(posted)))
        : FANOUT.postedSeeded,
    } as const;
  })();
  const chip = runChip(state, {
    posted: isPosted,
    replayed,
    cashDue,
    needsYou: counts.parked + counts.failed,
  });
  // What the holds kept inside the members' share, once every payout is settled: a caption on the cash row.
  const kept =
    state === "done" && snapshot.figures.redirectedCents > 0 ? FANOUT.keptCaption(summary.kept) : undefined;
  // The run's one micro-tag, beside its PayPal count (round 5: no money bar to carry it).
  const microTag = <MicroTag label={tag} testId="W-TR-08.tag" className="fsr-fanout__tag" />;

  return (
    <ScreenRoot
      id="W-TR-08"
      state={screenState}
      grid
      className="fsr-fanout-screen"
      labelledBy="W-TR-08-title"
    >
      {head(
        <Chip tone={chip.tone} glyph={chip.glyph} testId="W-TR-08.stateChip">
          {chip.text}
        </Chip>,
      )}
      {state === "denied" && (
        <p className="fsr-banner" data-tone="red" role="alert" data-testid="W-TR-08.denied">
          <Glyph name="rail" size={18} />
          {FANOUT.denied}
        </p>
      )}
      <section
        {...moment.rootProps}
        ref={fanRef}
        className="fsr-fanout"
        data-motion={moment.mode}
        data-state={state}
        aria-labelledby="W-TR-08-figure"
      >
        {/* The run's share of the money, said once (round 5: no money bar restates the fan): the count, its one
            micro-tag, its day and its one primary. */}
        <header
          className="fsr-fanout__head"
          data-instrument={status?.kind === "line" ? undefined : status?.kind}
          data-testid="W-TR-08.share"
        >
          <h2 id="W-TR-08-figure" className="fs-sr">
            {FANOUT.figure}
          </h2>
          {status && (
            <p
              className="fsr-fanout__status"
              role="status"
              tabIndex={-1}
              data-testid="W-TR-08.status"
              data-state={state}
            >
              {status.kind === "settled" ? (
                <>
                  {/* Settled: the two outcomes as the one hero, "7 PayPal  57 cash" (read as one sentence): each
                      count, then its 12 px key on the word's baseline (a jade dot, a hatch swatch), the two 32 px
                      apart; the micro-tag beside the PayPal count and the cash's day on the baseline. */}
                  <span className="fsr-fanout__settled" data-testid="W-TR-08.settled">
                    <span className="fs-sr">
                      {FANOUT.settledSpoken(status.settled.paypal, status.settled.cash)}{" "}
                    </span>
                    <span className="fsr-fanout__part" aria-hidden>
                      <Numeral
                        value={String(status.settled.paypal)}
                        decorative
                        className="fsr-fanout__count"
                        testId="W-TR-08.count"
                      />
                      <span className="fsr-fanout__key">
                        <StateDot kind="paid" size={12} />
                        <span className="fsr-fanout__word fs-t-label">{FANOUT.settledPaypal}</span>
                      </span>
                    </span>
                    {microTag}
                    <span className="fsr-fanout__part" aria-hidden>
                      <Numeral value={String(status.settled.cash)} decorative className="fsr-fanout__count" />
                      <span className="fsr-fanout__key">
                        <Swatch kind="cash" size={12} className="fsr-fanout__swatch" />
                        <span className="fsr-fanout__word fs-t-label">{FANOUT.settledCash}</span>
                      </span>
                    </span>
                    <span className="fsr-fanout__due fs-t-caption" data-testid="W-TR-08.cashDue">
                      {status.due}
                    </span>
                  </span>
                </>
              ) : status.kind === "count" ? (
                <>
                  {/* The screen's one hero count, in FS Sans tabular figures, read with its words and its tag. */}
                  <span className="fsr-fanout__instrument">
                    <Numeral value={status.count} className="fsr-fanout__count" testId="W-TR-08.count" />
                    <span className="fsr-fanout__unit fs-t-label">{status.unit}</span>
                    {microTag}
                  </span>
                  {"micro" in status && status.micro && (
                    <span className="fsr-fanout__facts">
                      <span className="fsr-fanout__micro fs-t-caption">{status.micro}</span>
                    </span>
                  )}
                </>
              ) : (
                <span className="fsr-fanout__line fs-t-body">
                  {status.text}
                  {"link" in status && (
                    <>
                      {" "}
                      <AppLink href={webRoutes.approve(view.runSlug)} className="fs-link fs-t-label">
                        {FANOUT.notPostedLink}
                      </AppLink>
                    </>
                  )}
                  {/* The batch the fan's eight amounts wait on is the simulated PayPal's: its one tag. */}
                  {"link" in status && microTag}
                </span>
              )}
            </p>
          )}
          {/* Round 6: one layout in every state. A parked payout's primary stands where the settled run's does, right
              under the hero count; its row under the fan keeps the facts on one line. */}
          {parked && (
            <div ref={slabRef} className="fsr-fanout__action">
              <Slab
                key={slabKey}
                label={FANOUT.payCash}
                srLabel={FANOUT.srPayCash(parked.name, format.money(parked.cents))}
                depth="d2"
                tone="chalk"
                glyph="cash"
                testId="W-TR-08.payCash"
                {...(!data.live || !parkedLineId ? { unavailableReason: FANOUT.payCashUnavailable } : {})}
                onCommit={() => {
                  if (!parkedLineId) return;
                  pressedCash.current = parked.memberNo;
                  payCash.mutate(
                    { params: { lineId: parkedLineId } },
                    { onError: () => setSlabKey((k) => k + 1) },
                  );
                }}
              />
            </div>
          )}
          {/* Under the settled hero, while the cash is due: the run's remaining action, the screen's one primary. */}
          {status?.kind === "settled" && cashDue && (
            <PrimaryLink
              href={webRoutes.proof(view.runSlug)}
              glyph="cash"
              className="fsr-fanout__action"
              testId="W-TR-08.cashReview"
            >
              {FANOUT.reviewCash}
            </PrimaryLink>
          )}
        </header>

        <Mirrored
          testId="W-TR-08.figureBlock"
          className="fsr-fanout__figure"
          visual={
            <SplitFan
              fan={fan}
              animate={landings}
              drawing={drawing}
              mode={moment.mode}
              cashDay={cashDay}
              {...(kept ? { cashCaption: kept } : {})}
            />
          }
          table={
            <DataTable
              caption={FANOUT.tableCaption}
              testId="W-TR-08.table"
              columns={[
                { key: "member", label: FANOUT.col.member },
                { key: "rail", label: FANOUT.col.rail },
                { key: "amount", label: FANOUT.col.amount, numeric: true },
                { key: "status", label: FANOUT.col.status },
              ]}
              rows={[
                ...fan.threads.map((t) => ({
                  key: t.memberNo,
                  cells: {
                    member: `${t.name} (${t.memberNo})`,
                    rail: t.tone === "moved" ? FANOUT.railCash : "Simulated PayPal sandbox",
                    amount: format.money(t.cents),
                    status: t.statusWord,
                  },
                })),
                {
                  key: "cash",
                  cells: {
                    member: `${FANOUT.cashBandMembers(fan.cash.members)}, ${FANOUT.dueOn(cashDay)}`,
                    rail: FANOUT.railCash,
                    amount: format.money(fan.cash.cents),
                    status: en("console.status.OFF_RAIL_DUE"),
                  },
                },
              ]}
            />
          }
        />

        {parked && (
          <section className="fsr-parked" aria-labelledby="W-TR-08-parked" data-testid="W-TR-08.parked">
            <div className="fsr-parked__who">
              <h3 id="W-TR-08-parked" className="fsr-parked__title">
                <StateDot kind="held" />
                <span className="fs-t-label">{replayed ? "Replayed" : FANOUT.parkedChip}</span>
                <span className="fsr-parked__name fs-t-label">{parked.name}</span>
                <span className="fsr-parked__amount fs-t-figure">{format.money(parked.cents)}</span>
              </h3>
              <p className="fsr-parked__line fs-t-caption">
                {replayed ? FANOUT.rheaReplayed : `${FANOUT.rheaLine} · ${FANOUT.returns}`}
              </p>
            </div>
            {/* Round 6: one line. The decision's primary ("Pay in cash at the bodega") stands under the hero count, as
                the settled run's does; the row keeps the one other way, quiet, its note in its title. */}
            <button
              type="button"
              className="fs-flat fsr-parked__resend"
              onClick={() => setResendAsked(true)}
              title={resendAsked ? FANOUT.resendPending : FANOUT.resendNote}
              data-testid="W-TR-08.resend"
            >
              {FANOUT.resend}
              <span className="fs-sr">{`: ${resendAsked ? FANOUT.resendPending : FANOUT.resendNote}`}</span>
            </button>
            {payCash.queuedMs !== null && (
              <p className="fs-t-caption fsr-muted" role="status" data-testid="W-TR-08.queued">
                {`You're next, about ${Math.ceil(payCash.queuedMs / 1000)} s`}
              </p>
            )}
            {payCash.error && <CommandNotice error={payCash.error} testId="W-TR-08.error" />}
          </section>
        )}
      </section>

      {/* The last four events (columns 1–8, ending 32 px above the panel's foot) and the latency dots (9–12); stacked
          below 1,040 px of panel. */}
      <Cell span={8} className="fsr-fanout__log fsc-peek">
        <RunLog
          rows={rows}
          isLive={(id) => live.isLive(id)}
          seeded={view.events.length === 0 && view.origin === "showcase"}
          {...(cashDue ? { settledAs: en("W-JG-01.pill.stateCashDue") } : {})}
          footer={
            <p className="fsr-fanout__fees fs-t-caption" data-testid="W-TR-08.fees">
              {replayed ? FANOUT.feesReplayed : FANOUT.feesSoFar}
            </p>
          }
        />
      </Cell>
      <Cell span={4} as="aside" className="fsr-fanout__side fsc-peek">
        {replayed ? (
          <p className="fs-t-caption fsr-muted">{FANOUT.timingReplayed}</p>
        ) : (
          <LatencyDots
            latency={lat}
            // Round 6: a settled run read back after a reload has its confirmations but not their timings; it never
            // says "No confirmations yet".
            {...(counts.confirmed > 0 && lat.dots.length === 0
              ? {
                  emptyText:
                    view.events.length === 0 && view.origin === "showcase"
                      ? FANOUT.latencySeeded
                      : FANOUT.latencyUntimed(counts.confirmed),
                }
              : {})}
          />
        )}
      </Cell>
    </ScreenRoot>
  );
}

interface RunChip {
  readonly tone: ChipTone;
  readonly glyph: GlyphName;
  readonly text: string;
}

/**
 * The run's state on its title row (round 5), said once: not posted, confirming, a person must decide, PayPal
 * complete with the cash due ("PayPal complete · cash due", never "Settled" while cash is due), settled, replayed or
 * PayPal's no.
 */
function runChip(
  state: FanoutState,
  run: {
    readonly posted: boolean;
    readonly replayed: boolean;
    readonly cashDue: boolean;
    readonly needsYou: number;
  },
): RunChip {
  if (state === "denied") return { tone: "red", glyph: "rail", text: FANOUT.chip.denied };
  if (!run.posted) return { tone: "neutral", glyph: "seal", text: FANOUT.chip.notPosted };
  if (run.replayed) return { tone: "flight", glyph: "rail", text: FANOUT.chip.replayed };
  if (state === "parked") return { tone: "canary", glyph: "ms:pause", text: FANOUT.needsYou(run.needsYou) };
  if (state === "done")
    return run.cashDue
      ? { tone: "hatch", glyph: "cash", text: FANOUT.chip.cashDue }
      : { tone: "neutral", glyph: "ms:check", text: FANOUT.chip.settled };
  return { tone: "flight", glyph: "rail", text: FANOUT.chip.confirming };
}
