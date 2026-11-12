// A photograph of four slips on the clerk's bamboo mat, as Jessie takes them (register §2: 4 slips a photo).
// The geometry is fixed (./slip.ts) so the reading band, a crop's outline and a flight can find any box from
// percentages alone. Evidence: the photo casts the paper shadow and its owner says "Synthetic sample" in the
// alt text; the drawing inside is aria-hidden.

import type { SlipFieldName } from "@fairsplit/contracts";
import { memo, type ReactNode } from "react";
import { photoExhibit, photoFieldFrac } from "./exhibits.js";
import { SlipPaper } from "./SlipPaper.js";
import { fracStyle, PHOTO_H, PHOTO_W, type PhotoSlip, slipFrac, tilt } from "./slip.js";
import "./reading.css";

export interface PhotoMatProps {
  readonly photoId?: string;
  readonly slips: readonly PhotoSlip[];
  readonly detail?: "full" | "thumb";
  /** A pencil outline on one box of one slip (MM-2 reduced, the crop being read). */
  readonly outline?: { readonly serial: string; readonly field: SlipFieldName } | null;
  /** Overlays drawn over the photo in its own coordinates (the reading band). */
  readonly children?: ReactNode;
  readonly className?: string;
}

export const PhotoMat = memo(function PhotoMat({
  photoId,
  slips,
  detail = "full",
  outline = null,
  children,
  className,
}: PhotoMatProps) {
  const photo = photoId ? photoExhibit(photoId) : null;
  const fieldOutline = photoId && outline ? photoFieldFrac(photoId, outline.serial, outline.field) : null;
  return (
    <div
      className={["fsc-mat", className].filter(Boolean).join(" ")}
      style={{ aspectRatio: photo ? `${photo.width} / ${photo.height}` : `${PHOTO_W} / ${PHOTO_H}` }}
      data-detail={detail}
    >
      {photo && (
        <img
          className="fsc-mat__image"
          src={`/media/${photo.image}`}
          alt={`Four synthetic weigh slips, composition ${photoId}. ${photo.label}. Composed in code.`}
          loading="lazy"
        />
      )}
      {/* Round 6: the compositor's notes baked into the picture are covered in the desk's own tone (reading.css). */}
      {photo && (
        <>
          <span className="fsc-mat__veil" data-at="head" aria-hidden />
          <span className="fsc-mat__veil" data-at="mid" aria-hidden />
          <span className="fsc-mat__veil" data-at="foot" aria-hidden />
        </>
      )}
      {fieldOutline && <span className="fsc-mat__outline" style={fracStyle(fieldOutline)} />}
      {!photo &&
        slips.map(({ position, slip }) => (
          <div
            key={`${position}-${slip.serial}`}
            className="fsc-mat__slip"
            style={{ ...fracStyle(slipFrac(position)), transform: `rotate(${tilt(slip.serial)}deg)` }}
            data-serial={slip.serial}
            data-position={position}
          >
            <SlipPaper
              slip={slip}
              detail={detail}
              outline={outline && outline.serial === slip.serial ? outline.field : null}
            />
          </div>
        ))}
      {children}
    </div>
  );
});
