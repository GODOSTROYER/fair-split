// The stage's bottom ribbon: the newest run-log row in each lane, Machine, People and PayPal (design §5), so
// the governance model reads at a glance: the machine prints in pencil, people decide in ink, PayPal lands.
// Each lane's mark is that grammar: a graphite square, an ink square, and an open ring for PayPal that turns
// jade flush only when its newest row is a payment PayPal confirmed. A new row prints with the clip wipe,
// only when its event arrives (motion is evidence); a repeated delivery is logged and changes nothing.
// UI gate round 2: one line per lane, the lane's name and its time in Davao (PHT), then the event in plain words.
// The detail (an item ID, a webhook's name and how it was checked) is the row's title; the PayPal lane's name is
// the honesty tag itself, and a seeded or replayed row wears its own small tag, never a sentence.
// Between 1024 and 1439 px the phone lives here too, as a fourth lane ("Phone: Nang Celing, Gisusi pa"): it
// never covers the screen, and pressing it raises the phone above the ribbon. The stage's honesty caption moved
// to What's real.

import type { LogLane, RunEvent } from "@fairsplit/contracts";
import { Glyph, HonestyTag, useT } from "@fairsplit/ui-web";
import { useMemo, useState } from "react";
import { describeEvent, type LogRow, latestByLane } from "../data/describe.js";
import { useDescribeContext, usePaypalRail, useRunEvents } from "../data/hooks.js";
import { payoutStatus } from "../data/payout-replay.js";
import type { RunView } from "../data/run-view.js";
import { davaoShort } from "../features/proof/davao.js";
import { env } from "../lib/env.js";
import { format } from "../lib/format.js";
import { PHONE_LANE, RIBBON, railTag, STAGE } from "./copy.js";

/** PayPal's event names in plain words for the ribbon ("PAYMENT.PAYOUTS-ITEM.SUCCEEDED" is "payout succeeded"). */
const NOTICE_NOUNS: Readonly<Record<string, string>> = {
  INVOICE: "invoice",
  "PAYOUTS-ITEM": "payout",
  PAYOUTSBATCH: "payout batch",
};
const NOTICE_VERBS: Readonly<Record<string, string>> = { CANCELED: "cancelled", SUCCEEDED: "succeeded" };

export function plainNotice(eventType: string): string {
  const [, noun = "", verb = ""] = eventType.split(".");
  const what = NOTICE_NOUNS[noun] ?? noun.toLowerCase().replace(/[-_]/g, " ");
  const how = NOTICE_VERBS[verb] ?? verb.toLowerCase().replace(/[-_]/g, " ");
  return [what, how].filter(Boolean).join(" ");
}

/** A row the seed stands in for: the first view's seeded history, or a reading the seed stand-in replays. */
function seededRow(row: LogRow): boolean {
  return row.provenance === "seeded" && (row.id.startsWith("seed-") || /seed/i.test(row.detail ?? ""));
}

/** A row's words as the ribbon prints them: a PayPal notice by what it says, never its raw event name. */
export function ribbonWords(words: string): string {
  const notice = /^PayPal notice: ([A-Z0-9_.-]+)$/.exec(words);
  return notice?.[1] ? RIBBON.notice(plainNotice(notice[1])) : words;
}

const LANES: readonly { readonly lane: LogLane; readonly key: "machine" | "people" | "paypal" }[] = [
  { lane: "MACHINE", key: "machine" },
  { lane: "PEOPLE", key: "people" },
  { lane: "PAYPAL", key: "paypal" },
];

/** The collapsed phone, as the ribbon's fourth lane. */
export interface PhoneLane {
  /** "Nang Celing: Gisusi pa" */
  readonly words: string;
  readonly raised: boolean;
  readonly onToggle: () => void;
}

export interface RibbonProps {
  readonly view: RunView | undefined;
  /** Rows to show before any event (the first view's seeded history). */
  readonly seeded?: Readonly<Record<LogLane, LogRow | null>>;
  /** The phone's lane, between 1024 and 1439 px; null where the phone is docked or visited. */
  readonly phone?: PhoneLane | null;
}

/** Live event IDs remembered for the print wipe; older ones have printed already. */
const LIVE_MEMORY = 64;

/** True when the event behind a row is a payment PayPal confirmed: the only row whose mark is jade. */
function landed(row: LogRow | null, events: readonly RunEvent[]): boolean {
  if (row?.lane !== "PAYPAL" || row.type !== "item.updated") return false;
  const event = events.find((e) => e.id === row.id);
  return (
    event?.type === "item.updated" &&
    payoutStatus({ itemStatus: event.payload.to, provenance: event.provenance }).amountState === "landed"
  );
}

export function Ribbon({ view, seeded, phone = null }: RibbonProps) {
  const t = useT();
  const ctx = useDescribeContext();
  // The PayPal lane says its rail in its own name (I8), so a row's long detail can never clip the label away.
  const rail = usePaypalRail() ?? env.paypalRail;
  // Only an event that arrived live prints with the wipe; history the stream replays appears at rest.
  const [live, setLive] = useState<readonly string[]>([]);
  useRunEvents(view?.runSlug ?? null, (event, meta) => {
    if (!meta.replay) setLive((prev) => [...prev.slice(-(LIVE_MEMORY - 1)), event.id]);
  });
  const latest = useMemo(() => {
    const empty = { MACHINE: null, PEOPLE: null, PAYPAL: null };
    if (!ctx || !view || view.events.length === 0) return seeded ?? empty;
    const rows: LogRow[] = [];
    for (const event of view.events) {
      const row = describeEvent(event, ctx);
      if (row) rows.push(row);
    }
    const byLane = latestByLane(rows);
    return {
      MACHINE: byLane.MACHINE ?? seeded?.MACHINE ?? null,
      PEOPLE: byLane.PEOPLE ?? seeded?.PEOPLE ?? null,
      PAYPAL: byLane.PAYPAL ?? seeded?.PAYPAL ?? null,
    };
  }, [ctx, view, seeded]);

  return (
    <section
      className="fsc-ribbon"
      aria-label={t("W-JG-01.ribbon")}
      data-phone={phone ? "" : undefined}
      data-testid="W-JG-01.ribbon"
    >
      {LANES.map(({ lane, key }) => {
        const row = latest[lane];
        const jade = key === "paypal" && landed(row, view?.events ?? []);
        return (
          <article
            key={lane}
            className="fsc-ribbon__lane"
            data-lane={key}
            data-landed={jade ? "" : undefined}
            data-provenance={row?.provenance}
            data-testid={`W-JG-01.ribbon.${key}`}
            title={
              row
                ? `${row.words}${row.detail ? `. ${row.detail}` : ""}${row.at ? `. ${davaoShort(row.at)} ${RIBBON.zone}` : ""}`
                : undefined
            }
          >
            <p className="fsc-ribbon__name fs-t-caption">
              <span className="fsc-ribbon__mark" aria-hidden />
              {key === "paypal" ? (
                <HonestyTag className="fsc-ribbon__tag">{railTag(rail)}</HonestyTag>
              ) : (
                t(`W-JG-01.lane.${key}`)
              )}
              {row?.at && (
                <time className="fsc-ribbon__time fs-t-micro" dateTime={row.at}>
                  {`${format.time(row.at)} ${RIBBON.zone}`}
                </time>
              )}
            </p>
            {row ? (
              <div
                key={row.id}
                className="fsc-ribbon__row"
                data-duplicate={row.duplicate ? "" : undefined}
                data-print={live.includes(row.id) ? "" : undefined}
              >
                <p className="fsc-ribbon__words fs-t-label">{ribbonWords(row.words)}</p>
                {row.replayNote ? (
                  <HonestyTag className="fsc-ribbon__tag">{row.replayNote}</HonestyTag>
                ) : seededRow(row) && key !== "paypal" ? (
                  <span className="fsc-ribbon__tag" title={RIBBON.seededTitle}>
                    <HonestyTag>{RIBBON.seeded}</HonestyTag>
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="fsc-ribbon__empty fs-t-caption">{STAGE.ribbonEmpty}</p>
            )}
          </article>
        );
      })}
      {phone && (
        <button
          type="button"
          className="fsc-ribbon__lane fsc-ribbon__phone"
          data-lane="phone"
          aria-expanded={phone.raised}
          aria-controls="fsc-phone-panel"
          onClick={phone.onToggle}
          data-testid="W-JG-01.phoneTab"
          title={phone.words}
        >
          <span className="fsc-ribbon__name fs-t-caption">
            <span className="fsc-ribbon__mark" aria-hidden />
            {PHONE_LANE.name}
          </span>
          <span className="fsc-ribbon__words fs-t-label">{phone.words}</span>
          <span className="fsc-ribbon__action fs-t-caption">
            <Glyph name={phone.raised ? "ms:expand-more" : "ms:expand-less"} size={16} />
            {phone.raised ? PHONE_LANE.lower : PHONE_LANE.raise}
          </span>
        </button>
      )}
    </section>
  );
}
