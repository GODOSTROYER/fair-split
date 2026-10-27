// SplitFan (S2.7, design §1 signature 6): one seal, the run's net as a bar, eight PayPal threads and the hatched
// cash band, in one SVG on one linear scale (width is money). Threads draw to 70% in graphite on PayPal's 201
// (sent, not paid), finish and turn jade only on a verified SUCCESS, hold at 70% with a canary cap when PayPal
// parks an item, and retract when the line moves to cash. History is drawn in place; only live events animate.
// The picture is hidden from screen readers and mirrored in a table (Data mode).

import { TIMING } from "@fairsplit/motion";
import { seal } from "@fairsplit/seal";
import { type CSSProperties, useMemo } from "react";
import { format } from "../../lib/format.js";
import { FANOUT } from "../split/shared/copy.js";
import { FAN, type FanThread, type FanView } from "./model.js";

export interface SplitFanProps {
  readonly fan: FanView;
  /** Threads whose last change was a live event, with the delay the stage director gave their landing. */
  readonly animate: ReadonlyMap<string, number>;
  /** The 201 just arrived live: the sent threads draw from 0 to 70%, staggered. */
  readonly drawing: boolean;
  readonly mode: "full" | "reduced" | "low";
  readonly cashDay: string;
}

function threadStyle(t: FanThread, delayMs: number | undefined, drawing: boolean): CSSProperties {
  const style: Record<string, string> = { "--fsr-p": String(t.progress), "--fsr-w": `${t.width}` };
  if (delayMs !== undefined) style["--fsr-delay"] = `${delayMs}ms`;
  else if (drawing) style["--fsr-delay"] = `${t.index * TIMING.threadStagger}ms`;
  return style as CSSProperties;
}

export function SplitFan({ fan, animate, drawing, mode, cashDay }: SplitFanProps) {
  const geometry = useMemo(() => seal(fan.sealHash, FAN.seal.size), [fan.sealHash]);
  const half = FAN.seal.size / 2;
  const moved = fan.slices.filter((s) => s.moved);
  const cashOnly = fan.slices.filter((s) => !s.moved);
  const bandLabelY = FAN.band.y0 + (fan.band.end - FAN.band.y0) / 2;
  return (
    <svg
      className="fsr-fan"
      viewBox={`0 0 ${FAN.width} ${FAN.height}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-motion={mode}
      data-drawing={drawing ? "" : undefined}
      data-testid="W-TR-08.fan"
    >
      <defs>
        <pattern
          id="fsr-fan-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="1.5" height="6" className="fsr-fan__hatch-line" />
        </pattern>
      </defs>

      {/* The seal the two keys completed, and the bar of the run's net. */}
      <g className="fsr-fan__seal" transform={`translate(${FAN.seal.cx - half} ${FAN.seal.cy - half})`}>
        {geometry.rings.map((ring) => (
          <path
            key={ring.d.slice(0, 24)}
            d={ring.d}
            className="fs-seal__ring"
            fill="none"
            strokeWidth={geometry.strokeWidth}
          />
        ))}
      </g>
      <rect
        className="fsr-fan__bar"
        x={FAN.bar.x0}
        y={FAN.bar.y0}
        width={FAN.bar.x1 - FAN.bar.x0}
        height={FAN.bar.y1 - FAN.bar.y0}
      />

      {/* The cash band: already drawn, still, hatched with its word (never jade). */}
      <path className="fsr-fan__band" d={fan.band.d} fill="url(#fsr-fan-hatch)" data-testid="W-TR-08.band" />
      <g className="fsr-fan__slices">
        {fan.slices.map((s) => (
          <rect
            key={s.memberNo}
            className="fsr-fan__slice"
            x={FAN.band.x0}
            y={s.y}
            width={FAN.band.x1 - FAN.band.x0}
            height={Math.max(0.5, s.h - 1)}
            data-attested={s.attested ? "" : undefined}
            data-moved={s.moved ? "" : undefined}
          />
        ))}
      </g>
      <text className="fsr-fan__label fsr-fan__label--band" x={FAN.band.x1 + 16} y={bandLabelY}>
        <tspan x={FAN.band.x1 + 16} dy="-1.3em">
          {FANOUT.cashBandFirst(cashOnly.length + moved.length)}
        </tspan>
        <tspan x={FAN.band.x1 + 16} dy="1.3em">
          {FANOUT.cashBandSecond(cashDay)}
        </tspan>
        <tspan x={FAN.band.x1 + 16} dy="1.3em" className="fsr-fan__amount">
          {format.money(fan.cash.cents)}
        </tspan>
      </text>
      {moved.map((s) => (
        <text
          key={s.memberNo}
          className="fsr-fan__label fsr-fan__label--moved"
          x={FAN.band.x1 + 16}
          y={Math.min(FAN.height - 6, s.y + s.h + 14)}
        >
          {FANOUT.movedToCash(s.name)}
        </text>
      ))}

      {/* Eight PayPal threads, each as wide as its payment. */}
      {fan.threads.map((t) => {
        const live = animate.get(t.memberNo);
        return (
          <g
            key={t.memberNo}
            className="fsr-fan__item"
            data-tone={t.tone}
            data-member={t.memberNo}
            data-testid={`W-TR-08.thread.${t.memberNo}`}
          >
            <path
              className="fsr-fan__thread"
              d={t.d}
              pathLength={1}
              strokeWidth={t.width}
              fill="none"
              data-animate={live !== undefined || drawing ? "" : undefined}
              style={threadStyle(t, live, drawing)}
            />
            {(t.tone === "parked" || t.tone === "failed") && (
              <rect
                className="fsr-fan__cap"
                x={t.capAt.x - FAN.cap / 2}
                y={t.capAt.y - FAN.cap / 2}
                width={FAN.cap}
                height={FAN.cap}
                data-tone={t.tone}
              />
            )}
            {t.tone === "parked" && (
              <g className="fsr-fan__parked" transform={`translate(${t.capAt.x + 10} ${t.capAt.y - 9})`}>
                <rect width={58} height={18} />
                <text x={29} y={13} textAnchor="middle">
                  {FANOUT.parkedChip}
                </text>
              </g>
            )}
            <g
              className="fsr-fan__stub"
              transform={`translate(${FAN.stub.x} ${t.stubY})`}
              data-animate={live !== undefined ? "" : undefined}
              style={{ ["--fsr-delay" as string]: `${live ?? 0}ms` }}
            >
              <rect className="fsr-fan__stub-edge" width={FAN.stub.w} height={FAN.stub.h} />
              <rect className="fsr-fan__stub-face" width={FAN.stub.w} height={FAN.stub.h} />
            </g>
            <text className="fsr-fan__label" x={FAN.stub.x + FAN.stub.w + 14} y={t.stubY + 10}>
              {t.name}
            </text>
            <text
              className="fsr-fan__label fsr-fan__amount"
              x={FAN.width - 8}
              y={t.stubY + 10}
              textAnchor="end"
              data-amount-state={t.tone === "moved" ? "hollow" : t.amountState}
            >
              {format.money(t.cents)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
