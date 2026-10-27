// The Judge stage's top bar (S1.6): the story in one line with how PayPal runs (ADR-0002), and What's real,
// Sound, Reset and the Proof counter. The lockup sits here only when the rail has folded to glyphs. A
// mock-data build says so here (I8).

import { Glyph, useT } from "@fairsplit/ui-web";
import type { PaypalRail } from "../lib/env.js";
import { AppLink } from "./AppLink.js";
import { MOCK_DATA, railLine, STAGE, story } from "./copy.js";
import { SoundToggle } from "./SoundToggle.js";
import { Wordmark } from "./Wordmark.js";

export interface StageBarProps {
  readonly members: number;
  readonly rail: PaypalRail;
  readonly mock: boolean;
  /** Show the lockup in the bar (the rail is folded, or there is no rail). */
  readonly lockup: boolean;
  readonly proofHref: string | null;
  readonly confirmed: number;
  readonly total: number;
  readonly canReset: boolean;
  readonly resetting: boolean;
  readonly onWhatsReal: () => void;
  readonly onReset: () => void;
}

export function StageBar({
  members,
  rail,
  mock,
  lockup,
  proofHref,
  confirmed,
  total,
  canReset,
  resetting,
  onWhatsReal,
  onReset,
}: StageBarProps) {
  const t = useT();
  return (
    <header className="fsc-bar" data-testid="W-JG-01.bar">
      {lockup && <Wordmark compact />}
      <p className="fsc-bar__story" data-testid="W-JG-01.notice">
        <span className="fsc-bar__lead">{story(members)}</span>{" "}
        <span className="fsc-bar__rail">{railLine(rail)}</span>
      </p>
      <nav className="fsc-bar__actions" aria-label="Stage">
        {mock && (
          <span
            className="fs-chip fsc-bar__mock"
            data-tone="hatch"
            title={MOCK_DATA.note}
            data-testid="W-JG-01.mockData"
          >
            <span className="fs-t-label">{MOCK_DATA.chip}</span>
          </span>
        )}
        <button
          type="button"
          className="fsc-barlink"
          onClick={onWhatsReal}
          data-testid="W-JG-01.whatsRealOpen"
        >
          <Glyph name="ms:visibility" size={16} />
          <span className="fs-t-label">{STAGE.whatsReal}</span>
        </button>
        <SoundToggle testId="W-JG-01.sound" />
        {canReset && (
          <button
            type="button"
            className="fsc-barlink"
            onClick={onReset}
            disabled={resetting}
            aria-busy={resetting || undefined}
            data-testid="W-JG-01.reset"
          >
            <Glyph name="ms:restart-alt" size={16} />
            <span className="fs-t-label">{STAGE.reset}</span>
          </button>
        )}
        {proofHref && (
          <AppLink
            href={proofHref}
            className="fsc-proofchip"
            data-testid="W-JG-01.proofChip"
            data-complete={total > 0 && confirmed === total ? "" : undefined}
          >
            <Glyph name={confirmed > 0 ? "seal-fill" : "seal"} size={16} />
            <span className="fs-t-label">{t("W-JG-01.proofChip", { confirmed, total })}</span>
          </AppLink>
        )}
      </nav>
    </header>
  );
}
