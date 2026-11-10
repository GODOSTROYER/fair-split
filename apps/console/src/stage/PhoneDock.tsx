// The stage's one phone (S1.6; UI gate round 3): Member, Chair and Clerk over the Expo web export at /app, one
// iframe per persona (named after it) so each keeps its own token and screen. On the steps where the phone shows
// nothing new it folds to a 56 px rail at the right: the phone glyph (it opens the phone), one avatar per frame (it
// opens that frame) and the shown frame's status dot. It opens on its own on the phone's beats (key 2's co-sign,
// "Bayad na", the traced peso) and when the viewer asks. Open from 1440 px it has a column of its own (a narrower
// one below 1680), at full contrast, with "Use the phone" on a line under it until it is the focus; below 1440 px it
// rises beside the screen (a moment's raise leaves the console lit) or over the scrim (the viewer's own raise). The
// member's frame alone, full width, on the phone visit under 1024 px. Folded, the frames stay loaded and keep their
// size (only hidden), so opening shows their last good state, never a reload or a skeleton. The aside never moves in
// the DOM, because a re-parented iframe reloads. Frames load once the console is idle (S2.11: all within 6 s); until
// the app answers, each shows a labelled preview drawn from the run on the stage.

import { Tabs } from "@base-ui/react/tabs";
import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph, PhoneFrame, StateDot, useT } from "@fairsplit/ui-web";
import { useEffect, useRef, useState } from "react";
import { PHONE_RAIL, STAGE } from "../chrome/copy.js";
import type { FramePersona } from "../data/adapter.js";
import type { RunView } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { screenControl, useFocusOnLeave } from "../lib/focus.js";
import { FRAME_PERSONAS, frameSrc } from "./bridge.js";
import { FramePoster } from "./FramePoster.js";
import type { PhoneLayout, PhoneSize } from "./layout.js";
import { personaInfo, personaInitials, personaStatus, personaTone } from "./personas.js";
import type { FrameStatus, StageBridgeApi } from "./useStageBridge.js";

/**
 * The caption under the phone says what the frame shows: S1.6's "The app's web build, running here" only once the
 * app answered; otherwise the preview, the asleep notice or the stand-in, in the frame's own words (I8). The stage
 * prints only the latter (UI gate round 2): a frame showing the app needs no caption.
 */
export function frameCaption(status: FrameStatus, asleep: boolean, appCaption: string): string {
  if (status === "app") return appCaption;
  if (status === "stub") return STAGE.frameCaptionStub;
  return asleep ? STAGE.frameCaptionAsleep : STAGE.frameCaptionPreview;
}

/** Frames that have not said fs.ready by then are shown as asleep. */
export const FRAME_ANSWER_MS = 8000;
/** Frames load after the console is idle, and at the latest this long after the stage mounts (S2.11). */
export const FRAME_IDLE_MS = 2000;

function useIdleFlag(delayMs: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: delayMs });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setIdle(true), Math.min(delayMs, 1200));
    return () => clearTimeout(timer);
  }, [delayMs]);
  return idle;
}

function useAfter(ms: number, start: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!start) return;
    const timer = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(timer);
  }, [ms, start]);
  return done;
}

/** Who raised the phone: the viewer (a scrim over the console) or a moment (the console stays lit). */
export type RaisedBy = "user" | "moment";

export interface PhoneDockProps {
  readonly layout: PhoneLayout;
  readonly persona: FramePersona;
  readonly raised: boolean;
  /** Who raised it; only the viewer's own raise lays the scrim over the console (1024–1439 px). */
  readonly raisedBy?: RaisedBy | null;
  /** Folded to its 56 px rail (round 3): the frames stay loaded, hidden at their size. */
  readonly folded?: boolean;
  readonly onPersona: (persona: FramePersona) => void;
  readonly onRaise: () => void;
  readonly onLower: () => void;
  /** The rail's phone glyph: open a folded phone, or fold an open one. */
  readonly onToggle?: () => void;
  readonly bridge: StageBridgeApi;
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot | undefined;
  /** Phone screen size in px (S1.6: 360 wide on the stage). */
  readonly size: PhoneSize;
}

/** The tab of the frame the phone shows (found by its persona, never the first tab in document order). */
function tabFor(persona: FramePersona): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#fsc-phone-panel [data-testid="W-JG-01.tab.${persona}"]`);
}

/**
 * The docked phone's resting face (1440 px and up, open): one button over the phone and the line under it, where
 * "Use the phone" sits, outside the device (the statement stays at full contrast); pressing it raises the phone, and
 * the button goes while it holds the keyboard. In that commit, before it goes, focus moves to the tab of the frame the
 * phone shows, so the next Tab goes on inside the phone, never back to the skip link from <body> (WCAG 2.4.3).
 */
function PhoneScrim({
  onRaise,
  tab,
}: {
  readonly onRaise: () => void;
  readonly tab: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnLeave(ref, tab);
  return (
    <button
      ref={ref}
      type="button"
      className="fsc-dock__scrim"
      onClick={onRaise}
      data-testid="W-JG-01.phoneScrim"
    >
      <span className="fsc-dock__scrim-label fs-t-label">
        <Glyph name="ms:fingerprint" size={16} />
        {STAGE.focusPhone}
      </span>
    </button>
  );
}

/** The rail's phone glyph (1.6 px line at 20 px, like the set): a handset with its speaker slot. */
function PhoneGlyph() {
  return (
    <svg className="fs-glyph" width={20} height={20} viewBox="0 0 20 20" aria-hidden focusable="false">
      <rect
        x={5.5}
        y={2.5}
        width={9}
        height={15}
        rx={2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path d="M8.5 5h3" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/** A frame of the phone holds focus: the page's own focus sits on its <iframe>. */
function frameHoldsFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && active.closest("#fsc-phone-panel") !== null;
}

/** Hands focus that a frame took to the screen's main control (WCAG 2.4.3), without scrolling the stage. */
function handFocusBack(): void {
  if (frameHoldsFocus()) screenControl()?.focus({ preventScroll: true });
}

/**
 * The app in a frame focuses its own control once it loads (the Member app's M-MB-01 amount), and the browser
 * lets it while the phone is folded (inert, hidden) or dimmed: focus, and the next Tab, would stay in a phone
 * nobody sees. Then it goes to the screen's main control: on the frame's focus event, and on the page's blur
 * (Chromium fires no focus on the <iframe> when its document takes focus), a task later.
 */
function useFocusOutOfLoweredPhone(lowered: boolean): void {
  useEffect(() => {
    if (!lowered) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(timer);
      timer = setTimeout(handFocusBack, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      clearTimeout(timer);
    };
  }, [lowered]);
}

/** The phone's words for its rail: "Nang Celing: Gisusi pa" (member status words are Cebuano, register §7). */
export function phoneLaneWords(
  persona: FramePersona,
  view: RunView | undefined,
  snapshot: SeasonSnapshot | undefined,
): string {
  const info = personaInfo(persona, snapshot);
  const status = personaStatus(persona, view);
  return status ? `${info.name}: ${status}` : info.name;
}

export function PhoneDock({
  layout,
  persona,
  raised,
  raisedBy = "user",
  folded = false,
  onPersona,
  onRaise,
  onLower,
  onToggle,
  bridge,
  view,
  snapshot,
  size,
}: PhoneDockProps) {
  const t = useT();
  const load = useIdleFlag(FRAME_IDLE_MS);
  const asleep = useAfter(FRAME_ANSWER_MS, load);
  const visit = layout === "phone-visit";
  const shown: FramePersona = visit ? "member" : persona;
  const info = personaInfo(shown, snapshot);
  const isFolded = folded && !visit;
  const dimmed = layout === "dock" && !raised && !isFolded;
  const lowered = isFolded || dimmed;
  useFocusOutOfLoweredPhone(lowered);
  const words = phoneLaneWords(shown, view, snapshot);
  const tone = personaTone(shown, view);
  const toggleWords = isFolded ? PHONE_RAIL.expand : PHONE_RAIL.collapse;

  return (
    <aside
      className="fsc-dock"
      data-layout={layout}
      data-raised={raised ? (raisedBy ?? "user") : undefined}
      data-folded={isFolded ? "" : undefined}
      aria-label={PHONE_RAIL.name}
      data-testid="W-JG-01.phone"
    >
      {layout === "tab" && raised && raisedBy !== "moment" && (
        <div
          className="fsc-dock__backdrop"
          // A press on the backdrop never moves focus to <body> first (a browser's default for a surface that
          // takes none): focus stays in the phone until the lowering hands it back.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onLower}
          aria-hidden
          data-testid="W-JG-01.phoneBackdrop"
        />
      )}
      <div id="fsc-phone-panel" className="fsc-dock__panel">
        <Tabs.Root
          value={shown}
          onValueChange={(value) => {
            onPersona(value as FramePersona);
            onRaise();
          }}
          className="fsc-dock__tabsroot"
        >
          {!visit && (
            <div className="fsc-dock__head">
              {onToggle && (
                <button
                  type="button"
                  className="fsc-dock__toggle"
                  aria-expanded={!isFolded}
                  aria-controls="fsc-phone-device"
                  title={`${toggleWords} · ${words}`}
                  onClick={onToggle}
                  data-testid="W-JG-01.phoneTab"
                >
                  <PhoneGlyph />
                  <span className="fs-sr">{`${toggleWords}. ${words}`}</span>
                </button>
              )}
              <Tabs.List className="fsc-dock__tabs" aria-label="Phone frame">
                {FRAME_PERSONAS.map((p) => {
                  const name = personaInfo(p, snapshot).name;
                  return (
                    <Tabs.Tab
                      key={p}
                      value={p}
                      className="fsc-dock__tab fs-t-label"
                      title={name}
                      data-testid={`W-JG-01.tab.${p}`}
                      // The shown frame's avatar opens the phone too: a change of frame raises it through
                      // onValueChange, and the tab already selected fires none (the folded rail's dead click).
                      onClick={p === shown ? onRaise : undefined}
                    >
                      <span className="fsc-dock__avatar" aria-hidden>
                        {personaInitials(name)}
                        {p === shown && tone && <StateDot kind={tone} className="fsc-dock__dot" />}
                      </span>
                      <span className="fsc-dock__tabword">{t(personaInfo(p, snapshot).tab)}</span>
                    </Tabs.Tab>
                  );
                })}
              </Tabs.List>
            </div>
          )}
          <div
            id="fsc-phone-device"
            className="fsc-dock__device"
            data-dimmed={dimmed ? "" : undefined}
            inert={isFolded}
            aria-hidden={isFolded || undefined}
          >
            <div className="fsc-dock__frame" inert={dimmed}>
              <PhoneFrame
                label={`${info.name}'s phone`}
                caption={
                  bridge.status[shown] === "app"
                    ? undefined
                    : frameCaption(bridge.status[shown], asleep, t("W-JG-01.frameCaption"))
                }
                width={size.width}
                height={size.height}
                testId="W-JG-01.frame"
              >
                {FRAME_PERSONAS.map((p) => {
                  const frameStatus = bridge.status[p];
                  return (
                    <Tabs.Panel
                      key={p}
                      value={p}
                      keepMounted
                      className="fsc-frame"
                      data-frame={frameStatus}
                      data-testid={`W-JG-01.panel.${p}`}
                    >
                      {frameStatus !== "app" && (
                        <FramePoster
                          persona={p}
                          view={view}
                          snapshot={snapshot}
                          asleep={asleep && frameStatus === "waiting"}
                          stub={frameStatus === "stub"}
                        />
                      )}
                      {load && (
                        <iframe
                          ref={bridge.attach(p)}
                          name={p}
                          className="fsc-frame__app"
                          src={frameSrc(p, env.appBase)}
                          title={`${personaInfo(p, snapshot).name}'s phone: the app's web build`}
                          referrerPolicy="no-referrer"
                          tabIndex={frameStatus === "app" ? undefined : -1}
                          onFocus={lowered ? handFocusBack : undefined}
                          data-testid={`W-JG-01.frame.${p}`}
                        />
                      )}
                    </Tabs.Panel>
                  );
                })}
              </PhoneFrame>
            </div>
            {dimmed && <PhoneScrim onRaise={onRaise} tab={() => tabFor(shown)} />}
          </div>
        </Tabs.Root>
      </div>
    </aside>
  );
}
