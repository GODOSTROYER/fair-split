// The run's events without a ticker (UI gate round 3). The three-lane ribbon is gone: each new event the run's
// stream delivers shows once, as one 40 px toast at the bottom left for 3 s, and the whole timeline sits behind the
// top bar's Log, newest first. The space the ribbon took goes back to the screens. Each row keeps its lane as a
// mark (graphite for the machine, ink for people, and for PayPal the simulated glyph, which turns to a jade dot only
// for a payment the simulated PayPal confirmed), its time in Davao (PHT) and its words; the detail (an item ID, a
// webhook's name and how it was checked) is the row's title. A seeded or replayed row carries its legend glyph,
// whose words a screen reader hears, never a pill. History the stream replays never toasts: motion is evidence.

import { Dialog } from "@base-ui/react/dialog";
import type { LogLane, RunEvent } from "@fairsplit/contracts";
import { Glyph, HONESTY, LegendGlyph, useT } from "@fairsplit/ui-web";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { describeEvent, type LogRow } from "../data/describe.js";
import { useDescribeContext, useRunEvents } from "../data/hooks.js";
import { payoutStatus } from "../data/payout-replay.js";
import type { RunView } from "../data/run-view.js";
import { davaoShort } from "../features/proof/davao.js";
import { FocusReturn } from "../lib/focus.js";
import { format } from "../lib/format.js";
import { LOG, RIBBON, TOAST_MS } from "./copy.js";

/** PayPal's event names in plain words ("PAYMENT.PAYOUTS-ITEM.SUCCEEDED" is "payout succeeded"). */
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

/** A row's words as the log prints them: a PayPal notice by what it says, never its raw event name. */
export function logWords(words: string): string {
  const notice = /^PayPal notice: ([A-Z0-9_.-]+)$/.exec(words);
  return notice?.[1] ? RIBBON.notice(plainNotice(notice[1])) : words;
}

/** The ribbon's name for `logWords`, kept for callers. */
export const ribbonWords = logWords;

/** A row the seed stands in for: the first view's seeded history, or a reading the seed stand-in replays. */
function seededRow(row: LogRow): boolean {
  return row.provenance === "seeded" && (row.id.startsWith("seed-") || /seed/i.test(row.detail ?? ""));
}

/** True when the event behind a row is a payment the simulated PayPal confirmed: the only jade mark. */
function landedEvent(row: LogRow, event: RunEvent | undefined): boolean {
  return (
    row.lane === "PAYPAL" &&
    event?.type === "item.updated" &&
    payoutStatus({ itemStatus: event.payload.to, provenance: event.provenance }).amountState === "landed"
  );
}

const LANE_KEY: Readonly<Record<LogLane, "machine" | "people" | "paypal">> = {
  MACHINE: "machine",
  PEOPLE: "people",
  PAYPAL: "paypal",
};

/** The row's lane mark. PayPal's is the simulated glyph (its name says the rail) until a payment lands. */
function LaneMark({ lane, landed }: { readonly lane: LogLane; readonly landed: boolean }) {
  const t = useT();
  if (lane === "PAYPAL") {
    return landed ? (
      <span className="fsc-log__mark" data-lane="paypal" data-landed="">
        <span className="fs-sr">{`${HONESTY.simulatedSandbox.label}, confirmed: `}</span>
      </span>
    ) : (
      <LegendGlyph {...HONESTY.simulatedSandbox} className="fsc-log__glyph" />
    );
  }
  return (
    <span className="fsc-log__mark" data-lane={LANE_KEY[lane]}>
      <span className="fs-sr">{`${t(`W-JG-01.lane.${LANE_KEY[lane]}`)}: `}</span>
    </span>
  );
}

/** A seeded or replayed row's legend glyph: the words are its title and its accessible name. */
function RowGlyph({ row }: { readonly row: LogRow }): ReactNode {
  if (row.replayNote) return <LegendGlyph kind="simulated" label={row.replayNote} />;
  if (seededRow(row)) return <LegendGlyph {...HONESTY.seedStandIn} />;
  return null;
}

function rowTitle(row: LogRow): string {
  return `${row.words}${row.detail ? `. ${row.detail}` : ""}${row.at ? `. ${davaoShort(row.at)} ${RIBBON.zone}` : ""}`;
}

/** One row: mark, time, words and its glyph, on one line. */
function Row({ row, landed }: { readonly row: LogRow; readonly landed: boolean }) {
  return (
    <>
      <LaneMark lane={row.lane} landed={landed} />
      {row.at && (
        <time className="fsc-log__time fs-t-micro" dateTime={row.at}>
          {`${format.time(row.at)} ${RIBBON.zone}`}
        </time>
      )}
      <span className="fsc-log__words fs-t-label" data-duplicate={row.duplicate ? "" : undefined}>
        {logWords(row.words)}
      </span>
      <RowGlyph row={row} />
    </>
  );
}

/**
 * Every row of the run's log, newest first: the session's events, or before any, the first view's seeded history.
 * Each row carries whether its event is a payment the simulated PayPal confirmed.
 */
export function useLogRows(
  view: RunView | undefined,
  seeded?: Readonly<Record<LogLane, LogRow | null>>,
): readonly { readonly row: LogRow; readonly landed: boolean }[] {
  const ctx = useDescribeContext();
  return useMemo(() => {
    if (!ctx || !view || view.events.length === 0) {
      const history = seeded ? [seeded.PAYPAL, seeded.PEOPLE, seeded.MACHINE] : [];
      return history.filter((r): r is LogRow => r !== null).map((row) => ({ row, landed: false }));
    }
    const out: { row: LogRow; landed: boolean }[] = [];
    for (const event of view.events) {
      const row = describeEvent(event, ctx);
      if (row) out.push({ row, landed: landedEvent(row, event) });
    }
    return out.reverse();
  }, [ctx, view, seeded]);
}

export interface EventToastProps {
  /** The run on the stage; only its live events toast. */
  readonly runSlug: string | null;
}

/**
 * One toast, bottom left, 40 px: the newest live event for 3 s. A new event replaces it and starts its 3 s again.
 * It never takes focus or a click (the Log has everything), and it is not a live region: the run's own
 * announcements speak, so 48 slip readings never read out 48 times.
 */
export function EventToast({ runSlug }: EventToastProps) {
  const ctx = useDescribeContext();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [current, setCurrent] = useState<{ row: LogRow; landed: boolean } | null>(null);
  const [shown, setShown] = useState(false);
  useRunEvents(runSlug, (event, meta) => {
    if (meta.replay || !ctxRef.current) return;
    const row = describeEvent(event, ctxRef.current);
    if (!row) return;
    setCurrent({ row, landed: landedEvent(row, event) });
    setShown(true);
  });
  useEffect(() => {
    if (!shown || !current) return;
    const timer = setTimeout(() => setShown(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [shown, current]);
  if (!current) return null;
  const { row, landed } = current;
  return (
    <aside
      key={row.id}
      className="fsc-toast"
      aria-label={LOG.toast}
      data-state={shown ? "in" : "out"}
      data-lane={LANE_KEY[row.lane]}
      data-landed={landed ? "" : undefined}
      data-provenance={row.provenance}
      title={rowTitle(row)}
      data-testid="W-JG-01.toast"
    >
      <Row row={row} landed={landed} />
    </aside>
  );
}

export interface LogSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: RunView | undefined;
  readonly seeded?: Readonly<Record<LogLane, LogRow | null>>;
}

/** The whole timeline, newest first, in a sheet behind the top bar's Log. */
export function LogSheet({ open, onOpenChange, view, seeded }: LogSheetProps) {
  const rows = useLogRows(view, seeded);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fsc-sheet__scrim" />
        <Dialog.Popup finalFocus={false} className="fsc-sheet fsc-logsheet" data-testid="W-JG-01.log">
          {/* Closing hands focus back to the Log button, through the console's one return (lib/focus.ts). */}
          <FocusReturn open={open} leaving={() => document.querySelector('[data-testid="W-JG-01.log"]')} />
          <header className="fsc-sheet__head">
            <Dialog.Title className="fs-t-title-1">{LOG.title}</Dialog.Title>
            <Dialog.Close className="fsc-sheet__close" data-testid="W-JG-01.log.close">
              <Glyph name="ms:close" size={18} />
              <span className="fs-t-label">{LOG.close}</span>
            </Dialog.Close>
          </header>
          {rows.length === 0 ? (
            <p className="fsc-log__empty fs-t-body">{LOG.empty}</p>
          ) : (
            <ol className="fsc-log" data-testid="W-JG-01.log.rows">
              {rows.map(({ row, landed }) => (
                <li
                  key={row.id}
                  className="fsc-log__row"
                  data-lane={LANE_KEY[row.lane]}
                  data-landed={landed ? "" : undefined}
                  data-provenance={row.provenance}
                  title={rowTitle(row)}
                  data-testid={`W-JG-01.log.${LANE_KEY[row.lane]}`}
                >
                  <Row row={row} landed={landed} />
                </li>
              ))}
            </ol>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
