// W-JG-02 "What's real" (S1.6; UI gate round 2): a sheet of five rows (Real code, the simulated PayPal sandbox,
// Replayed, Synthetic, Not built), each its mark, its name and one line, with the details behind "More"; then
// "Try to break it". This sheet is where the stage's explanations live: the screens keep only the tags. The
// PayPal row follows the rail the API runs (ADR-0002). Opened from the stage bar. The attempts' controls are the
// season slice's (ChromePortal "whatsReal.tryToBreak"); the plain list stands in until then.

import { Dialog } from "@base-ui/react/dialog";
import { Glyph, type HonestyKind, LegendMark } from "@fairsplit/ui-web";
import { FocusReturn } from "../lib/focus.js";
import { stageCaption, TRY_TO_BREAK, WHATS_REAL, type WhatsRealFacts, whatsReal } from "./copy.js";
import { ChromeSlot } from "./slots.js";

/**
 * The full legend lives here only (UI gate round 3): each row's glyph is the one the screens carry bare, with its
 * words as tooltip and name. Real code a solid square, the simulated PayPal sandbox (and demo keys) a dashed
 * circle, the seed stand-in and the synthetic co-op a hatched square.
 */
const SECTION_GLYPH: Readonly<Record<string, HonestyKind>> = {
  real: "real",
  "simulated-paypal": "simulated",
  "real-paypal": "simulated",
  replayed: "synthetic",
  synthetic: "synthetic",
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
        <Dialog.Popup
          finalFocus={false}
          className="fsc-sheet"
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
          <dl className="fsc-truth" data-testid="W-JG-01.whatsReal.rows">
            {sections.map((section) => (
              <div key={section.id} className="fsc-truth__row" data-section={section.id}>
                <dt className="fsc-truth__term fs-t-label">
                  {/* The legend: the same glyph the screens carry bare (round 3), hidden here beside its words. */}
                  {SECTION_GLYPH[section.id] ? (
                    <LegendMark kind={SECTION_GLYPH[section.id] ?? "real"} />
                  ) : (
                    <span className="fsc-truth__mark" aria-hidden />
                  )}
                  {section.title}
                </dt>
                <dd className="fsc-truth__line">
                  <p className="fs-t-body">{section.line}</p>
                  <details className="fsc-truth__more">
                    <summary className="fs-t-label">
                      {WHATS_REAL.more}
                      <span className="fs-sr"> about {section.title}</span>
                      <span className="fsc-truth__chev" aria-hidden>
                        <Glyph name="ms:expand-more" size={16} />
                      </span>
                    </summary>
                    <ul className="fs-t-caption">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>
                </dd>
              </div>
            ))}
          </dl>
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
                <li key={attempt}>
                  <Glyph name="bolt" size={16} />
                  <span>{attempt}</span>
                </li>
              ))}
            </ul>
          </section>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
