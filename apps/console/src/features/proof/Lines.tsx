import { payoutStatus } from "../../data/payout-replay.js";
// Plate 4's lines (S1.8): every member's line by ID (C-23), with kilos, rail, net and status, and MM-7 "Tap a
// peso" on Proof (cut-order item 6, built reduced-first): a press on a net amount frames it and unfolds why it is
// that amount, in shares of the co-op's kilos (Proof never shows a per-kg rate, S1.10); a press on one of its
// slips zooms into the slip the kilos were read from; Back (or Escape) returns. Every act starts from the
// person's own press, which is its evidence. "+"/"−" and the arrow keys zoom and pan the slip without a drag
// (WCAG 2.5.7). The brand's view adds names and masked receivers (C-23).
//
// Proof is read on phones first. At 560 px and below the table folds to three columns (the rail under the
// member, the status under the net), so the peso to tap is on screen without a sideways scroll; the brand's view
// always folds its names and receivers under the member, since seven columns never fit the 680 px column. The
// trace spans every visible column and is pinned to the scroller's window (proof.css), so it never crops, even
// if a table ever scrolls sideways.

import type { MemberLineState, ProofBundle, ProofLine, SnapshotSlip } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import { spring } from "@fairsplit/motion/web";
import { Chip, Glyph, HONESTY, LegendGlyph, MicroTag, StatusChip } from "@fairsplit/ui-web";
import { animate, type MotionValue, motion, useMotionValue, useTransform } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { returnFocus, useFocusAfterRemoval } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import { useViewportWidth } from "../../stage/layout.js";
import { LINES_COPY } from "./copy.js";
import { ZoomGlyph } from "./glyphs.js";
import { itemsByMember, type LineStates, lineStateOf, type ProofItemView } from "./model.js";
import { SlipCrop, slipAlt } from "./SlipCrop.js";

export interface MemberLabel {
  readonly name: string;
  readonly receiverMasked: string | null;
}

export interface LinesProps {
  readonly bundle: ProofBundle;
  readonly items: readonly ProofItemView[];
  readonly lineStates: LineStates;
  readonly slips: ReadonlyMap<string, SnapshotSlip>;
  /** "R1" → "CBU": the rate card's own term labels. */
  readonly ruleNames: ReadonlyMap<string, string>;
  /** A credit's mark ID → what the slip said ("Multa (absent GA) ₱200"). */
  readonly markNames: ReadonlyMap<string, string>;
  /** The resolution the rules come from: "BR 2026-04". */
  readonly card: string;
  /** The brand's view only: names and masked receivers under the data-sharing agreement. */
  readonly names: ReadonlyMap<string, MemberLabel> | null;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 0.35;
const PAN_STEP = 24;

/** At this viewport width and below the lines fold to three columns (the five need about 545 px). */
export const LINES_FOLD_PX = 560;

type Trace = { readonly memberNo: string; readonly serial: string | null } | null;

export function Lines({ bundle, items, lineStates, slips, ruleNames, markNames, card, names }: LinesProps) {
  const mm7 = useMoment("MM-7");
  const [trace, setTrace] = useState<Trace>(null);
  const presses = useRef(0);
  const closing = useRef(false);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const frame = mm7.value("frame");
  const expand = mm7.value("expand");
  const zoom = mm7.value("zoom");
  const dim = mm7.value("dim");
  const tiles = mm7.value("tiles");
  const receiptOpacity = useTransform(dim, (d) => 1 - d * 0.75);
  const reduced = mm7.mode !== "full";
  const unfold = useTransform(expand, (v) =>
    reduced ? "none" : `inset(0 0 ${Math.round((1 - v) * 100)}% 0)`,
  );

  const itemBy = useMemo(() => itemsByMember(items), [items]);
  const totals = useMemo(
    () => ({
      verified: bundle.lines.reduce((s, l) => s + l.canonical.verifiedG, 0),
      grade1: bundle.lines.reduce((s, l) => s + l.canonical.grade1G, 0),
    }),
    [bundle.lines],
  );

  const evidence = (what: string) => {
    presses.current += 1;
    return { eventId: `press:${what}:${presses.current}`, kind: "press" as const };
  };

  const open = (memberNo: string) => {
    closing.current = false;
    panX.set(0);
    panY.set(0);
    setTrace({ memberNo, serial: null });
    mm7.reset();
    mm7.play("tap", evidence(`line:${memberNo}`));
  };

  const zoomTo = (memberNo: string, serial: string) => {
    closing.current = false;
    panX.set(0);
    panY.set(0);
    setTrace({ memberNo, serial });
    mm7.play("zoom", evidence(`slip:${serial}`));
  };

  const back = () => {
    if (!trace) return;
    if (trace.serial) {
      // Back from the slip returns to the line, still framed and unfolded.
      setTrace({ memberNo: trace.memberNo, serial: null });
      mm7.reset();
      mm7.play("tap", evidence(`line:${trace.memberNo}`));
      return;
    }
    closing.current = true;
    mm7.play("back", evidence(`back:${trace.memberNo}`));
  };

  // The back act ends in "rest"; only then does the line fold away.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (closing.current && mm7.phase === "rest") {
      closing.current = false;
      // The trace's Close goes away with it: the layout effect below hands focus back once that commit lands.
      refocus.current = trace?.memberNo ?? null;
      setTrace(null);
    }
  }, [mm7.phase, trace]);

  // In the commit that removed the trace (never on a timer, which can fire before React commits, find the Close
  // still focused and give up), focus returns to the peso that opened it if it fell to <body> (WCAG 2.4.3). The
  // trace pushed the rows below it down while it was open, so the peso is often above the viewport by now: it
  // scrolls back into view, so the keyboard's ring is never off screen (WCAG 2.4.7).
  useLayoutEffect(() => {
    const memberNo = refocus.current;
    if (trace !== null || memberNo === null) return;
    refocus.current = null;
    returnFocus(() => document.querySelector<HTMLElement>(`[data-testid="W-PF-01.peso.${memberNo}"]`));
  }, [trace]);

  // Back from the slip (Escape on a zoom button) takes the zoom controls away: focus lands on the trace's Back.
  const [traceRoot, setTraceRoot] = useState<HTMLDivElement | null>(null);
  useFocusAfterRemoval(
    traceRoot,
    () => traceRoot?.querySelector<HTMLElement>('[data-testid="W-PF-01.trace.back"]') ?? null,
  );

  const nudgeZoom = (delta: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.get() + delta));
    if (reduced) zoom.set(next);
    else animate(zoom, next, spring("glide", "unitless"));
  };

  const onCropKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [PAN_STEP, 0],
      ArrowRight: [-PAN_STEP, 0],
      ArrowUp: [0, PAN_STEP],
      ArrowDown: [0, -PAN_STEP],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      const limit = 120 * (zoom.get() - 1);
      panX.set(Math.max(-limit, Math.min(limit, panX.get() + move[0])));
      panY.set(Math.max(-limit, Math.min(limit, panY.get() + move[1])));
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      nudgeZoom(ZOOM_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      nudgeZoom(-ZOOM_STEP);
    }
  };

  const traceState = !trace ? "closed" : trace.serial ? "slip" : "line";
  // The brand's seven columns never fit Proof's 680 px column, so its names and receivers always fold.
  const narrow = useViewportWidth() <= LINES_FOLD_PX;
  const fold = narrow || names !== null;
  const columns = fold ? 3 : 5;

  return (
    <section
      className="pf-lines"
      {...mm7.rootProps}
      data-motion={mm7.mode}
      data-trace={traceState}
      data-testid="W-PF-01.lines"
      aria-label="Every member's line"
      onKeyDown={(e) => {
        if (e.key === "Escape" && trace) {
          e.stopPropagation();
          back();
        }
      }}
    >
      {/* The table's PayPal money is named simulated once, by the micro-tag, never per row. */}
      <p className="pf-lines__bar">
        <span className="pf-lines__hint fs-t-caption">{LINES_COPY.hint}</span>
        <MicroTag testId="W-PF-01.lines.tag" />
      </p>
      <div className="pf-table-wrap" data-testid="W-PF-01.lines.scroller">
        <table
          className="pf-table pf-lines__table"
          data-fold={fold ? "" : undefined}
          data-testid="W-PF-01.lines.table"
        >
          <caption className="fs-sr">{LINES_COPY.caption}</caption>
          <thead>
            <tr>
              <th scope="col">
                Member
                {fold && <span className="fs-sr">{names ? ", name, receiver and rail" : " and rail"}</span>}
              </th>
              <th scope="col" data-numeric="">
                Verified
              </th>
              {!fold && <th scope="col">Rail</th>}
              <th scope="col" data-numeric="">
                Net
                {fold && <span className="fs-sr"> and status</span>}
              </th>
              {!fold && <th scope="col">Status</th>}
            </tr>
          </thead>
          <tbody>
            {bundle.lines.map((line) => {
              const state = lineStateOf(line, itemBy.get(line.memberNo), lineStates);
              const isOpen = trace?.memberNo === line.memberNo;
              const traceId = `W-PF-01-trace-${line.memberNo}`;
              return (
                <LineRows
                  key={line.memberNo}
                  line={line}
                  replayed={
                    payoutStatus({
                      state,
                      bundle,
                      provenance: itemBy.get(line.memberNo)?.provenance,
                      memberNo: line.memberNo,
                      paypal: line.rail === "PAYPAL" && state !== "OFF_RAIL_DUE" && state !== "OFF_RAIL_PAID",
                    }).replayed
                  }
                  state={state}
                  label={names?.get(line.memberNo)}
                  names={names !== null}
                  fold={fold}
                  columns={columns}
                  open={isOpen}
                  traceId={traceId}
                  onOpen={() => (isOpen ? back() : open(line.memberNo))}
                  frame={frame}
                >
                  {isOpen && trace && (
                    <motion.div
                      ref={setTraceRoot}
                      className="pf-trace"
                      id={traceId}
                      style={{ opacity: expand, clipPath: unfold }}
                      data-pin="scroller"
                      data-testid="W-PF-01.trace"
                    >
                      <motion.div style={{ opacity: receiptOpacity }} className="pf-trace__receipt">
                        <Receipt
                          line={line}
                          state={state}
                          replayed={
                            payoutStatus({
                              state,
                              bundle,
                              provenance: itemBy.get(line.memberNo)?.provenance,
                              memberNo: line.memberNo,
                              paypal: line.rail === "PAYPAL",
                            }).replayed
                          }
                          totals={totals}
                          ruleNames={ruleNames}
                          markNames={markNames}
                          card={card}
                        />
                        <div className="pf-trace__slips">
                          <span className="pf-trace__lead">{LINES_COPY.fromSlips}</span>
                          {line.canonical.slipSerials.map((serial) => {
                            const slip = slips.get(serial);
                            const kg = slip ? format.kg(slip.payableG, 2) : null;
                            return (
                              <button
                                key={serial}
                                type="button"
                                className="pf-slipchip"
                                data-active={trace.serial === serial ? "" : undefined}
                                data-testid={`W-PF-01.trace.slip.${serial}`}
                                aria-label={LINES_COPY.openSlip(serial, kg)}
                                aria-pressed={trace.serial === serial}
                                onClick={() => zoomTo(line.memberNo, serial)}
                              >
                                <Glyph name="triplicate-slip" size={16} />
                                <span className="pf-slipchip__no fs-t-id">{serial}</span>
                                {kg && <span className="pf-slipchip__kg">{kg}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                      {trace.serial && (
                        <CropPanel
                          serial={trace.serial}
                          slip={slips.get(trace.serial) ?? null}
                          zoom={zoom}
                          tiles={tiles}
                          panX={panX}
                          panY={panY}
                          onKey={onCropKey}
                          onZoom={nudgeZoom}
                        />
                      )}
                      <p className="pf-trace__actions">
                        <button
                          type="button"
                          className="fs-link fs-t-label"
                          onClick={back}
                          data-testid="W-PF-01.trace.back"
                        >
                          <Glyph name="ms:arrow-back" size={16} />
                          {trace.serial ? LINES_COPY.backToLine : LINES_COPY.close}
                        </button>
                      </p>
                    </motion.div>
                  )}
                </LineRows>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="fs-sr" aria-live="polite">
        {trace
          ? trace.serial
            ? LINES_COPY.slipOpen(trace.serial)
            : LINES_COPY.traceOpen(trace.memberNo)
          : ""}
      </span>
      <p className="pf-lines__sum">
        <span>{LINES_COPY.sum(bundle.lines.length)}</span>{" "}
        <span>
          {LINES_COPY.netOf}{" "}
          <span data-amount-state="ink" className="fs-t-figure">
            {format.money(bundle.lines.reduce((s, l) => s + l.netCents, 0))}
          </span>
          .
        </span>
      </p>
      {/* The trace's state for tests and CSS: which line and slip are traced. */}
      <span hidden data-testid="W-PF-01.trace.state" data-trace={traceState} />
    </section>
  );
}

/** "Capital build-up (CBU)" → "CBU": the short name the chips use. */
export function shortRuleName(label: string): string {
  return /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? label;
}

interface ReceiptProps {
  readonly replayed: boolean;
  readonly line: ProofLine;
  readonly state: MemberLineState;
  readonly totals: { readonly verified: number; readonly grade1: number };
  readonly ruleNames: ReadonlyMap<string, string>;
  readonly markNames: ReadonlyMap<string, string>;
  readonly card: string;
}

/** Why the amount is the amount, read top to bottom: premium, bonus, ruled deductions, credits, net. */
function Receipt({ line, state, replayed, totals, ruleNames, markNames, card }: ReceiptProps) {
  const k = line.canonical;
  return (
    <dl className="pf-receipt" data-testid="W-PF-01.trace.receipt">
      <div className="pf-receipt__row">
        <dt>
          Premium <Glyph name="ms:lock" size={14} />
          <span className="pf-receipt__why">
            {LINES_COPY.share(format.kg(k.verifiedG), format.kg(totals.verified))}. {LINES_COPY.premiumNote}.
          </span>
        </dt>
        <dd className="fs-t-figure" data-amount-state="ink">
          {format.money(k.premiumCents)}
        </dd>
      </div>
      <div className="pf-receipt__row">
        <dt>
          Quality bonus
          <span className="pf-receipt__why">
            {LINES_COPY.bonusShare(format.kg(k.grade1G), format.kg(totals.grade1))}.
          </span>
        </dt>
        <dd className="fs-t-figure" data-amount-state="ink">
          + {format.money(k.bonusCents)}
        </dd>
      </div>
      {k.deductions.map((d, i) => (
        <div className="pf-receipt__row" key={`${d.ruleId}-${i}`} data-kind="deduction">
          <dt>
            {shortRuleName(ruleNames.get(d.ruleId) ?? d.ruleId)}
            <span className="pf-receipt__why">
              {d.ruleId}, {card}
            </span>
          </dt>
          <dd className="fs-t-figure" data-amount-state="ink">
            − {format.money(d.amountCents)}
          </dd>
        </div>
      ))}
      {k.credits.map((c) => (
        <div className="pf-receipt__row" key={c.markId} data-kind="credit">
          <dt>
            Returned to the member
            <span className="pf-receipt__why">
              {markNames.has(c.markId)
                ? `“${markNames.get(c.markId)}” matches no rule on ${card}.`
                : `No rule on ${card} allows it.`}
            </span>
          </dt>
          <dd className="fs-t-figure" data-amount-state="ink">
            + {format.money(c.amountCents)}
          </dd>
        </div>
      ))}
      <div className="pf-receipt__row pf-receipt__row--net">
        <dt>Net {replayed && <span>{payoutStatus({ state, replayed }).statusWord}</span>}</dt>
        <dd className="fs-t-figure" data-amount-state={payoutStatus({ state, replayed }).amountState}>
          {format.money(k.netCents)}
        </dd>
      </div>
    </dl>
  );
}

interface CropPanelProps {
  readonly serial: string;
  readonly slip: SnapshotSlip | null;
  readonly zoom: MotionValue<number>;
  readonly tiles: MotionValue<number>;
  readonly panX: MotionValue<number>;
  readonly panY: MotionValue<number>;
  readonly onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onZoom: (delta: number) => void;
}

/**
 * The slip: evidence, so it is paper with the only shadow and the synthetic glyph. The zoom buttons carry
 * the keys too: with one focused, the arrow keys pan and plus and minus zoom, so nothing needs a drag (WCAG 2.5.7).
 */
function CropPanel({ serial, slip, zoom, tiles, panX, panY, onKey, onZoom }: CropPanelProps) {
  return (
    <div className="pf-crop" data-testid="W-PF-01.trace.crop">
      {slip ? (
        <figure className="fs-paper pf-crop__paper" data-testid="W-PF-01.trace.paper">
          <div className="pf-crop__focus" role="img" aria-label={`${slipAlt(slip)}. Synthetic sample.`}>
            <SlipCrop
              slip={slip}
              zoom={zoom}
              tiles={tiles}
              panX={panX}
              panY={panY}
              testId="W-PF-01.trace.slip"
            />
          </div>
          <figcaption className="fs-paper__tag">
            <LegendGlyph {...HONESTY.syntheticSample} />
          </figcaption>
        </figure>
      ) : (
        <p className="pf-crop__missing">{LINES_COPY.cropMissing(serial)}</p>
      )}
      <div className="pf-crop__controls">
        <button
          type="button"
          className="fs-flat pf-crop__zoom"
          onClick={() => onZoom(-ZOOM_STEP)}
          onKeyDown={onKey}
          data-testid="W-PF-01.trace.zoom-out"
          aria-label={LINES_COPY.zoomOut}
        >
          <ZoomGlyph dir="out" />
        </button>
        <button
          type="button"
          className="fs-flat pf-crop__zoom"
          onClick={() => onZoom(ZOOM_STEP)}
          onKeyDown={onKey}
          data-testid="W-PF-01.trace.zoom-in"
          aria-label={LINES_COPY.zoomIn}
        >
          <ZoomGlyph dir="in" />
        </button>
        <span className="pf-crop__note">{LINES_COPY.cropNote}</span>
      </div>
    </div>
  );
}

/** A masked receiver may wrap after its "@" in a narrow cell ("m***@" over "members…"), never mid-name first. */
function breakAfterAt(receiver: string): ReactNode {
  const at = receiver.indexOf("@");
  if (at < 0) return receiver;
  return (
    <>
      {receiver.slice(0, at + 1)}
      <wbr />
      {receiver.slice(at + 1)}
    </>
  );
}

/**
 * A PayPal status in a table row: the bare word on screen ("Paid"), since the table's micro-tag names the simulated
 * sandbox once (UI gate round 3: never per row); a screen reader still hears the rail on every row, so the text
 * is the whole status ("Paid (Simulated PayPal sandbox)"). A replay keeps its own label in view.
 */
export function RailWord({
  presentation,
}: {
  readonly presentation: Pick<ReturnType<typeof payoutStatus>, "word" | "replayed" | "simulatedLabel">;
}) {
  return (
    <>
      {presentation.word}
      {!presentation.replayed && presentation.simulatedLabel && (
        <span className="fs-sr"> ({presentation.simulatedLabel})</span>
      )}
    </>
  );
}

/** A cash line's status in words: the console's own (one catalog), with no pill (unslop spec §3.12). */
const CASH_WORDS = {
  OFF_RAIL_DUE: translate("en", "console.status.OFF_RAIL_DUE"),
  OFF_RAIL_PAID: translate("en", "console.status.OFF_RAIL_PAID"),
} as const;

interface LineRowsProps {
  readonly replayed?: boolean;
  readonly line: ProofLine;
  readonly state: MemberLineState;
  readonly label: MemberLabel | undefined;
  readonly names: boolean;
  /** Three columns for a phone: the rail under the member, the status under the net. */
  readonly fold: boolean;
  readonly columns: number;
  readonly open: boolean;
  readonly traceId: string;
  readonly onOpen: () => void;
  readonly frame: MotionValue<number>;
  readonly children: ReactNode;
}

function LineRows({
  replayed = false,
  line,
  state,
  label,
  names,
  fold,
  columns,
  open,
  traceId,
  onOpen,
  frame,
  children,
}: LineRowsProps) {
  const presentation = payoutStatus({
    state,
    replayed,
    paypal: line.rail === "PAYPAL" && state !== "OFF_RAIL_DUE" && state !== "OFF_RAIL_PAID",
  });
  const amountState = presentation.amountState;
  const cash = line.rail === "CASH" || state === "OFF_RAIL_DUE" || state === "OFF_RAIL_PAID";
  // The rail in one word: the table's tag names PayPal as the simulated sandbox once, for every row. Cash is a
  // hatch swatch and the word, never a pill.
  const rail = (
    <span className="pf-rail" data-rail={cash ? "cash" : "paypal"}>
      {cash && <span className="pf-rail__swatch" aria-hidden />}
      <span>{cash ? "Cash" : "PayPal"}</span>
    </span>
  );
  const cashWords = state === "OFF_RAIL_PAID" || state === "OFF_RAIL_DUE" ? CASH_WORDS[state] : null;
  const status = cashWords ? (
    <span className="pf-cash-status" data-state={state}>
      {state === "OFF_RAIL_PAID" && <Glyph name="ms:check" size={16} />}
      <span className="fs-t-label">{cashWords}</span>
    </span>
  ) : presentation.simulatedLabel ? (
    <Chip
      tone={presentation.tone}
      glyph={presentation.replayed ? "rail" : presentation.amountState === "landed" ? "ms:check" : "rail"}
    >
      <RailWord presentation={presentation} />
    </Chip>
  ) : (
    <StatusChip state={state} surface="console" />
  );
  const peso = (
    <button
      type="button"
      className="pf-peso"
      aria-expanded={open}
      aria-controls={open ? traceId : undefined}
      aria-label={`${format.money(line.netCents)} for ${line.memberNo}: ${open ? "close" : "see where it comes from"}`}
      onClick={onOpen}
      data-testid={`W-PF-01.peso.${line.memberNo}`}
    >
      {open && <motion.span className="pf-peso__frame" style={{ opacity: frame }} aria-hidden />}
      <span className="fs-t-figure" data-amount-state={amountState}>
        {format.money(line.netCents)}
      </span>
    </button>
  );
  return (
    <>
      <tr
        data-state={presentation.replayed ? "replay" : state}
        data-open={open ? "" : undefined}
        data-testid={`W-PF-01.line.${line.memberNo}`}
      >
        {fold ? (
          <th scope="row">
            <div className="pf-line__who">
              <span className="fs-t-id">{line.memberNo}</span>
              {names && <span className="pf-line__name">{label?.name ?? ""}</span>}
              {names && label?.receiverMasked && (
                <span className="pf-table__receiver pf-line__receiver">
                  {breakAfterAt(label.receiverMasked)}
                </span>
              )}
              {rail}
            </div>
          </th>
        ) : (
          <th scope="row" className="fs-t-id">
            {line.memberNo}
          </th>
        )}
        <td data-numeric="" className="fs-t-figure">
          {format.kg(line.canonical.verifiedG)}
        </td>
        {!fold && <td>{rail}</td>}
        <td data-numeric="">
          {fold ? (
            <div className="pf-line__net">
              {peso}
              {status}
            </div>
          ) : (
            peso
          )}
        </td>
        {!fold && <td>{status}</td>}
      </tr>
      {open && (
        <tr className="pf-lines__trace-row">
          <td colSpan={columns}>{children}</td>
        </tr>
      )}
    </>
  );
}
