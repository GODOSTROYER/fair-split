// W-TR-08 Run (S1.7, design §6 C8): the split fan on top (MM-6, "Honest fan-out"), the three-lane run log and
// the latency dots beneath. PayPal's 201 draws eight graphite threads to 70%: sent, not paid. Each verified
// SUCCESS finishes its thread and floods its stub jade, one scale note each, landings at least 250 ms apart.
// Rhea's item parks: a canary cap and "Parked", never red, and a d2 slab moves her to cash. A repeated delivery
// logs one quiet row and moves nothing. History is drawn in place; only live events animate.

import { webRoutes } from "@fairsplit/contracts";
import { feedback, Glyph, Slab } from "@fairsplit/ui-web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { describeEvent, type LogRow } from "../../data/describe.js";
import { useCommand, useDescribeContext } from "../../data/hooks.js";
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
import { useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { useMomentScript, usePhaseSync } from "../../features/split/shared/script.js";
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
  const describe = useDescribeContext();
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
      <h1 id="W-TR-08-title" className="fs-t-title-1">
        {FANOUT.title}
      </h1>
      <p className="fsr-screen__slug fs-t-hash">{runSlug}</p>
    </header>
  );

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

  const cashDay = format.dateShort(snapshot.run.cashDay);
  const isPosted = isPostedRun(view);
  const summary = summaryFacts(snapshot, fan);
  const parkedLineId = parked ? (view.lines[parked.memberNo]?.lineId ?? null) : null;
  const moved = fan.threads.find((t) => t.tone === "moved");
  const screenState: ScreenState<"W-TR-08"> = state;
  const lat = latency(view, fan);

  const statusLine = (() => {
    if (state === "denied") return null;
    if (!isPosted) return FANOUT.notPosted;
    if (state === "done") return FANOUT.done(summary.paid, summary.cash, summary.kept);
    if (state === "parked" && parked) return FANOUT.parked(parked.name);
    if (posted)
      return `${FANOUT.waiting(format.time(posted))} ${FANOUT.elapsed(format.elapsedClock(now - Date.parse(posted)))}`;
    return FANOUT.waitingSeeded;
  })();

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
        className="fsr-fanout"
        data-motion={moment.mode}
        aria-labelledby="W-TR-08-figure"
      >
        <header className="fsr-fanout__head">
          <h2 id="W-TR-08-figure" className="fs-t-title-2">
            {FANOUT.figure}
          </h2>
          {statusLine && (
            <p
              className="fsr-fanout__status fs-t-body"
              role="status"
              data-testid="W-TR-08.status"
              data-state={state}
            >
              {statusLine}
              {!isPosted && (
                <>
                  {" "}
                  <AppLink href={webRoutes.approve(view.runSlug)} className="fs-link fs-t-label">
                    {FANOUT.notPostedLink}
                  </AppLink>
                </>
              )}
            </p>
          )}
        </header>
        <div className="fsr-fanout__stage" data-parked={parked ? "" : undefined}>
          <div className="fsr-fanout__main">
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
                        rail: t.tone === "moved" ? FANOUT.railCash : "PayPal",
                        amount: format.money(t.cents),
                        status: view.lines[t.memberNo]
                          ? en(`console.status.${view.lines[t.memberNo]?.state ?? "READY"}`)
                          : t.tone === "unsent"
                            ? en("console.status.READY")
                            : FANOUT.statusWaiting,
                      },
                    })),
                    {
                      key: "cash",
                      cells: {
                        member: FANOUT.cashBandMembers(fan.cash.members, cashDay),
                        rail: FANOUT.railCash,
                        amount: format.money(fan.cash.cents),
                        status: en("console.status.OFF_RAIL_DUE"),
                      },
                    },
                  ]}
                />
              }
            />
            <p className="fsr-fanout__share fs-t-label" data-testid="W-TR-08.share">
              {FANOUT.shareCounts(shareCounts(fan))}{" "}
              <span className="fsr-muted">{FANOUT.shareValue(fan.paypal.share)}</span>
            </p>
          </div>

          {parked && (
            <section className="fsr-parked" aria-labelledby="W-TR-08-parked" data-testid="W-TR-08.parked">
              <h3 id="W-TR-08-parked" className="fs-t-label">
                <span className="fsr-parked__chip">{FANOUT.parkedChip}</span>
                {parked.name}
              </h3>
              <p className="fs-t-body">{FANOUT.rheaWhy(parked.name, format.money(parked.cents))}</p>
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
              <p className="fs-t-caption fsr-muted">{FANOUT.wait}</p>
              {payCash.error && <CommandNotice error={payCash.error} testId="W-TR-08.error" />}
            </section>
          )}
        </div>
        {moved && !parked && (
          <p className="fsr-fanout__rerouted fs-t-body" data-testid="W-TR-08.rerouted">
            <Glyph name="cash" size={18} />
            {FANOUT.rerouted(moved.name, cashDay)}
          </p>
        )}
      </section>

      <div className="fsr-fanout__below">
        <RunLog
          rows={rows}
          isLive={(id) => live.isLive(id)}
          seeded={view.events.length === 0 && view.origin === "showcase"}
        />
        <aside className="fsr-fanout__side">
          <LatencyDots latency={lat} />
          <p className="fsr-fanout__fees fs-t-caption" data-testid="W-TR-08.fees">
            {FANOUT.feesSoFar}
          </p>
        </aside>
      </div>
    </ScreenRoot>
  );
}
