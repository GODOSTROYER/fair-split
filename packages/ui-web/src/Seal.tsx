// Seal: the guilloché grown from the batch digest and completed by two people (design §5, S2 §2.7). The inner
// rings engrave when the treasurer signs, the outer rings when the Chair signs; unsigned bands show as 1 px rule
// circles. Below 96 px the seal draws one ring per key. Pure SVG from @fairsplit/seal, so every surface draws
// the same seal for the same batch; with `showHash` both ends of its digest sit under it in groups of four, so
// a person can cross-check the console and the phone by eye.

import { TIMING, TWEENS } from "@fairsplit/motion/presets";
import { spring, tween } from "@fairsplit/motion/web";
import { hashGroups, isRingSigned, ringBandCircle, type SealRing, seal, sealHash } from "@fairsplit/seal";
import { animate, motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMotionMode, useT } from "./context.js";
import type { KeysSigned, SealProps } from "./contract.js";

/**
 * A still frame for the MM-5 motion study: per-ring engrave progress and opacity, indexed like the five-ring seal
 * (a two-ring seal reads the entries of the rings its bytes come from, 0 and 3), and the landing scale.
 */
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

/** Device pixels per CSS pixel, read once: the stroke is never thinner than one device pixel. */
function useDevicePixelRatio(): number {
  const [dpr] = useState(() => {
    const value = typeof window === "undefined" ? 1 : window.devicePixelRatio;
    return value > 0 && Number.isFinite(value) ? value : 1;
  });
  return dpr;
}

export function Seal({
  batchSha256,
  size,
  keys,
  engrave = false,
  showHash = false,
  testId,
  frame,
  className,
}: WebSealProps) {
  const t = useT();
  const mode = useMotionMode();
  const dpr = useDevicePixelRatio();
  const geometry = useMemo(
    () => seal(batchSha256, size, { devicePixelRatio: dpr }),
    [batchSha256, size, dpr],
  );
  const scale = useMotionValue(frame?.scale ?? 1);
  const previousKeys = useRef<KeysSigned>(keys);
  const newlySigned = useRef<Set<number>>(new Set());

  if (previousKeys.current !== keys) {
    const fresh = new Set<number>();
    for (const r of geometry.rings)
      if (isRingSigned(r, keys) && !isRingSigned(r, previousKeys.current)) fresh.add(r.index);
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

  const label = `${t("seal.title", { hash: hashGroups(geometry.digest) })}. ${t("seal.keys", { signed: keys })}`;
  const stroke = geometry.strokeWidth;

  const drawRing = (r: SealRing) => {
    const circle = ringBandCircle(r, size);
    const ruleCircle = (opacity: number) => (
      <circle
        key={`band-${r.index}`}
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
      const progress = frame.rings[r.source] ?? 0;
      const opacity = frame.opacity[r.source] ?? 0;
      const visible = progress * opacity;
      return (
        <g key={r.index} data-ring={r.index}>
          {visible < 1 && ruleCircle(1 - visible)}
          {visible > 0 && (
            <path
              className="fs-seal__ring"
              d={r.d}
              fill="none"
              strokeWidth={stroke}
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
    if (!isRingSigned(r, keys)) return <g key={r.index}>{ruleCircle(1)}</g>;
    const order = [...newlySigned.current].sort((a, b) => a - b).indexOf(r.index);
    const animateIn = order >= 0;
    const delay = (Math.max(0, order) * TIMING.engraveStagger) / 1000;
    if (animateIn && mode === "full") {
      return (
        <motion.path
          key={r.index}
          className="fs-seal__ring"
          d={r.d}
          fill="none"
          strokeWidth={stroke}
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
          key={r.index}
          className="fs-seal__ring"
          d={r.d}
          fill="none"
          strokeWidth={stroke}
          strokeLinejoin="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={fade}
        />
      );
    }
    return (
      <path
        key={r.index}
        className="fs-seal__ring"
        d={r.d}
        fill="none"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    );
  };

  const svg = (
    <motion.svg
      className={["fs-seal", showHash ? undefined : className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-state={`keys-${keys}`}
      data-variant={geometry.variant}
      data-digest={geometry.digest}
      style={{ scale }}
    >
      {geometry.rings.map(drawRing)}
    </motion.svg>
  );

  if (!showHash) return svg;
  return (
    <figure className={["fs-seal-figure", className].filter(Boolean).join(" ")}>
      {svg}
      <figcaption
        className="fs-seal-figure__hash fs-t-hash"
        data-testid={testId ? `${testId}.hash` : undefined}
      >
        {sealHash(geometry.digest)}
      </figcaption>
    </figure>
  );
}
