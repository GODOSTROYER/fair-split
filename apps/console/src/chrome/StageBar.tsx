// The Judge stage's top bar (S1.6): one row. On the left, how PayPal runs here (ADR-0002) in one line, after
// the mock-data chip when the build answers from a mock (I8); in the centre, the run pill (it replaces the rail's
// row in Judge Mode, so the screens keep their height); on the right What's real, Sound, Reset and the Proof
// counter. The story ("A cacao co-op pays 64 farmers…") heads the rail under the lockup; when the rail folds to
// glyphs the lockup and the story sit here instead, the story on its own row.

import { Glyph, useT } from "@fairsplit/ui-web";
import { type ReactNode, useRef } from "react";
import type { PaypalRail } from "../lib/env.js";
import { useFocusOnLeave } from "../lib/focus.js";
import { AppLink } from "./AppLink.js";
import { MOCK_DATA, railNotice, STAGE, story } from "./copy.js";
import { SoundToggle } from "./SoundToggle.js";
import { Wordmark } from "./Wordmark.js";

export interface StageBarProps {
  readonly members: number;
  readonly rail: PaypalRail;
  readonly mock: boolean;
  /** Show the lockup and the story in the bar (the rail is folded, or there is no rail). */
  readonly lockup: boolean;
  /** The run pill, centred in the bar. */
  readonly pill?: ReactNode;
  readonly proofHref: string | null;
  readonly confirmed: number;
  readonly total: number;
  readonly canReset: boolean;
  readonly resetting: boolean;
  readonly onWhatsReal: () => void;
  readonly onReset: () => void;
}

/**
 * Reset. While it runs it keeps the keyboard (aria-disabled: a disabled button loses its focus to <body>), and a
 * second press does nothing. It goes once the session has (the first view is back): in that commit, before its
 * DOM goes, focus moves to the screen's main control, the first press, so it never falls to <body> (WCAG 2.4.3).
 */
function ResetButton({ resetting, onReset }: { readonly resetting: boolean; readonly onReset: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnLeave(ref);
  return (
    <button
      ref={ref}
      type="button"
      className="fsc-barlink fsc-barlink--fold"
      onClick={() => {
        if (!resetting) onReset();
      }}
      aria-disabled={resetting || undefined}
      aria-busy={resetting || undefined}
      data-testid="W-JG-01.reset"
    >
      <Glyph name="ms:restart-alt" size={16} />
      <span className="fs-t-label">{STAGE.reset}</span>
    </button>
  );
}

export function StageBar({
  members,
  rail,
  mock,
  lockup,
  pill,
  proofHref,
  confirmed,
  total,
  canReset,
  resetting,
  onWhatsReal,
  onReset,
}: StageBarProps) {
  const t = useT();
  const notice = railNotice(rail);
  return (
    <header className="fsc-bar" data-testid="W-JG-01.bar" data-lockup={lockup ? "" : undefined}>
      {lockup && <Wordmark compact />}
      <div className="fsc-bar__honest">
        {mock && (
          <span
            className="fs-chip fsc-bar__mock"
            data-tone="pencil"
            title={MOCK_DATA.note}
            data-testid="W-JG-01.mockData"
          >
            <span className="fs-t-label">{MOCK_DATA.chip}</span>
          </span>
        )}
        <p className="fsc-bar__story" data-testid="W-JG-01.notice">
          {lockup && <span className="fsc-bar__lead">{story(members)} </span>}
          <span className="fsc-bar__rail">
            <span className="fsc-bar__rail-lead">{notice.lead}</span> {notice.rest}
          </span>
        </p>
      </div>
      {pill && <div className="fsc-bar__pill">{pill}</div>}
      <nav className="fsc-bar__actions" aria-label="Stage">
        <button
          type="button"
          className="fsc-barlink"
          onClick={onWhatsReal}
          data-testid="W-JG-01.whatsRealOpen"
        >
          <Glyph name="ms:visibility" size={16} />
          <span className="fs-t-label">{STAGE.whatsReal}</span>
        </button>
        <SoundToggle testId="W-JG-01.sound" className="fsc-barlink--fold" />
        {canReset && <ResetButton resetting={resetting} onReset={onReset} />}
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
