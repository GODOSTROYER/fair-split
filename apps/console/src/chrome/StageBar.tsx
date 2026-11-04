// The Judge stage's top bar (S1.6; UI gate round 2): one row. On the left only what must lead (the mock-data chip
// when the build answers from a mock, I8; the lockup and the story when the rail is folded); in the centre, the
// run pill, the one element that says what to do next, which never truncates; on the right the utilities (What's
// real, Sound, Reset) as one quiet cluster, the short Proof counter, and the honesty tag beside it, once. The
// tag replaces the sentence the bar used to open on ("Simulated PayPal sandbox. Anything replayed says so.").

import { Glyph, HonestyTag, useT } from "@fairsplit/ui-web";
import { type ReactNode, useRef } from "react";
import type { PaypalRail } from "../lib/env.js";
import { useFocusOnLeave } from "../lib/focus.js";
import { AppLink } from "./AppLink.js";
import { MOCK_DATA, railTag, STAGE } from "./copy.js";
import { SoundToggle } from "./SoundToggle.js";
import { Wordmark } from "./Wordmark.js";

export interface StageBarProps {
  /** The season's member count (the lockup's story is no longer printed: UI gate round 2). */
  readonly members?: number;
  readonly rail: PaypalRail;
  readonly mock: boolean;
  /** Show the lockup in the bar (the rail is folded, or there is no rail). */
  readonly lockup: boolean;
  /** The run pill, centred in the bar. */
  readonly pill?: ReactNode;
  readonly proofHref: string | null;
  readonly confirmed: number;
  readonly replayed?: boolean;
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
 * What the Proof counter says to assistive technology and to anyone reading the page's text: the whole
 * sentence. On screen it reads "Proof 0/8" (or "Proof replayed"); the honesty tag beside it says where.
 */
export function proofChipLabel(
  t: ReturnType<typeof useT>,
  {
    confirmed,
    total,
    replayed,
    rail,
  }: { confirmed: number; total: number; replayed: boolean; rail: PaypalRail },
): { readonly spoken: string; readonly count: string } {
  if (replayed)
    return {
      spoken: `Proof: ${total} statuses replayed (labelled, simulated), ${confirmed} successful in the source run`,
      count: STAGE.proofReplayed,
    };
  return {
    spoken: `${t("W-JG-01.proofChip", { confirmed, total })}${rail === "simulator" ? " in the simulated sandbox" : ""}`,
    count: `${confirmed}/${total}`,
  };
}

export function StageBar({
  rail,
  mock,
  lockup,
  pill,
  proofHref,
  confirmed,
  replayed = false,
  total,
  canReset,
  resetting,
  onWhatsReal,
  onReset,
}: StageBarProps) {
  const t = useT();
  const proof = proofChipLabel(t, { confirmed, total, replayed, rail });
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
          <SoundToggle testId="W-JG-01.sound" className="fsc-barlink--fold" />
          {canReset && <ResetButton resetting={resetting} onReset={onReset} />}
        </div>
        {proofHref && (
          <AppLink
            href={proofHref}
            className="fsc-proofchip"
            data-testid="W-JG-01.proofChip"
            data-complete={total > 0 && confirmed === total ? "" : undefined}
          >
            <Glyph name={confirmed > 0 ? "seal-fill" : "seal"} size={16} />
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
          <HonestyTag>{railTag(rail)}</HonestyTag>
        </span>
      </nav>
    </header>
  );
}
