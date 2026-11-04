// The run log (design §5 "Webhook and live timeline"; UI gate round 2): the last five events in plain words, one
// line each (a time, a lane and what happened), then "All N events" opens the three lanes (Machine, People,
// PayPal), newest first, where each row adds its event name, IDs, source and signature result in micro type. One
// honesty tag at the log's head covers every PayPal row. A repeated PayPal delivery logs one quiet row and changes
// nothing. Latency dots sit beside it at the true receipt times, funding to each confirmed payment.

import { Glyph, HonestyTag } from "@fairsplit/ui-web";
import { Fragment, type ReactNode } from "react";
import { ScrollRegion } from "../../chrome/ScrollRegion.js";
import { type LogRow, rowTime } from "../../data/describe.js";
import { format } from "../../lib/format.js";
import { FANOUT } from "../split/shared/copy.js";
import { byLane, LANES, type Latency } from "./model.js";

/** How many events the log shows before "All N events". */
export const LATEST = 5;

export interface RunLogProps {
  readonly rows: readonly LogRow[];
  /** Rows whose event arrived live (they print with the clip wipe; history prints in place). */
  readonly isLive: (id: string) => boolean;
  /** Seeded history, labelled as such (the showcase run has no event stream). */
  readonly seeded: boolean;
  /** The honesty tag's words for the PayPal rows; the simulator's by default. */
  readonly tag?: string;
  /** Said at the foot of the full log (the fee note). */
  readonly footer?: ReactNode;
}

/** A PayPal notice in plain words; its event code stays in the row's detail. */
const NOTICE_WORDS: Readonly<Record<string, string>> = {
  "INVOICING.INVOICE.PAID": "Invoice paid",
  "PAYMENT.PAYOUTSBATCH.SUCCESS": "Batch accepted",
  "PAYMENT.PAYOUTSBATCH.PROCESSING": "Batch processing",
  "PAYMENT.PAYOUTSBATCH.DENIED": "Batch declined",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "Payment confirmed",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "Payment cancelled",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "Payment unclaimed",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "Payment returned",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "Payment failed",
};

/**
 * A row's words for people: a PayPal notice by what it means ("Batch accepted", never PAYMENT.PAYOUTSBATCH.SUCCESS),
 * and a paid row without its rail in brackets, since the log's one tag says the rail. Replayed rows keep their
 * words whole: each says what it replayed.
 */
export function plainWords(row: LogRow): string {
  const notice = /^PayPal notice: ([A-Z][A-Z.\-_]+)$/.exec(row.words);
  if (notice?.[1]) return NOTICE_WORDS[notice[1]] ?? row.words;
  return row.words.replace(/ \(Simulated PayPal sandbox\)$/, "");
}

function AmountWords({ words }: { readonly words: string }) {
  return words.split(/(US\$[\d,]+\.\d{2})/).map((part, index) =>
    part.startsWith("US$") ? (
      <span className="fsr-log__amount" key={`${index}:${part}`}>
        {part}
      </span>
    ) : (
      <span key={`${index}:${part}`}>{part}</span>
    ),
  );
}

function EventName({ name }: { readonly name: string }) {
  return name.split(/(?<=[.\-_])/).map((part, index) => (
    <Fragment key={`${index}:${part}`}>
      {part}
      {/[.\-_]$/.test(part) && <wbr />}
    </Fragment>
  ));
}

/** A PayPal event name (PAYMENT.PAYOUTS-ITEM.SUCCEEDED) gets its own breakable line; internal types never print. */
function EventDetail({ row }: { readonly row: LogRow }) {
  const first = row.detail.split(", ")[0] ?? "";
  const name = /^[A-Z]+[.\-_]/.test(first) ? first : null;
  const detail = name ? row.detail.slice(first.length).replace(/^, /, "") : row.detail;
  return (
    <>
      {name && (
        <p className="fsr-log__event fs-t-micro">
          <EventName name={name} />
        </p>
      )}
      {detail && <p className="fsr-log__detail fs-t-micro">{detail}</p>}
    </>
  );
}

export function RunLog({ rows, isLive, seeded, tag = "Simulated PayPal sandbox", footer }: RunLogProps) {
  const lanes = byLane(rows);
  const latest = rows.slice(-LATEST).reverse();
  // A replayed payout's long note is the log's, said once here; each replayed row names only what it replayed.
  const replayNote = rows.find((row) => row.replayNote)?.replayNote ?? null;
  return (
    <section className="fsr-log" data-testid="W-TR-08.log">
      <div className="fsr-log__head">
        <h2 id="W-TR-08-log" className="fs-t-title-2">
          {FANOUT.log}
        </h2>
        <HonestyTag>{tag}</HonestyTag>
      </div>
      {seeded && <p className="fsr-log__note fs-t-micro">{FANOUT.seededLog}</p>}
      {replayNote && (
        <p className="fsr-log__note fs-t-micro" data-testid="W-TR-08.log.replayNote">
          {replayNote}
        </p>
      )}
      {latest.length === 0 ? (
        <p className="fsr-log__empty fs-t-caption">{FANOUT.logEmpty}</p>
      ) : (
        <ol className="fsr-log__latest" aria-label={FANOUT.latest}>
          {latest.map((row) => (
            <li
              key={row.id}
              className="fsr-log__item"
              data-lane={row.lane}
              data-duplicate={row.duplicate ? "" : undefined}
              data-live={isLive(row.id) ? "" : undefined}
              title={row.detail || undefined}
            >
              <time className="fsr-log__time fs-t-micro" dateTime={row.at ?? undefined}>
                {rowTime(row.at)}
              </time>
              <span className="fsr-log__lane-name fs-t-micro">
                <span className="fsr-log__dot" data-lane={row.lane} aria-hidden />
                {FANOUT.lane[row.lane]}
              </span>
              <span className="fsr-log__words fs-t-label">
                {row.duplicate && <Glyph name="ms:restart-alt" size={14} />}
                <AmountWords words={plainWords(row)} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 && (
        <details className="fsr-log__all">
          <summary className="fsr-log__summary fs-t-label">
            <Glyph name="ms:expand-more" size={16} />
            {FANOUT.showAll(rows.length)}
          </summary>
          <div className="fsr-log__lanes">
            {LANES.map((lane) => (
              <section
                key={lane}
                className="fsr-log__lane"
                data-lane={lane}
                data-testid={`W-TR-08.lane.${lane}`}
              >
                <h3 id={`W-TR-08-lane-${lane}`} className="fsr-log__lane-title fs-t-label">
                  <span className="fsr-log__dot" data-lane={lane} aria-hidden />
                  {FANOUT.lane[lane]}
                </h3>
                {lanes[lane].length === 0 ? (
                  <p className="fsr-log__empty fs-t-caption">{FANOUT.laneEmpty[lane]}</p>
                ) : (
                  <ScrollRegion className="fsr-log__scroll" labelledBy={`W-TR-08-lane-${lane}`}>
                    <ol className="fsr-log__rows">
                      {lanes[lane].map((row) => (
                        <li
                          key={row.id}
                          className="fsr-log__row"
                          data-duplicate={row.duplicate ? "" : undefined}
                          data-provenance={row.provenance}
                          data-live={isLive(row.id) ? "" : undefined}
                          data-testid={row.duplicate ? "W-TR-08.log.duplicate" : `W-TR-08.log.${row.id}`}
                        >
                          <p className="fsr-log__words fs-t-label">
                            {row.duplicate && <Glyph name="ms:restart-alt" size={14} />}
                            <AmountWords words={plainWords(row)} />
                          </p>
                          <EventDetail row={row} />
                          <time className="fsr-log__time fs-t-micro" dateTime={row.at ?? undefined}>
                            {rowTime(row.at)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </ScrollRegion>
                )}
              </section>
            ))}
          </div>
          {footer}
        </details>
      )}
    </section>
  );
}

/** The track's span: 5 s either side of the fastest and slowest confirmation, so the dots spread out. */
export function latencyScale(ms: readonly number[]): { readonly lo: number; readonly hi: number } {
  if (ms.length === 0) return { lo: 0, hi: 0 };
  return { lo: Math.max(0, Math.min(...ms) - 5000), hi: Math.max(...ms) + 5000 };
}

export function LatencyDots({ latency }: { readonly latency: Latency }) {
  const max = latency.max ?? 0;
  const { lo, hi } = latencyScale(latency.dots.map((d) => d.ms));
  const at = (ms: number) => `${hi > lo ? ((ms - lo) / (hi - lo)) * 100 : 0}%`;
  return (
    <figure className="fsr-latency" data-testid="W-TR-08.latency">
      <figcaption className="fs-t-label">{FANOUT.latency}</figcaption>
      {latency.dots.length === 0 ? (
        <p className="fs-t-micro fsr-muted">{FANOUT.latencyEmpty}</p>
      ) : (
        <>
          <div className="fsr-latency__track" aria-hidden>
            {latency.dots.map((d) => (
              <span
                key={d.memberNo}
                className="fsr-latency__dot"
                style={{ left: at(d.ms) }}
                title={`${d.name}, ${format.elapsedWords(d.ms)}`}
              />
            ))}
            {latency.p50 !== null && max > 0 && (
              <span className="fsr-latency__p50" style={{ left: at(latency.p50) }} />
            )}
            <span className="fsr-latency__tick fs-t-micro" data-end="start">
              {format.elapsedWords(lo)}
            </span>
            <span className="fsr-latency__tick fs-t-micro" data-end="end">
              {format.elapsedWords(hi)}
            </span>
          </div>
          <p className="fsr-latency__summary fs-t-micro" data-testid="W-TR-08.latency.summary">
            {FANOUT.latencySummary(format.elapsedWords(latency.p50 ?? 0), format.elapsedWords(max))}
          </p>
          <ul className="fs-sr">
            {latency.dots.map((d) => (
              <li key={d.memberNo}>
                {d.name}, {format.elapsedWords(d.ms)}
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
