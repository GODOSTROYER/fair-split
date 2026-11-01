// Under 1024 px the stage becomes a phone visit (S1.6): Nang Celing's statement in the phone frame below,
// the film when there is one, and a way to take the full stage to a laptop.

import { Glyph } from "@fairsplit/ui-web";
import { useState } from "react";
import { STAGE } from "../chrome/copy.js";
import { ChromeSlot } from "../chrome/slots.js";
import { Wordmark } from "../chrome/Wordmark.js";

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
      <Wordmark compact />
      <h1 id="fsc-visit-title" className="fsc-visit__title fs-t-title-1">
        {STAGE.phoneVisitTitle}
      </h1>
      <p className="fsc-visit__body">{STAGE.phoneVisitBody}</p>
      <p className="fsc-visit__actions">
        <button
          type="button"
          className="fs-flat"
          onClick={() => void copy()}
          data-testid="W-JG-01.visit.copy"
        >
          <Glyph name="ms:content-copy" size={18} />
          {STAGE.phoneVisitCopy}
        </button>
        <span className="fs-t-caption fsc-visit__copied" role="status">
          {copied ? STAGE.phoneVisitCopied : ""}
        </span>
      </p>
      <ChromeSlot name="stage.film" className="fsc-visit__film" />
    </main>
  );
}
