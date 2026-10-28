// MM-2's flights (S2.9): the slip's net-kilos crop lifts off the photo (shadow grows, 1 → 1.04), flies along a
// curve bowed 40 px up to its print bed, and on the way Jessie's handwriting blurs out while the typeset digits
// sharpen in; the row then prints under it. The flying element is a crop of the drawn slip, positioned over the
// room; its motion runs on the Web Animations API with every time from motion's timeline. Reduced motion (and
// the low tier) never fly: a 1 px connector shows for 600 ms instead.

import { useLayoutEffect, useRef } from "react";
import {
  type Box,
  FLIGHT_EASE,
  flightKeyframes,
  LIFT_EASE,
  LIFT_SCALE,
  RESOLVE_BLUR_PX,
  ROW_AT,
  ROW_MS,
} from "./mm2.js";
import { SlipPaper } from "./SlipPaper.js";
import type { PhotoSlip } from "./slip.js";
import { boxFor } from "./slip.js";
import "./reading.css";

export interface Flight {
  readonly id: string;
  readonly serial: string;
  readonly from: Box;
  readonly to: Box;
  readonly slip: PhotoSlip["slip"];
  /** The typeset value the handwriting resolves into. */
  readonly text: string;
}

export interface Connector {
  readonly id: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

const NET_BOX = boxFor("net_kg");
const CROP = NET_BOX ? { x: NET_BOX.x - 2, y: NET_BOX.y - 2, w: NET_BOX.w + 4, h: NET_BOX.h + 4 } : null;

function FlyingCrop({ flight, onDone }: { readonly flight: Flight; readonly onDone: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLDivElement>(null);
  const type = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    const end = ROW_AT.print + ROW_MS.print;
    const done = setTimeout(() => onDone(flight.id), end);
    if (!node || typeof node.animate !== "function") return () => clearTimeout(done);
    const lifted = `scale(${LIFT_SCALE})`;
    const animations = [
      node.animate([{ transform: "scale(1)" }, { transform: lifted }], {
        duration: ROW_MS.lift,
        delay: ROW_AT.lift,
        easing: LIFT_EASE,
        fill: "forwards",
      }),
      node.animate(flightKeyframes(flight.from, flight.to), {
        duration: ROW_MS.flight,
        delay: ROW_AT.flight,
        easing: FLIGHT_EASE,
        fill: "forwards",
      }),
      node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: ROW_MS.print,
        delay: ROW_AT.print,
        easing: "linear",
        fill: "forwards",
      }),
    ];
    const blur = `blur(${RESOLVE_BLUR_PX}px)`;
    if (hand.current) {
      animations.push(
        hand.current.animate(
          [
            { filter: "blur(0px)", opacity: 1 },
            { filter: blur, opacity: 0 },
          ],
          {
            duration: ROW_MS.resolve,
            delay: ROW_AT.resolve,
            easing: "linear",
            fill: "forwards",
          },
        ),
      );
    }
    if (type.current) {
      animations.push(
        type.current.animate(
          [
            { filter: blur, opacity: 0 },
            { filter: "blur(0px)", opacity: 1 },
          ],
          {
            duration: ROW_MS.resolve,
            delay: ROW_AT.resolve,
            easing: "linear",
            fill: "forwards",
          },
        ),
      );
    }
    return () => {
      clearTimeout(done);
      for (const a of animations) a.cancel();
    };
  }, [flight, onDone]);
  return (
    <div
      ref={el}
      className="fsc-flight"
      data-serial={flight.serial}
      style={{
        left: flight.from.x,
        top: flight.from.y,
        width: flight.from.width,
        height: flight.from.height,
      }}
    >
      <div ref={hand} className="fsc-flight__hand">
        <SlipPaper slip={flight.slip} crop={CROP} />
      </div>
      <span ref={type} className="fsc-flight__type fs-t-figure">
        {flight.text}
      </span>
    </div>
  );
}

export function FlightLayer({
  flights,
  connectors,
  onDone,
}: {
  readonly flights: readonly Flight[];
  readonly connectors: readonly Connector[];
  readonly onDone: (id: string) => void;
}) {
  if (flights.length === 0 && connectors.length === 0) return null;
  return (
    <div className="fsc-flights" aria-hidden data-testid="W-TR-03.flights">
      {flights.map((f) => (
        <FlyingCrop key={f.id} flight={f} onDone={onDone} />
      ))}
      {connectors.length > 0 && (
        <svg className="fsc-flights__connectors" aria-hidden="true" focusable="false">
          {connectors.map((c) => (
            <line
              key={c.id}
              className="fsc-flights__connector"
              x1={c.from.x}
              y1={c.from.y}
              x2={c.to.x}
              y2={c.to.y}
              style={{ ["--fsc-connector-ms" as string]: `${ROW_MS.flight}ms` }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
