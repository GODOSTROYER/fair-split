// The filmstrip (S1.7 W-TR-03): photos A to L of the recorded run, each ticked once all four of its slips are
// read, the photo on the bench outlined. P01 to P54 sit collapsed under "Read earlier this season" as hatched
// archived tiles with their read dates. Each photo is a real link (`?photo=`), so it can open in a new tab.

import type { SnapshotPhoto } from "@fairsplit/contracts";
import { webRoutes } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { format } from "../../lib/format.js";
import { READING_COPY } from "./copy.js";
import { PhotoMat } from "./PhotoMat.js";
import type { PhotoSlip } from "./slip.js";
import "./reading.css";

export interface FilmPhoto {
  readonly photo: SnapshotPhoto;
  readonly slips: readonly PhotoSlip[];
  readonly read: boolean;
  readonly pending: boolean;
}

export interface FilmstripProps {
  readonly season: string;
  readonly replay: readonly FilmPhoto[];
  readonly earlier: readonly SnapshotPhoto[];
  readonly active: string;
  readonly progress: { readonly read: number; readonly total: number };
  readonly testId: string;
}

export function Filmstrip({ season, replay, earlier, active, progress, testId }: FilmstripProps) {
  const activeIsEarlier = earlier.some((p) => p.photoId === active);
  const [open, setOpen] = useState(activeIsEarlier);
  return (
    <nav className="fsc-film" aria-label={READING_COPY.filmstrip} data-testid={testId}>
      <div className="fsc-film__strip">
        <ol className="fsc-film__photos">
          {replay.map(({ photo, slips, read, pending }) => (
            <li key={photo.photoId} className="fsc-film__item">
              <AppLink
                href={webRoutes.reading(season, photo.photoId)}
                className="fsc-film__link"
                aria-current={photo.photoId === active ? "true" : undefined}
                aria-label={READING_COPY.photoLink(photo.photoId, read, pending)}
                data-read={read ? "" : undefined}
                data-pending={pending ? "" : undefined}
                data-testid={`${testId}.${photo.photoId}`}
              >
                <span className="fsc-film__thumb" aria-hidden>
                  <PhotoMat slips={slips} detail="thumb" />
                </span>
                <span className="fsc-film__label fs-t-caption" aria-hidden>
                  {photo.photoId}
                  {read && !pending && <Glyph name="ms:check" size={12} />}
                  {pending && <span className="fsc-film__pending" />}
                </span>
              </AppLink>
            </li>
          ))}
        </ol>
        <div className="fsc-film__meta">
          <p className="fs-t-label fsc-film__progress" data-testid={`${testId}.progress`}>
            {READING_COPY.progress(progress.read, progress.total)}
          </p>
          <button
            type="button"
            className="fs-link fs-t-caption"
            aria-expanded={open}
            aria-controls={`${testId}-earlier`}
            onClick={() => setOpen((o) => !o)}
            data-testid={`${testId}.earlierToggle`}
          >
            {open ? READING_COPY.earlierHide : READING_COPY.earlier(earlier.length)}
          </button>
        </div>
      </div>
      {open && (
        <ol id={`${testId}-earlier`} className="fsc-film__earlier" data-testid={`${testId}.earlier`}>
          {earlier.map((photo) => {
            const date = photo.readOn ? format.dateShort(photo.readOn) : "";
            return (
              <li key={photo.photoId}>
                <AppLink
                  href={webRoutes.reading(season, photo.photoId)}
                  className="fsc-film__archived fs-t-caption"
                  aria-current={photo.photoId === active ? "true" : undefined}
                  aria-label={READING_COPY.earlierTile(photo.photoId, date)}
                >
                  <span className="fsc-film__archived-id">{photo.photoId}</span>
                  <span className="fsc-film__archived-date">{date}</span>
                </AppLink>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
