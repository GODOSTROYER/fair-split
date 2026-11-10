// Under 1024 px the stage becomes a phone visit (S1.6; UI gate rounds 2 and 3): on a phone the product is the
// member's statement, so it comes first, full width (PhoneDock), right under the stage bar. The bar keeps the
// product, the simulation status and its few controls; the laptop recommendation ("Best on a laptop · ≥ 1024 px"),
// "Copy the link" and Proof move into the bar's overflow menu (VisitMenu), so nothing stands between the bar and
// her name, her amount, her kilos and her payment's state. The film, when there is one, follows.

import { Menu } from "@base-ui/react/menu";
import { Glyph } from "@fairsplit/ui-web";
import { useState } from "react";
import { AppLink } from "../chrome/AppLink.js";
import { STAGE } from "../chrome/copy.js";
import { ChromeSlot } from "../chrome/slots.js";

export function PhoneVisit() {
  return (
    <main
      id="fsc-main"
      className="fsc-visit"
      aria-labelledby="fsc-visit-title"
      data-testid="W-JG-01.visit"
      tabIndex={-1}
    >
      <h1 id="fsc-visit-title" className="fs-sr">
        {STAGE.phoneVisitTitle}
      </h1>
      <ChromeSlot name="stage.film" className="fsc-visit__film" />
    </main>
  );
}

/** Three dots: the overflow's mark (no glyph in the set says "more"). */
function MoreMark() {
  return (
    <svg className="fs-glyph" width={18} height={18} viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

/**
 * The phone visit's overflow (round 3), at the end of the stage bar's controls: the laptop recommendation, "Copy
 * the link", and Proof once there is a run. "Copied" is said in the menu's live line.
 */
export function VisitMenu({ proofHref }: { readonly proofHref: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <Menu.Root onOpenChange={(open) => !open && setCopied(false)}>
        <Menu.Trigger
          className="fsc-barlink fsc-visit__more"
          aria-label={STAGE.visitMore}
          title={STAGE.visitMore}
          data-testid="W-JG-01.visit.more"
        >
          <MoreMark />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="fsc-menu__positioner" sideOffset={8} align="end">
            <Menu.Popup className="fsc-menu fsc-visit__menu" data-testid="W-JG-01.visit.menu">
              <Menu.Group>
                {/* The laptop line names the group: the full stage is a laptop's; the link takes it there. */}
                <Menu.GroupLabel className="fsc-visit__laptop" title={STAGE.phoneVisitBody}>
                  <span className="fs-t-label">{STAGE.phoneVisitLine}</span>
                  <span className="fsc-visit__px fs-t-caption">{STAGE.phoneVisitPx}</span>
                </Menu.GroupLabel>
                <Menu.Item
                  className="fsc-menu__item"
                  closeOnClick={false}
                  onClick={() => void copy()}
                  data-testid="W-JG-01.visit.copy"
                >
                  <Glyph name="ms:content-copy" size={18} />
                  <span>{copied ? STAGE.phoneVisitCopied : STAGE.phoneVisitCopy}</span>
                </Menu.Item>
                {proofHref && (
                  <Menu.LinkItem
                    className="fsc-menu__item"
                    render={<AppLink href={proofHref} />}
                    data-testid="W-JG-01.visit.proof"
                  >
                    <Glyph name="seal" size={18} />
                    <span>{STAGE.proof}</span>
                  </Menu.LinkItem>
                )}
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span className="fs-sr" role="status">
        {copied ? STAGE.phoneVisitCopied : ""}
      </span>
    </>
  );
}
