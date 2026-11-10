// SplitFan (S2.7, design §1 signature 6; UI gate round 3): the run's hero. One seal at 180 units, 64 lines: eight
// PayPal threads fan out from the hub beside the seal to one row each, at one even stroke, and the cash members run
// together as one 6-unit hatched ribbon in neutral-300 into one compact block. Threads draw to 70% in flight on
// PayPal's 201 (sent, not paid), finish and turn jade only on a verified SUCCESS, run on to the member's own marker
// in marigold when PayPal parks an item (the marker is the dot; nothing floats in mid-air), and retract when the
// line moves to cash, while that member's own thin cash line draws from the same slot to the cash block. The seal's
// rings fill in indigo per key, as on Approve and the Chair's phone. History is drawn in place; only live events
// animate. Every word and figure is HTML laid over the picture at its own type size; the picture is hidden from
// screen readers and mirrored in a table (Data mode).

import { TIMING } from "@fairsplit/motion";
import { isRingSigned, seal } from "@fairsplit/seal";
import { MoneyFigure, StateDot } from "@fairsplit/ui-web";
import { type CSSProperties, useId, useMemo } from "react";
import { format } from "../../lib/format.js";
import { FANOUT } from "../split/shared/copy.js";
import { type CashLine, FAN, type FanThread, type FanView } from "./model.js";

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

/** A member moved to cash: the thin cash line draws in along its own path where the thread retracts (MM-6). */
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
        mask={`url(#${maskId})`}
        data-moved=""
        data-attested={line.attested ? "" : undefined}
        data-testid={`W-TR-08.cash.${line.memberNo}`}
      />
    </g>
  );
}

/** A pending amount: neutral-500 with a hollow dot (never a dashed underline: dashed means simulated). */
function Amount({ cents, state }: { readonly cents: number; readonly state: string }) {
  return (
    <span className="fsr-fan__amount fs-t-figure" data-amount-state={state}>
      {state === "hollow" && <StateDot kind="pending" className="fsr-fan__pending" />}
      <MoneyFigure display={format.money(cents)} />
    </span>
  );
}

export function SplitFan({ fan, animate, drawing, mode, cashDay }: SplitFanProps) {
  const uid = useId().replaceAll(":", "");
  const geometry = useMemo(() => (fan.sealHash ? seal(fan.sealHash, FAN.seal.size) : null), [fan.sealHash]);
  const half = FAN.seal.size / 2;
  const hatchId = `fsr-fan-hatch-${uid}`;
  const ribbonHatchId = `fsr-fan-ribbon-hatch-${uid}`;
  const ribbonMaskId = `fsr-fan-ribbon-${uid}`;
  const band = fan.cashLines.filter((l) => !l.moved);
  // The block sits on the ribbon's end, one stub tall, so the label beside it reads level with both.
  const ribbonMid = (fan.cash.top + fan.cash.bottom) / 2;
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
          {/* The ribbon's hatch, as a mask: the 56 shares draw solid and meet as one ribbon, then show through
              these stripes only, so the hatch keeps its own edges. */}
          <pattern
            id={ribbonHatchId}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="1.5" height="4" className="fsr-fan__mask-line" />
          </pattern>
          <mask
            id={ribbonMaskId}
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={FAN.width}
            height={FAN.height}
          >
            <rect width={FAN.width} height={FAN.height} fill={`url(#${ribbonHatchId})`} />
          </mask>
        </defs>

        {/* The seal the two keys completed: each key's rings in indigo, a ring not signed yet at 1 px in
            neutral-400; and the hub every line leaves. */}
        <g
          className="fsr-fan__seal"
          data-digest={fan.sealHash ?? undefined}
          data-keys={fan.sealKeys}
          transform={`translate(${FAN.seal.cx - half} ${FAN.seal.cy - half})`}
        >
          {geometry?.rings.map((ring) => {
            const signed = isRingSigned(ring, fan.sealKeys);
            return (
              <path
                key={ring.d.slice(0, 24)}
                d={ring.d}
                className={signed ? "fs-seal__ring" : "fsr-fan__ring-unsigned"}
                fill="none"
                strokeWidth={signed ? geometry.strokeWidth : 1}
                strokeLinejoin="round"
              />
            );
          })}
        </g>
        <rect
          className="fsr-fan__bar"
          x={FAN.bar.x0}
          y={FAN.bar.y0}
          width={FAN.bar.x1 - FAN.bar.x0}
          height={FAN.bar.y1 - FAN.bar.y0}
          rx={2}
        />

        {/* The cash members as one hatched ribbon: each member's share, still, meeting its neighbours. A line
            moved to cash draws in, thin and solid, from its own thread's slot. */}
        <g className="fsr-fan__cash" data-testid="W-TR-08.cash">
          <g className="fsr-fan__ribbon" mask={`url(#${ribbonMaskId})`} data-testid="W-TR-08.ribbon">
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
          </g>
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
            y={ribbonMid - FAN.stub.h / 2}
            width={FAN.cash.w}
            height={FAN.stub.h}
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
                <Amount cents={t.cents} state={t.amountState} />
              </>
            )}
          </p>
        ))}
        {fan.cashLines.length > 0 && (
          <p className="fsr-fan__group" style={at(FAN.labelX, ribbonMid)} data-testid="W-TR-08.cashLabel">
            <span className="fsr-fan__name fs-t-label" title={FANOUT.dueOn(cashDay)}>
              {FANOUT.cashBandMembers(fan.cash.members)}
            </span>
            <Amount cents={fan.cash.cents} state={fan.cash.amountState} />
          </p>
        )}
      </div>
    </div>
  );
}
