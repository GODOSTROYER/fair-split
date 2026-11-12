// The run's events without a ticker (UI gate rounds 3 and 5). Each new event the run's stream delivers shows once,
// for 3 s, folded into the top bar's Next pill (round 5: the pill crossfades to the event in plain words, then back to
// "Next: …", so the bar never grows a seventh item), and the whole timeline sits behind the chevron menu's Run log,
// newest first, where the times live. Each row keeps its lane as an 8 px round mark (graphite for the machine, ink
// for people, a hollow ring for PayPal that turns to the jade dot only for a payment the simulated PayPal confirmed),
// its time in Davao (PHT) and its words; the detail (an item ID, a webhook's name and how it was checked, a seeded or
// replayed row's provenance) is the row's title. No legend glyphs (round 5: provenance once, in a screen's id line).
// History the stream replays never toasts: motion is evidence.

import { Dialog } from "@base-ui/react/dialog";
import type { LogLane, RunEvent } from "@fairsplit/contracts";
import { TWEENS } from "@fairsplit/motion/presets";
import { Glyph, HONESTY, useT } from "@fairsplit/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeEvent, type LogRow } from "../data/describe.js";
import { useDescribeContext, useRunEvents } from "../data/hooks.js";
import { payoutStatus } from "../data/payout-replay.js";
import type { RunView } from "../data/run-view.js";
import { davaoShort } from "../features/proof/davao.js";
import { FocusReturn } from "../lib/focus.js";
import { format } from "../lib/format.js";
import { LOG, RIBBON, TOAST_MS } from "./copy.js";
import { toastWords } from "./toast.js";

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

/**
 * The row's lane mark: an 8 px round dot (round 5: one marker vocabulary). PayPal's is a hollow ring (the simulated
 * sandbox, not yet money anyone holds) until a payment lands, then the jade dot. Its words are for screen readers.
 */
function LaneMark({ lane, landed }: { readonly lane: LogLane; readonly landed: boolean }) {
  const t = useT();
  const words =
    lane === "PAYPAL"
      ? landed
        ? `${HONESTY.simulatedSandbox.label}, confirmed: `
        : `${HONESTY.simulatedSandbox.label}: `
      : `${t(`W-JG-01.lane.${LANE_KEY[lane]}`)}: `;
  return (
    <span className="fsc-log__mark" data-lane={LANE_KEY[lane]} data-landed={landed ? "" : undefined}>
      <span className="fs-sr">{words}</span>
    </span>
  );
}

/** Where a seeded or replayed row came from, said in its title (never a glyph on the row). */
function provenanceNote(row: LogRow): string | null {
  if (row.replayNote) return row.replayNote;
  if (seededRow(row)) return HONESTY.seedStandIn.label;
  return null;
}

function rowTitle(row: LogRow): string {
  const note = provenanceNote(row);
  return [
    row.words,
    row.detail || null,
    note && !row.detail.includes(note) ? note : null,
    row.at ? `${davaoShort(row.at)} ${RIBBON.zone}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

/** One log row: mark, time and words, on one line; a seeded or replayed row's provenance is said, not drawn. */
function Row({ row, landed }: { readonly row: LogRow; readonly landed: boolean }) {
  const note = provenanceNote(row);
  return (
    <>
      <LaneMark lane={row.lane} landed={landed} />
      {row.at && (
        <time className="fsc-log__time fs-t-id" dateTime={row.at}>
          {`${format.time(row.at)} ${RIBBON.zone}`}
        </time>
      )}
      <span className="fsc-log__words fs-t-label" data-duplicate={row.duplicate ? "" : undefined}>
        {logWords(row.words)}
      </span>
      {note && <span className="fs-sr">{`. ${note}`}</span>}
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

/** The newest live event, as the Next pill shows it for 3 s (round 5). */
export interface PillToast {
  readonly row: LogRow;
  readonly landed: boolean;
  /** Its words in the toast catalog's plain words (chrome/toast.ts): no time, no "Notice:", no full stop. */
  readonly words: string;
  /** In for TIMING.toast, then out; it leaves the pill one swap (150 ms) later. */
  readonly shown: boolean;
}

/**
 * The run's newest live event for the Next pill: in for 3 s (TIMING.toast), then out, then gone after the 150 ms
 * crossfade back to "Next: …". A new event replaces it and starts its 3 s again. History the stream replays never
 * toasts. It never takes focus or a click (the Run log has everything), and it is not a live region: the run's own
 * announcements speak, so 48 slip readings never read out 48 times.
 */
export function usePillToast(runSlug: string | null): PillToast | null {
  const ctx = useDescribeContext();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [current, setCurrent] = useState<Omit<PillToast, "shown"> | null>(null);
  const [shown, setShown] = useState(false);
  useRunEvents(runSlug, (event, meta) => {
    if (meta.replay || !ctxRef.current) return;
    const row = describeEvent(event, ctxRef.current);
    if (!row) return;
    // Round 6: an event with nothing to say never takes the pill's words (it would leave a bare dot): the pill
    // keeps "Next: …".
    const words = toastWords(row, event).trim();
    if (!words) return;
    setCurrent({ row, landed: landedEvent(row, event), words });
    setShown(true);
  });
  useEffect(() => {
    if (!current) return;
    if (shown) {
      const timer = setTimeout(() => setShown(false), TOAST_MS);
      return () => clearTimeout(timer);
    }
    const gone = setTimeout(() => setCurrent(null), TWEENS.swap.ms);
    return () => clearTimeout(gone);
  }, [shown, current]);
  useEffect(() => {
    if (runSlug === null) {
      setCurrent(null);
      setShown(false);
    }
  }, [runSlug]);
  return current ? { ...current, shown } : null;
}

/**
 * The toast inside the Next pill: the event's plain words over the pill's own, crossfading (150 ms). Hidden from
 * assistive technology (the pill's name stays "Next: …"); its title carries the row's detail and its time.
 */
export function PillToastWords({ toast }: { readonly toast: PillToast }) {
  const { row, landed, words, shown } = toast;
  return (
    <span
      key={row.id}
      className="fsc-toast"
      aria-hidden
      data-state={shown ? "in" : "out"}
      data-lane={LANE_KEY[row.lane]}
      data-landed={landed ? "" : undefined}
      data-provenance={row.provenance}
      title={rowTitle(row)}
      data-testid="W-JG-01.toast"
    >
      {words}
    </span>
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
