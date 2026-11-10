// The rate card's materials: the bolted hash plate (zero travel for anyone), the BR 2026-04 pages as paper,
// and Schedule A printed flat beside them. Hovering or pressing a rule lays the reading band over the clause it
// was read from, so every printed rule points at its own words on the scan.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph, Paper } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { RATECARD_COPY } from "./copy.js";
import { type ClauseRef, sealedText } from "./model.js";
import "./ratecard.css";

type Card = SeasonSnapshot["rateCard"];

/** A bolted plate: plate-2 face, steel-hatched edges, two bolt heads. It does not move, for anyone. */
export function BoltedPlate({
  children,
  testId,
  className,
  bright = false,
}: {
  readonly children: ReactNode;
  readonly testId: string;
  readonly className?: string;
  /** MM-4 reduced: the steel brightens for 200 ms instead of shaking. */
  readonly bright?: boolean;
}) {
  return (
    <section
      className={["fsc-bolted-plate", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-bright={bright ? "" : undefined}
    >
      <span className="fsc-bolted-plate__bolt fsc-bolted-plate__bolt--l" aria-hidden />
      <span className="fsc-bolted-plate__bolt fsc-bolted-plate__bolt--r" aria-hidden />
      {children}
    </section>
  );
}

/** "sha256 f2d7 026d, sealed 14 Mar 2026 by BR 2026-04", with the full hash in groups of four beneath. */
export function HashPlate({
  snapshot,
  testId,
  compact = false,
  bright = false,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly testId: string;
  readonly compact?: boolean;
  readonly bright?: boolean;
}) {
  const card = snapshot.rateCard;
  const sealed = sealedText(card);
  const sealedAt = Math.max(0, sealed.indexOf(","));
  const initials = (name: string) =>
    snapshot.officers.find((o) => o.name === name)?.initials ?? name.slice(0, 2).toUpperCase();
  return (
    <BoltedPlate
      testId={testId}
      bright={bright}
      className={compact ? "fsc-bolted-plate--compact" : undefined}
    >
      <p className="fsc-bolted-plate__title">
        <Glyph name="bolt" size={18} />
        <span className="fs-t-label">{card.canonical.resolutionNo}, Schedule A</span>
      </p>
      {/* The seal line: its hash in the id role (the one mono), its words in the caption role. */}
      <p className="fsc-bolted-plate__sealed fs-t-caption" data-testid={`${testId}.sealed`}>
        <span className="fs-t-id">{sealed.slice(0, sealedAt)}</span>
        {sealed.slice(sealedAt)}
      </p>
      {!compact && (
        <p className="fsc-bolted-plate__hash fs-t-hash" data-testid={`${testId}.hash`}>
          <span className="fs-sr">{RATECARD_COPY.fullHash}</span>
          {format.hashAllGroups(card.sha256)}
        </p>
      )}
      {!compact && (
        <ul className="fsc-bolted-plate__acts fs-t-caption">
          {card.ratifications.map((r) => (
            <li key={r.role}>
              <Stamp
                stamp={{
                  initials: initials(r.name),
                  name: r.name,
                  at: `${format.date(r.at.slice(0, 10))}, ${format.time(r.at)}`,
                }}
              />
              <span>
                {r.act === "CERTIFIED" ? RATECARD_COPY.certified : RATECARD_COPY.attested} {r.name},{" "}
                {r.role === "SECRETARY" ? RATECARD_COPY.secretary : RATECARD_COPY.chair}
              </span>
            </li>
          ))}
        </ul>
      )}
    </BoltedPlate>
  );
}

/** The scanned resolution, typeset from its verified text layer, as paper. The band marks a rule's clause. */
export function ResolutionPages({
  card,
  highlight,
  testId,
}: {
  readonly card: Card;
  readonly highlight: readonly ClauseRef[];
  readonly testId: string;
}) {
  const total = card.textLayer.pages.length;
  return (
    <div className="fsc-rc-pages" data-testid={testId}>
      {card.textLayer.pages.map((page) => (
        <Paper
          key={page.page}
          alt={`${card.canonical.resolutionNo}, ${RATECARD_COPY.page(page.page, total).toLowerCase()}`}
          className="fsc-rc-page"
          testId={`${testId}.page${page.page}`}
        >
          <div className="fsc-rc-page__sheet">
            {page.lines.map((line, i) => {
              const on = highlight.some((h) => h.page === page.page && h.line === i);
              return (
                <p key={i} className={lineClass(line, i)} data-band={on ? "" : undefined}>
                  {line}
                </p>
              );
            })}
            <p className="fsc-rc-page__folio">
              {page.page} / {total}
            </p>
          </div>
        </Paper>
      ))}
    </div>
  );
}

function lineClass(line: string, index: number): string {
  if (/^SCHEDULE A$/.test(line)) return "fsc-rc-page__line fsc-rc-page__line--heading";
  if (index < 5 && line === line.toUpperCase()) return "fsc-rc-page__line fsc-rc-page__line--head";
  if (/^(Certified|Attested) by/.test(line)) return "fsc-rc-page__line fsc-rc-page__line--sign";
  if (/^Approved and ratified/.test(line)) return "fsc-rc-page__line fsc-rc-page__line--date";
  if (/^R\d\s/.test(line)) return "fsc-rc-page__line fsc-rc-page__line--rule";
  return "fsc-rc-page__line";
}
