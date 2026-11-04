// The print beds (S1.7 W-TR-03): one row per slip of the photo on the bench, at 42% of the room. A row prints in
// pencil when its `extract.row` lands (MM-2 "print", then "ring"); until then its bed waits, dashed, at its
// final size. A field below 0.85 prints as a "You" cell that routes to W-TR-04, unless the zoom's read agrees
// with one of the two readings: then it waits in the room for one tap (`confirm-one`). A value a person entered
// or confirmed prints in ink with their stamp. A slip nothing could be read from lies hatched, with its words.
// J and K move between rows while the table has focus, Space opens the slip's crop on the bench, Enter takes a
// doubtful field to a person.

import { type SnapshotOfficer, webRoutes } from "@fairsplit/contracts";
import { Glyph, Print } from "@fairsplit/ui-web";
import { type CSSProperties, type KeyboardEvent, type RefObject, useRef } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { READING_COPY } from "./copy.js";
import { ROW_AT, ROW_MS } from "./mm2.js";
import type { ReadingRow } from "./model.js";
import type { PhotoSlip } from "./slip.js";
import "./reading.css";

export interface Landing {
  readonly eventId: string;
  /** Spacing wait before this row's MM-2 starts (the stage director keeps rows 180 ms apart). */
  readonly delay: number;
}

/** A ring drawn once, from the top, as MM-2's last act ("ring" → "landed"). */
function RingMark({ score, landing }: { readonly score: number; readonly landing: boolean }) {
  const low = score < 0.85;
  return (
    <svg
      className="fsc-ring"
      data-low={low ? "" : undefined}
      data-landing={landing ? "" : undefined}
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden
      focusable="false"
    >
      <circle className="fsc-ring__track" cx="9" cy="9" r="7" pathLength={1} />
      <circle
        className="fsc-ring__arc"
        cx="9"
        cy="9"
        r="7"
        pathLength={1}
        style={{ ["--fsc-score" as string]: String(score) }}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

/** A value a person entered or confirmed: ink, with their stamp (S2.2.1 `ink`). */
function InkValue({
  stamp,
  value,
  testId,
}: {
  readonly stamp: { readonly initials: string; readonly name: string; readonly at: string } | null;
  readonly value: string;
  readonly testId?: string | undefined;
}) {
  return (
    <span className="fsc-beds__entered" data-amount-state="ink" data-testid={testId}>
      {stamp && <Stamp stamp={stamp} />}
      <span className="fs-t-figure">{value}</span>
    </span>
  );
}

export interface BedsProps {
  readonly season: string;
  readonly photoId: string;
  readonly slips: readonly PhotoSlip[];
  readonly rows: readonly (ReadingRow | null)[];
  readonly landings: Readonly<Record<string, Landing>>;
  /** The row J and K have reached. */
  readonly active: string | null;
  readonly onActive: (serial: string) => void;
  /** Space: open the slip's crop on the bench. */
  readonly onOpenCrop: (serial: string) => void;
  /** Enter on a row with a doubtful field: to W-TR-04. */
  readonly onByHand: (serial: string) => void;
  readonly tableRef: RefObject<HTMLTableElement | null>;
  readonly started: boolean;
  /** Whose stamp a confirmation carries (by the initials the hold was resolved with). */
  readonly officers: readonly SnapshotOfficer[];
  readonly treasurer: { readonly initials: string; readonly name: string; readonly shortName: string } | null;
  /** The quarantine notice for a slip (S1.7 `quarantined`). */
  readonly notice: (serial: string) => string;
  readonly testId: string;
}

function landingStyle(landing: Landing | undefined): CSSProperties | undefined {
  if (!landing) return undefined;
  return {
    ["--fsc-print-at" as string]: `${landing.delay + ROW_AT.print}ms`,
    ["--fsc-ring-at" as string]: `${landing.delay + ROW_AT.ring}ms`,
    ["--fsc-print-ms" as string]: `${ROW_MS.print}ms`,
    ["--fsc-ring-ms" as string]: `${ROW_MS.ring}ms`,
  };
}

export function Beds({
  season,
  photoId,
  slips,
  rows,
  landings,
  active,
  onActive,
  onOpenCrop,
  onByHand,
  tableRef,
  started,
  officers,
  treasurer,
  notice,
  testId,
}: BedsProps) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: ReadingRow | null, serial: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onOpenCrop(serial);
      return;
    }
    if (event.key === "Enter" && row && row.pending.length > 0 && !row.zoomAgreed && !row.illegible) {
      event.preventDefault();
      onByHand(serial);
    }
  };
  const stampFor = (by: string, at: string) => {
    const officer = officers.find((o) => o.initials === by) ?? treasurer;
    return officer ? { initials: officer.initials, name: officer.name, at: at ? format.time(at) : "" } : null;
  };
  const focusable = active ?? slips[0]?.slip.serial ?? null;
  return (
    <section className="fsc-beds" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`} className="fs-sr">
        {READING_COPY.beds(photoId)}
      </h2>
      <table className="fsc-beds__table" ref={tableRef} aria-describedby={`${testId}-keys`}>
        <caption className="fs-sr">{READING_COPY.beds(photoId)}</caption>
        <thead>
          <tr>
            <th scope="col" className="fs-t-caption">
              {READING_COPY.col.serial}
            </th>
            <th scope="col" className="fs-t-caption">
              {READING_COPY.col.member}
            </th>
            <th scope="col" className="fs-t-caption" data-numeric="">
              {READING_COPY.col.net}
            </th>
            <th scope="col" className="fs-t-caption" data-numeric="">
              {READING_COPY.col.mc}
            </th>
            <th scope="col" className="fs-t-caption">
              {READING_COPY.col.grade}
            </th>
            <th scope="col" className="fs-t-caption">
              <span className="fs-sr">{READING_COPY.col.confidence}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {slips.map(({ slip }, i) => {
            const row = rows[i] ?? null;
            const serial = slip.serial;
            const landing = landings[serial];
            const state = row === null ? "waiting" : landing ? "landing" : "printed";
            return (
              <tr
                key={serial}
                ref={(el) => {
                  if (el) rowRefs.current.set(serial, el);
                  else rowRefs.current.delete(serial);
                }}
                className="fsc-beds__row"
                data-state={state}
                data-serial={serial}
                data-active={active === serial ? "" : undefined}
                data-copy={row?.copy}
                data-testid={`${testId}.row.${serial}`}
                aria-describedby="fsc-reading-provenance"
                tabIndex={focusable === serial ? 0 : -1}
                onFocus={() => onActive(serial)}
                onKeyDown={(e) => onKeyDown(e, row, serial)}
                style={landingStyle(landing)}
              >
                <th scope="row" className="fsc-beds__serial fs-t-hash">
                  <span className="fsc-beds__copy" data-copy={row?.copy ?? "white"} aria-hidden />
                  {serial}
                  {row?.copy === "pink" && <span className="fs-sr">, {READING_COPY.pinkCopy}</span>}
                </th>
                {row === null ? (
                  <td colSpan={5} className="fsc-beds__bed">
                    <span className="fsc-beds__dash" aria-hidden />
                    <span className="fs-sr">{READING_COPY.waiting}</span>
                  </td>
                ) : row.illegible ? (
                  <td
                    colSpan={5}
                    className="fsc-beds__bed"
                    data-flight-target={serial}
                    data-testid={`${testId}.illegible.${serial}`}
                  >
                    <span className="fsc-beds__illegible fs-t-caption">{READING_COPY.illegible}</span>
                  </td>
                ) : (
                  <>
                    <td className="fsc-beds__member">
                      <span className="fsc-beds__print">{row.memberName}</span>
                      {row.memberNo && <span className="fsc-beds__no fs-t-caption">{row.memberNo}</span>}
                    </td>
                    <td className="fsc-beds__net" data-numeric="" data-flight-target={serial}>
                      {row.entered || row.confirmed ? (
                        <InkValue
                          stamp={
                            row.entered
                              ? stampFor(row.entered.by, row.entered.at)
                              : row.confirmed
                                ? stampFor(row.confirmed.by, row.confirmed.at)
                                : null
                          }
                          value={row.entered?.value ?? row.netKg}
                          testId={row.confirmed ? `${testId}.confirmed.${serial}` : undefined}
                        />
                      ) : row.zoomAgreed ? (
                        <span
                          className="fsc-beds__you"
                          data-amount-state="you"
                          data-testid={`${testId}.zoom.${serial}`}
                        >
                          {row.standIn ? (
                            <span className="fs-t-figure">{row.netKg}</span>
                          ) : (
                            <Print
                              value={row.netKg}
                              provenance="claude"
                              state="pencil"
                              confidence={row.score ?? 0}
                            />
                          )}
                        </span>
                      ) : row.pending.length > 0 ? (
                        <AppLink
                          href={webRoutes.byHand(season, serial)}
                          className="fsc-beds__you"
                          data-testid={`${testId}.you.${serial}`}
                          aria-label={READING_COPY.byHand(serial)}
                          data-amount-state="you"
                        >
                          {row.standIn ? (
                            <span className="fs-t-figure">{row.netKg}</span>
                          ) : (
                            <Print
                              value={row.netKg}
                              provenance="claude"
                              state="pencil"
                              confidence={row.score ?? 0}
                            />
                          )}
                        </AppLink>
                      ) : (
                        <span className="fsc-beds__print fs-t-figure" data-amount-state="pencil">
                          {row.netKg}
                        </span>
                      )}
                    </td>
                    <td className="fsc-beds__print fs-t-figure" data-numeric="">
                      {row.mcPct}
                    </td>
                    <td className="fsc-beds__print fs-t-figure">{row.grade}</td>
                    <td className="fsc-beds__ring">
                      {!row.standIn && row.score !== null ? (
                        <>
                          <RingMark score={row.score} landing={landing !== undefined} />
                          <span className="fs-sr">{`${Math.round(row.score * 100)}%`}</span>
                        </>
                      ) : null}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r?.quarantined) && (
        <ul className="fsc-beds__notices">
          {rows
            .filter((r): r is ReadingRow => r?.quarantined === true)
            .map((r) => (
              <li
                key={r.serial}
                className="fsc-beds__notice"
                data-testid={`${testId}.quarantine.${r.serial}`}
              >
                <Glyph name="ms:visibility" size={16} />
                <span>{notice(r.serial)}</span>
              </li>
            ))}
        </ul>
      )}
      <p id={`${testId}-keys`} className="fs-t-caption fsc-beds__keys">
        {started ? READING_COPY.bedsKeys : READING_COPY.waiting}
      </p>
    </section>
  );
}
