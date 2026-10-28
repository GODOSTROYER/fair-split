// The Judge stage (S1.6, design §6 J1): one bar on top (the honesty line, the run pill in its centre, What's
// real, Sound, Reset and Proof), the console (rail and the screen) on the left, one phone frame on the right,
// and the ribbon along the bottom: the newest log row of each lane, the phone's lane between 1024 and 1679 px,
// and the honesty caption at its end. Nothing else takes the screens' height. It holds the run the judge is
// driving: the first view before the first press (no session, no calls), then the session's run, kept live by
// one SSE stream. Every console route renders inside it.

import { type LogLane, type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import { useMotionMode } from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useJudgeSession, usePaypalRail, useRunEvents, useRunStream, useStageRun } from "../data/hooks.js";
import { itemCounts } from "../data/run-view.js";
import { env } from "../lib/env.js";
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
import { HERO_MEMBER } from "./personas.js";
import { useStageBridge } from "./useStageBridge.js";

const SEASON_FALLBACK = "2026-A";

/** The stage's `data-state` (S1.6), most specific first. */
export type StageState =
  | "phone-visit"
  | "resetting"
  | "reset-failed"
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

  // A moment, a step or a frame raises the phone beside the screen: the console stays lit, so the moment reads
  // on both screens at once. Only the viewer's own raise lays the scrim over the console.
  const raisePhone = useCallback((p: FramePersona) => {
    setPersona(p);
    setRaisedBy("moment");
  }, []);
  const raiseByViewer = useCallback(() => setRaisedBy("user"), []);
  const lowerPhone = useCallback(() => setRaisedBy(null), []);

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
  // Where the run stands with each place: the first view's step is the Season's press; a settled run is done.
  const ratified = snapshot !== undefined;
  const places = useMemo(
    () => placeStates(items, next.id === "done" ? null : next.screen, ratified),
    [items, next, ratified],
  );
  const counts = view ? itemCounts(view) : { total: 0, confirmed: 0 };
  const seeded = useMemo(() => firstViewRows(snapshot, rail), [snapshot, rail]);
  const visit = layout.phone === "phone-visit";
  const notice = stageNoticeFor({ session, view, autoplay, inSession });
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
          <a className="fsc-skip" href="#fsc-main">
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
