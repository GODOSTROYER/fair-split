// W-JG-02 "What's real" (S1.6): a sheet that separates real, replayed (dated), simulated, seeded and
// synthetic, names who holds the money and what is not built, and holds "Try to break it" on a bolted
// plate. The PayPal part follows the rail the API runs (ADR-0002). Opened from the stage bar. The attempts'
// controls are the season slice's (ChromePortal "whatsReal.tryToBreak"); the plain list stands in until then.

import { Dialog } from "@base-ui/react/dialog";
import { Glyph } from "@fairsplit/ui-web";
import { TRY_TO_BREAK, type WhatsRealFacts, whatsReal } from "./copy.js";
import { ChromeSlot } from "./slots.js";

export interface WhatsRealSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly facts: WhatsRealFacts;
}

export function WhatsRealSheet({ open, onOpenChange, facts }: WhatsRealSheetProps) {
  const sections = whatsReal(facts);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fsc-sheet__scrim" />
        <Dialog.Popup className="fsc-sheet" data-testid="W-JG-01.whatsReal" data-rail={facts.rail}>
          <header className="fsc-sheet__head">
            <Dialog.Title className="fs-t-title-1">What's real</Dialog.Title>
            <Dialog.Close className="fsc-sheet__close" data-testid="W-JG-01.whatsReal.close">
              <Glyph name="ms:close" size={18} />
              <span className="fs-t-label">Close</span>
            </Dialog.Close>
          </header>
          <Dialog.Description className="fsc-sheet__lede">
            Everything on this stage is real, replayed with its date, simulated or synthetic, and says which.
          </Dialog.Description>
          <dl className="fsc-ledger">
            {sections.map((section) => (
              <div key={section.id} className="fsc-ledger__row" data-section={section.id}>
                <dt className="fsc-ledger__term fs-t-label">{section.title}</dt>
                <dd className="fsc-ledger__items">
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
          <section
            className="fsc-sheet__break"
            aria-labelledby="fsc-break-title"
            data-testid="W-JG-01.tryToBreak"
          >
            <div className="fsc-bolted">
              <span className="fsc-bolted__bolt fsc-bolted__bolt--l" aria-hidden />
              <span className="fsc-bolted__bolt fsc-bolted__bolt--r" aria-hidden />
              <h2 id="fsc-break-title" className="fs-t-title-2">
                {TRY_TO_BREAK.title}
              </h2>
              <p className="fsc-sheet__lede">{TRY_TO_BREAK.lede}</p>
              {/* The season slice portals the live attempts into the slot; until it does, CSS shows the list. */}
              <ChromeSlot name="whatsReal.tryToBreak" className="fsc-sheet__slot" />
              <ul className="fsc-sheet__attempts" data-testid="W-JG-01.tryToBreak.list">
                {TRY_TO_BREAK.attempts.map((attempt) => (
                  <li key={attempt}>
                    <Glyph name="bolt" size={16} />
                    <span>{attempt}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
