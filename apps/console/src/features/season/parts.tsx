// The season's quieter parts: the stencilled season mark, the run strip (six stages in a true sequence), the
// contact sheet of the replay photos, and the eval waffle. Built on ui-web's marks and the console's tokens.

import type { SeasonSnapshot, SnapshotPhoto } from "@fairsplit/contracts";
import { Glyph, useT } from "@fairsplit/ui-web";
import { AppLink } from "../../chrome/AppLink.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import type { RunStripStage } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { slipsOf } from "../reading/model.js";
import { PhotoMat } from "../reading/PhotoMat.js";
import { tilt } from "../reading/slip.js";
import { SEASON_COPY } from "./copy.js";
import type { StripStage } from "./model.js";
import "./season.css";

/** "2026-A" in the stencil cut, as on the jute sacks; the lot beside it and the co-op beneath. */
export function SeasonMark({
  snapshot,
  testId,
  size = "small",
  lot = false,
  coop = true,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly testId: string;
  readonly size?: "hero" | "small";
  readonly lot?: boolean;
  readonly coop?: boolean;
}) {
  const t = useT();
  // Spans throughout, so the mark can sit inside a heading.
  return (
    <span className="fsc-mark" data-size={size} data-testid={testId}>
      <span className="fsc-mark__stencil">
        <span className="fsc-mark__season fs-t-mark">{snapshot.season.label}</span>
        {lot && (
          <span className="fsc-mark__lot fs-t-mark">
            <span className="fs-sr">, lot </span>
            {snapshot.lot.lotCode}
          </span>
        )}
      </span>
      {coop && (
        <span className="fsc-mark__coop fs-t-label">
          <span className="fs-sr">, </span>
          {t("W-TR-01.coop")}
        </span>
      )}
    </span>
  );
}

const STRIP_KEYS = {
  RATIFIED: "W-TR-01.strip.ratified",
  FUNDED: "W-TR-01.strip.funded",
  READ: "W-TR-01.strip.read",
  CHECKED: "W-TR-01.strip.checked",
  APPROVED: "W-TR-01.strip.approved",
  PAID: "W-TR-01.strip.paid",
} as const satisfies Record<RunStripStage, string>;

/**
 * The run strip: six stages in their true sequence, stencilled on one plate like the marks on the co-op's jute
 * sacks, with a notch cut between each stage and the next. A stage that has not happened is a dashed print bed
 * with its word faint inside, waiting to print; the first of them is next. A stage that has happened prints in
 * ink. Funded is the one PayPal decides: it lands flush jade, and only once the invoice has read back as paid.
 * Each stage lights only when register §7's condition holds.
 */
export function RunStrip({
  stages,
  ratifiedOn,
  testId,
}: {
  readonly stages: readonly StripStage[];
  readonly ratifiedOn: string;
  readonly testId: string;
}) {
  const t = useT();
  const current = stages.find((s) => !s.lit)?.id ?? null;
  const ratified = format.dateShort(ratifiedOn);
  return (
    <ol className="fsc-strip" aria-label={SEASON_COPY.strip} data-testid={testId}>
      {stages.map((stage) => {
        const state = stage.lit ? "lit" : stage.id === current ? "current" : "unlit";
        // The word alone in the stencil; the ratification date prints beneath it, by the bolt.
        const word =
          stage.id === "RATIFIED" ? t(STRIP_KEYS.RATIFIED, { date: "" }).trim() : t(STRIP_KEYS[stage.id]);
        const landed = stage.lit && stage.id === "FUNDED";
        return (
          <li
            key={stage.id}
            className="fsc-strip__stage"
            data-state={state}
            data-stage={stage.id}
            data-landed={landed ? "" : undefined}
            data-testid={`${testId}.${stage.id}`}
          >
            <span className="fsc-strip__word">{word}</span>
            {stage.id === "RATIFIED" ? (
              <span className="fsc-strip__note fs-t-caption">
                <Glyph name="bolt" size={12} />
                {ratified}
              </span>
            ) : state === "current" ? (
              <span className="fsc-strip__note fs-t-caption" aria-hidden>
                {SEASON_COPY.stripNextWord}
              </span>
            ) : null}
            <span className="fs-sr">
              {`, ${state === "lit" ? SEASON_COPY.stripDone : state === "current" ? SEASON_COPY.stripNext : SEASON_COPY.stripLater}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The replay set (A–L) as a contact sheet of paper on the lacquer; each photo opens in the reading room. `fit`
 * lays as many prints a row as the space holds at a readable size (the Judge stage's desk).
 */
export function ContactSheet({
  snapshot,
  photos,
  readPhotos,
  hrefFor,
  testId,
  columns = 4,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly photos: readonly SnapshotPhoto[];
  readonly readPhotos?: ReadonlySet<string>;
  readonly hrefFor: (photoId: string) => string;
  readonly testId: string;
  readonly columns?: 4 | 6 | 12 | "fit";
}) {
  return (
    <ul className="fsc-contact" data-columns={columns} data-testid={testId}>
      {photos.map((photo) => {
        const slips = slipsOf(snapshot, photo);
        const read = readPhotos?.has(photo.photoId) ?? false;
        const serials = slips.map((s) => s.slip.serial).join(", ");
        const turn = tilt(String(photo.photoId.charCodeAt(0) + photo.photoId.length * 7)) * 0.8;
        return (
          <li
            key={photo.photoId}
            className="fsc-contact__item"
            data-read={read ? "" : undefined}
            style={{ ["--fsc-turn" as string]: `${turn.toFixed(2)}deg` }}
          >
            <AppLink
              href={hrefFor(photo.photoId)}
              className="fsc-contact__link"
              aria-label={SEASON_COPY.photoLabel(photo.photoId, serials, read)}
              data-testid={`${testId}.${photo.photoId}`}
            >
              <span className="fsc-contact__paper" aria-hidden>
                <PhotoMat slips={slips} detail="thumb" />
              </span>
              <span className="fsc-contact__caption fs-t-caption" aria-hidden>
                <span className="fsc-contact__id">{photo.photoId}</span>
                {read && <Glyph name="ms:check" size={12} />}
              </span>
            </AppLink>
          </li>
        );
      })}
    </ul>
  );
}

export interface EvalCase {
  readonly id: string;
  readonly exactRow: boolean;
  readonly routedToPerson: boolean;
  readonly unsafeAccepts: number;
}

function caseWord(c: EvalCase): string {
  if (c.unsafeAccepts > 0) return "Unsafe auto-accept";
  if (c.routedToPerson) return "Sent to a person";
  return c.exactRow ? "Exact row" : "Missed";
}

/**
 * 40 cells from the latest eval report: ink for an exact row, a canary outline for a case routed to a person,
 * red for an unsafe auto-accept. The console has no read for the report yet, so it shows the empty sheet.
 */
export function EvalWaffle({
  cases,
  caption,
  testId,
}: {
  readonly cases: readonly EvalCase[] | null;
  readonly caption?: string;
  readonly testId: string;
}) {
  const cells = Array.from({ length: 40 }, (_, i) => cases?.[i] ?? null);
  return (
    <section
      className="fsc-waffle"
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      data-state={cases ? "run" : "empty"}
    >
      <h2 id={`${testId}-title`} className="fsc-section-title fs-t-label">
        {SEASON_COPY.evalTitle}
      </h2>
      <Mirrored
        testId={`${testId}.mirror`}
        visual={
          <div className="fsc-waffle__grid">
            {cells.map((c, i) => (
              <span
                key={i}
                className="fsc-waffle__cell"
                data-cell={
                  c === null
                    ? "empty"
                    : c.unsafeAccepts > 0
                      ? "unsafe"
                      : c.routedToPerson
                        ? "person"
                        : c.exactRow
                          ? "exact"
                          : "miss"
                }
              />
            ))}
          </div>
        }
        table={
          <DataTable
            caption={SEASON_COPY.evalTitle}
            testId={`${testId}.table`}
            columns={[
              { key: "case", label: SEASON_COPY.evalCase },
              { key: "result", label: SEASON_COPY.evalResult },
            ]}
            rows={(cases ?? []).map((c) => ({ key: c.id, cells: { case: c.id, result: caseWord(c) } }))}
          />
        }
      />
      <p className="fs-t-caption fsc-waffle__caption">{cases ? caption : SEASON_COPY.evalEmpty}</p>
    </section>
  );
}
