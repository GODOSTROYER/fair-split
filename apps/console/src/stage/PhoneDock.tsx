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
import { useEffect, useState } from "react";
import { STAGE } from "../chrome/copy.js";
import type { FramePersona } from "../data/adapter.js";
import type { RunView } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { FRAME_PERSONAS, frameSrc } from "./bridge.js";
import { FramePoster } from "./FramePoster.js";
import type { PhoneLayout, PhoneSize } from "./layout.js";
import { personaInfo, personaStatus } from "./personas.js";
import type { StageBridgeApi } from "./useStageBridge.js";

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
                caption={t("W-JG-01.frameCaption")}
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
                          data-testid={`W-JG-01.frame.${p}`}
                        />
                      )}
                    </Tabs.Panel>
                  );
                })}
              </PhoneFrame>
            </div>
            {dimmed && (
              <button
                type="button"
                className="fsc-dock__scrim"
                onClick={onRaise}
                data-testid="W-JG-01.phoneScrim"
              >
                <span className="fsc-dock__scrim-label fs-t-label">{STAGE.focusPhone}</span>
              </button>
            )}
          </div>
        </Tabs.Root>
      </div>
    </aside>
  );
}
