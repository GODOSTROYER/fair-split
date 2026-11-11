// The Judge stage's top bar (S1.6; UI gate rounds 4 and 5): one row of six calm items at most, at all times. "Fair
// Split" leads at every width (the rail no longer carries the lockup); then the status area, where only the mock-data
// chip lives (round 5: the event toast folds into the Next pill); in the centre the run pill, "● Next: …" with "Play it
// for me" and the chevron (whose menu holds the screens, the run log, sound, Reset and Shortcuts); on the right What's
// real (its word kept at 1,280 and 1,470), the Proof counter on Proof's six checks ("Proof 0/6" until this browser has
// checked, then "6/6") and the stage's one quiet honesty indicator, "Simulated PayPal sandbox" ("Simulated" under
// 1,680 px, its whole name kept for assistive technology). The phone visit (no pill, so no chevron) keeps two icons:
// What's real and its overflow menu, which holds the log, sound and Reset (round 5).

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
  /** The run pill (its chevron's menu holds the run log, sound and Reset). */
  readonly pill?: ReactNode;
  /** The status area's content beside the mock chip (round 5: empty on the stage; the toast lives in the pill). */
  readonly status?: ReactNode;
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
  /** An overflow menu at the end of the utilities (the phone visit's: the laptop line, the link, Proof). */
  readonly overflow?: ReactNode;
}

/**
 * Reset as a line icon (the phone visit's bar; on the stage it is an item in the chevron's menu). While it runs it
 * keeps the keyboard (aria-disabled: a disabled button loses its focus to <body>), and a second press does nothing.
 * It goes once the session has (the first view is back): in that commit, before its DOM goes, focus moves to the
 * screen's main control, the first press, so it never falls to <body> (WCAG 2.4.3).
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
  status,
  proofHref,
  checks,
  replayed = false,
  canReset,
  resetting,
  onWhatsReal,
  onLog,
  onReset,
  overflow,
}: StageBarProps) {
  const t = useT();
  const proof = proofChipLabel(t, { ...checks, replayed });
  // With the run pill on the bar, its chevron's menu holds the log, sound and Reset (round 4: six items at most); on
  // the phone visit the overflow menu holds them (round 5: two icons in its header).
  const utilitiesInMenu = Boolean(pill) || Boolean(overflow);
  const tag = railTag(rail);
  const space = tag.indexOf(" ");
  return (
    <header className="fsc-bar" data-testid="W-JG-01.bar">
      <Wordmark compact />
      <div className="fsc-bar__status">
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
        {status}
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
          {!utilitiesInMenu && (
            <>
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
            </>
          )}
          {overflow}
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
        <span className="fsc-bar__tag" data-testid="W-JG-01.notice" title={tag}>
          {/* Under 1,680 px the first word stays on screen ("Simulated") and the rest is for assistive technology,
              so What's real keeps its word at 1,280 and 1,470 (round 5). */}
          <HonestyTag quiet>
            {space > 0 ? (
              <>
                {tag.slice(0, space)}
                <span className="fsc-bar__tagrest">{tag.slice(space)}</span>
              </>
            ) : (
              tag
            )}
          </HonestyTag>
        </span>
      </nav>
    </header>
  );
}
