// Honesty marks with a budget (UI gate round 3). The meaning survives; the pills go.
// - One quiet indicator in the top bar: the honesty tag with `quiet` ("Simulated PayPal sandbox", no outline).
// - One micro-tag, MicroTag: a 12 px dashed circle and the word "Sandbox" at 12 px, 18 px tall, only on PayPal money
//   values, at most two a screen. A screen reader hears the whole label ("Simulated PayPal sandbox").
// - Every other provenance pill ("Seed stand-in", "Seeded sample", "Synthetic sample", "Demo key", "Demo data")
//   becomes a bare LegendGlyph: a hatched square for synthetic, a dashed circle for simulated, a solid square for
//   real. Its words are its tooltip and its accessible name. The full legend (HonestyLegend) lives only in the
//   What's real sheet.
// TAG_BUDGET and tagBudget() let a screen's test hold it to three tags at most, the top bar's included.

import type { ReactNode } from "react";

/** What a legend glyph says: real code, a simulated system, or synthetic data. */
export type HonestyKind = "real" | "simulated" | "synthetic";

/** A glyph's kind and the words a person hovers (or a screen reader hears) for it. */
export interface HonestyMark {
  readonly kind: HonestyKind;
  readonly label: string;
}

/**
 * The marks the stage uses, word for word. The seed stand-in keeps its pinned phrase as its accessible name; a seed
 * or a synthetic sample is made-up data (hatched); the PayPal sandbox and the demo keys are stand-in systems (dashed).
 */
export const HONESTY = {
  realCode: { kind: "real", label: "Real code" },
  simulatedSandbox: { kind: "simulated", label: "Simulated PayPal sandbox" },
  demoKey: { kind: "simulated", label: "Demo key, made in this browser" },
  simulatedPush: { kind: "simulated", label: "Simulated push" },
  machineTranslated: { kind: "simulated", label: "Machine-translated, pending native review" },
  seedStandIn: { kind: "synthetic", label: "Seed stand-in, not a Claude recording" },
  seededSample: { kind: "synthetic", label: "Seeded sample" },
  syntheticSample: { kind: "synthetic", label: "Synthetic sample" },
  syntheticVoice: { kind: "synthetic", label: "Synthetic voice" },
  demoData: { kind: "synthetic", label: "Demo data" },
} as const satisfies Record<string, HonestyMark>;

export type HonestyMarkName = keyof typeof HONESTY;

/** The legend's three rows, in reading order: what each glyph means. */
export const HONESTY_LEGEND: readonly { readonly kind: HonestyKind; readonly term: string }[] = [
  { kind: "real", term: "Real code" },
  { kind: "simulated", term: "Simulated" },
  { kind: "synthetic", term: "Synthetic" },
];

/** At most three tags a screen, the top bar's indicator included; at most two of them micro-tags. */
export const TAG_BUDGET = { perScreen: 3, microPerScreen: 2 } as const;

/** Counts the tags under `root` (glyphs are not tags): every `[data-fs-tag]`, and the micro-tags among them. */
export function tagBudget(root: ParentNode): {
  readonly tags: number;
  readonly micro: number;
  readonly glyphs: number;
  readonly ok: boolean;
} {
  const tags = root.querySelectorAll("[data-fs-tag]").length;
  const micro = root.querySelectorAll('[data-fs-tag="micro"]').length;
  const glyphs = root.querySelectorAll("[data-fs-glyph]").length;
  return {
    tags,
    micro,
    glyphs,
    ok: tags <= TAG_BUDGET.perScreen && micro <= TAG_BUDGET.microPerScreen,
  };
}

/** The dashed circle: "not real, or not yet". Drawn in currentColor at `size` px. */
function DashedCircle({ size }: { readonly size: number }) {
  const r = size / 2 - 1;
  const dash = Math.max(1.4, size / 7);
  return (
    <svg
      className="fs-mark-svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      focusable="false"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeDasharray={`${dash} ${dash * 0.8}`}
      />
    </svg>
  );
}

function LegendShape({ kind, size }: { readonly kind: HonestyKind; readonly size: number }) {
  if (kind === "simulated") return <DashedCircle size={size} />;
  const s = size - 3;
  const o = 1.5;
  if (kind === "real") {
    return (
      <svg
        className="fs-mark-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        focusable="false"
      >
        <rect x={o} y={o} width={s} height={s} rx={1.5} fill="currentColor" />
      </svg>
    );
  }
  // Synthetic: a square in a hairline with 45° hatch inside it (each line cut to the square: no clip path, so two
  // glyphs on a page never share an id).
  const lo = o;
  const hi = o + s;
  const hatch = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((f) => {
    const c = 2 * lo + f * s;
    const x1 = Math.max(lo, c - hi);
    const x2 = Math.min(hi, c - lo);
    return { key: f, x1, y1: c - x1, x2, y2: c - x2 };
  });
  return (
    <svg
      className="fs-mark-svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={1}>
        {hatch.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>
      <rect x={o} y={o} width={s} height={s} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

export interface LegendGlyphProps {
  readonly kind: HonestyKind;
  /** The words: its tooltip and its accessible name ("Seed stand-in, not a Claude recording"). */
  readonly label: string;
  /** 12 px by default (the glyph beside a value); 14 in a legend row. */
  readonly size?: number;
  readonly testId?: string;
  readonly className?: string;
}

/**
 * A bare legend glyph in place of a provenance pill: no outline, no word on screen. Hovering shows its words (the
 * title), and a screen reader hears them (the visually hidden text), so the honesty meaning survives.
 */
export function LegendGlyph({ kind, label, size = 12, testId, className }: LegendGlyphProps) {
  return (
    <span
      className={["fs-legend-glyph", className].filter(Boolean).join(" ")}
      data-kind={kind}
      data-fs-glyph=""
      title={label}
      data-testid={testId}
    >
      <LegendShape kind={kind} size={size} />
      <span className="fs-sr">{label}</span>
    </span>
  );
}

/** The glyph's shape alone, hidden from assistive technology: for a legend row whose words sit beside it. */
export function LegendMark({ kind, size = 14 }: { readonly kind: HonestyKind; readonly size?: number }) {
  return (
    <span className="fs-legend-glyph" data-kind={kind} aria-hidden>
      <LegendShape kind={kind} size={size} />
    </span>
  );
}

export interface MicroTagProps {
  /** The word on screen: "Sandbox". */
  readonly children?: ReactNode;
  /** What a screen reader hears and the tooltip says: "Simulated PayPal sandbox". */
  readonly label?: string;
  readonly testId?: string;
  readonly className?: string;
}

/**
 * The micro-tag beside a PayPal money value: a 12 px dashed circle and "Sandbox" at 12 px, 18 px tall, in ink-3.
 * At most two a screen (TAG_BUDGET); the screen reader hears the whole label, never just "Sandbox".
 */
export function MicroTag({
  children = "Sandbox",
  label = HONESTY.simulatedSandbox.label,
  testId,
  className,
}: MicroTagProps) {
  return (
    <span
      className={["fs-microtag", className].filter(Boolean).join(" ")}
      data-fs-tag="micro"
      title={label}
      data-testid={testId}
    >
      <DashedCircle size={12} />
      <span className="fs-microtag__word" aria-hidden>
        {children}
      </span>
      <span className="fs-sr">{label}</span>
    </span>
  );
}

export interface HonestyLegendProps {
  /** One line per kind, beside its term (What's real says what each covers). */
  readonly lines?: Partial<Record<HonestyKind, string>>;
  readonly testId?: string;
  readonly className?: string;
}

/** The full legend: three rows, glyph and term. It lives in the What's real sheet only. */
export function HonestyLegend({ lines, testId, className }: HonestyLegendProps) {
  return (
    <ul className={["fs-legend", className].filter(Boolean).join(" ")} data-testid={testId}>
      {HONESTY_LEGEND.map(({ kind, term }) => (
        <li key={kind} className="fs-legend__row" data-kind={kind}>
          <LegendMark kind={kind} />
          <span className="fs-legend__term fs-t-label">{term}</span>
          {lines?.[kind] && <span className="fs-legend__line fs-t-caption">{lines[kind]}</span>}
        </li>
      ))}
    </ul>
  );
}

export type StateDotKind = "pending" | "waiting" | "done" | "paid" | "held" | "failed";

export interface StateDotProps {
  /**
   * pending: a hollow neutral dot beside a pending amount (its figure in --fs-pending). waiting: a hollow circle for
   * a signer not yet signed. done: a solid ink dot (signed, checked). paid: the jade dot, only for money the
   * simulated PayPal confirmed. held: marigold (a person must decide). failed: red (PayPal said no).
   */
  readonly kind: StateDotKind;
  readonly testId?: string;
  readonly className?: string;
}

/** A state's dot: colour lives here, and the word beside it says the state (never colour alone). */
export function StateDot({ kind, testId, className }: StateDotProps) {
  return (
    <span
      className={["fs-state-dot", className].filter(Boolean).join(" ")}
      data-kind={kind}
      data-testid={testId}
      aria-hidden
    />
  );
}
