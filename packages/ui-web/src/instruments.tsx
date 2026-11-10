// Instruments: the bodega's hanging-scale dial for mass balance, and the rail bar that splits a run between
// PayPal and cash at the bodega (design §2.6, S2 §2.7). Visualisations are hidden from screen readers and
// mirrored in words.

import { spring } from "@fairsplit/motion/web";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { useMotionMode } from "./context.js";

export interface MassBalanceDialProps {
  /** Shrink in percent, e.g. 2.05. */
  readonly value: number;
  /** "2.05%", from format.* */
  readonly display: string;
  readonly limit?: number;
  readonly limitDisplay: string;
  readonly label: string;
  readonly size?: number;
  readonly testId?: string;
  /** Swing the needle on the needle spring when the value changes (MM-3). */
  readonly animateNeedle?: boolean;
  /**
   * An old reading to keep as a half-strength marigold ghost needle. Without one, a live change (animateNeedle) leaves
   * the previous reading as the ghost for 1.2 s (decision.md §9).
   */
  readonly ghost?: number;
  /**
   * The reading's type: the small figure (a drawer's dial) or amount-l, the bench's hero reading (32/36,
   * condensed, proportional). While a ghost shows, the old reading stands before the new one: "2.05% → 1.62%".
   */
  readonly valueRole?: "figure" | "amount-l";
}

/** How long the previous reading stays as a ghost after a live change. */
const GHOST_MS = 1200;

const MAX = 4;
/** 240° arc: 0–4.0% at 60° per percentage point, so 2.0% sits at 12 o'clock. */
const angleOf = (v: number) => -120 + 60 * Math.max(0, Math.min(MAX, v));

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function MassBalanceDial({
  value,
  display,
  limit = 2,
  limitDisplay,
  label,
  size = 132,
  testId,
  animateNeedle = false,
  ghost,
  valueRole = "figure",
}: MassBalanceDialProps) {
  const mode = useMotionMode();
  const id = useId().replaceAll(":", "");
  const angle = useMotionValue(angleOf(value));
  const needle = useTransform(angle, (a) => `rotate(${a}deg)`);
  const w = size;
  const h = Math.round(size * 0.78);
  const cx = w / 2;
  const cy = w / 2 + 4;
  const r = w / 2 - 10;
  const previous = useRef(value);
  const previousDisplay = useRef(display);
  const [trail, setTrail] = useState<number | null>(null);
  const [trailDisplay, setTrailDisplay] = useState<string | null>(null);
  useEffect(() => {
    const target = angleOf(value);
    if (animateNeedle && mode === "full") animate(angle, target, spring("needle", "unitless"));
    else angle.set(target);
    const was = previous.current;
    const wasDisplay = previousDisplay.current;
    previous.current = value;
    if (!animateNeedle || was === value) return;
    setTrail(was);
    setTrailDisplay(wasDisplay);
    const timer = setTimeout(() => {
      setTrail(null);
      setTrailDisplay(null);
    }, GHOST_MS);
    return () => clearTimeout(timer);
  }, [value, animateNeedle, mode, angle]);
  useEffect(() => {
    previousDisplay.current = display;
  }, [display]);
  const ghostValue = ghost ?? trail;
  const ticks = Array.from({ length: MAX * 2 + 1 }, (_, i) => i / 2);
  const over = value > limit;
  return (
    <figure className="fs-dial" data-testid={testId} data-over={over ? "" : undefined}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <defs>
          <pattern
            id={`hatch-${id}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="1.5" height="6" className="fs-dial__hatch-line" />
          </pattern>
        </defs>
        <path d={arc(cx, cy, r, -120, 120)} className="fs-dial__track" />
        <path
          d={arc(cx, cy, r, angleOf(limit), 120)}
          className="fs-dial__over"
          stroke={`url(#hatch-${id})`}
        />
        {ticks.map((v) => {
          const [x0, y0] = polar(cx, cy, r, angleOf(v));
          const [x1, y1] = polar(cx, cy, r - (v % 1 === 0 ? 9 : 5), angleOf(v));
          return (
            <line
              key={v}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              className={v === limit ? "fs-dial__tick fs-dial__tick--limit" : "fs-dial__tick"}
            />
          );
        })}
        {ghostValue !== null && ghostValue !== undefined && (
          <g
            className="fs-dial__ghost-needle"
            data-testid={testId ? `${testId}.ghost` : undefined}
            transform={`rotate(${angleOf(ghostValue)} ${cx} ${cy})`}
          >
            <line x1={cx} y1={cy} x2={cx} y2={cy - r + 12} className="fs-dial__ghost" />
          </g>
        )}
        <motion.g style={{ transform: needle, transformOrigin: `${cx}px ${cy}px` }}>
          <line x1={cx} y1={cy + 6} x2={cx} y2={cy - r + 12} className="fs-dial__needle" />
        </motion.g>
        <circle cx={cx} cy={cy} r={3.5} className="fs-dial__hub" />
      </svg>
      <figcaption className="fs-dial__caption" data-role={valueRole}>
        <span className="fs-dial__reading">
          {trailDisplay !== null && trail !== null && (
            <span className="fs-dial__was" data-testid={testId ? `${testId}.was` : undefined} aria-hidden>
              <span className={`fs-t-${valueRole}`}>{trailDisplay}</span>
              <span className="fs-dial__arrow">→</span>
            </span>
          )}
          <span className={`fs-dial__value fs-t-${valueRole}`}>{display}</span>
        </span>
        <span className="fs-dial__label fs-t-caption">{label}</span>
        <span className="fs-dial__limit fs-t-caption">{limitDisplay}</span>
      </figcaption>
    </figure>
  );
}

export interface RailBarProps {
  /** Share of value on PayPal, 0 to 1. */
  readonly paypalShare: number;
  readonly paypalText: string;
  readonly cashText: string;
  readonly cashWord: string;
  /** Jade only once PayPal confirmed; before that the PayPal part is a neutral steel outline. */
  readonly confirmed?: boolean;
  readonly testId?: string;
}

export function RailBar({
  paypalShare,
  paypalText,
  cashText,
  cashWord,
  confirmed = false,
  testId,
}: RailBarProps) {
  const pct = `${Math.max(2, Math.min(98, paypalShare * 100)).toFixed(2)}%`;
  return (
    <figure className="fs-railbar" data-testid={testId} data-confirmed={confirmed ? "" : undefined}>
      <div className="fs-railbar__bar" aria-hidden>
        <span className="fs-railbar__paypal" style={{ width: pct }} />
        <span className="fs-railbar__cash">
          <span className="fs-railbar__word fs-t-caption">{cashWord}</span>
        </span>
      </div>
      <figcaption className="fs-railbar__caption">
        <span className="fs-t-label">{paypalText}</span>
        <span className="fs-t-caption">{cashText}</span>
      </figcaption>
    </figure>
  );
}
