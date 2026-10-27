// The run pill (S1.6): top centre of the console, the run's state word beside the next step, which links to
// the screen whose control is pre-focused. A small mark says who moves the run next: canary when a person
// must decide, pencil while the machine reads, an open ring while PayPal confirms. Its menu lists the six
// console screens and Shortcuts. "Play it for me" (the season slice) sits in its accessory slot.

import { Menu } from "@base-ui/react/menu";
import { Glyph, useT } from "@fairsplit/ui-web";
import type { RunView } from "../data/run-view.js";
import { useShortcuts } from "../lib/shortcuts.js";
import { AppLink } from "./AppLink.js";
import { STAGE } from "./copy.js";
import type { NextStep } from "./next-step.js";
import type { RailItem } from "./rail-items.js";
import { ChromeSlot } from "./slots.js";

export interface RunPillProps {
  readonly view: RunView | undefined;
  readonly next: NextStep;
  readonly items: readonly RailItem[];
  readonly onStep?: (step: NextStep) => void;
}

export function RunPill({ view, next, items, onStep }: RunPillProps) {
  const t = useT();
  const shortcuts = useShortcuts();
  const state = view ? t(`run.${view.state}`, { treasurer: "Analyn", chair: "Ernesto" }) : "";
  return (
    <div className="fsc-pill" data-testid="W-JG-01.runPill" data-step={next.id} data-actor={next.actor}>
      {state && (
        <span className="fsc-pill__state fs-t-caption" data-testid="W-JG-01.runPill.state">
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
