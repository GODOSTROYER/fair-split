// Seal: the guilloché grown from the batch digest and completed by two people (design §5). Inner rings 0–2
// engrave when the treasurer signs, outer rings 3–4 when the Chair signs; unsigned bands show as 1 px rule
// circles. Pure SVG from @fairsplit/seal, so every surface draws the same seal for the same batch.

import { TIMING, TWEENS } from "@fairsplit/motion/presets";
import { spring, tween } from "@fairsplit/motion/web";
import { bandCircle, hashGroups, isSigned, type RingIndex, seal } from "@fairsplit/seal";
import { animate, motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { useMotionMode, useT } from "./context.js";
import type { KeysSigned, SealProps } from "./contract.js";

/** A still frame for the MM-5 motion study: per-ring engrave progress and opacity, and the landing scale. */
export interface SealFrame {
  readonly rings: readonly number[];
  readonly opacity: readonly number[];
  readonly scale?: number;
}

export interface WebSealProps extends SealProps {
  readonly testId?: string;
  readonly frame?: SealFrame;
  readonly className?: string;
}

const RINGS: readonly RingIndex[] = [0, 1, 2, 3, 4];

export function Seal({ batchSha256, size, keys, engrave = false, testId, frame, className }: WebSealProps) {
  const t = useT();
  const mode = useMotionMode();
  const geometry = useMemo(() => seal(batchSha256, size), [batchSha256, size]);
  const scale = useMotionValue(frame?.scale ?? 1);
  const previousKeys = useRef<KeysSigned>(keys);
  const newlySigned = useRef<Set<RingIndex>>(new Set());

  if (previousKeys.current !== keys) {
    const fresh = new Set<RingIndex>();
    for (const i of RINGS) if (isSigned(i, keys) && !isSigned(i, previousKeys.current)) fresh.add(i);
    newlySigned.current = engrave ? fresh : new Set();
  }

  useEffect(() => {
    const was = previousKeys.current;
    previousKeys.current = keys;
    if (frame || !engrave || keys !== 2 || was === 2 || mode !== "full") return;
    // The seal lands 720 ms after the Chair's signature: 1.03 → 1 on the land spring (S2 §2.9).
    const timer = setTimeout(() => {
      scale.set(1.03);
      animate(scale, 1, spring("land", "unitless"));
    }, 720);
    return () => clearTimeout(timer);
  }, [keys, engrave, frame, mode, scale]);

  useEffect(() => {
    if (frame?.scale !== undefined) scale.set(frame.scale);
  }, [frame?.scale, scale]);

  const hash = hashGroups(geometry.digest);
  const label = `${t("seal.title", { hash })}. ${t("seal.keys", { signed: keys })}`;

  return (
    <motion.svg
      className={["fs-seal", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-state={`keys-${keys}`}
      data-digest={hash}
      style={{ scale }}
    >
      {RINGS.map((i) => {
        const ring = geometry.rings[i];
        if (!ring) return null;
        const circle = bandCircle(i, size);
        const ruleCircle = (opacity: number) => (
          <circle
            key={`band-${i}`}
            className="fs-seal__band"
            cx={circle.cx}
            cy={circle.cy}
            r={circle.r}
            strokeWidth={1}
            fill="none"
            opacity={opacity}
          />
        );
        if (frame) {
          const progress = frame.rings[i] ?? 0;
          const opacity = frame.opacity[i] ?? 0;
          const visible = progress * opacity;
          return (
            <g key={i} data-ring={i}>
              {visible < 1 && ruleCircle(1 - visible)}
              {visible > 0 && (
                <path
                  className="fs-seal__ring"
                  d={ring.d}
                  fill="none"
                  strokeWidth={geometry.strokeWidth}
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray="1 1"
                  strokeDashoffset={1 - progress}
                  opacity={opacity}
                />
              )}
            </g>
          );
        }
        if (!isSigned(i, keys)) return <g key={i}>{ruleCircle(1)}</g>;
        const order = [...newlySigned.current].sort().indexOf(i);
        const animateIn = order >= 0;
        const delay = (Math.max(0, order) * TIMING.engraveStagger) / 1000;
        if (animateIn && mode === "full") {
          return (
            <motion.path
              key={i}
              className="fs-seal__ring"
              d={ring.d}
              fill="none"
              strokeWidth={geometry.strokeWidth}
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: TWEENS.engrave.ms / 1000, ease: "linear", delay }}
            />
          );
        }
        if (animateIn) {
          const fade = mode === "low" ? tween("lowFade") : tween("reduced");
          return (
            <motion.path
              key={i}
              className="fs-seal__ring"
              d={ring.d}
              fill="none"
              strokeWidth={geometry.strokeWidth}
              strokeLinejoin="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={fade}
            />
          );
        }
        return (
          <path
            key={i}
            className="fs-seal__ring"
            d={ring.d}
            fill="none"
            strokeWidth={geometry.strokeWidth}
            strokeLinejoin="round"
          />
        );
      })}
    </motion.svg>
  );
}
