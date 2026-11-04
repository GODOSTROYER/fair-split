// The run log in three lanes (design §5 "Webhook and live timeline"): Machine (Claude and the engine), People and
// PayPal, newest first. Each row leads with plain words; the event name, IDs, source and signature result follow
// in caption type. A repeated PayPal delivery logs one quiet row and changes nothing. Latency dots sit beside
// it at the true receipt times, funding to each confirmed payment, with the median and the slowest.

import { Glyph } from "@fairsplit/ui-web";
import { Fragment } from "react";
import { ScrollRegion } from "../../chrome/ScrollRegion.js";
import { type LogRow, rowTime } from "../../data/describe.js";
import { format } from "../../lib/format.js";
import { FANOUT } from "../split/shared/copy.js";
import { byLane, LANES, type Latency } from "./model.js";

export interface RunLogProps {
  readonly rows: readonly LogRow[];
  /** Rows whose event arrived live (they print with the clip wipe; history prints in place). */
  readonly isLive: (id: string) => boolean;
  /** Seeded history, labelled as such (the showcase run has no event stream). */
  readonly seeded: boolean;
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
        <p className="fsr-log__event fs-t-caption">
          <EventName name={name} />
        </p>
      )}
      {detail && <p className="fsr-log__detail fs-t-caption">{detail}</p>}
    </>
  );
}

export function RunLog({ rows, isLive, seeded }: RunLogProps) {
  const lanes = byLane(rows);
  // A replayed payout's long note is the log's, said once here; each replayed row names only what it replayed.
  const replayNote = rows.find((row) => row.replayNote)?.replayNote ?? null;
  return (
    <section className="fsr-log" data-testid="W-TR-08.log">
      <h2 id="W-TR-08-log" className="fs-t-title-2">
        {FANOUT.log}
      </h2>
      {seeded && <p className="fsr-log__note fs-t-caption">{FANOUT.seededLog}</p>}
      {replayNote && (
        <p className="fsr-log__note fs-t-caption" data-testid="W-TR-08.log.replayNote">
          {replayNote}
        </p>
      )}
      <div className="fsr-log__lanes">
        {LANES.map((lane) => (
          <section key={lane} className="fsr-log__lane" data-lane={lane} data-testid={`W-TR-08.lane.${lane}`}>
            <h3 id={`W-TR-08-lane-${lane}`} className="fsr-log__lane-title fs-t-label">
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
                        <AmountWords words={row.words} />
                      </p>
                      <EventDetail row={row} />
                      <time className="fsr-log__time fs-t-caption" dateTime={row.at ?? undefined}>
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
        <p className="fs-t-caption fsr-muted">{FANOUT.latencyEmpty}</p>
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
            <span className="fsr-latency__tick fs-t-caption" data-end="start">
              {format.elapsedWords(lo)}
            </span>
            <span className="fsr-latency__tick fs-t-caption" data-end="end">
              {format.elapsedWords(hi)}
            </span>
          </div>
          <p className="fs-t-caption" data-testid="W-TR-08.latency.summary">
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
