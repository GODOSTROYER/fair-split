// Small marks the primitives are built from: the indigo stamp a person leaves on a decision, status pills,
// rule chips, the honesty chip, the confidence ring and evidence paper. Every state carries a glyph and a word.

import type { LineState } from "@fairsplit/i18n";
import type { ReactNode } from "react";
import { useLang, useT } from "./context.js";
import { AUTO_ACCEPT, type StampView } from "./contract.js";
import { useFlip } from "./flip.js";
import { Glyph, type GlyphName } from "./Glyph.js";

export interface InkStampProps {
  readonly stamp: StampView;
  readonly testId?: string;
}

/**
 * A 22 px indigo stamp (radius 6) with the person's initials in white; the time shows on hover. It is an image
 * named in full ("Analyn R. Sumalinog, 10:31"): an <abbr> allows no name (axe aria-prohibited-attr), so some readers
 * said only the initials.
 */
export function InkStamp({ stamp, testId }: InkStampProps) {
  const full = `${stamp.name}, ${stamp.at}`;
  return (
    <span className="fs-stamp" role="img" title={full} data-testid={testId} aria-label={full}>
      <span className="fs-t-stamp" aria-hidden>
        {stamp.initials}
      </span>
    </span>
  );
}

/**
 * How a status reads: a tone (which material is true now), a glyph and the register's word. "flight" is money on
 * its way: a neutral outline, which turns to the flush jade face only when the simulated PayPal confirms.
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
  const flip = useFlip(tone === "jade");
  const word = text ?? (surface === "console" ? t(`console.status.${state}`) : t(`status.${state}`));
  return (
    <span
      className="fs-chip"
      data-tone={tone}
      data-flip={flip ? "" : undefined}
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
  const flip = useFlip(tone === "jade");
  return (
    <span className="fs-chip" data-tone={tone} data-flip={flip ? "" : undefined} data-testid={testId}>
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
  /**
   * The top bar's one quiet indicator (UI gate round 3): the dashed circle and the words, with no outline. Every
   * other place uses MicroTag (PayPal money) or a LegendGlyph (anything else).
   */
  readonly quiet?: boolean;
}

/**
 * The honesty tag (I8; unslop spec §2.2): a 20 px pill in a dashed steel outline (simulated), a 10 px dashed
 * circle, the words at 12/16 in ink-3; `quiet`, the words at 14/20 with no outline. Round 3 keeps it for the top
 * bar's one quiet indicator: a PayPal money value takes MicroTag, any other provenance a LegendGlyph. It counts
 * against the screen's tag budget (TAG_BUDGET: three at most, honesty.tsx).
 */
export function HonestyChip({ children, testId, className, quiet = false }: HonestyChipProps) {
  return (
    <span
      className={["fs-honesty", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-fs-tag={quiet ? "bar" : "tag"}
      data-quiet={quiet ? "" : undefined}
    >
      <svg className="fs-honesty__glyph" width={10} height={10} viewBox="0 0 10 10" aria-hidden>
        <circle
          cx={5}
          cy={5}
          r={4}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeDasharray="2 1.6"
        />
      </svg>
      <span>{children}</span>
    </span>
  );
}

/** The honesty tag under its design name; the same component as `HonestyChip`. */
export const HonestyTag = HonestyChip;

export interface RuleChipProps {
  /** What is deducted, as people say it ("CBU"). */
  readonly name: string;
  /** The amount, already signed and formatted ("−1.37"). */
  readonly amount: string;
  /** The rule's id ("R1"): its title and its accessible name, never on the chip (round 5: no ids for people). */
  readonly rule: string;
  /** The rule in a few words ("CBU 5% of bonus"), after the id in the title. */
  readonly ruleText?: string;
}

/** A rule chip's title: "Rule R1 · CBU 5% of bonus" (the rule's id lives here, never on the chip). */
export function ruleChipTitle(rule: string, ruleText?: string): string {
  return ruleText ? `Rule ${rule} · ${ruleText}` : `Rule ${rule}`;
}

/**
 * A deduction reads "CBU −1.37" (round 5): plate-2, no hue of its own. The rule's id and words are its title and
 * part of its accessible name, where a technical reader looks for them.
 */
export function RuleChip({ name, amount, rule, ruleText }: RuleChipProps) {
  const title = ruleChipTitle(rule, ruleText);
  return (
    <span
      className="fs-rule-chip fs-t-figure"
      title={title}
      role="img"
      aria-label={`${name} ${amount}, ${title}`}
    >
      {name} {amount}
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

/**
 * Evidence: the only thing that casts a shadow. Round 5 (provenance once a screen): no glyph in its corner; "Synthetic
 * sample" stays in its accessible name and its title, and the screen's id line says it once for every slip on it.
 */
export function Paper({ alt, children, testId, className }: PaperProps) {
  const t = useT();
  const name = `${alt}. ${t("paper.synthetic")}`;
  return (
    <figure className={["fs-paper", className].filter(Boolean).join(" ")} data-testid={testId} title={name}>
      <div role="img" aria-label={name} className="fs-paper__body">
        {children}
      </div>
    </figure>
  );
}
