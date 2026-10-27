// The Judge stage (S1.6, design §6 J1): the top bar, the console (rail, run pill, the screen) on the left, one
// phone frame on the right, the newest log row of each lane along the bottom, and the honesty caption under
// it. It holds the run the judge is driving: the first view before the first press (no session, no calls),
// then the session's run, kept live by one SSE stream. Every console route renders inside it.

import { type LogLane, type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import { useMotionMode } from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionBanner } from "../chrome/ConnectionBanner.js";
import { ConsoleRail } from "../chrome/ConsoleRail.js";
import { MOCK_DATA, STAGE, stageCaption } from "../chrome/copy.js";
import { nextStep } from "../chrome/next-step.js";
import { Ribbon } from "../chrome/Ribbon.js";
import { RunPill } from "../chrome/RunPill.js";
import { railItems } from "../chrome/rail-items.js";
import { SoundOffer } from "../chrome/SoundOffer.js";
import { StageBar } from "../chrome/StageBar.js";
import { StageNotice, stageNoticeFor } from "../chrome/StageNotice.js";
import { ChromeSlot } from "../chrome/slots.js";
import { WhatsRealSheet } from "../chrome/WhatsRealSheet.js";
import type { FramePersona } from "../data/adapter.js";
import type { LogRow } from "../data/describe.js";
import { useJudgeSession, usePaypalRail, useRunEvents, useRunStream, useStageRun } from "../data/hooks.js";
import { itemCounts } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { format } from "../lib/format.js";
import { DirectorProvider } from "../lib/moment.js";
import { useShortcut } from "../lib/shortcuts.js";
import { StageExtras } from "../screens/W-JG-01/index.js";
import { useSound } from "../sound/sound.js";
import type { FramePrefs } from "./bridge.js";
import { type AutoplayState, type StageApi, StageContext } from "./context.js";
import { StageDirector } from "./director.js";
import { phoneSizeFor, useStageLayout, useViewportHeight } from "./layout.js";
import { PhoneDock } from "./PhoneDock.js";
import { PhoneVisit } from "./PhoneVisit.js";
import { HERO_MEMBER } from "./personas.js";
import { useStageBridge } from "./useStageBridge.js";

const SEASON_FALLBACK = "2026-A";

/** The stage's `data-state` (S1.6), most specific first. */
export type StageState =
  | "phone-visit"
  | "resetting"
  | "start-failed"
  | "autoplay"
  | "paused"
  | "queued"
  | "ai-off"
  | "paypal-off"
  | "session"
  | "ready";

/** The first view's three seeded rows (S1.6: "the last three log rows"), labelled as seeded. */
function firstViewRows(snapshot: SeasonSnapshot | undefined, rail: string): Record<LogLane, LogRow | null> {
  if (!snapshot) return { MACHINE: null, PEOPLE: null, PAYPAL: null };
  const run = snapshot.run;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER")?.shortName ?? "The treasurer";
  const recorded = format.dateShort(run.recordedOn);
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
      `Claude drafted ${snapshot.payer.shortName}'s invoice; policy allowed it`,
      `invoiceEqualsQuote, replay of the ${recorded} run`,
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
      rail === "simulator" ? "Invoicing v2, simulated PayPal sandbox" : "Invoicing v2, PayPal sandbox",
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
  const [raised, setRaised] = useState(false);
  const [whatsReal, setWhatsReal] = useState(false);
  const [autoplay, setAutoplay] = useState<AutoplayState>("off");

  const season = snapshot?.season.label ?? SEASON_FALLBACK;
  const recordedOn = snapshot ? format.dateShort(snapshot.run.recordedOn) : "";
  const byHandSlip = snapshot?.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ?? "0462";
  const payouts = snapshot?.figures.batchItemCount ?? 0;
  const next = useMemo(
    () => nextStep(view, { inSession, season, recordedOn, byHandSlip, payouts }),
    [view, inSession, season, recordedOn, byHandSlip, payouts],
  );

  const raisePhone = useCallback((p: FramePersona) => {
    setPersona(p);
    setRaised(true);
  }, []);
  const lowerPhone = useCallback(() => setRaised(false), []);

  // A co-sign request raises the Chair (S1.6); a frame may ask for focus itself (fs.focus).
  const lastStep = useRef(next.id);
  useEffect(() => {
    if (next.id !== lastStep.current && next.persona) raisePhone(next.persona);
    lastStep.current = next.id;
  }, [next, raisePhone]);

  // When M-014's payment lands, the phone rises for MM-1 (S1.6). History never raises it.
  useRunEvents(inSession ? runSlug : null, (event, meta) => {
    if (meta.replay || event.type !== "item.updated") return;
    if (event.payload.memberNo === HERO_MEMBER && event.payload.to === "SUCCESS") raisePhone("member");
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
  const counts = view ? itemCounts(view) : { total: 0, confirmed: 0 };
  const seeded = useMemo(() => firstViewRows(snapshot, rail), [snapshot, rail]);
  const visit = layout.phone === "phone-visit";
  const notice = stageNoticeFor({ session, view, autoplay, inSession });
  const stageState: StageState = visit ? "phone-visit" : (notice?.state ?? (inSession ? "session" : "ready"));

  const api = useMemo<StageApi>(
    () => ({
      layout,
      phone: { persona, raised, ready },
      raisePhone,
      lowerPhone,
      selectPersona: setPersona,
      director,
      next,
      autoplay,
      setAutoplay,
    }),
    [layout, persona, raised, ready, raisePhone, lowerPhone, director, next, autoplay],
  );

  const onReset = async () => {
    setAutoplay("off");
    lowerPhone();
    await session.reset();
    void navigate({ to: "/judge" });
  };

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
          data-raised={raised ? "" : undefined}
        >
          <a className="fsc-skip" href="#fsc-main">
            {STAGE.skip}
          </a>
          <StageBar
            members={snapshot?.figures.members ?? 0}
            rail={rail}
            mock={env.data === "mock"}
            lockup={layout.railCollapsed}
            proofHref={runSlug ? webRoutes.proof(runSlug) : null}
            confirmed={counts.confirmed}
            total={counts.total || payouts}
            canReset={inSession || session.status === "failed"}
            resetting={session.status === "resetting"}
            onWhatsReal={() => setWhatsReal(true)}
            onReset={() => void onReset()}
          />
          {notice && !visit && <StageNotice notice={notice} onRetry={() => session.dismissError()} />}
          <div className="fsc-stage__body">
            {visit ? (
              <PhoneVisit />
            ) : (
              <div
                className="fsc-console"
                data-rail={layout.railCollapsed ? "collapsed" : "full"}
                onPointerDown={layout.phone === "dock" && raised ? lowerPhone : undefined}
              >
                <ConsoleRail items={items} collapsed={layout.railCollapsed} seasonMark={season} />
                <div className="fsc-console__main">
                  <div className="fsc-console__top">
                    <RunPill
                      view={view}
                      next={next}
                      items={items}
                      onStep={(s) => s.persona && raisePhone(s.persona)}
                    />
                  </div>
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
              onPersona={setPersona}
              onRaise={() => setRaised(true)}
              onLower={lowerPhone}
              bridge={bridge}
              view={view}
              snapshot={snapshot}
              size={phoneSize}
            />
          </div>
          {!visit && <Ribbon view={inSession ? view : undefined} seeded={seeded} />}
          <footer className="fsc-stage__caption fs-t-caption" data-testid="W-JG-01.caption">
            <span>{stageCaption(recordedOn)}</span>
            {env.data === "mock" && <span className="fsc-stage__mocknote">{MOCK_DATA.note}</span>}
          </footer>
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
            }}
          />
          <StageExtras />
        </div>
      </DirectorProvider>
    </StageContext.Provider>
  );
}
