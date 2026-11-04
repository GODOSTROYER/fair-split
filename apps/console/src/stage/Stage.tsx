import { payoutReplayed } from "../data/payout-replay.js";
// The Judge stage (S1.6, design §6 J1): one bar on top (the honesty line, the run pill in its centre, What's
// real, Sound, Reset and Proof), the console (rail and the screen) on the left, one phone frame on the right,
// and the ribbon along the bottom: the newest log row of each lane, the phone's lane between 1024 and 1679 px,
// and the honesty caption at its end. Nothing else takes the screens' height. It holds the run the judge is
// driving: the first view before the first press (no session, no calls), then the session's run, kept live by
// one SSE stream. Every console route renders inside it.

import { type LogLane, type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import { useMotionMode } from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConnectionBanner } from "../chrome/ConnectionBanner.js";
import { ConsoleRail } from "../chrome/ConsoleRail.js";
import { STAGE, stageCaption, story } from "../chrome/copy.js";
import { nextStep } from "../chrome/next-step.js";
import { Ribbon } from "../chrome/Ribbon.js";
import { RunPill } from "../chrome/RunPill.js";
import { placeStates, railItems } from "../chrome/rail-items.js";
import { SoundOffer } from "../chrome/SoundOffer.js";
import { StageBar } from "../chrome/StageBar.js";
import { StageNotice, stageNoticeFor } from "../chrome/StageNotice.js";
import { ChromeSlot } from "../chrome/slots.js";
import { WhatsRealSheet } from "../chrome/WhatsRealSheet.js";
import type { FramePersona } from "../data/adapter.js";
import type { LogRow } from "../data/describe.js";
import {
  useJudgeReplayRail,
  useJudgeSession,
  usePaypalRail,
  useRunEvents,
  useRunStream,
  useStageRun,
} from "../data/hooks.js";
import { itemCounts } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { type FocusPlace, focusAndReveal, focusInto, rememberFocus, returnFocus } from "../lib/focus.js";
import { format } from "../lib/format.js";
import { DirectorProvider } from "../lib/moment.js";
import { useSearchParam } from "../lib/search-param.js";
import { useShortcut } from "../lib/shortcuts.js";
import { StageExtras } from "../screens/W-JG-01/index.js";
import { useSound } from "../sound/sound.js";
import type { FramePrefs } from "./bridge.js";
import { type AutoplayState, type StageApi, StageContext } from "./context.js";
import { StageDirector } from "./director.js";
import { phoneSizeFor, useStageLayout, useViewportHeight } from "./layout.js";
import { PhoneDock, phoneLaneWords, type RaisedBy } from "./PhoneDock.js";
import { PhoneVisit } from "./PhoneVisit.js";
import { heroPaymentLanded } from "./personas.js";
import { useStageBridge } from "./useStageBridge.js";

const SEASON_FALLBACK = "2026-A";

/**
 * The skip link focuses the screen without fragment navigation: following `#fsc-main` scrolls the stage (a box
 * with overflow) by the bar's height and hides the top bar with its labels, so focus moves with preventScroll.
 */
function skipToScreen(event: MouseEvent): void {
  const main = document.getElementById("fsc-main");
  if (!main) return;
  event.preventDefault();
  focusAndReveal(main);
}

/** The stage's `data-state` (S1.6), most specific first. */
export type StageState =
  | "replay"
  | "phone-visit"
  | "resetting"
  | "session-ended"
  | "reset-failed"
  | "start-failed"
  | "autoplay"
  | "paused"
  | "queued"
  | "circuit"
  | "balance-low"
  | "ai-off"
  | "paypal-off"
  | "session"
  | "ready";

/** The first view's three seeded rows (S1.6: "the last three log rows"), labelled as seeded. */
function firstViewRows(snapshot: SeasonSnapshot | undefined, rail: string): Record<LogLane, LogRow | null> {
  if (!snapshot) return { MACHINE: null, PEOPLE: null, PAYPAL: null };
  const run = snapshot.run;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER")?.shortName ?? "The treasurer";
  const row = (lane: LogLane, words: string, detail: string, at: string): LogRow => ({
    id: `seed-${lane}`,
    lane,
    words,
    detail,
    at,
    type: "policy.verdict",
    provenance: "seeded",
    duplicate: false,
  });
  return {
    MACHINE: row(
      "MACHINE",
      "Placeholder draft (seed-written), checked by the live policy lattice",
      "Line labels: a placeholder written with the seed (no Claude recording in this build)",
      run.recordedOn,
    ),
    PEOPLE: row(
      "PEOPLE",
      `${treasurer} approved sending the invoice`,
      "Seeded approval",
      run.invoice.invoiceDate,
    ),
    PAYPAL: row(
      "PAYPAL",
      `Invoice ${run.invoice.invoiceNumber}: sent to ${snapshot.payer.shortName}`,
      rail === "simulator"
        ? "Invoicing v2, simulated PayPal sandbox"
        : "Invoicing v2, untested PayPal sandbox",
      run.invoice.invoiceDate,
    ),
  };
}

export function Stage({ children }: { readonly children: ReactNode }) {
  const layout = useStageLayout();
  const viewportHeight = useViewportHeight();
  const navigate = useNavigate();
  const motion = useMotionMode();
  const sound = useSound();
  const session = useJudgeSession();
  const rail = usePaypalRail() ?? env.paypalRail;
  const { runSlug, view, inSession, snapshot } = useStageRun();
  const stream = useRunStream(inSession ? runSlug : null);
  const director = useMemo(() => new StageDirector(), []);
  const [persona, setPersona] = useState<FramePersona>("member");
  const [raisedBy, setRaisedBy] = useState<RaisedBy | null>(null);
  const raised = raisedBy !== null;
  const [whatsReal, setWhatsReal] = useState(false);
  const [autoplay, setAutoplay] = useState<AutoplayState>("off");

  const season = snapshot?.season.label ?? SEASON_FALLBACK;
  const recordedOn = snapshot ? format.dateShort(snapshot.run.recordedOn) : "";
  const byHandSlip = snapshot?.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ?? "0462";
  const payouts = snapshot?.figures.batchItemCount ?? 0;
  // The hold open in the drawer: the pill names its decision instead of pointing elsewhere.
  const openHold = useSearchParam("hold") ?? null;
  const next = useMemo(
    () => nextStep(view, { inSession, season, recordedOn, byHandSlip, payouts, openHold }),
    [view, inSession, season, recordedOn, byHandSlip, payouts, openHold],
  );

  // The viewer's own raise (1024-1679 px) lays a scrim over the console: the console goes inert under it, focus
  // moves into the phone, and lowering hands focus back to whatever raised it.
  const raiseOpener = useRef<FocusPlace | null>(null);
  const raisedByRef = useRef(raisedBy);
  raisedByRef.current = raisedBy;
  const raiseByViewer = useCallback(() => {
    if (raisedByRef.current !== "user") raiseOpener.current = rememberFocus();
    setRaisedBy("user");
  }, []);
  // A raise that asks for a frame while the phone is already up over the scrim (the co-sign request switches it
  // to the Chair's): focus follows to that frame's tab.
  const askedFrame = useRef(false);
  const shown = useRef(persona);
  shown.current = persona;
  // A moment, a step or a frame raises the phone beside the screen: the console stays lit, so the moment reads
  // on both screens at once. Below 1280 px there is no room beside it (the screen would be 488 px: the approve
  // column ran under the phone, the fan's labels overlapped), so the phone rises over the scrim, as S1.6's table
  // has it for that width.
  const roomBeside = useRef(!layout.railCollapsed);
  roomBeside.current = !layout.railCollapsed;
  const raisePhone = useCallback(
    (p: FramePersona) => {
      setPersona(p);
      if (roomBeside.current) setRaisedBy("moment");
      else {
        askedFrame.current = p !== shown.current;
        raiseByViewer();
      }
    },
    [raiseByViewer],
  );
  // A lowering on its way: what raised the phone (null when nothing did: MM-1 rises while focus is on <body>).
  const lowerTo = useRef<{ readonly opener: FocusPlace | null } | null>(null);
  const lowerPhone = useCallback(() => {
    const opener = raisedByRef.current === "user" ? raiseOpener.current : null;
    raiseOpener.current = null;
    if (raisedByRef.current !== null) lowerTo.current = { opener };
    setRaisedBy(null);
  }, []);
  // Focus goes back to what raised the phone (or its successor, redrawn) in the commit that lowered it, when the
  // console under the scrim is live again; with nothing to go back to, focus still held by the panel going inert
  // goes to the screen's main control (or the drawer covering it), never to <body> (WCAG 2.4.3). Never on a timer:
  // one that fires before that commit finds the console still inert, the browser refuses the focus, and the panel
  // then drops it to <body> (lib/focus.ts).
  useLayoutEffect(() => {
    const lowering = lowerTo.current;
    lowerTo.current = null;
    if (raisedBy !== null || !lowering) return;
    returnFocus(lowering.opener);
  }, [raisedBy]);

  // A co-sign request raises the Chair (S1.6); a frame may ask for focus itself (fs.focus).
  const lastStep = useRef(next.id);
  useEffect(() => {
    if (next.id !== lastStep.current && next.persona) raisePhone(next.persona);
    lastStep.current = next.id;
  }, [next, raisePhone]);

  // When M-014's payment lands in this run, the phone rises for MM-1 (S1.6). History never raises it, and neither
  // does a replayed SUCCESS: it is the earlier run's, never this one's landing.
  useRunEvents(inSession ? runSlug : null, (event, meta) => {
    if (meta.replay) return;
    if (heroPaymentLanded(event)) raisePhone("member");
  });

  const prefs = useMemo<FramePrefs>(
    () => ({
      tier: motion === "full" ? "full" : "low",
      sound: sound.on,
      reducedMotion: motion === "reduced",
      gloss: true,
    }),
    [motion, sound.on],
  );
  const bridge = useStageBridge(prefs, { onFocus: (p) => raisePhone(p) });
  const ready = useMemo(
    () => ({
      member: bridge.status.member === "app",
      chair: bridge.status.chair === "app",
      clerk: bridge.status.clerk === "app",
    }),
    [bridge.status],
  );

  useShortcut({
    id: "stage.lower-phone",
    keys: "Escape",
    label: "Lower the phone",
    group: "General",
    when: () => layout.phone === "tab" && raised,
    run: lowerPhone,
  });

  const items = useMemo(() => railItems(season, runSlug), [season, runSlug]);
  // Where the run stands with each place: the first view's step is the Season's press; a settled run is done.
  const ratified = snapshot !== undefined;
  const places = useMemo(
    () => placeStates(items, next.id === "done" ? null : next.screen, ratified),
    [items, next, ratified],
  );
  const counts = view ? itemCounts(view) : { total: 0, confirmed: 0 };
  const seeded = useMemo(() => firstViewRows(snapshot, rail), [snapshot, rail]);
  const visit = layout.phone === "phone-visit";
  const replayRail = useJudgeReplayRail();
  const replayReason = replayRail?.reason ?? null;
  const replayed = payoutReplayed(view);
  const notice = stageNoticeFor({
    session,
    view,
    autoplay,
    inSession,
    replayReason,
    sessionRunState: replayRail?.runState,
  });
  const stageState: StageState = visit ? "phone-visit" : (notice?.state ?? (inSession ? "session" : "ready"));

  const api = useMemo<StageApi>(
    () => ({
      layout,
      phone: { persona, raised, raisedBy, ready },
      raisePhone,
      lowerPhone,
      selectPersona: setPersona,
      director,
      next,
      autoplay,
      setAutoplay,
    }),
    [layout, persona, raised, raisedBy, ready, raisePhone, lowerPhone, director, next, autoplay],
  );

  const skipLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const link = skipLink.current;
    link?.addEventListener("click", skipToScreen);
    return () => link?.removeEventListener("click", skipToScreen);
  }, []);

  // Over the scrim, focus moves into the phone, to the tab of the frame it shows (the Chair's, for a co-sign), in
  // the commit that raised it: the console under it goes inert, and a browser would drop that focus to <body>. If
  // the panel cannot take focus yet, focusInto tries again each frame until it can (WCAG 2.4.3). The tab is found
  // by the frame's persona, never the first tab in document order (the Member's). Already up, a raise that asks
  // for another frame moves focus to that frame's tab; a tab the judge picks keeps the focus they gave it.
  const consoleUnderScrim = layout.phone === "tab" && raisedBy === "user";
  useLayoutEffect(() => {
    const asked = askedFrame.current;
    askedFrame.current = false;
    if (!consoleUnderScrim) return;
    const panel = document.getElementById("fsc-phone-panel");
    if (!panel) return;
    const tab = () =>
      panel.querySelector<HTMLElement>(`[role="tab"][data-testid="W-JG-01.tab.${shown.current}"]`) ??
      panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (panel.contains(document.activeElement)) {
      const to = tab();
      if (asked && to && document.activeElement !== to) focusAndReveal(to);
      return;
    }
    return focusInto(panel, tab);
  }, [consoleUnderScrim, persona]);

  const onReset = async () => {
    setAutoplay("off");
    lowerPhone();
    try {
      await session.reset();
    } catch {
      // The server still holds the session: the stage's strip says so, with its request ID and "Try Reset again".
    }
    void navigate({ to: "/judge" });
  };

  // The server ended the session meanwhile (a renewal landed in another workspace: a Reset in another tab, or
  // it expired): the strip says the stage is back at the first press, so it goes there, as Reset does. Only on
  // the change into "ended": the judge may move on while the notice is still up.
  const ended = session.status === "ended";
  const wasEnded = useRef(ended);
  useEffect(() => {
    const entered = ended && !wasEnded.current;
    wasEnded.current = ended;
    if (!entered) return;
    setAutoplay("off");
    lowerPhone();
    void navigate({ to: "/judge" });
  }, [ended, lowerPhone, navigate]);

  const phoneSize = phoneSizeFor(layout, viewportHeight);

  return (
    <StageContext.Provider value={api}>
      <DirectorProvider value={director}>
        <div
          className="fsc-stage"
          data-testid="W-JG-01.stage"
          data-state={stageState}
          data-layout={layout.phone}
          data-drawer={layout.drawer}
          data-rail={layout.railCollapsed ? "collapsed" : "full"}
          data-raised={raisedBy ?? undefined}
        >
          <a className="fsc-skip" href="#fsc-main" ref={skipLink}>
            {STAGE.skip}
          </a>
          <StageBar
            members={snapshot?.figures.members ?? 0}
            rail={rail}
            mock={env.data === "mock"}
            lockup={layout.railCollapsed || visit}
            pill={
              visit ? null : (
                <RunPill
                  view={view}
                  next={next}
                  items={items}
                  onStep={(s) => s.persona && raisePhone(s.persona)}
                />
              )
            }
            proofHref={runSlug ? webRoutes.proof(runSlug) : null}
            confirmed={counts.confirmed}
            replayed={replayed}
            total={counts.total || payouts}
            canReset={inSession || session.status === "failed"}
            resetting={session.status === "resetting"}
            onWhatsReal={() => setWhatsReal(true)}
            onReset={() => void onReset()}
          />
          {notice && !visit && (
            <StageNotice
              notice={notice}
              onRetry={() => (notice.state === "reset-failed" ? void onReset() : session.dismissError())}
            />
          )}
          <div className="fsc-stage__body">
            {visit ? (
              <PhoneVisit />
            ) : (
              <div
                className="fsc-console"
                data-rail={layout.railCollapsed ? "collapsed" : "full"}
                onPointerDown={layout.phone === "dock" && raised ? lowerPhone : undefined}
                inert={consoleUnderScrim}
              >
                <ConsoleRail
                  items={items}
                  collapsed={layout.railCollapsed}
                  seasonMark={season}
                  story={story(snapshot?.figures.members ?? 0)}
                  states={places}
                  {...(next ? { nextActor: next.actor } : {})}
                />
                <div className="fsc-console__main">
                  <ConnectionBanner status={stream} />
                  <div className="fsc-console__body">
                    <main id="fsc-main" className="fsc-console__screen" tabIndex={-1}>
                      {children}
                    </main>
                    <ChromeSlot name="console.drawer" className="fsc-console__drawer" />
                  </div>
                </div>
              </div>
            )}
            <PhoneDock
              layout={layout.phone}
              persona={persona}
              raised={raised}
              raisedBy={raisedBy}
              onPersona={setPersona}
              onRaise={raiseByViewer}
              onLower={lowerPhone}
              bridge={bridge}
              view={view}
              snapshot={snapshot}
              size={phoneSize}
            />
          </div>
          {!visit && (
            <Ribbon
              view={inSession ? view : undefined}
              seeded={seeded}
              caption={stageCaption(recordedOn)}
              phone={
                layout.phone === "tab"
                  ? {
                      words: phoneLaneWords(persona, view, snapshot),
                      raised,
                      onToggle: raised ? lowerPhone : raiseByViewer,
                    }
                  : null
              }
            />
          )}
          {visit && (
            <footer className="fsc-stage__caption fs-t-caption" data-testid="W-JG-01.caption">
              <span>{stageCaption(recordedOn)}</span>
            </footer>
          )}
          <ChromeSlot name="stage.overlay" className="fsc-stage__overlay" />
          <SoundOffer />
          <WhatsRealSheet
            open={whatsReal}
            onOpenChange={setWhatsReal}
            facts={{
              rail,
              recordedOn,
              replayPhotos: snapshot?.photos.filter((p) => p.set === "REPLAY").length ?? 0,
              replaySlips: snapshot?.slips.filter((s) => s.replaySet).length ?? 0,
              earlierPhotos: snapshot?.photos.filter((p) => p.set === "EARLIER").length ?? 0,
              members: snapshot?.figures.members ?? 0,
              paypalMembers: snapshot?.figures.onRailMembers ?? 0,
              mock: env.data === "mock",
            }}
          />
          <StageExtras />
        </div>
      </DirectorProvider>
    </StageContext.Provider>
  );
}
