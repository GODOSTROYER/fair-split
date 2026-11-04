// The stage's one phone (S1.6): Member, Chair and Clerk tabs over the Expo web export at /app, one iframe per
// persona (named after it) so each keeps its own token and screen. Docked at the right from 1680 px under a
// 56% ground scrim until it is the focus; between 1024 and 1679 px it folds into the ribbon's phone lane and
// rises above the ribbon at the right, beside the screen: a moment that raises it (a co-sign request, M-014's
// payment) leaves the console lit and usable, so both screens read at once; only a raise the viewer asked for
// lays the scrim over the console. The member's frame alone on the phone-visit layout under 1024 px. The aside
// never moves in the DOM, because a re-parented iframe reloads. Frames load once the console is idle (S2.11:
// all within 6 s); until the app answers, each shows a labelled preview drawn from the run on the stage.

import { Tabs } from "@base-ui/react/tabs";
import type { SeasonSnapshot } from "@fairsplit/contracts";
import { PhoneFrame, useT } from "@fairsplit/ui-web";
import { useEffect, useRef, useState } from "react";
import { STAGE } from "../chrome/copy.js";
import type { FramePersona } from "../data/adapter.js";
import type { RunView } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { screenControl, useFocusOnLeave } from "../lib/focus.js";
import { FRAME_PERSONAS, frameSrc } from "./bridge.js";
import { FramePoster } from "./FramePoster.js";
import type { PhoneLayout, PhoneSize } from "./layout.js";
import { personaInfo, personaStatus } from "./personas.js";
import type { FrameStatus, StageBridgeApi } from "./useStageBridge.js";

/**
 * The caption under the phone says what the frame shows: S1.6's "The app's web build, running here" only once the
 * app answered; otherwise the preview, the asleep notice or the stand-in, in the frame's own words (I8).
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
  /** Who raised it; only the viewer's own raise lays the scrim over the console (1024–1679 px). */
  readonly raisedBy?: RaisedBy | null;
  readonly onPersona: (persona: FramePersona) => void;
  readonly onRaise: () => void;
  readonly onLower: () => void;
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
 * The docked phone's dimmed face (1680 px and up): "Use the phone" raises it, and the button goes with the dim
 * while it holds the keyboard. In that commit, before it goes, focus moves to the tab of the frame the phone
 * shows, so the next Tab goes on inside the phone, never back to the skip link from <body> (WCAG 2.4.3).
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
      <span className="fsc-dock__scrim-label fs-t-label">{STAGE.focusPhone}</span>
    </button>
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
 * lets it while the phone is lowered (inert, hidden) or dimmed: focus, and the next Tab, would stay in a phone
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

/** The phone lane's words: "Nang Celing: Gisusi pa" (member status words are Cebuano, register §7). */
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
  onPersona,
  onRaise,
  onLower,
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
  const hiddenPanel = layout === "tab" && !raised;
  const dimmed = layout === "dock" && !raised;
  const lowered = hiddenPanel || dimmed;
  useFocusOutOfLoweredPhone(lowered);

  return (
    <aside
      className="fsc-dock"
      data-layout={layout}
      data-raised={raised ? (raisedBy ?? "user") : undefined}
      aria-label="Phone"
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
      <div
        id="fsc-phone-panel"
        className="fsc-dock__panel"
        inert={hiddenPanel}
        aria-hidden={hiddenPanel || undefined}
      >
        <Tabs.Root
          value={shown}
          onValueChange={(value) => {
            onPersona(value as FramePersona);
            onRaise();
          }}
          className="fsc-dock__tabsroot"
        >
          {!visit && (
            <Tabs.List className="fsc-dock__tabs" aria-label="Phone frame">
              {FRAME_PERSONAS.map((p) => (
                <Tabs.Tab
                  key={p}
                  value={p}
                  className="fsc-dock__tab fs-t-label"
                  data-testid={`W-JG-01.tab.${p}`}
                >
                  {t(personaInfo(p, snapshot).tab)}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          )}
          <div className="fsc-dock__device" data-dimmed={dimmed ? "" : undefined}>
            <div className="fsc-dock__frame" inert={dimmed}>
              <PhoneFrame
                label={`${info.name}'s phone`}
                caption={frameCaption(bridge.status[shown], asleep, t("W-JG-01.frameCaption"))}
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
