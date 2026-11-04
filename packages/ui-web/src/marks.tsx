// Small marks the primitives are built from: the indigo stamp a person leaves on a decision, status pills,
// rule chips, the honesty chip, the confidence ring and evidence paper. Every state carries a glyph and a word.

import type { LineState } from "@fairsplit/i18n";
import type { ReactNode } from "react";
import { useLang, useT } from "./context.js";
import { AUTO_ACCEPT, type StampView } from "./contract.js";
import { Glyph, type GlyphName } from "./Glyph.js";

export interface InkStampProps {
  readonly stamp: StampView;
  readonly testId?: string;
}

/** A 20 px indigo stamp (radius 6) with the person's initials in white; the time shows on hover or focus. */
export function InkStamp({ stamp, testId }: InkStampProps) {
  return (
    <abbr
      className="fs-stamp"
      title={`${stamp.name}, ${stamp.at}`}
      data-testid={testId}
      aria-label={`${stamp.name}, ${stamp.at}`}
    >
      <span className="fs-t-stamp">{stamp.initials}</span>
    </abbr>
  );
}

/**
 * How a status reads: a tone (which material is true now), a glyph and the register's word. "flight" is money on
 * its way: a dashed jade outline that floods to the flush jade face only when the simulated PayPal confirms.
 */
export type ChipTone = "neutral" | "pencil" | "canary" | "flight" | "jade" | "hatch" | "red";

const LINE_STATE_CHIP: Readonly<Record<LineState, { tone: ChipTone; glyph: GlyphName }>> = {
  COMPUTED: { tone: "canary", glyph: "hanging-scale" },
  READY: { tone: "canary", glyph: "hanging-scale" },
  HELD: { tone: "canary", glyph: "hanging-scale" },
  EXCLUDED: { tone: "neutral", glyph: "logbook" },
  LOCKED: { tone: "pencil", glyph: "rail" },
  SUBMITTED: { tone: "flight", glyph: "rail" },
  PAYPAL_PENDING: { tone: "flight", glyph: "rail" },
  PAID: { tone: "jade", glyph: "ms:check" },
  OFF_RAIL_DUE: { tone: "hatch", glyph: "cash" },
  OFF_RAIL_PAID: { tone: "neutral", glyph: "thumbmark" },
  UNCLAIMED: { tone: "canary", glyph: "ms:pause" },
  RETURNED: { tone: "neutral", glyph: "ms:arrow-back" },
  REROUTED: { tone: "flight", glyph: "rail" },
  PAYPAL_HELD: { tone: "canary", glyph: "ms:pause" },
  NEEDS_ACTION: { tone: "red", glyph: "ms:help" },
  REVERSED: { tone: "red", glyph: "ms:restart-alt" },
};

export interface StatusChipProps {
  readonly state: LineState;
  /** Member surfaces speak the member's language; the console uses its own words. */
  readonly surface?: "member" | "console";
  /** Overrides the word (for a state sentence with a date or a timer). */
  readonly text?: string;
  readonly testId?: string;
}

/** Never a raw state name: the words come from the catalogs (register §7). */
export function StatusChip({ state, surface = "member", text, testId }: StatusChipProps) {
  const t = useT();
  const lang = useLang();
  const { tone, glyph } = LINE_STATE_CHIP[state];
  const word = text ?? (surface === "console" ? t(`console.status.${state}`) : t(`status.${state}`));
  return (
    <span
      className="fs-chip"
      data-tone={tone}
      data-state={state}
      data-testid={testId}
      lang={surface === "member" ? lang : undefined}
    >
      <Glyph name={glyph} size={16} />
      <span className="fs-t-label">{word}</span>
    </span>
  );
}

export interface ChipProps {
  readonly tone: ChipTone;
  readonly glyph?: GlyphName;
  readonly children: ReactNode;
  readonly testId?: string;
}

export function Chip({ tone, glyph, children, testId }: ChipProps) {
  return (
    <span className="fs-chip" data-tone={tone} data-testid={testId}>
      {glyph && <Glyph name={glyph} size={16} />}
      <span className="fs-t-label">{children}</span>
    </span>
  );
}

export interface HonestyChipProps {
  /** The label, word for word: "Simulated PayPal sandbox", "Simulated push", "Synthetic sample"... */
  readonly children: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

/**
 * Every simulated or seeded thing carries this chip (I8): a dashed steel outline means "not real, or not yet"
 * (decision.md §4), a flask in ink-3, the words in ink-2, pill radius.
 */
export function HonestyChip({ children, testId, className }: HonestyChipProps) {
  return (
    <span className={["fs-honesty fs-t-caption", className].filter(Boolean).join(" ")} data-testid={testId}>
      <svg className="fs-honesty__flask" width={14} height={14} viewBox="0 0 24 24" aria-hidden>
        <path
          d="M9 3h6M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3M7.2 15h9.6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}

export interface RuleChipProps {
  readonly name: string;
  readonly amount: string;
  readonly rule: string;
}

/** Deductions use plate-2 with the rule ID written in text; they get no hue of their own. */
export function RuleChip({ name, amount, rule }: RuleChipProps) {
  return (
    <span className="fs-rule-chip fs-t-figure">
      {name} {amount} <span className="fs-rule-chip__id">{rule}</span>
    </span>
  );
}

export interface ConfidenceRingProps {
  readonly confidence: number;
  readonly size?: number;
  /** 0 to 1: how much of the ring has drawn (MM-2 "ring"). */
  readonly drawn?: number;
}

/** Read confidence as a ring; below 0.85 it turns canary because a person must confirm. */
export function ConfidenceRing({ confidence, size = 16, drawn = 1 }: ConfidenceRingProps) {
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  const low = confidence < AUTO_ACCEPT;
  return (
    <svg
      className="fs-conf"
      data-low={low ? "" : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${Math.round(confidence * 100)}%`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} className="fs-conf__track" fill="none" strokeWidth={1.5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="fs-conf__arc"
        fill="none"
        strokeWidth={1.5}
        strokeDasharray={`${c * confidence * drawn} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export interface PaperProps {
  /** Alt text: always includes "Synthetic sample". */
  readonly alt: string;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly className?: string;
}

/** Evidence: the only thing that casts a shadow, tagged "Synthetic sample" in its corner. */
export function Paper({ alt, children, testId, className }: PaperProps) {
  const t = useT();
  return (
    <figure className={["fs-paper", className].filter(Boolean).join(" ")} data-testid={testId}>
      <div role="img" aria-label={`${alt}. ${t("paper.synthetic")}`} className="fs-paper__body">
        {children}
      </div>
      <figcaption className="fs-paper__tag fs-t-caption">{t("paper.synthetic")}</figcaption>
    </figure>
  );
}
