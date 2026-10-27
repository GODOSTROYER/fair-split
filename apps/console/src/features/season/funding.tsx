// MM-S, the funded arc (S2.9; register §5 "INVOICE.PAID arc"): when a fresh GET shows Lantern Bay's invoice
// PAID or MARKED_AS_PAID with nothing due, one jade arc draws from the invoice to the pool, the pool turns from
// hollow to solid, and "Funded" closes its inset to jade flush with the season's root note. Motion is
// evidence: only a live `invoice.state` event plays it (its ID is the evidence); a run that was funded before
// this page subscribed simply shows funded, drawn, still. The invoice plate carries Claude's recorded draft in
// pencil: Claude chose the labels, every amount is the code's quote (I1).

import { INVOICE_STATUS_LABELS, pickLabel, type SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph, InkStamp, useT } from "@fairsplit/ui-web";
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
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { useRunEvents } from "../../data/hooks.js";
import type { RunView } from "../../data/run-view.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { type MomentController, useMoment } from "../../lib/moment.js";
import { provenanceFooter } from "../../lib/provenance.js";
import { fundedSource, SEASON_COPY } from "./copy.js";
import { invoiceLines, isFunded, isPaid, poolOf } from "./model.js";
import "./season.css";

export type FundingMoment = MomentController<"MM-S">;

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
  return (
    <span className="fsc-figure" data-amount-state={landed ? "landed" : "hollow"} data-testid={testId}>
      <span className="fs-sr">{format.amountSpoken(cents, "en")}</span>
      <span ref={anchor} className={`fsc-figure__digits fs-t-${typeRole}`} aria-hidden>
        <span className="fsc-figure__hollow">{display}</span>
        <motion.span className="fsc-figure__solid" style={{ opacity: mirror }}>
          {display}
        </motion.span>
      </span>
    </span>
  );
}

/** An inline amount: hollow is ink-2 with a dashed underline; landed is ink (S2.2.1, under 28 px). */
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
  /** Invoice beside the pool (W-TR-01) or above it (the Judge stage's first view). */
  readonly layout: "row" | "column";
  /** `{screenId}` for test hooks. */
  readonly screen: "W-TR-01" | "W-JG-01";
  /** Placed on the invoice plate, under its draft: the first view's single slab. */
  readonly action?: ReactNode;
  /** The invoice total's size: the hero cut on the first view. */
  readonly totalRole?: "amount-l" | "amount-hero";
  /** The first view's denser plate: the memo in one caption, the slab right under Claude's draft. */
  readonly compact?: boolean;
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
}: FundingBlockProps) {
  const t = useT();
  const container = useRef<HTMLElement>(null);
  const from = useRef<HTMLSpanElement>(null);
  const to = useRef<HTMLSpanElement>(null);
  const d = useArcPath(container, from, to);
  const funded = isFunded(view);
  const values = fundingValues(moment, funded);
  const lines = invoiceLines(snapshot);
  const pool = poolOf(snapshot);
  const invoice = snapshot.run.invoice;
  const number = view?.invoice.number ?? invoice.invoiceNumber;
  const status = view?.invoice.status ?? null;
  // State lands with the event (S1.6: only the motion waits); MM-S draws the arc and fills the outline after it.
  const landed = funded;
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER");
  const recorded = format.dateShort(snapshot.run.recordedOn);
  const statusWord = status ? pickLabel(INVOICE_STATUS_LABELS[status], "en") : SEASON_COPY.waiting;
  const arc = typeof values.arc === "number" ? null : values.arc;
  const memo = t("W-TR-01.invoice.memo", {
    season: snapshot.season.label,
    hash: format.hashGroups(snapshot.rateCard.sha256),
    lot: snapshot.lot.lotCode,
  });
  return (
    <section
      ref={container}
      className="fsc-fund"
      data-layout={layout}
      data-compact={compact ? "" : undefined}
      data-testid={`${screen}.funding`}
      aria-label={SEASON_COPY.arcCaption}
      {...moment.rootProps}
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
            {SEASON_COPY.invoice(number)}
          </h2>
          <span
            className="fsc-fund__status fs-t-caption"
            data-state={funded ? "funded" : "waiting"}
            data-testid={`${screen}.invoice.status`}
          >
            {statusWord}
          </span>
        </header>
        <div className="fsc-fund__total">
          <span className="fsc-fund__muted fs-t-label">{SEASON_COPY.invoiceTotal}</span>
          <HollowFigure
            cents={invoice.amountCents}
            solid={funded ? 1 : 0}
            landed={funded}
            typeRole={totalRole}
            anchor={from}
            testId={`${screen}.invoice.amount`}
          />
          <span className="fsc-fund__estimate fs-t-caption">{invoice.pesoEstimate}</span>
        </div>
        {action && compact && (
          <div className="fsc-fund__action" data-place="lead">
            {action}
          </div>
        )}
        <div className="fsc-fund__draft" data-provenance="claude" data-testid={`${screen}.invoice.draft`}>
          <p className="fsc-fund__draft-head fs-t-label">
            <Glyph name="pencil" size={16} />
            {SEASON_COPY.draftBy}
          </p>
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
          <p className="fsc-fund__note fs-t-caption">{SEASON_COPY.draftNote(recorded)}</p>
        </div>
        {compact ? (
          <p className="fsc-fund__memo fs-t-caption">
            {`${memo}. ${t("W-TR-01.invoice.autoCancel", { date: format.date(invoice.autoCancelOn) })}`}
          </p>
        ) : (
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
                  <InkStamp
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
                  item: SEASON_COPY.invoice(number),
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
        data-testid={`${screen}.pool`}
        data-state={landed ? "landed" : "hollow"}
        aria-labelledby={`${screen}-pool-title`}
      >
        <header className="fsc-fund__head">
          <h2 id={`${screen}-pool-title`} className="fsc-fund__title fs-t-label">
            <Glyph name="sack" size={18} />
            {SEASON_COPY.pool}
          </h2>
          {(funded || moment.playing) && (
            <FundedMark inset={values.inset} flood={values.flood} testId={`${screen}.funded`} />
          )}
        </header>
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
        {funded && (
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
    </section>
  );
}
