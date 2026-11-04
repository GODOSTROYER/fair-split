// The stage's bottom ribbon: the newest run-log row in each lane, Machine, People and PayPal (design §5), so
// the governance model reads at a glance: the machine prints in pencil, people decide in ink, PayPal lands.
// Each lane's mark is that grammar: a graphite square, an ink square, and an open ring for PayPal that turns
// jade flush only when its newest row is a payment PayPal confirmed. A new row prints with the clip wipe,
// only when its event arrives (motion is evidence); a repeated delivery is logged and changes nothing. A row's
// detail keeps two lines, so an item ID or a webhook's name is never cut mid-word.
// Between 1024 and 1679 px the phone lives here too, as a fourth lane ("Phone: Nang Celing, Gisusi pa"): it
// never covers the screen, and pressing it raises the phone above the ribbon. The stage's honesty caption
// ("Synthetic co-op, people and slips…") closes the ribbon at its right end.

import type { LogLane, RunEvent } from "@fairsplit/contracts";
import { Glyph, useT } from "@fairsplit/ui-web";
import { useMemo, useState } from "react";
import { describeEvent, type LogRow, latestByLane, rowTime } from "../data/describe.js";
import { useDescribeContext, usePaypalRail, useRunEvents } from "../data/hooks.js";
import type { RunView } from "../data/run-view.js";
import { env } from "../lib/env.js";
import { PHONE_LANE, STAGE } from "./copy.js";

/** The PayPal lane's rail, after its name under the simulator: "PayPal, simulated sandbox". */
const PAYPAL_LANE_RAIL = "simulated sandbox";

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
  /** The phone's lane, between 1024 and 1679 px; null where the phone is docked or visited. */
  readonly phone?: PhoneLane | null;
  /** The stage's honesty caption, at the ribbon's right end. */
  readonly caption?: string;
}

/** Live event IDs remembered for the print wipe; older ones have printed already. */
const LIVE_MEMORY = 64;

/** True when the event behind a row is a payment PayPal confirmed: the only row whose mark is jade. */
function landed(row: LogRow | null, events: readonly RunEvent[]): boolean {
  if (row?.lane !== "PAYPAL" || row.type !== "item.updated") return false;
  const event = events.find((e) => e.id === row.id);
  return event?.type === "item.updated" && event.provenance !== "replay" && event.payload.to === "SUCCESS";
}

export function Ribbon({ view, seeded, phone = null, caption }: RibbonProps) {
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
          >
            <p className="fsc-ribbon__name fs-t-caption">
              <span className="fsc-ribbon__mark" aria-hidden />
              {t(`W-JG-01.lane.${key}`)}
              {key === "paypal" && rail === "simulator" ? `, ${PAYPAL_LANE_RAIL}` : ""}
              {row?.at && (
                <time className="fsc-ribbon__time" dateTime={row.at}>
                  {rowTime(row.at)}
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
                <p className="fsc-ribbon__words fs-t-label">{row.words}</p>
                {row.detail ? <p className="fsc-ribbon__detail fs-t-caption">{row.detail}</p> : null}
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
      {caption && (
        <p className="fsc-ribbon__caption fs-t-caption" data-testid="W-JG-01.caption">
          {caption}
        </p>
      )}
    </section>
  );
}
