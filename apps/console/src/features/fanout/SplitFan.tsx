// SplitFan (S2.7, design §1 signature 6; UI gate round 2): the run's hero. One seal, 64 lines: eight PayPal
// threads fan out from the seal's hub to one row each, at one even stroke, and the cash members run together as one
// calm band into one compact block. Threads draw to 70% in flight on PayPal's 201 (sent, not paid), finish and turn
// jade only on a verified SUCCESS, hold at 70% with a marigold cap when PayPal parks an item, and retract when the
// line moves to cash, while that member's own dashed line draws from the same slot to the cash block. History is
// drawn in place; only live events animate. Every word and figure is HTML laid over the picture at its own type
// size; the picture is hidden from screen readers and mirrored in a table (Data mode).

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
  const geometry = useMemo(() => (fan.sealHash ? seal(fan.sealHash, FAN.seal.size) : null), [fan.sealHash]);
  const half = FAN.seal.size / 2;
  const hatchId = `fsr-fan-hatch-${uid}`;
  const band = fan.cashLines.filter((l) => !l.moved);
  const blockH = fan.cash.bottom - fan.cash.top;
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

        {/* The seal the two keys completed, and the hub every line leaves. */}
        <g
          className="fsr-fan__seal"
          data-digest={fan.sealHash ?? undefined}
          transform={`translate(${FAN.seal.cx - half} ${FAN.seal.cy - half})`}
        >
          {geometry?.rings.map((ring) => (
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
          rx={2}
        />

        {/* The cash members as one band: each member's share, solid and still, meeting its neighbours. A line
            moved to cash draws in dashed from its own thread's slot. */}
        <g className="fsr-fan__cash" data-testid="W-TR-08.cash">
          {band.map((line) => (
            <path
              key={line.memberNo}
              className="fsr-fan__cash-line"
              d={line.d}
              pathLength={1}
              strokeWidth={line.stroke}
              data-attested={line.attested ? "" : undefined}
              data-testid={`W-TR-08.cash.${line.memberNo}`}
            />
          ))}
          {fan.cashLines
            .filter((l) => l.moved)
            .map((line) => (
              <MovedLine
                key={line.memberNo}
                line={line}
                live={animate.get(line.memberNo)}
                maskId={`fsr-fan-reveal-${uid}-${line.memberNo}`}
              />
            ))}
        </g>
        {fan.cashLines.length > 0 && (
          <rect
            className="fsr-fan__block"
            x={FAN.endX}
            y={fan.cash.top}
            width={FAN.cash.w}
            height={Math.max(FAN.cash.w, blockH)}
            rx={3}
            style={fan.cash.amountState === "attested" ? undefined : { fill: `url(#${hatchId})` }}
            data-attested={fan.cash.amountState === "attested" ? "" : undefined}
          />
        )}

        {/* Eight PayPal threads, one row each. */}
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
                <circle
                  className="fsr-fan__cap"
                  cx={t.capAt.x}
                  cy={t.capAt.y}
                  r={FAN.cap / 2}
                  data-tone={t.replayed ? "sent" : t.tone}
                />
              )}
              <g
                className="fsr-fan__stub"
                transform={`translate(${FAN.endX} ${t.stubY})`}
                data-animate={live !== undefined ? "" : undefined}
                style={{ ["--fsr-delay" as string]: `${live ?? 0}ms` }}
              >
                <rect
                  className="fsr-fan__stub-face"
                  width={FAN.stub.w}
                  height={FAN.stub.h}
                  rx={3}
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
              // Her money now rides with the cash block beneath: the row says where it went.
              <span className="fsr-fan__name fs-t-label">{FANOUT.movedToCash(t.name)}</span>
            ) : (
              <>
                <span className="fsr-fan__name fs-t-label" title={t.statusWord}>
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
              className="fsr-fan__chip fs-t-micro"
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
            <span className="fsr-fan__name fs-t-label" title={FANOUT.dueOn(cashDay)}>
              {FANOUT.cashBandMembers(fan.cash.members)}
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
