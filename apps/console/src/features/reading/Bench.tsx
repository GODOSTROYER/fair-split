// The reading bench (S1.7 W-TR-03): the photo on the lacquer in the room's 58% column, fitted to the height the
// stage leaves it, with zoom about the pointer, "+" and "−" buttons and arrow keys (WCAG 2.5.7), and the
// reading band (a 1 px chalk line over a 6% wash) that slides to the line each row is read from (MM-2 "band";
// it jumps under reduced motion). Each slip's net-kilos box carries an anchor, so a flight starts exactly where
// the crop is, zoomed or not.

import type { SnapshotPhoto } from "@fairsplit/contracts";
import { type MotionMode, Paper } from "@fairsplit/ui-web";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useState } from "react";
import { READING_COPY } from "./copy.js";
import { photoBandFrac, photoExhibit, photoFieldFrac } from "./exhibits.js";
import { PhotoMat } from "./PhotoMat.js";
import {
  boxFrac,
  type Frac,
  fracStyle,
  PHOTO_H,
  PHOTO_W,
  type PhotoSlip,
  type SlipPosition,
  slipFrac,
} from "./slip.js";
import "./reading.css";

/** Zoom steps: fit, a closer look, and the most the source allows (CropZoom's sMax). */
export const ZOOM_STEPS = [1, 1.6, 2.4] as const;

export interface BenchZoom {
  readonly scale: number;
  /** The point the zoom holds still, as fractions of the photo. */
  readonly fx: number;
  readonly fy: number;
}

export const FIT: BenchZoom = { scale: 1, fx: 0.5, fy: 0.5 };

/** The band across a slip at its net-kilos line. */
export function bandFrac(position: SlipPosition, photoId?: string, serial?: string): Frac {
  const projected = photoId && serial ? photoBandFrac(photoId, serial) : null;
  if (projected) return projected;
  const slip = slipFrac(position);
  const box = boxFrac(position, "net_kg");
  return { left: slip.left, top: box?.top ?? slip.top, width: slip.width, height: box?.height ?? 0 };
}

/** Zoom on one slip's net box (Space on a row: "opens the crop"). */
export function zoomOnSlip(position: SlipPosition, photoId?: string, serial?: string): BenchZoom {
  const box =
    (photoId && serial ? photoFieldFrac(photoId, serial, "net_kg") : null) ?? boxFrac(position, "net_kg");
  if (!box) return FIT;
  return {
    scale: ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1,
    fx: box.left + box.width / 2,
    fy: box.top + box.height / 2,
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export interface BenchProps {
  readonly photo: SnapshotPhoto;
  readonly slips: readonly PhotoSlip[];
  /** The slip the band rests on (the row being read), or null. */
  readonly band: string | null;
  /** MM-2 reduced: the crop outlined in pencil while its row lands. */
  readonly outline: string | null;
  readonly zoom: BenchZoom;
  readonly onZoom: (zoom: BenchZoom) => void;
  readonly mode: MotionMode;
  readonly testId: string;
  /** Printed at the end of the bench's heading row (the reading's progress). */
  readonly aside?: ReactNode;
}

export function Bench({ photo, slips, band, outline, zoom, onZoom, mode, testId, aside }: BenchProps) {
  const composition = photoExhibit(photo.photoId);
  const [tracking, setTracking] = useState(false);
  const bandSlip = band ? slips.find((s) => s.slip.serial === band) : undefined;
  const outlined = outline ? slips.find((s) => s.slip.serial === outline) : undefined;
  const step = ZOOM_STEPS.indexOf(zoom.scale as (typeof ZOOM_STEPS)[number]);
  const zoomTo = (index: number) => {
    const scale = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index))] ?? 1;
    onZoom(scale === 1 ? FIT : { ...zoom, scale });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom.scale === 1 || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    setTracking(true);
    onZoom({
      scale: zoom.scale,
      fx: clamp01((event.clientX - rect.left) / rect.width),
      fy: clamp01((event.clientY - rect.top) / rect.height),
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const move = 0.08;
    switch (event.key) {
      case "+":
      case "=":
        zoomTo(step + 1);
        break;
      case "-":
      case "_":
        zoomTo(step - 1);
        break;
      case "0":
        onZoom(FIT);
        break;
      case "ArrowLeft":
        onZoom({ ...zoom, fx: clamp01(zoom.fx - move) });
        break;
      case "ArrowRight":
        onZoom({ ...zoom, fx: clamp01(zoom.fx + move) });
        break;
      case "ArrowUp":
        onZoom({ ...zoom, fy: clamp01(zoom.fy - move) });
        break;
      case "ArrowDown":
        onZoom({ ...zoom, fy: clamp01(zoom.fy + move) });
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const s = zoom.scale;
  const transform =
    s === 1
      ? undefined
      : `translate(${(zoom.fx * (1 - s) * 100).toFixed(3)}%, ${(zoom.fy * (1 - s) * 100).toFixed(3)}%) scale(${s})`;
  const serials = slips.map((x) => x.slip.serial).join(", ");
  return (
    <section
      className="fsc-bench"
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      data-photo={photo.photoId}
      style={{
        ["--fsc-photo-aspect" as string]: String(
          composition ? composition.width / composition.height : PHOTO_W / PHOTO_H,
        ),
      }}
    >
      <header className="fsc-bench__head">
        <h2 id={`${testId}-title`} className="fs-t-label fsc-bench__title">
          {READING_COPY.bench(photo.photoId)}
        </h2>
        <fieldset className="fsc-bench__zoom" onKeyDown={onKeyDown} data-testid={`${testId}.zoom`}>
          <legend className="fs-sr">{READING_COPY.benchKeys}</legend>
          <button
            type="button"
            className="fsc-zoom-button"
            data-icon=""
            onClick={() => zoomTo(step - 1)}
            aria-disabled={step <= 0 ? true : undefined}
            aria-label={READING_COPY.zoomOut}
            title={READING_COPY.zoomOut}
            data-testid={`${testId}.zoomOut`}
          >
            <span aria-hidden>{READING_COPY.zoomOutMark}</span>
          </button>
          <span className="fsc-bench__scale fs-t-micro" aria-live="polite" data-testid={`${testId}.scale`}>
            {READING_COPY.zoomLevel(s.toFixed(1))}
          </span>
          <button
            type="button"
            className="fsc-zoom-button"
            data-icon=""
            onClick={() => zoomTo(step + 1)}
            aria-disabled={step >= ZOOM_STEPS.length - 1 ? true : undefined}
            aria-label={READING_COPY.zoomIn}
            title={READING_COPY.zoomIn}
            data-testid={`${testId}.zoomIn`}
          >
            <span aria-hidden>{READING_COPY.zoomInMark}</span>
          </button>
          <button
            type="button"
            className="fsc-zoom-button"
            onClick={() => onZoom(FIT)}
            aria-disabled={s === 1 ? true : undefined}
            data-testid={`${testId}.zoomFit`}
          >
            {READING_COPY.zoomFit}
          </button>
        </fieldset>
        {aside}
      </header>
      <div
        className="fsc-bench__viewport"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setTracking(false)}
        data-testid={`${testId}.viewport`}
      >
        {/* The photo's own caption ("Code-composed · synthetic") is printed on the photo; the paper's glyph and its
            alt text say it too, so no caption repeats it beneath (UI gate round 3). */}
        <Paper
          alt={
            composition
              ? `${READING_COPY.benchAlt(photo.photoId, serials)}. ${composition.label}`
              : READING_COPY.benchAlt(photo.photoId, serials)
          }
          className="fsc-bench__paper"
        >
          <div className="fsc-bench__frame">
            <div
              className="fsc-bench__zoomer"
              style={{ transform }}
              data-motion={mode}
              data-tracking={tracking ? "" : undefined}
              data-scale={s}
            >
              <PhotoMat
                photoId={photo.photoId}
                slips={slips}
                detail="full"
                outline={outlined ? { serial: outlined.slip.serial, field: "net_kg" } : null}
              >
                {slips.map(({ position, slip }) => {
                  const box =
                    photoFieldFrac(photo.photoId, slip.serial, "net_kg") ?? boxFrac(position, "net_kg");
                  return box ? (
                    <span
                      key={slip.serial}
                      className="fsc-bench__anchor"
                      data-anchor={slip.serial}
                      style={fracStyle(box)}
                    />
                  ) : null;
                })}
                {bandSlip && (
                  <span
                    className="fsc-bench__band"
                    data-testid={`${testId}.band`}
                    data-serial={bandSlip.slip.serial}
                    style={fracStyle(bandFrac(bandSlip.position, photo.photoId, bandSlip.slip.serial))}
                  />
                )}
              </PhotoMat>
            </div>
          </div>
        </Paper>
      </div>
    </section>
  );
}
