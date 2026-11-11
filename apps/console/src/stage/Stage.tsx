import { payoutReplayed } from "../data/payout-replay.js";
// The Judge stage (S1.6, design §6 J1; UI gate round 4): one bar on top of six items at most ("Fair Split", the
// status area with the one event toast, the run pill in its centre with Play and the chevron whose menu holds the
// screens, the run log, sound and Reset; What's real, the Proof counter on Proof's six checks and the one quiet
// honesty indicator on the right), the console (rail and the screen) on the left and the phone on the right: its
// own column from 1440 px, folded to a 56 px rail where it shows nothing new, rising on its beats. No ribbon: each
// new event toasts for 3 s in the bar (never over a row), and the whole timeline is behind the menu's Run log.
// Under 1024 px the stage is a phone visit: the member's statement. It holds the run the judge is driving: the
// first view before the first press (no session, no calls), then the session's run, kept live by one SSE stream.
// Every console route renders inside it.

import { type LogLane, type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import { useMotionMode } from "@fairsplit/ui-web";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConnectionBanner } from "../chrome/ConnectionBanner.js";
import { ConsoleRail } from "../chrome/ConsoleRail.js";
import { STAGE } from "../chrome/copy.js";
import { EventToast, LogSheet } from "../chrome/EventLog.js";
import { nextStep } from "../chrome/next-step.js";
import { RunPill } from "../chrome/RunPill.js";
import { activeRailItem, placeStates, railItems } from "../chrome/rail-items.js";
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
import { env } from "../lib/env.js";
import { type FocusPlace, focusAndReveal, focusInto, rememberFocus, returnFocus } from "../lib/focus.js";
import { format } from "../lib/format.js";
import { DirectorProvider } from "../lib/moment.js";
import { useProofChecks } from "../lib/proof-checks.js";
import { useSearchParam } from "../lib/search-param.js";
import { useShortcut } from "../lib/shortcuts.js";
import { StageExtras } from "../screens/W-JG-01/index.js";
import { useSound } from "../sound/sound.js";
import type { FramePrefs } from "./bridge.js";
import { type AutoplayState, type StageApi, StageContext } from "./context.js";
import { StageDirector } from "./director.js";
import { phoneRestsFolded, phoneSizeFor, useStageLayout, useViewportHeight } from "./layout.js";
import { PhoneDock, type RaisedBy } from "./PhoneDock.js";
import { PhoneVisit, VisitMenu } from "./PhoneVisit.js";
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
      "Invoice lines: a seeded sample",
      "Claude did not draft them in this build. Code quotes every amount",
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
  const pathname = useLocation({ select: (location) => location.pathname });
  const screenRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [pathname]);
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
  const [logOpen, setLogOpen] = useState(false);
  const [autoplay, setAutoplay] = useState<AutoplayState>("off");

  const season = snapshot?.season.label ?? SEASON_FALLBACK;
  // Who the judge acts as, for the rail's foot: "AS Analyn · Treasurer".
  const officer = snapshot?.officers.find((o) => o.role === "TREASURER");
  const treasurer = officer
    ? {
        initials: officer.initials,
        first: officer.shortName.split(" ")[0] ?? officer.shortName,
        role: "Treasurer",
      }
    : null;
  const recordedOn = snapshot ? format.dateShort(snapshot.run.recordedOn) : "";
  const byHandSlip = snapshot?.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ?? "0462";
  const payouts = snapshot?.figures.batchItemCount ?? 0;
  const cashMembers = snapshot?.figures.cashMembers ?? 0;
  // The hold open in the drawer: the pill names its decision instead of pointing elsewhere.
  const openHold = useSearchParam("hold") ?? null;
  const next = useMemo(
    () =>
      nextStep(view, {
        inSession,
        pressing: session.pressing,
        season,
        recordedOn,
        byHandSlip,
        payouts,
        openHold,
        cashMembers,
      }),
    [view, inSession, session.pressing, season, recordedOn, byHandSlip, payouts, openHold, cashMembers],
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
  // The docked phone (1440 px and wider) always has its own column, whatever the rail does beside it.
  const besideAt = (l: typeof layout) => l.phone === "dock" || !l.railCollapsed;
  const roomBeside = useRef(besideAt(layout));
  roomBeside.current = besideAt(layout);
  const raisePhone = useCallback(
    (p: FramePersona) => {
      setPersona(p);
      if (roomBeside.current) setRaisedBy((current) => (current === "user" ? "user" : "moment"));
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
  // Below 1440 px the lowered phone keeps its rail (round 3), whose avatars stay live: focus left on one of them, or
  // anywhere in the phone, still goes back to what raised it, as it did when the whole panel went inert.
  const tabLayout = useRef(layout.phone === "tab");
  tabLayout.current = layout.phone === "tab";
  useLayoutEffect(() => {
    const lowering = lowerTo.current;
    lowerTo.current = null;
    if (raisedBy !== null || !lowering) return;
    const inPhone = document.getElementById("fsc-phone-panel")?.contains(document.activeElement) ?? false;
    returnFocus(lowering.opener, inPhone && tabLayout.current ? { when: "always" } : {});
  }, [raisedBy]);

  // A co-sign request raises the Chair (S1.6); a frame may ask for focus itself (fs.focus).
  const lastStep = useRef(next.id);
  useEffect(() => {
    if (next.id !== lastStep.current) {
      if (next.persona) raisePhone(next.persona);
      else if (raisedByRef.current === "moment") lowerPhone();
    }
    lastStep.current = next.id;
  }, [next, raisePhone, lowerPhone]);

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
  const bridge = useStageBridge(prefs, {
    onFocus: (p) => {
      if (p === next.persona) raisePhone(p);
    },
  });
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
  const checks = useProofChecks(inSession ? runSlug : null);
  const seeded = useMemo(() => firstViewRows(snapshot, rail), [snapshot, rail]);
  const visit = layout.phone === "phone-visit";

  // The phone's fold (round 3): it rests folded to its rail where it shows nothing new (and below 1680 px), opens
  // on its beats (a raise), and the viewer's own choice holds on this screen until they move on.
  const [foldChoice, setFoldChoice] = useState<{ readonly path: string; readonly folded: boolean } | null>(
    null,
  );
  const restsFolded = phoneRestsFolded(layout, activeRailItem(pathname), next.id);
  const chosenFold = foldChoice?.path === pathname ? foldChoice.folded : null;
  // Below 1440 px the phone has no column of its own: lowered, it is its rail. From 1440 px it has one, and the
  // viewer's choice (open or folded) holds on this screen.
  const folded = !visit && !raised && (layout.phone === "tab" || (chosenFold ?? restsFolded));
  const togglePhone = () => {
    setFoldChoice({ path: pathname, folded: !folded });
    if (folded) raiseByViewer();
    else lowerPhone();
  };
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
    // The rail's phone glyph sits in the panel's head (round 3): focus on it is the opener's, not the phone's.
    const active = document.activeElement;
    const onToggle = active instanceof HTMLElement && active.dataset.testid === "W-JG-01.phoneTab";
    if (panel.contains(active) && !onToggle) {
      const to = tab();
      if (asked && to && document.activeElement !== to) focusAndReveal(to);
      return;
    }
    // From the glyph, focus goes on into the frames' tabs (the glyph is in the panel, so the panel is no test).
    const into = onToggle ? (panel.querySelector<HTMLElement>(".fsc-dock__tabs") ?? panel) : panel;
    return focusInto(into, tab);
  }, [consoleUnderScrim, persona]);

  const onReset = async () => {
    setAutoplay("off");
    lowerPhone();
    setPersona("member");
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
    setPersona("member");
    void navigate({ to: "/judge" });
  }, [ended, lowerPhone, navigate]);

  useEffect(() => {
    if (session.status === "none" || session.status === "ended") setPersona("member");
  }, [session.status]);

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
          data-phone={visit ? undefined : folded ? "folded" : "open"}
        >
          <a className="fsc-skip" href="#fsc-main" ref={skipLink}>
            {STAGE.skip}
          </a>
          <StageBar
            rail={rail}
            mock={env.data === "mock"}
            pill={
              visit ? null : (
                <RunPill
                  view={view}
                  next={next}
                  items={items}
                  onStep={(s) => s.persona && raisePhone(s.persona)}
                  // Round 4: the run log, sound and Reset live in the chevron's menu (six items in the bar).
                  utilities={{
                    onLog: () => setLogOpen(true),
                    canReset: inSession || session.status === "failed",
                    resetting: session.status === "resetting",
                    onReset: () => void onReset(),
                  }}
                />
              )
            }
            // Round 4: the one event toast lives in the bar's status area, so it never covers a row.
            status={visit ? null : <EventToast runSlug={inSession ? runSlug : null} />}
            // The phone visit's bar keeps the product, the simulation status and its controls; Proof moves into
            // its overflow menu, with the laptop line and the link (round 3).
            proofHref={!visit && runSlug ? webRoutes.proof(runSlug) : null}
            overflow={visit ? <VisitMenu proofHref={runSlug ? webRoutes.proof(runSlug) : null} /> : null}
            checks={checks}
            replayed={replayed}
            canReset={inSession || session.status === "failed"}
            resetting={session.status === "resetting"}
            onWhatsReal={() => setWhatsReal(true)}
            onLog={() => setLogOpen(true)}
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
                  states={places}
                  {...(treasurer ? { actor: treasurer } : {})}
                  {...(next ? { nextActor: next.actor } : {})}
                />
                <div className="fsc-console__main">
                  <ConnectionBanner status={stream} />
                  <div className="fsc-console__body">
                    <main id="fsc-main" className="fsc-console__screen" tabIndex={-1} ref={screenRef}>
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
              folded={folded}
              onPersona={setPersona}
              onRaise={raiseByViewer}
              onLower={lowerPhone}
              onToggle={togglePhone}
              bridge={bridge}
              view={view}
              snapshot={snapshot}
              size={phoneSize}
            />
          </div>
          <LogSheet
            open={logOpen}
            onOpenChange={setLogOpen}
            view={inSession ? view : undefined}
            seeded={seeded}
          />
          <ChromeSlot name="stage.overlay" className="fsc-stage__overlay" />
          {/* No sound offer (UI gate round 2): the speaker icon in the bar, off by default, is the one control. */}
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
