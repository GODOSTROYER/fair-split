// W-JG-02 "What's real" (S1.6; UI gate rounds 2 to 5): a sheet of five rows (Real code, the simulated PayPal
// sandbox, Replayed, Synthetic, Not built), each its name and one sentence (only the simulated row wears a mark, the
// dashed circle the screens carry), the whole row opening to its details (round 4: no "More" on every row); it starts
// under the top bar and hugs its rows (round 5);
// then "Try to break it", four rows each with "Try". This sheet is where the stage's explanations live: the screens
// keep only the marks. The PayPal row follows the rail the API runs (ADR-0002). Opened from the stage bar. The
// attempts' controls are the season slice's (ChromePortal "whatsReal.tryToBreak"); the rows' names stand in until
// then.

import { Dialog } from "@base-ui/react/dialog";
import { Glyph, type HonestyKind, LegendMark } from "@fairsplit/ui-web";
import { FocusReturn } from "../lib/focus.js";
import { stageCaption, TRY_TO_BREAK, type WhatsRealFacts, whatsReal } from "./copy.js";
import { ChromeSlot } from "./slots.js";

/**
 * The legend lives here only (UI gate rounds 3 and 5). Round 5 (provenance once, hatch only for cash): the screens
 * carry one mark, the dashed circle beside PayPal money, so only the simulated PayPal row wears it; every other row
 * is its words alone (the screens say them once, in their id line), its mark's slot kept so the names align.
 */
const SECTION_GLYPH: Readonly<Record<string, HonestyKind>> = {
  "simulated-paypal": "simulated",
  "real-paypal": "simulated",
};

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
        {/* Round 5: the sheet hugs its rows (no empty band under "Try to break it"), scrolling past the stage's foot. */}
        <Dialog.Popup
          finalFocus={false}
          className="fsc-sheet fsc-sheet--hug"
          data-testid="W-JG-01.whatsReal"
          data-rail={facts.rail}
        >
          {/* Closing hands focus back to What's real's button, through the console's one return (lib/focus.ts). */}
          <FocusReturn
            open={open}
            leaving={() => document.querySelector('[data-testid="W-JG-01.whatsReal"]')}
          />
          <header className="fsc-sheet__head">
            <Dialog.Title className="fs-t-title-1">What's real</Dialog.Title>
            <Dialog.Close className="fsc-sheet__close" data-testid="W-JG-01.whatsReal.close">
              <Glyph name="ms:close" size={18} />
              <span className="fs-t-label">Close</span>
            </Dialog.Close>
          </header>
          {/* The stage's honesty caption, for assistive technology: the rows below say it on screen. */}
          <Dialog.Description className="fs-sr">{stageCaption(facts.recordedOn)}</Dialog.Description>
          {/* Round 4: each row is one disclosure, its mark, its name and its one sentence, with a chevron at the
              end; the details open under the sentence (no "More" repeated five times). */}
          <ul className="fsc-truth" data-testid="W-JG-01.whatsReal.rows">
            {sections.map((section) => (
              <li key={section.id} className="fsc-truth__row" data-section={section.id}>
                <details className="fsc-truth__more">
                  <summary className="fsc-truth__summary">
                    <span className="fsc-truth__term fs-t-label">
                      {/* The legend: the same glyph the screens carry bare (round 3), hidden here beside its words. */}
                      {SECTION_GLYPH[section.id] ? (
                        <LegendMark kind={SECTION_GLYPH[section.id] ?? "real"} />
                      ) : (
                        <span className="fsc-truth__mark" aria-hidden />
                      )}
                      {section.title}
                    </span>
                    <span className="fs-sr">: </span>
                    <span className="fsc-truth__line fs-t-body">{section.line}</span>
                    <span className="fsc-truth__chev" aria-hidden>
                      <Glyph name="ms:expand-more" size={16} />
                    </span>
                  </summary>
                  <ul className="fsc-truth__items fs-t-caption">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <section
            className="fsc-sheet__break"
            aria-labelledby="fsc-break-title"
            data-testid="W-JG-01.tryToBreak"
          >
            <h2 id="fsc-break-title" className="fs-t-title-2">
              {TRY_TO_BREAK.title}
            </h2>
            <p className="fsc-sheet__lede">{TRY_TO_BREAK.lede}</p>
            {/* The season slice portals the live attempts into the slot; until it does, CSS shows the list. */}
            <ChromeSlot name="whatsReal.tryToBreak" className="fsc-sheet__slot" />
            <ul className="fsc-sheet__attempts" data-testid="W-JG-01.tryToBreak.list">
              {TRY_TO_BREAK.attempts.map((attempt) => (
                <li key={attempt} className="fs-t-label">
                  {attempt}
                </li>
              ))}
            </ul>
          </section>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
