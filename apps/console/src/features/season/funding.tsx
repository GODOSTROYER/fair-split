// MM-S, the funded arc (S2.9; register §5 "INVOICE.PAID arc"): when a fresh GET shows Lantern Bay's invoice
// PAID or MARKED_AS_PAID with nothing due, one jade arc draws from the invoice to the pool, the pool turns from
// hollow to solid, and "Funded" closes its inset to jade flush with the season's root note. Motion is
// evidence: only a live `invoice.state` event plays it (its ID is the evidence); a run that was funded before
// this page subscribed simply shows funded, drawn, still. The invoice plate carries Claude's recorded draft in
// pencil: Claude chose the labels, every amount is the code's quote (I1).
//
// UI gate round 3 on the first view (the compact desk): the PayPal money values wear the one micro-tag (the invoice
// always, the pool once the simulated PayPal funds it), the seeded lines a bare legend glyph; the pool is one line,
// "Invoice US$4,333.50 − costs US$60.00 = US$4,273.50", pending grey with a hollow dot until it is funded; the
// invoice's id is the showcase run's until the judge's own run has one.

import { INVOICE_STATUS_LABELS, pickLabel, type SeasonSnapshot } from "@fairsplit/contracts";
import { CurrencyFigure, Glyph, HONESTY, LegendGlyph, MicroTag, StateDot, useT } from "@fairsplit/ui-web";
import { type MotionValue, motion, useMotionValue, useTransform } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { railTag } from "../../chrome/copy.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { Stamp } from "../../chrome/Stamp.js";
import { useJudgeSession, useRunEvents } from "../../data/hooks.js";
import type { RunView } from "../../data/run-view.js";
import { stageInvoice } from "../../lib/display.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { type MomentController, useMoment } from "../../lib/moment.js";
import { provenanceFooter } from "../../lib/provenance.js";
import { FIRST_VIEW_COPY, fundedSource, SEASON_COPY } from "./copy.js";
import { invoiceLines, isFunded, isPaid, poolOf } from "./model.js";
import "./season.css";

export type FundingMoment = MomentController<"MM-S">;

/**
 * The invoice's title in words: the session's own number once it has one ("Draft invoice" before), and before
 * the first press the showcase run's number, labelled as the showcase's (round 3: one id, said for what it is).
 */
export function invoiceTitle(
  snapshot: SeasonSnapshot,
  view: RunView | undefined,
  inSession: boolean,
): string {
  if (inSession) return view?.invoice.number ? SEASON_COPY.invoice(view.invoice.number) : "Draft invoice";
  const id = stageInvoice(snapshot, view, false);
  return id?.note ? `${SEASON_COPY.invoice(id.number)} (${id.note})` : SEASON_COPY.invoice(id?.number ?? "");
}

/** The micro-tag beside a PayPal money value: the simulated sandbox's, or the untested sandbox rail's words. */
function RailMicroTag({ rail, testId }: { readonly rail: PaypalRail; readonly testId?: string }) {
  return <MicroTag label={railTag(rail)} {...(testId ? { testId } : {})} />;
}

/**
 * Plays MM-S on the live `invoice.state` that shows the invoice paid with 0.00 due, and settles straight to
 * "funded" for history (a reload, a run funded before this page subscribed). After Reset it returns to waiting.
 */
export function useFundingMoment(runSlug: string | null, view: RunView | undefined): FundingMoment {
  const moment = useMoment("MM-S", { focal: true });
  const funded = isFunded(view);
  useRunEvents(runSlug, (event, meta) => {
    if (meta.replay || event.type !== "invoice.state") return;
    if (!isPaid(event.payload.to) || event.payload.dueCents !== 0) return;
    moment.play("paid", { eventId: event.id, kind: "sse" });
  });
  const { phase, playing, enter, reset } = moment;
  useEffect(() => {
    if (playing) return;
    if (funded && phase === "waiting") enter("funded");
    if (!funded && phase !== "waiting") reset();
  }, [funded, phase, playing, enter, reset]);
  return moment;
}

type Live = MotionValue<number> | number;

/** The values a funding block draws with: live motion values while MM-S plays, still values otherwise. */
interface FundingValues {
  readonly arc: Live;
  readonly poolSolid: Live;
  readonly inset: Live;
  readonly flood: Live;
}

function fundingValues(moment: FundingMoment, funded: boolean): FundingValues {
  if (moment.playing) {
    return {
      arc: moment.value("arc"),
      poolSolid: moment.value("pool.solid"),
      inset: moment.value("funded.inset"),
      flood: moment.value("funded.flood"),
    };
  }
  return funded ? { arc: 1, poolSolid: 1, inset: 0, flood: 1 } : { arc: 0, poolSolid: 0, inset: 3, flood: 0 };
}

/** A stable motion value that follows either a still number or another motion value. */
function useMirror(source: Live): MotionValue<number> {
  const mirror = useMotionValue(typeof source === "number" ? source : source.get());
  useEffect(() => {
    if (typeof source === "number") {
      mirror.set(source);
      return;
    }
    mirror.set(source.get());
    return source.on("change", (v) => mirror.set(v));
  }, [source, mirror]);
  return mirror;
}

/** A large amount drawn hollow until its money lands, then solid ink (S2.2.1: hollow → landed). */
export function HollowFigure({
  cents,
  solid,
  landed,
  typeRole,
  testId,
  anchor,
}: {
  readonly cents: number;
  /** How much of the solid layer shows over the outline (MM-S drives it from 0 to 1). */
  readonly solid: Live;
  /** The amount's state: it lands when its event says so, whatever the motion is doing. */
  readonly landed: boolean;
  readonly typeRole: "amount-l" | "amount-hero";
  readonly testId?: string;
  readonly anchor?: RefObject<HTMLSpanElement | null>;
}) {
  const display = format.money(cents);
  const mirror = useMirror(solid);
  // Landed and filled, the amount reads as money: a third layer in FS Sans's proportional figures (a plain zero)
  // cross-fades in over the hollow cut, whose figures are tabular with the slashed zero (ADR-0016, decision §7).
  const hasLanded = useMirror(landed ? 1 : 0);
  const ink = useTransform([mirror, hasLanded], ([v, l]) =>
    (l as number) >= 1 && (v as number) >= 1 ? 1 : 0,
  );
  const cut = useTransform(ink, (v) => 1 - v);
  return (
    <span className="fsc-figure" data-amount-state={landed ? "landed" : "hollow"} data-testid={testId}>
      <span className="fs-sr">{format.amountSpoken(cents, "en")}</span>
      <span ref={anchor} className={`fsc-figure__digits fs-t-${typeRole}`} aria-hidden>
        <motion.span className="fsc-figure__cut" style={{ opacity: cut }}>
          <span className="fsc-figure__hollow">
            <CurrencyFigure display={display} />
          </span>
          <motion.span className="fsc-figure__solid" style={{ opacity: mirror }}>
            <CurrencyFigure display={display} />
          </motion.span>
        </motion.span>
        <motion.span className="fsc-figure__ink" style={{ opacity: ink }}>
          <CurrencyFigure display={display} />
        </motion.span>
      </span>
    </span>
  );
}

/** An inline amount: hollow is the pending grey (never dashed: dashed means simulated); landed is ink (S2.2.1). */
function InlineAmount({
  cents,
  landed,
  testId,
}: {
  readonly cents: number;
  readonly landed: boolean;
  readonly testId?: string;
}) {
  return (
    <span
      className="fsc-inline-amount fs-t-figure"
      data-amount-state={landed ? "landed" : "hollow"}
      data-testid={testId}
    >
      {format.money(cents)}
    </span>
  );
}

/** "Funded" takes PayPal's press: its 3 px inset closes to flush and jade floods it from the corner. */
function FundedMark({
  inset,
  flood,
  testId,
}: {
  readonly inset: Live;
  readonly flood: Live;
  readonly testId: string;
}) {
  const t = useMirror(inset);
  const f = useMirror(flood);
  const face = useTransform(t, (v) => `translate(${3 - v}px, ${3 - v}px)`);
  const edgeR = useTransform(t, (v) => `translate(${3 - v}px, ${3 - v}px) skewY(45deg) scaleX(${v / 3})`);
  const edgeB = useTransform(t, (v) => `translate(${3 - v}px, ${3 - v}px) skewX(45deg) scaleY(${v / 3})`);
  const floodScale = useTransform(f, (v) => `scale(${v})`);
  const floodOpacity = useTransform(f, (v) => (v > 0 ? 1 : 0));
  return (
    <span className="fsc-funded" data-testid={testId} role="status">
      <motion.span
        className="fsc-funded__edge fsc-funded__edge--r"
        aria-hidden
        style={{ transform: edgeR }}
      />
      <motion.span
        className="fsc-funded__edge fsc-funded__edge--b"
        aria-hidden
        style={{ transform: edgeB }}
      />
      <motion.span className="fsc-funded__face" style={{ transform: face }}>
        <motion.span
          className="fsc-funded__flood"
          aria-hidden
          style={{ transform: floodScale, opacity: floodOpacity }}
        />
        <span className="fsc-funded__label fs-t-label">
          <Glyph name="ms:check" size={16} />
          {SEASON_COPY.funded}
        </span>
      </motion.span>
    </span>
  );
}

/** A quadratic arc between two elements, in the container's coordinates (no layout in jsdom: no path). */
function useArcPath(
  container: RefObject<HTMLElement | null>,
  from: RefObject<HTMLElement | null>,
  to: RefObject<HTMLElement | null>,
): string | null {
  const [d, setD] = useState<string | null>(null);
  const measure = useCallback(() => {
    const c = container.current?.getBoundingClientRect();
    const a = from.current?.getBoundingClientRect();
    const b = to.current?.getBoundingClientRect();
    if (!c || !a || !b || c.width === 0 || a.width === 0 || b.width === 0) {
      setD(null);
      return;
    }
    // Side by side: from the invoice amount's right end over to the pool amount's left end, the control point
    // 40 px up. Stacked: down the left margin, from the invoice amount to the pool amount, bowing 40 px left.
    const layout = b.top > a.bottom + 16 ? "column" : "row";
    const start =
      layout === "row"
        ? { x: a.right - c.left + 12, y: a.top + a.height * 0.55 - c.top }
        : { x: a.left - c.left - 12, y: a.top + a.height * 0.55 - c.top };
    const end =
      layout === "row"
        ? { x: b.left - c.left - 12, y: b.top + b.height * 0.55 - c.top }
        : { x: b.left - c.left - 12, y: b.top + b.height * 0.55 - c.top };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const control =
      layout === "row"
        ? { x: mid.x, y: Math.min(start.y, end.y) - 40 }
        : { x: Math.min(start.x, end.x) - 40, y: mid.y };
    const r = (n: number) => Math.round(n * 10) / 10;
    setD(`M${r(start.x)} ${r(start.y)} Q${r(control.x)} ${r(control.y)} ${r(end.x)} ${r(end.y)}`);
  }, [container, from, to]);
  useLayoutEffect(() => {
    measure();
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, measure]);
  return d;
}

export interface FundingBlockProps {
  readonly snapshot: SeasonSnapshot;
  readonly view: RunView | undefined;
  readonly moment: FundingMoment;
  readonly rail: PaypalRail;
  /**
   * Invoice beside the pool (W-TR-01), above it, or the Judge stage's desk: the invoice on the left, the pool as
   * one compact strip on the right, and `desk` (the paper) under the strip, beside the invoice.
   */
  readonly layout: "row" | "column" | "desk";
  /** `{screenId}` for test hooks. */
  readonly screen: "W-TR-01" | "W-JG-01";
  /** Placed on the invoice plate, under its draft: the first view's single slab. */
  readonly action?: ReactNode;
  /** The invoice total's size: the hero cut on the first view. */
  readonly totalRole?: "amount-l" | "amount-hero";
  /** The first view's denser plate: the memo in one caption, the slab right under Claude's draft. */
  readonly compact?: boolean;
  /** The desk layout's paper, beside the invoice and under the pool. */
  readonly desk?: ReactNode;
}

/** The invoice Claude drafted and code checked, the arc, and the pool it funds. */
export function FundingBlock({
  snapshot,
  view,
  moment,
  rail,
  layout,
  screen,
  action,
  totalRole = "amount-l",
  compact = false,
  desk,
}: FundingBlockProps) {
  const t = useT();
  const session = useJudgeSession();
  const container = useRef<HTMLElement>(null);
  const attachMomentRoot = moment.rootProps.ref;
  const containerRef = useCallback(
    (node: HTMLElement | null) => {
      container.current = node;
      const detach = attachMomentRoot(node);
      return () => {
        detach?.();
        if (container.current === node) container.current = null;
      };
    },
    [attachMomentRoot],
  );
  const from = useRef<HTMLSpanElement>(null);
  const to = useRef<HTMLSpanElement>(null);
  const d = useArcPath(container, from, to);
  const funded = isFunded(view);
  const values = fundingValues(moment, funded);
  const lines = invoiceLines(snapshot);
  const pool = poolOf(snapshot);
  const invoice = snapshot.run.invoice;
  const status = view?.invoice.status ?? null;
  // State lands with the event (S1.6: only the motion waits); MM-S draws the arc and fills the outline after it.
  const landed = funded;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER");
  const recorded = format.dateShort(snapshot.run.recordedOn);
  const statusWord = status ? pickLabel(INVOICE_STATUS_LABELS[status], "en") : SEASON_COPY.waiting;
  const arc = typeof values.arc === "number" ? null : values.arc;
  // When the invoice read back as paid: the funded tag's time (compact).
  const paidAt = view?.events.find(
    (event) =>
      event.type === "invoice.state" &&
      (event.payload.to === "PAID" || event.payload.to === "MARKED_AS_PAID"),
  )?.at;
  const draftBody = (
    <>
      <dl className="fsc-fund__lines">
        {lines.map((line) => (
          <div key={line.key} className="fsc-fund__line">
            <dt className="fsc-fund__pencil">{line.label}</dt>
            <dd className="fsc-fund__pencil fs-t-figure" data-amount-state="pencil">
              {format.money(line.cents)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="fsc-fund__note fs-t-caption">{SEASON_COPY.invoiceLinesNote(recorded)}</p>
    </>
  );
  const memo = t("W-TR-01.invoice.memo", {
    season: snapshot.season.label,
    hash: format.hashGroups(snapshot.rateCard.sha256),
    lot: snapshot.lot.lotCode,
  });
  // The first view's invoice id: the session's own run's once it has one, else the showcase's, labelled (round 3).
  const inSession = session.session !== null;
  const shownId = inSession ? null : stageInvoice(snapshot, view, false);
  // The pool as one line only when the line is true: invoice minus the payout costs is the pool, to the cent.
  const balanced = invoice.amountCents - pool.disbursementCents === pool.poolCents;
  const fundedSourceTitle = `${fundedSource(rail)} ${provenanceFooter({
    kind: "paypal",
    source: "status_check",
    rail,
    provenance: view?.invoice.provenance,
  })}`;
  return (
    <section
      className="fsc-fund"
      data-layout={layout}
      data-compact={compact ? "" : undefined}
      data-testid={`${screen}.funding`}
      aria-label={SEASON_COPY.arcCaption}
      {...moment.rootProps}
      ref={containerRef}
    >
      <article
        className="fsc-fund__plate fsc-fund__invoice"
        data-testid={`${screen}.invoice`}
        data-state={funded ? "funded" : "waiting"}
        aria-labelledby={`${screen}-invoice-title`}
      >
        <header className="fsc-fund__head">
          <h2 id={`${screen}-invoice-title`} className="fsc-fund__title fs-t-label">
            <Glyph name="triplicate-slip" size={18} />
            {compact ? (
              <>
                {FIRST_VIEW_COPY.invoice}
                <span className="fsc-fund__number fs-t-micro" data-testid={`${screen}.invoice.id`}>
                  {inSession ? (view?.invoice.number ?? "draft") : (shownId?.number ?? invoice.invoiceNumber)}
                  {shownId?.note ? <span className="fsc-fund__id-note">{` · ${shownId.note}`}</span> : null}
                </span>
              </>
            ) : (
              invoiceTitle(snapshot, view, inSession)
            )}
          </h2>
          {/* On the first view the heading says where the invoice is ("Invoice sent."): the status stays for
              assistive technology and the arc's table, not as a second line of words. */}
          <span
            className={compact ? "fs-sr" : "fsc-fund__status fs-t-caption"}
            data-state={funded ? "funded" : "waiting"}
            data-testid={`${screen}.invoice.status`}
          >
            {statusWord}
          </span>
        </header>
        <div className="fsc-fund__total">
          <span className="fsc-fund__muted fs-t-label">{SEASON_COPY.invoiceTotal}</span>
          {/* The arc starts after the amount and its tag (compact), never through the tag. */}
          <span className="fsc-fund__figure-row" ref={compact ? from : undefined}>
            <HollowFigure
              cents={invoice.amountCents}
              solid={funded ? 1 : 0}
              landed={funded}
              typeRole={totalRole}
              {...(compact ? {} : { anchor: from })}
              testId={`${screen}.invoice.amount`}
            />
            {compact && <RailMicroTag rail={rail} testId={`${screen}.invoice.tag`} />}
          </span>
          {compact ? (
            <span className="fsc-fund__estimate fs-t-micro" title={invoice.pesoEstimate}>
              {invoice.pesoEstimate.replace(/^about /, "≈ ").replace(/ \(estimate\)$/, "")}
            </span>
          ) : (
            <span className="fsc-fund__estimate fs-t-caption">{invoice.pesoEstimate}</span>
          )}
        </div>
        {action && compact && (
          <div className="fsc-fund__action" data-place="lead">
            {action}
          </div>
        )}
        {compact ? (
          // The first view folds the invoice's lines (the pool strip beside it shows the same three figures) under
          // their provenance, which stays in view: "Invoice lines (seeded sample)".
          <details
            className="fsc-fund__draft"
            data-provenance="seeded"
            data-testid={`${screen}.invoice.draft`}
          >
            <summary className="fsc-fund__draft-head fs-t-label">
              <Glyph name="pencil" size={16} />
              {SEASON_COPY.invoiceLines.replace(/ \(seeded sample\)$/, "")}
              <LegendGlyph {...HONESTY.seededSample} testId={`${screen}.invoice.draft.mark`} />
              <Glyph name="ms:expand-more" size={18} />
            </summary>
            {draftBody}
            <p className="fsc-fund__memo fs-t-micro">
              {`${memo} · ${t("W-TR-01.invoice.autoCancel", { date: format.date(invoice.autoCancelOn) })}`}
            </p>
          </details>
        ) : (
          <div className="fsc-fund__draft" data-provenance="seeded" data-testid={`${screen}.invoice.draft`}>
            <p className="fsc-fund__draft-head fs-t-label">
              <Glyph name="pencil" size={16} />
              {SEASON_COPY.invoiceLines}
            </p>
            {draftBody}
          </div>
        )}
        {compact ? null : (
          <dl className="fsc-fund__meta fs-t-caption">
            <div>
              <dt className="fs-sr">Memo</dt>
              <dd>{memo}</dd>
            </div>
            <div>
              <dt className="fs-sr">Auto-cancel</dt>
              <dd>{t("W-TR-01.invoice.autoCancel", { date: format.date(invoice.autoCancelOn) })}</dd>
            </div>
            {treasurer && (
              <div className="fsc-fund__sent">
                <dt className="fs-sr">Sent by</dt>
                <dd>
                  <Stamp
                    stamp={{
                      initials: treasurer.initials,
                      name: treasurer.name,
                      at: format.date(invoice.invoiceDate),
                    }}
                  />
                  <span>{t("W-TR-01.invoice.drafted")}</span>
                </dd>
              </div>
            )}
          </dl>
        )}
        {action && !compact && <div className="fsc-fund__action">{action}</div>}
      </article>

      <Mirrored
        testId={`${screen}.arc`}
        className="fsc-fund__arc"
        visual={
          d ? (
            <svg className="fsc-fund__arc-svg" aria-hidden focusable="false">
              {arc ? (
                <motion.path d={d} className="fsc-fund__arc-path" style={{ pathLength: arc }} />
              ) : values.arc === 1 ? (
                <path d={d} className="fsc-fund__arc-path" />
              ) : null}
            </svg>
          ) : null
        }
        table={
          <DataTable
            caption={SEASON_COPY.arcCaption}
            testId={`${screen}.arc.table`}
            columns={[
              { key: "item", label: "Item" },
              { key: "amount", label: "Amount", numeric: true },
              { key: "status", label: "Status" },
            ]}
            rows={[
              {
                key: "invoice",
                cells: {
                  item: invoiceTitle(snapshot, view, session.session !== null),
                  amount: format.money(invoice.amountCents),
                  status: statusWord,
                },
              },
              {
                key: "pool",
                cells: {
                  item: SEASON_COPY.poolShare(snapshot.figures.members),
                  amount: format.money(pool.poolCents),
                  status: funded ? SEASON_COPY.funded : SEASON_COPY.waiting,
                },
              },
            ]}
          />
        }
      />

      <article
        className="fsc-fund__plate fsc-fund__pool"
        data-variant={layout === "desk" ? "strip" : "plate"}
        data-testid={`${screen}.pool`}
        data-state={landed ? "landed" : "hollow"}
        aria-labelledby={`${screen}-pool-title`}
      >
        <header className="fsc-fund__head">
          <h2 id={`${screen}-pool-title`} className="fsc-fund__title fs-t-label">
            <Glyph name="sack" size={18} />
            {layout === "desk" ? FIRST_VIEW_COPY.pool : SEASON_COPY.pool}
            {layout === "desk" && (
              <span
                className="fsc-fund__share fs-t-micro"
                title={SEASON_COPY.poolShare(snapshot.figures.members)}
              >
                {FIRST_VIEW_COPY.members(snapshot.figures.members)}
              </span>
            )}
          </h2>
          {(funded || moment.playing) && (
            <span className="fsc-fund__head-end">
              {funded && compact && (
                // When the simulated PayPal's status check read the invoice paid: its time, the words in its title.
                <span
                  className="fsc-fund__checked fs-t-micro"
                  title={fundedSourceTitle}
                  data-testid={`${screen}.funded.source`}
                >
                  {[FIRST_VIEW_COPY.statusCheck, paidAt ? format.time(paidAt) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              <FundedMark inset={values.inset} flood={values.flood} testId={`${screen}.funded`} />
            </span>
          )}
        </header>
        {layout === "desk" && balanced ? (
          // The desk's pool as one line (round 3): the invoice, minus the payout costs, is the pool. Until the
          // simulated PayPal funds it the pool is pending (grey, a hollow dot); then ink, with the one micro-tag.
          <p
            className="fsc-fund__eq"
            data-state={landed ? "landed" : "pending"}
            data-testid={`${screen}.pool.eq`}
          >
            <span className="fs-sr">
              {FIRST_VIEW_COPY.eqSpoken(
                format.money(invoice.amountCents),
                format.money(pool.disbursementCents),
              )}
            </span>
            <span className="fsc-fund__eq-terms" aria-hidden>
              {/* The arc lands on the invoice's own amount here: the money that funds the pool. */}
              <span className="fsc-fund__eq-term" ref={to}>
                <span className="fsc-fund__eq-word">{FIRST_VIEW_COPY.eqInvoice}</span>
                <InlineAmount cents={invoice.amountCents} landed={landed} />
              </span>
              <span className="fsc-fund__eq-op">−</span>
              <span className="fsc-fund__eq-term">
                <span className="fsc-fund__eq-word">{FIRST_VIEW_COPY.eqCosts}</span>
                <InlineAmount
                  cents={pool.disbursementCents}
                  landed={landed}
                  testId={`${screen}.pool.disbursement`}
                />
              </span>
            </span>
            <span className="fsc-fund__eq-result">
              <span className="fsc-fund__eq-op" aria-hidden>
                =
              </span>
              {!landed && <StateDot kind="pending" />}
              <HollowFigure
                cents={pool.poolCents}
                solid={values.poolSolid}
                landed={landed}
                typeRole="amount-l"
                testId={`${screen}.pool.amount`}
              />
              {landed && compact && <RailMicroTag rail={rail} testId={`${screen}.pool.tag`} />}
            </span>
          </p>
        ) : layout === "desk" ? (
          // The desk's strip: the pool's total and its three parts on one line, so the paper sits high.
          <div className="fsc-fund__strip">
            <HollowFigure
              cents={pool.poolCents}
              solid={values.poolSolid}
              landed={landed}
              typeRole="amount-l"
              anchor={to}
              testId={`${screen}.pool.amount`}
            />
            <dl className="fsc-fund__parts">
              <div className="fsc-fund__part">
                <dt>
                  {SEASON_COPY.premium}
                  <Glyph name="ms:lock" size={12} label={SEASON_COPY.premiumNote} />
                </dt>
                <dd>
                  <InlineAmount cents={pool.premiumCents} landed={landed} testId={`${screen}.pool.premium`} />
                </dd>
              </div>
              <div className="fsc-fund__part">
                <dt>{SEASON_COPY.bonus}</dt>
                <dd>
                  <InlineAmount cents={pool.bonusCents} landed={landed} testId={`${screen}.pool.bonus`} />
                </dd>
              </div>
              <div className="fsc-fund__part" data-aside="">
                <dt>{SEASON_COPY.disbursement}</dt>
                <dd>
                  <InlineAmount
                    cents={pool.disbursementCents}
                    landed={landed}
                    testId={`${screen}.pool.disbursement`}
                  />
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <div className="fsc-fund__total">
              <span className="fsc-fund__muted fs-t-label">
                {SEASON_COPY.poolShare(snapshot.figures.members)}
              </span>
              <HollowFigure
                cents={pool.poolCents}
                solid={values.poolSolid}
                landed={landed}
                typeRole="amount-l"
                anchor={to}
                testId={`${screen}.pool.amount`}
              />
            </div>
            <dl className="fsc-fund__lines fsc-fund__lines--pool">
              <div className="fsc-fund__line">
                <dt>
                  <span className="fsc-fund__pool-label">
                    {SEASON_COPY.premium}
                    <Glyph name="ms:lock" size={14} label="Protected" />
                  </span>
                  <span className="fs-t-caption fsc-fund__muted">{SEASON_COPY.premiumNote}</span>
                </dt>
                <dd>
                  <InlineAmount cents={pool.premiumCents} landed={landed} testId={`${screen}.pool.premium`} />
                </dd>
              </div>
              <div className="fsc-fund__line">
                <dt>{SEASON_COPY.bonus}</dt>
                <dd>
                  <InlineAmount cents={pool.bonusCents} landed={landed} testId={`${screen}.pool.bonus`} />
                </dd>
              </div>
              <div className="fsc-fund__line fsc-fund__line--aside">
                <dt>
                  <span>{SEASON_COPY.disbursement}</span>
                  <span className="fs-t-caption fsc-fund__muted">{SEASON_COPY.disbursementNote}</span>
                </dt>
                <dd>
                  <InlineAmount
                    cents={pool.disbursementCents}
                    landed={landed}
                    testId={`${screen}.pool.disbursement`}
                  />
                </dd>
              </div>
            </dl>
          </>
        )}
        {funded && !compact && (
          <p className="fsc-fund__source fs-t-caption" data-testid={`${screen}.funded.source`}>
            {fundedSource(rail)}{" "}
            <span className="fsc-fund__muted">
              {provenanceFooter({
                kind: "paypal",
                source: "status_check",
                rail,
                provenance: view?.invoice.provenance,
              })}
            </span>
          </p>
        )}
      </article>

      {layout === "desk" && desk && <div className="fsc-fund__desk">{desk}</div>}
    </section>
  );
}
