// Under 1024 px the stage becomes a phone visit (S1.6; UI gate round 2): on a phone the product is the member's
// statement, so it comes first, full width (PhoneDock), under one short line that hands the full stage to a
// laptop: "Best on a laptop · ≥ 1024 px · Copy the link". The film, when there is one, follows.

import { Glyph } from "@fairsplit/ui-web";
import { useState } from "react";
import { STAGE } from "../chrome/copy.js";
import { ChromeSlot } from "../chrome/slots.js";

export function PhoneVisit() {
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
      <p className="fsc-visit__line" title={STAGE.phoneVisitBody}>
        <span className="fs-t-label">{STAGE.phoneVisitLine}</span>
        <span className="fsc-visit__px fs-t-micro">{STAGE.phoneVisitPx}</span>
      </p>
      <button
        type="button"
        className="fs-flat fsc-visit__copy"
        onClick={() => void copy()}
        data-testid="W-JG-01.visit.copy"
      >
        <Glyph name="ms:content-copy" size={16} />
        {STAGE.phoneVisitCopy}
      </button>
      <span className="fs-t-caption fsc-visit__copied" role="status">
        {copied ? STAGE.phoneVisitCopied : ""}
      </span>
      <ChromeSlot name="stage.film" className="fsc-visit__film" />
    </main>
  );
}
