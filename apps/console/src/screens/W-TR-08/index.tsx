// W-TR-08 Run (S1.7, design §6 C8; UI gate round 3): the fan is the hero, full width (MM-6, "Honest fan-out"):
// the 180-unit seal, eight threads to eight named rows, and the cash as one hatched ribbon into one labelled block.
// The run's one hero count, "7/8" in FS Sans and "confirmed", sits right above the seal; beneath the fan Rhea's
// decision when she is parked, then the money bar with its one micro-tag; then the last five events and the latency
// dots. PayPal's 201 draws eight threads to 70% in neutral: sent, not paid. Each verified SUCCESS finishes its
// thread and floods its marker jade, one scale note each, landings at least 250 ms apart. Rhea's item parks: her
// path runs on to her own marker in marigold, never red, and a slab moves her to cash. Once PayPal is complete the
// 57 members' cash still due reads apart from the 7 confirmed (a jade dot against the hatch), with "Review cash
// handover" until it is attested. A repeated delivery logs one quiet row and moves nothing. History is drawn in
// place; only live events animate.

import { webRoutes } from "@fairsplit/contracts";
import { Chip, feedback, Glyph, MicroTag, Numeral, Slab, StateDot } from "@fairsplit/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { railTag } from "../../chrome/copy.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { RunRouteGate } from "../../chrome/Fallbacks.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { describeEvent, type LogRow } from "../../data/describe.js";
import { useCommand, useDescribeContext, usePaypalRail } from "../../data/hooks.js";
import { payoutReplayed, payoutStatus } from "../../data/payout-replay.js";
import { MoneyBar, type MoneySegment } from "../../features/approve/MoneyBar.js";
import {
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
  // "Pay in cash" goes away once the line moves: focus goes to the line that says where the cash is now.
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
  // Between PayPal's return and the line's own move, neither card nor line may be drawn: then the run's status row
  // takes focus, at the top, so the fan stays in view.
  useFocusAfterRemoval(fanRoot, () => [
    fanRoot?.querySelector<HTMLElement>('[data-testid="W-TR-08.rerouted"]') ?? null,
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

  const title = (
    <header className="fsr-screen__head">
      <h1 id="W-TR-08-title" className="fs-t-title">
        {FANOUT.title}
      </h1>
      <p className="fsr-screen__slug fs-t-id">{runLabel(runSlug).text}</p>
    </header>
  );

  if (data.access !== "allowed") return <RunRouteGate data={data} />;
  if (data.error && !view) {
    return (
      <ScreenRoot
        id="W-TR-08"
        state="error"
        className="fsr-screen fsr-fanout-screen"
        labelledBy="W-TR-08-title"
      >
        {title}
        <CommandNotice error={data.error} testId="W-TR-08.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  }
  if (!snapshot || !view || !fan || !state) {
    return (
      <ScreenRoot
        id="W-TR-08"
        state="loading"
        className="fsr-screen fsr-fanout-screen"
        labelledBy="W-TR-08-title"
      >
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
  const moved = fan.threads.find((t) => t.tone === "moved");
  const screenState: ScreenState<"W-TR-08"> = state;
  const lat = latency(view, fan);
  const tag = railTag(rail);

  // The status: the run's one hero count (confirmed of sent), then one fact or one pill beneath it. Never a sentence
  // about the rail: the tag says it once. Once PayPal is complete, its confirmed payments wear the jade dot and the
  // cash still due reads apart in neutral with its hatch, with "Review cash handover" until it is attested: PayPal
  // complete, cash due, never "done".
  const cashDue = fan.cash.members > 0 && fan.cash.amountState !== "attested";
  const status = (() => {
    if (state === "denied") return null;
    if (!isPosted) return { text: FANOUT.notPosted, link: true } as const;
    if (replayed) return { text: FANOUT.replayedStatus } as const;
    const count = `${counts.confirmed}/${counts.sent}`;
    if (state === "done")
      return {
        count,
        unit: FANOUT.confirmedOnPaypal,
        paid: true,
        due: cashDue ? FANOUT.cashDue(summary.cash, cashDay) : FANOUT.cashPaid(summary.cash),
      } as const;
    if (state === "parked")
      return {
        count,
        unit: FANOUT.confirmedWord,
        pill: FANOUT.needsYou(counts.parked + counts.failed),
      } as const;
    return {
      count,
      unit: FANOUT.confirmedWord,
      micro: posted
        ? FANOUT.posted(format.time(posted), format.elapsedClock(now - Date.parse(posted)))
        : FANOUT.postedSeeded,
    } as const;
  })();

  // The money bar's rows: what PayPal confirmed, what is still in flight, what waits on a person, and the cash.
  const onRail = fan.threads.filter((t) => t.tone !== "moved");
  const sum = (list: readonly { readonly cents: number }[]) => list.reduce((s, t) => s + t.cents, 0);
  const group = (tones: readonly string[]) =>
    onRail.filter((t) => !t.replayed && (tones as readonly string[]).includes(t.tone));
  const replayedThreads = onRail.filter((t) => t.replayed);
  const paypalRows: MoneySegment[] = (
    [
      ["confirmed", "confirmed", group(["landed"])],
      ["flight", "flight", group(["sent"])],
      ["planned", "planned", group(["unsent"])],
      ["held", "held", group(["parked"])],
      ["failed", "failed", group(["failed"])],
      ["returned", "planned", group(["returned"])],
      ["replayed", "flight", replayedThreads],
    ] as const
  )
    .filter(([, , list]) => list.length > 0)
    .map(([key, tone, list]) => ({
      key,
      tone,
      cents: sum(list),
      label: FANOUT.legend[key],
      count: list.length,
      amount: format.money(sum(list)),
    }));
  const segments: MoneySegment[] = [
    ...paypalRows,
    {
      key: "cash",
      tone: "cash",
      cents: fan.cash.cents,
      label: FANOUT.legend.cash,
      count: fan.cash.members,
      note: FANOUT.dueOn(cashDay),
      amount: format.money(fan.cash.cents),
    },
    // Once every item is terminal: what the holds kept inside the members' share.
    ...(state === "done" && snapshot.figures.redirectedCents > 0
      ? [
          {
            key: "kept",
            tone: "kept",
            cents: snapshot.figures.redirectedCents,
            label: FANOUT.legend.kept,
            amount: summary.kept,
          } as const,
        ]
      : []),
  ];

  return (
    <ScreenRoot
      id="W-TR-08"
      state={screenState}
      className="fsr-screen fsr-fanout-screen"
      labelledBy="W-TR-08-title"
    >
      {title}
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
        <header className="fsr-fanout__head" data-instrument={status?.count ? "" : undefined}>
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
              {status.count ? (
                <>
                  {/* The screen's one hero count, in FS Sans tabular figures, read with its words. */}
                  <span className="fsr-fanout__instrument">
                    <Numeral value={status.count} className="fsr-fanout__count" testId="W-TR-08.count" />
                    <span className="fsr-fanout__unit fs-t-label">
                      {"paid" in status && <StateDot kind="paid" />}
                      {status.unit}
                    </span>
                  </span>
                  <span className="fsr-fanout__facts">
                    {"micro" in status && status.micro && (
                      <span className="fsr-fanout__micro fs-t-caption">{status.micro}</span>
                    )}
                    {"pill" in status && status.pill && (
                      <Chip tone="canary" glyph="ms:pause">
                        {status.pill}
                      </Chip>
                    )}
                    {"due" in status && status.due && (
                      <span className="fsr-fanout__due fs-t-label" data-testid="W-TR-08.cashDue">
                        <span className="fsr-fanout__swatch" aria-hidden />
                        {status.due}
                      </span>
                    )}
                    {"due" in status && cashDue && (
                      <AppLink
                        href={webRoutes.proof(view.runSlug)}
                        className="fs-link fs-t-label"
                        data-testid="W-TR-08.cashReview"
                      >
                        {FANOUT.reviewCash}
                      </AppLink>
                    )}
                  </span>
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
                </span>
              )}
            </p>
          )}
        </header>

        <Mirrored
          testId="W-TR-08.figureBlock"
          className="fsr-fanout__figure"
          visual={
            <SplitFan fan={fan} animate={landings} drawing={drawing} mode={moment.mode} cashDay={cashDay} />
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
            <div className="fsr-parked__actions">
              <div ref={slabRef}>
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
              <div className="fsr-parked__flat">
                <button
                  type="button"
                  className="fs-flat"
                  data-size="l"
                  onClick={() => setResendAsked(true)}
                  data-testid="W-TR-08.resend"
                >
                  {FANOUT.resend}
                </button>
                <span className="fs-t-caption fsr-muted">
                  {resendAsked ? FANOUT.resendPending : FANOUT.resendNote}
                </span>
              </div>
            </div>
            {payCash.queuedMs !== null && (
              <p className="fs-t-caption fsr-muted" role="status" data-testid="W-TR-08.queued">
                {`You're next, about ${Math.ceil(payCash.queuedMs / 1000)} s`}
              </p>
            )}
            {payCash.error && <CommandNotice error={payCash.error} testId="W-TR-08.error" />}
          </section>
        )}

        {/* Her line moved to cash, where her decision stood: focus lands here when it goes, just under the fan,
            so the fan stays in view. */}
        {moved && !parked && (
          <p className="fsr-fanout__rerouted" data-testid="W-TR-08.rerouted" tabIndex={-1}>
            <span className="fsr-fanout__swatch" aria-hidden />
            <span className="fs-t-label">{FANOUT.rerouted(moved.name)}</span>
            <span className="fs-t-caption fsr-muted">{FANOUT.dueOn(cashDay)}</span>
          </p>
        )}

        <div className="fsr-fanout__share" data-testid="W-TR-08.share">
          <MoneyBar
            label={FANOUT.shareLabel}
            title={FANOUT.shareTitle}
            segments={segments}
            tag={<MicroTag label={tag} testId="W-TR-08.tag" />}
            {...(replayed ? { footnote: FANOUT.replayedShare(counts.sent, counts.replayedSuccessful) } : {})}
          />
        </div>
      </section>

      <div className="fsr-fanout__below">
        <RunLog
          rows={rows}
          isLive={(id) => live.isLive(id)}
          seeded={view.events.length === 0 && view.origin === "showcase"}
          tag={tag}
          {...(cashDue ? { settledAs: en("W-JG-01.pill.stateCashDue") } : {})}
          footer={
            <p className="fsr-fanout__fees fs-t-caption" data-testid="W-TR-08.fees">
              {replayed ? FANOUT.feesReplayed : FANOUT.feesSoFar}
            </p>
          }
        />
        <aside className="fsr-fanout__side">
          {replayed ? (
            <p className="fs-t-caption fsr-muted">{FANOUT.timingReplayed}</p>
          ) : (
            <LatencyDots
              latency={lat}
              {...(counts.confirmed > 0 && view.events.length === 0
                ? { emptyText: FANOUT.latencySeeded }
                : {})}
            />
          )}
        </aside>
      </div>
    </ScreenRoot>
  );
}
