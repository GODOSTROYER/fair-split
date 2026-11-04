// Money on screen (design §2.3, §2.5; ADR-0016). Amounts are FS Sans condensed with proportional lining figures
// (a plain zero, a plain one), the "US$" prefix at half size and raised on the large roles; the accessible text
// keeps the whole string. Approved but not yet in the member's hands, they are hollow outlines; they fill only when
// PayPal (or the bodega) says so. A peso figure is always an estimate. The status capsule is a pill: dashed jade
// in flight, flush jade with an ink check (and one beat of halo) once the simulated PayPal confirms (MM-1).

import type { ReactNode } from "react";

import { useMotionMode } from "./context.js";
import type { MoneyView } from "./contract.js";
import { useFlip } from "./flip.js";
import { Glyph, type GlyphName } from "./Glyph.js";

/** The currency prefixes a display string can start with ("US$" first, so "$" never splits it). */
const CURRENCY = /^(US\$|₱|\$)/;

/** Splits "US$4,333.50" into ["US$", "4,333.50"]; a string with no prefix comes back whole. */
export function splitCurrency(display: string): readonly [prefix: string, figure: string] {
  const m = CURRENCY.exec(display);
  return m ? [m[1] ?? "", display.slice(m[0].length)] : ["", display];
}

/**
 * An amount's characters with the prefix set small and raised (`.fs-cur`). The text content is unchanged
 * ("US$64.45"), so a copy, a search or a test reads the whole string.
 */
export function CurrencyFigure({ display }: { readonly display: string }): ReactNode {
  const [prefix, figure] = splitCurrency(display);
  if (!prefix) return display;
  return (
    <>
      <span className="fs-cur">{prefix}</span>
      {figure}
    </>
  );
}

export interface AmountDisplayProps {
  readonly amount: MoneyView;
  /** "mga ₱4,028 (gibanabana)", already worded by the catalog. */
  readonly estimate?: string;
  readonly typeRole?: "amount-hero" | "amount-l";
  /** Approved, not yet received: outline only. */
  readonly hollow?: boolean;
  /** 0 to 1: how much of the solid layer shows over the outline (MM-1 "fill"). */
  readonly solid?: number;
  /** An engine figure before the two keys: graphite. */
  readonly pencil?: boolean;
  readonly testId?: string;
  readonly lang?: string;
  readonly className?: string;
}

export function AmountDisplay({
  amount,
  estimate,
  typeRole = "amount-hero",
  hollow = false,
  solid,
  pencil = false,
  testId,
  lang,
  className,
}: AmountDisplayProps) {
  const solidOpacity = solid ?? (hollow ? 0 : 1);
  const state = pencil ? "pencil" : solidOpacity >= 1 ? "solid" : solidOpacity <= 0 ? "hollow" : "filling";
  return (
    <div
      className={["fs-amount", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state={state}
    >
      <span className="fs-sr">{estimate ? `${amount.spoken}, ${estimate}` : amount.spoken}</span>
      <p className={`fs-amount__figure fs-t-${typeRole}`} aria-hidden>
        <span className="fs-amount__hollow">
          <CurrencyFigure display={amount.display} />
        </span>
        <span className="fs-amount__solid" style={{ opacity: solidOpacity }}>
          <CurrencyFigure display={amount.display} />
        </span>
      </p>
      {estimate && (
        <p className="fs-amount__estimate fs-t-figure" aria-hidden lang={lang}>
          {estimate}
        </p>
      )}
    </div>
  );
}

export type CapsuleState =
  | "checking"
  | "sent"
  | "paid"
  | "cash-due"
  | "received"
  | "unclaimed"
  | "held-line"
  | "offline";

const CAPSULE_GLYPH: Readonly<Record<CapsuleState, GlyphName>> = {
  checking: "hanging-scale",
  sent: "rail",
  paid: "ms:check",
  "cash-due": "cash",
  received: "thumbmark",
  unclaimed: "ms:pause",
  "held-line": "hanging-scale",
  offline: "ms:wifi-off",
};

/** A still frame of MM-1: inset in px (5 → 0), flood scale and opacity, and the label crossfade. */
export interface CapsuleFrame {
  readonly inset: number;
  readonly flood: number;
  readonly floodOpacity: number;
  readonly label: number;
}

export interface StatusCapsuleProps {
  readonly state: CapsuleState;
  readonly text: string;
  /** The words it crossfades to when PayPal confirms (shown only in frames). */
  readonly nextText?: string;
  readonly frame?: CapsuleFrame;
  readonly testId?: string;
  readonly lang?: string;
}

/** The statement's status capsule (M-MB-01). Jade only once PayPal confirmed the payment. */
export function StatusCapsule({ state, text, nextText, frame, testId, lang }: StatusCapsuleProps) {
  const mode = useMotionMode();
  const paid = state === "paid";
  // The halo's one beat: paid while the viewer watched, never a capsule that mounted paid (or a gallery frame).
  const flip = useFlip(paid) && frame === undefined;
  const inset = frame?.inset ?? (paid ? 0 : state === "sent" ? 5 : 0);
  const flood = frame?.flood ?? (paid ? 1 : 0);
  const floodOpacity = frame?.floodOpacity ?? (paid ? 1 : 0);
  const labelMix = frame?.label ?? 0;
  // Reduced motion: no corner flood, the jade fades in place.
  const floodScale = mode === "reduced" ? (floodOpacity > 0 ? 1 : 0) : flood;
  return (
    <div
      className="fs-capsule"
      data-state={state}
      data-flip={flip ? "" : undefined}
      data-testid={testId}
      data-raised={inset > 0 ? "" : undefined}
      style={{ ["--cap-t" as string]: `${5 - inset}px`, ["--cap-k" as string]: String(inset / 5) }}
      lang={lang}
      role="status"
    >
      <span className="fs-capsule__edge fs-capsule__edge--r" aria-hidden />
      <span className="fs-capsule__edge fs-capsule__edge--b" aria-hidden />
      <span className="fs-capsule__face">
        <span
          className="fs-capsule__flood"
          aria-hidden
          style={{ transform: `scale(${floodScale})`, opacity: floodOpacity }}
        />
        <span className="fs-capsule__label" style={{ opacity: 1 - labelMix }}>
          <Glyph name={CAPSULE_GLYPH[state]} size={18} />
          <span className="fs-t-label">{text}</span>
        </span>
        {nextText && labelMix > 0 && (
          <span
            className="fs-capsule__label fs-capsule__label--next"
            style={{ opacity: labelMix }}
            aria-hidden
          >
            <Glyph name="ms:check" size={18} />
            <span className="fs-t-label">{nextText}</span>
          </span>
        )}
      </span>
    </div>
  );
}
