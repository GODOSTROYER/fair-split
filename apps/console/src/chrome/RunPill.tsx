// The run pill (S1.6; UI gate round 4): the top bar's one centre group. "● Next: …" links to the screen whose control
// is pre-focused; a small mark says who moves the run next (canary when a person must decide, pencil while the
// machine reads, an open ring while PayPal confirms); "Play it for me" (the season slice's) sits in its accessory slot;
// the chevron opens the stage's one menu: the six console screens, the run log, sound, Reset (while there is a session
// to end) and Shortcuts. The run's state word is no longer a grey segment that repeats the page title: it is spoken
// with the pill (it still never overclaims: "PayPal complete · cash due" while cash is due).

import { Menu } from "@base-ui/react/menu";
import { Glyph, HONESTY, LegendGlyph, useT } from "@fairsplit/ui-web";
import type { RunView } from "../data/run-view.js";
import { useShortcuts } from "../lib/shortcuts.js";
import { useSound } from "../sound/sound.js";
import { AppLink } from "./AppLink.js";
import { LOG, STAGE } from "./copy.js";
import type { NextStep } from "./next-step.js";
import type { RailItem } from "./rail-items.js";
import { ChromeSlot } from "./slots.js";

/** The stage's own utilities, which live in the chevron's menu (round 4: the top bar keeps six items). */
export interface StageUtilities {
  /** Opens the run's whole timeline (the Log sheet). */
  readonly onLog: () => void;
  /** Reset is offered while there is a session to end (or a start that failed). */
  readonly canReset: boolean;
  readonly resetting: boolean;
  readonly onReset: () => void;
}

export interface RunPillProps {
  readonly view: RunView | undefined;
  readonly next: NextStep;
  readonly items: readonly RailItem[];
  readonly onStep?: (step: NextStep) => void;
  readonly utilities?: StageUtilities;
}

export function RunPill({ view, next, items, onStep, utilities }: RunPillProps) {
  const t = useT();
  const shortcuts = useShortcuts();
  const sound = useSound();
  // The step's own state word where the register's would overclaim (cash still due is never "Settled").
  const state = view
    ? (next.stateWord ?? t(`run.${view.state}`, { treasurer: "Analyn", chair: "Ernesto" }))
    : "";
  return (
    <div className="fsc-pill" data-testid="W-JG-01.runPill" data-step={next.id} data-actor={next.actor}>
      {state && (
        <span
          className="fsc-pill__state fs-sr"
          data-keep={next.stateWord ? "" : undefined}
          data-testid="W-JG-01.runPill.state"
        >
          {state}
        </span>
      )}
      <AppLink
        href={next.to}
        className="fsc-pill__next fs-t-label"
        data-testid="W-JG-01.runPill.next"
        onClick={() => onStep?.(next)}
      >
        <span className="fsc-pill__mark" aria-hidden />
        <span>{next.text}</span>
        {/* The reading replays the seed stand-in: its glyph says so (the pinned phrase is its name), no sentence. */}
        {next.id === "reading" && <LegendGlyph {...HONESTY.seedStandIn} className="fsc-pill__glyph" />}
      </AppLink>
      <ChromeSlot name="pill.accessory" as="span" className="fsc-pill__slot" />
      <Menu.Root>
        <Menu.Trigger className="fsc-pill__menu" aria-label={STAGE.menu} data-testid="W-JG-01.runPill.menu">
          <Glyph name="ms:expand-more" size={18} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="fsc-menu__positioner" sideOffset={8} align="end">
            <Menu.Popup className="fsc-menu" data-testid="W-JG-01.runPill.menuPopup">
              {items.map((item) => (
                <Menu.LinkItem
                  key={item.id}
                  className="fsc-menu__item"
                  render={<AppLink href={item.href} />}
                  data-testid={`W-JG-01.menu.${item.id}`}
                >
                  <Glyph name={item.glyph} size={18} />
                  <span>{t(item.label)}</span>
                </Menu.LinkItem>
              ))}
              {utilities && (
                <>
                  <Menu.Separator className="fsc-menu__rule" />
                  <Menu.Item
                    className="fsc-menu__item"
                    onClick={utilities.onLog}
                    data-testid="W-JG-01.logOpen"
                  >
                    <Glyph name="ms:schedule" size={18} />
                    <span>{LOG.title}</span>
                  </Menu.Item>
                  {/* Sound: off by default, remembered per viewer; this click is the gesture that lets audio start. */}
                  <Menu.CheckboxItem
                    className="fsc-menu__item"
                    checked={sound.on}
                    onCheckedChange={() => sound.toggle()}
                    data-testid="W-JG-01.sound"
                  >
                    <Glyph name={sound.on ? "ms:volume-up" : "ms:volume-off"} size={18} />
                    <span>{STAGE.sound}</span>
                    <span className="fsc-menu__state">{sound.on ? STAGE.on : STAGE.off}</span>
                  </Menu.CheckboxItem>
                  {utilities.canReset && (
                    <Menu.Item
                      className="fsc-menu__item"
                      onClick={() => {
                        if (!utilities.resetting) utilities.onReset();
                      }}
                      aria-disabled={utilities.resetting || undefined}
                      aria-busy={utilities.resetting || undefined}
                      data-testid="W-JG-01.reset"
                    >
                      <Glyph name="ms:restart-alt" size={18} />
                      <span>{STAGE.reset}</span>
                    </Menu.Item>
                  )}
                </>
              )}
              <Menu.Separator className="fsc-menu__rule" />
              <Menu.Item
                className="fsc-menu__item"
                onClick={() => shortcuts.setSheetOpen(true)}
                data-testid="W-JG-01.menu.shortcuts"
              >
                <Glyph name="ms:keyboard" size={18} />
                <span>{STAGE.shortcuts}</span>
                <kbd className="fsc-kbd">?</kbd>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
