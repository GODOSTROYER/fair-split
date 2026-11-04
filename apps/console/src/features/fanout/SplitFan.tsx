// SplitFan (S2.7, design §1 signature 6): one seal, 64 lines, eight PayPal threads and 56 dashed cash lines, in
// one SVG on one linear scale (width is money). Threads draw to 70% in graphite on PayPal's 201 (sent, not
// paid), finish and turn jade only on a verified SUCCESS, hold at 70% with a canary cap when PayPal parks an
// item, and retract when the line moves to cash, while that member's own dashed cash line draws from the same
// slot. The 56 cash lines are already drawn and stay still. History is drawn in place; only live events animate.
// Every word and figure is HTML laid over the picture at its own type size (12 to 14 px at any width); the
// picture is hidden from screen readers and mirrored in a table (Data mode).

import { TIMING } from "@fairsplit/motion";
import { seal } from "@fairsplit/seal";
import { type CSSProperties, useId, useMemo } from "react";
import { format } from "../../lib/format.js";
import { FANOUT } from "../split/shared/copy.js";
import { CASH_DASHARRAY, type CashLine, FAN, type FanThread, type FanView } from "./model.js";

export interface SplitFanProps {
  readonly fan: FanView;
  /** Lines whose last change was a live event, with the delay the stage director gave their landing. */
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

const pct = (n: number) => `${Math.round(n * 10_000) / 100}%`;

/** Places a label at a point of the picture, in percent of its box (the picture keeps its aspect ratio). */
function at(x: number, y: number): CSSProperties {
  return { ["--fsr-x" as string]: pct(x / FAN.width), ["--fsr-y" as string]: pct(y / FAN.height) };
}

/** A member moved to cash: the dashed line draws in along its own path where the thread retracts (MM-6). */
function MovedLine({ line, live, maskId }: { line: CashLine; live: number | undefined; maskId: string }) {
  return (
    <g
      className="fsr-fan__moved"
      data-animate={live !== undefined ? "" : undefined}
      style={{ ["--fsr-delay" as string]: `${live ?? 0}ms` }}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={FAN.width} height={FAN.height}>
        <path className="fsr-fan__reveal" d={line.d} pathLength={1} strokeWidth={line.stroke + 4} />
      </mask>
      <path
        className="fsr-fan__cash-line"
        d={line.d}
        pathLength={1}
        strokeWidth={line.stroke}
        strokeDasharray={CASH_DASHARRAY}
        strokeDashoffset={line.dashOffset}
        mask={`url(#${maskId})`}
        data-moved=""
        data-attested={line.attested ? "" : undefined}
        data-testid={`W-TR-08.cash.${line.memberNo}`}
      />
    </g>
  );
}

export function SplitFan({ fan, animate, drawing, mode, cashDay }: SplitFanProps) {
  const uid = useId().replaceAll(":", "");
  const geometry = useMemo(() => seal(fan.sealHash, FAN.seal.size), [fan.sealHash]);
  const half = FAN.seal.size / 2;
  const hatchId = `fsr-fan-hatch-${uid}`;
  return (
    <div
      className="fsr-fan"
      data-motion={mode}
      data-drawing={drawing ? "" : undefined}
      data-testid="W-TR-08.fan"
      aria-hidden="true"
    >
      <svg
        className="fsr-fan__svg"
        viewBox={`0 0 ${FAN.width} ${FAN.height}`}
        role="presentation"
        focusable="false"
      >
        <defs>
          <pattern
            id={hatchId}
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

        {/* One dashed line per member paid in cash: already drawn, still, hatch-coloured (never jade). */}
        <g className="fsr-fan__cash" data-testid="W-TR-08.cash">
          {fan.cashLines.map((line) =>
            line.moved ? (
              <MovedLine
                key={line.memberNo}
                line={line}
                live={animate.get(line.memberNo)}
                maskId={`fsr-fan-reveal-${uid}-${line.memberNo}`}
              />
            ) : (
              <path
                key={line.memberNo}
                className="fsr-fan__cash-line"
                d={line.d}
                pathLength={1}
                strokeWidth={line.stroke}
                strokeDasharray={CASH_DASHARRAY}
                strokeDashoffset={line.dashOffset}
                data-attested={line.attested ? "" : undefined}
                data-testid={`W-TR-08.cash.${line.memberNo}`}
              />
            ),
          )}
        </g>
        <g className="fsr-fan__ends">
          {fan.cashLines.map((line) => (
            <rect
              key={line.memberNo}
              className="fsr-fan__end"
              x={FAN.endX}
              y={line.endY}
              width={FAN.cash.w}
              height={Math.max(0.5, line.h - 1)}
              style={line.attested ? undefined : { fill: `url(#${hatchId})` }}
              data-attested={line.attested ? "" : undefined}
            />
          ))}
        </g>

        {/* Eight PayPal threads, each as wide as its payment. */}
        {fan.threads.map((t) => {
          const live = animate.get(t.memberNo);
          return (
            <g
              key={t.memberNo}
              className="fsr-fan__item"
              data-tone={t.replayed ? "sent" : t.tone}
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
                  data-tone={t.replayed ? "sent" : t.tone}
                />
              )}
              <g
                className="fsr-fan__stub"
                transform={`translate(${FAN.endX} ${t.stubY})`}
                data-animate={live !== undefined ? "" : undefined}
                style={{ ["--fsr-delay" as string]: `${live ?? 0}ms` }}
              >
                <rect className="fsr-fan__stub-edge" width={FAN.stub.w} height={FAN.stub.h} />
                <rect
                  className="fsr-fan__stub-face"
                  width={FAN.stub.w}
                  height={FAN.stub.h}
                  style={t.tone === "moved" ? { fill: `url(#${hatchId})` } : undefined}
                />
              </g>
            </g>
          );
        })}
      </svg>

      <div className="fsr-fan__labels">
        {fan.threads.map((t) => (
          <p
            key={t.memberNo}
            className="fsr-fan__row"
            style={at(FAN.labelX, t.stubY + FAN.stub.h / 2)}
            data-tone={t.replayed ? "sent" : t.tone}
            data-testid={`W-TR-08.label.${t.memberNo}`}
          >
            {t.tone === "moved" ? (
              // Her money now rides with the cash line and the cash total beneath: the row says where it went.
              <span className="fsr-fan__name fs-t-caption">{FANOUT.movedToCash(t.name)}</span>
            ) : (
              <>
                <span className="fsr-fan__name fs-t-caption" title={t.statusWord}>
                  {t.name}
                  {t.replayed ? " · Replayed (labelled, simulated)" : ""}
                </span>
                <span className="fsr-fan__amount fs-t-figure" data-amount-state={t.amountState}>
                  {format.money(t.cents)}
                </span>
              </>
            )}
          </p>
        ))}
        {fan.threads
          .filter((t) => t.tone === "parked")
          .map((t) => (
            <span
              key={t.memberNo}
              className="fsr-fan__chip fs-t-caption"
              style={at(t.capAt.x + 12, t.capAt.y)}
              data-testid={`W-TR-08.chip.${t.memberNo}`}
            >
              {t.replayed ? "Replayed (labelled, simulated)" : FANOUT.parkedChip}
            </span>
          ))}
        {fan.cashLines.length > 0 && (
          <p
            className="fsr-fan__group"
            style={at(FAN.labelX, (fan.cash.top + fan.cash.bottom) / 2)}
            data-testid="W-TR-08.cashLabel"
          >
            <span className="fsr-fan__name fs-t-caption">
              {FANOUT.cashBandMembers(fan.cash.members, cashDay)}
            </span>
            <span className="fsr-fan__amount fs-t-figure" data-amount-state={fan.cash.amountState}>
              {format.money(fan.cash.cents)}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
