// DigitSwap (design §3 "digit", S2.7): when an amount changes because of a live event, only the characters that
// changed slide 6 px and crossfade (out 120 ms, in 150 ms); the value never counts through intermediate numbers.
// Replayed history and the person's own reload change instantly. Reduced motion changes instantly too, with a
// 600 ms pencil wash so the change is still seen (MM-3 reduced). Screen readers get the new value once.

import { useMotionMode } from "@fairsplit/ui-web";
import { type CSSProperties, useState } from "react";

export interface DigitSwapProps {
  /** The formatted value, e.g. "62.71" (from `format.*`). */
  readonly value: string;
  /** The event that changed it. A new key with a new value animates; the same key never animates twice. */
  readonly changeKey?: string | null;
  /** False for replays and first paint: the value changes in place. */
  readonly animate?: boolean;
  /** Starts the swap later (the MM-3 wave: 6 ms a row, capped). */
  readonly delayMs?: number;
  readonly className?: string;
  readonly testId?: string;
}

interface SwapState {
  readonly value: string;
  readonly key: string | null | undefined;
  /** The value it is swapping from, while a swap shows. */
  readonly from: string | null;
  readonly swapKey: string | null;
}

/** Right-aligns two strings by padding the shorter one on the left (amounts align on the decimal point). */
export function alignForSwap(from: string, to: string): readonly (readonly [string, string])[] {
  const width = Math.max(from.length, to.length);
  const a = from.padStart(width, " ");
  const b = to.padStart(width, " ");
  return Array.from({ length: width }, (_, i) => [a[i] ?? " ", b[i] ?? " "] as const);
}

export function DigitSwap({
  value,
  changeKey = null,
  animate = false,
  delayMs = 0,
  className,
  testId,
}: DigitSwapProps) {
  const mode = useMotionMode();
  const [state, setState] = useState<SwapState>({ value, key: changeKey, from: null, swapKey: null });
  // Storing what the previous render showed (React's "adjusting state when a prop changes"): a change is
  // detected in render, so the frame that first shows the new value already carries its swap.
  if (state.value !== value || state.key !== changeKey) {
    const swaps = value !== state.value && animate && !!changeKey && changeKey !== state.key;
    setState({
      value,
      key: changeKey,
      from: swaps ? state.value : value === state.value ? state.from : null,
      swapKey: swaps ? (changeKey ?? null) : value === state.value ? state.swapKey : null,
    });
  }
  const swapping = state.from !== null && state.swapKey !== null && state.from !== value;
  const style = { "--fsr-swap-delay": `${Math.max(0, delayMs)}ms` } as CSSProperties;
  const classes = ["fsr-digits", className].filter(Boolean).join(" ");

  if (!swapping) {
    return (
      <span className={classes} data-testid={testId} data-swap="none">
        {value}
      </span>
    );
  }

  if (mode !== "full") {
    // Reduced motion and the low tier: the new value at once, washed in pencil for 600 ms.
    return (
      <span
        key={state.swapKey}
        className={`${classes} fsr-digits--wash`}
        style={style}
        data-testid={testId}
        data-swap={state.swapKey}
        data-swap-mode="wash"
      >
        {value}
      </span>
    );
  }

  const pairs = alignForSwap(state.from ?? "", value);
  return (
    <span
      className={classes}
      style={style}
      data-testid={testId}
      data-swap={state.swapKey}
      data-swap-mode="slide"
    >
      <span className="fs-sr">{value}</span>
      <span aria-hidden className="fsr-digits__row">
        {pairs.map(([before, after], i) =>
          before === after ? (
            <span key={i} className="fsr-digits__char">
              {after === " " ? "" : after}
            </span>
          ) : (
            <span key={`${state.swapKey}-${i}`} className="fsr-digits__slot">
              <span className="fsr-digits__in">{after === " " ? "" : after}</span>
              <span className="fsr-digits__out">{before === " " ? "" : before}</span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
