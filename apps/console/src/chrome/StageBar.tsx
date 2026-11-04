// The Judge stage's top bar (S1.6; UI gate round 3): one row. "Fair Split" leads at every width (the rail no longer
// carries the lockup); then the mock-data chip when the build answers from a mock (I8); in the centre the run pill,
// the one element that says what to do next, which never truncates; on the right the utilities (What's real, Log,
// Sound, Reset) as one quiet cluster of line icons, the Proof counter on Proof's six checks ("Proof 0/6" until this
// browser has checked, then "6/6"), and the stage's one quiet honesty indicator, "Simulated PayPal sandbox".

import { Glyph, HonestyTag, useT } from "@fairsplit/ui-web";
import { type ReactNode, useRef } from "react";
import type { PaypalRail } from "../lib/env.js";
import { useFocusOnLeave } from "../lib/focus.js";
import { AppLink } from "./AppLink.js";
import { LOG, MOCK_DATA, railTag, STAGE } from "./copy.js";
import { SoundToggle } from "./SoundToggle.js";
import { Wordmark } from "./Wordmark.js";

export interface StageBarProps {
  readonly rail: PaypalRail;
  readonly mock: boolean;
  /** The run pill. */
  readonly pill?: ReactNode;
  readonly proofHref: string | null;
  /** Proof's six checks: how many matched in this browser (0 until it has checked). */
  readonly checks: { readonly matched: number; readonly total: number };
  /** The run's payout statuses are a labelled replay (the counter says so). */
  readonly replayed?: boolean;
  readonly canReset: boolean;
  readonly resetting: boolean;
  readonly onWhatsReal: () => void;
  /** Opens the run's whole timeline (the Log sheet). */
  readonly onLog: () => void;
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
      title={STAGE.reset}
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

/**
 * What the Proof counter says to assistive technology and to anyone reading the page's text: the whole sentence,
 * about the same six checks Proof shows. On screen it reads "Proof 0/6"; a replayed run says that first.
 */
export function proofChipLabel(
  t: ReturnType<typeof useT>,
  {
    matched,
    total,
    replayed,
  }: { readonly matched: number; readonly total: number; readonly replayed: boolean },
): { readonly spoken: string; readonly count: string } {
  const checks = t("W-JG-01.proofChip", { matched, total });
  return {
    spoken: replayed ? `${checks}. Payout statuses replayed (labelled, simulated)` : checks,
    count: `${matched}/${total}`,
  };
}

export function StageBar({
  rail,
  mock,
  pill,
  proofHref,
  checks,
  replayed = false,
  canReset,
  resetting,
  onWhatsReal,
  onLog,
  onReset,
}: StageBarProps) {
  const t = useT();
  const proof = proofChipLabel(t, { ...checks, replayed });
  return (
    <header className="fsc-bar" data-testid="W-JG-01.bar">
      <Wordmark compact />
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
      </div>
      {pill && <div className="fsc-bar__pill">{pill}</div>}
      <nav className="fsc-bar__actions" aria-label="Stage">
        <div className="fsc-bar__utils">
          <button
            type="button"
            className="fsc-barlink fsc-barlink--real"
            title={STAGE.whatsReal}
            onClick={onWhatsReal}
            data-testid="W-JG-01.whatsRealOpen"
          >
            <Glyph name="ms:visibility" size={16} />
            <span className="fs-t-label">{STAGE.whatsReal}</span>
          </button>
          <button
            type="button"
            className="fsc-barlink fsc-barlink--fold"
            title={LOG.title}
            onClick={onLog}
            data-testid="W-JG-01.logOpen"
          >
            <Glyph name="ms:schedule" size={16} />
            <span className="fs-t-label">{LOG.open}</span>
          </button>
          <SoundToggle testId="W-JG-01.sound" className="fsc-barlink--fold" />
          {canReset && <ResetButton resetting={resetting} onReset={onReset} />}
        </div>
        {proofHref && (
          <AppLink
            href={proofHref}
            className="fsc-proofchip"
            data-testid="W-JG-01.proofChip"
            data-complete={checks.total > 0 && checks.matched === checks.total ? "" : undefined}
            data-replayed={replayed ? "" : undefined}
          >
            <Glyph name={checks.matched > 0 ? "seal-fill" : "seal"} size={16} />
            <span className="fs-sr">{proof.spoken}</span>
            <span className="fs-t-label" aria-hidden>
              {STAGE.proof}
            </span>
            <span className="fsc-proofchip__count fs-t-micro" aria-hidden>
              {proof.count}
            </span>
          </AppLink>
        )}
        <span className="fsc-bar__tag" data-testid="W-JG-01.notice">
          <HonestyTag quiet>{railTag(rail)}</HonestyTag>
        </span>
      </nav>
    </header>
  );
}
