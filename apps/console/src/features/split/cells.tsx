import { payoutStatus } from "../../data/payout-replay.js";
// SplitGrid's cell renderers (S2.7): pencil and ink values, the kilos-per-tree bar, confidence rings, rule chips,
// the hatched cash cell and the status cell. Rows never hold a slab. A cell washes jade only when PayPal changed
// it (a verified item notice) and pencil only when the engine recomputed it; both wash only for live events,
// never for replayed history. Every amount carries `data-amount-state` (S2.2.1).

import type { SnapshotSlip } from "@fairsplit/contracts";
import type { StampView } from "@fairsplit/ui-web";
import { ConfidenceRing, Glyph, type GlyphName, RuleChip, ruleChipTitle } from "@fairsplit/ui-web";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { ReactNode } from "react";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { duplicateSerial, type HoldNoteRow } from "./HoldNote.js";
import type { RowConfidence, SplitRow, SplitTotals } from "./model.js";
import { en, SPLIT } from "./shared/copy.js";
import { DigitSwap } from "./shared/DigitSwap.js";

/**
 * A line's calculation, opened under it in a narrow grid (UI gate round 3): the columns a narrow container hides
 * (premium, bonus, deductions, credit), as one full-width row. Every figure is the line's own.
 */
export interface DetailRow {
  readonly kind: "detail";
  /** The grid's row ID: the line's member number and ":detail". */
  readonly memberNo: string;
  readonly forMember: string;
  readonly line: SplitRow;
}

/**
 * A grid row: a member's line (opened or not, in a narrow grid), the pinned totals, the inline hold note under H1,
 * or a line's opened calculation (both full-width rows).
 */
export type GridRow =
  | ({ readonly kind: "line"; readonly expanded?: boolean } & SplitRow)
  | ({ readonly kind: "totals" } & SplitTotals & { readonly memberNo: "totals" })
  | HoldNoteRow
  | DetailRow;

export interface GridContext {
  /** Live events may animate; replayed history may not. */
  readonly isLive: (eventId: string | null | undefined) => boolean;
  /** The row's place in the engine-recompute wave, in ms (0 when it did not change). */
  readonly waveDelay: (memberNo: string) => number;
  readonly stamp: (by: string, at: string) => StampView | null;
  /** "1.6": the ratified kilos-per-tree limit. */
  readonly yieldLimit: string;
  /** The premium's per-kg pool rate for the tooltip, console only: "US$0.29523 a kg". */
  readonly premiumRate: string;
  /** The seed's slip for a copy (the H1 note compares the two sheets' fields). */
  readonly slip?: (serial: string, copy: SnapshotSlip["copy"]) => SnapshotSlip | undefined;
  /** A narrow grid opens a line's hidden calculation under it (round 3): set by the grid. */
  readonly toggleDetail?: (memberNo: string) => void;
  /** A rule in a few words, from the card's own terms ("CBU 5% of bonus"): a deduction chip's title (round 5). */
  readonly ruleText?: (ruleId: string) => string | undefined;
}

type Props = CustomCellRendererProps<GridRow, unknown, GridContext>;

const CENTS = (cents: number) => format.amount(cents);

function Cell({
  children,
  wash,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly wash?: {
    readonly cause: "paypal" | "engine";
    readonly key: string;
    readonly delayMs: number;
  } | null;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <span
      className={["fsr-cell", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-wash={wash?.cause}
    >
      {wash && (
        <span
          key={wash.key}
          className="fsr-cell__wash"
          data-cause={wash.cause}
          style={{ animationDelay: `${wash.delayMs}ms` }}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/** The wash a live change earns: jade only for PayPal's word, pencil only for the engine's recompute. */
function statusWash(row: SplitRow, ctx: GridContext) {
  if (row.replayed) return null;
  if (!row.statusEventId || row.statusCause !== "paypal" || !ctx.isLive(row.statusEventId)) return null;
  return { cause: "paypal" as const, key: row.statusEventId, delayMs: 0 };
}

function amountWash(row: SplitRow, ctx: GridContext) {
  const paypal = statusWash(row, ctx);
  if (paypal) return paypal;
  const delay = ctx.waveDelay(row.memberNo);
  if (!row.amountsEventId || delay <= 0 || !ctx.isLive(row.amountsEventId)) return null;
  return { cause: "engine" as const, key: row.amountsEventId, delayMs: delay };
}

// ------------------------------------------------------------------------------------------------ member

export function MemberCell({ data }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    // The footer says what its Net figure is (round 3): the members' net total, over its lines.
    return (
      <Cell className="fsr-cell--member">
        <span className="fsr-member">
          <span className="fsr-member__name fs-t-label">{SPLIT.totalsLabel}</span>
          <span className="fsr-member__meta fs-t-micro">{SPLIT.totalsLines(data.lines)}</span>
        </span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--member" testId={`W-TR-05.row.${data.memberNo}`}>
      <span className="fsr-member">
        <span className="fsr-member__name fs-t-body">{data.name}</span>
        <span className="fsr-member__meta fs-t-id">{data.memberNo}</span>
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ slips

/**
 * How a serial on this line twice reads (UI gate round 4): while its hold is open, "0457 ×2" in a 1 px outline with
 * ink words (pink belongs to the D copy's own swatch, never a chip); once counted once, "0457 counted once" in
 * neutral ink; once decided as two deliveries, "0457 ×2" in neutral ink.
 */
export function duplicateLook(
  row: Pick<SplitRow, "slips" | "holds">,
): { readonly serial: string; readonly state: "open" | "once" | "twice" } | null {
  const serial = duplicateSerial(row.slips);
  if (!serial) return null;
  const hold = row.holds.find((h) => h.kind === "DUPLICATE_SLIP");
  if (hold?.state === "RESOLVED" && hold.resolution === "COUNT_ONCE") return { serial, state: "once" };
  if (hold?.state === "RESOLVED") return { serial, state: "twice" };
  return { serial, state: "open" };
}

/**
 * The slip count alone (UI gate round 3: no 30 px thumbnails, which read as noise at row height), and the duplicate
 * badge only where a serial sits on the line twice.
 */
export function SlipsCell({ data }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data || data.kind === "totals") return null;
  const dup = duplicateLook(data);
  return (
    <Cell className="fsr-cell--slips">
      <span className="fsr-slips">
        <span className="fsr-slips__count fs-t-figure" aria-hidden>
          {data.slips.length}
        </span>
        <span className="fs-sr">{SPLIT.slipCount(data.slips.length)}</span>
        {dup && (
          <span
            className="fsr-dupchip fs-t-caption"
            data-state={dup.state}
            data-testid={`W-TR-05.dup.${data.memberNo}`}
          >
            {dup.state === "once" ? SPLIT.countedOnce(dup.serial) : SPLIT.countedTwice(dup.serial)}
          </span>
        )}
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ kilos

/**
 * Verified kilos as a number column, right-aligned (UI gate round 4: the per-tree micro-bars had no scale, so they
 * went). A line over the per-tree limit says so in its hold's note under it (H2), never stacked in this cell.
 */
export function KgCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") return null;
  // Verified kilos are the engine's figure, like the money beside them: pencil until the two keys turn it to ink.
  return (
    <Cell className="fsr-cell--kg">
      <span
        className="fsr-kg__value fs-t-figure"
        data-amount-state={data.partsState}
        title={SPLIT.perTreeTitle(data.kgPerTree, data.trees, context.yieldLimit)}
      >
        {format.kgNumber(data.verifiedG)}
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ confidence

function ConfidenceBody({
  confidence,
  ctx,
}: {
  readonly confidence: RowConfidence;
  readonly ctx: GridContext;
}) {
  switch (confidence.kind) {
    case "score":
      return (
        <span className="fsr-conf">
          <ConfidenceRing confidence={confidence.score} />
          <span className="fs-t-figure">{confidence.score.toFixed(2)}</span>
        </span>
      );
    case "you":
      return (
        <span className="fs-you fsr-conf__you" data-amount-state="you">
          <span className="fs-you__value fs-t-figure">
            {confidence.score === null ? SPLIT.byHand : confidence.score.toFixed(2)}
          </span>
          <span className="fs-you__tag">{en("you.tag")}</span>
        </span>
      );
    case "by-hand": {
      const stamp = ctx.stamp(confidence.by, confidence.at);
      return (
        <span className="fsr-conf fsr-conf--hand">
          {stamp && <Stamp stamp={stamp} />}
          <span className="fs-t-caption">{SPLIT.byHand}</span>
        </span>
      );
    }
    case "unknown":
      return (
        <span className="fsr-conf fsr-conf--unknown fs-t-caption" title={SPLIT.confidenceUnknown}>
          <span aria-hidden>—</span>
          <span className="fs-sr">{SPLIT.confidenceUnknown}</span>
        </span>
      );
  }
}

export function ConfidenceCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data || data.kind === "totals") return null;
  return (
    <Cell className="fsr-cell--conf">
      <ConfidenceBody confidence={data.confidence} ctx={context} />
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ money

function Part({
  cents,
  state,
  row,
  ctx,
  testId,
}: {
  readonly cents: number;
  readonly state: "pencil" | "ink";
  readonly row: SplitRow;
  readonly ctx: GridContext;
  readonly testId?: string;
}) {
  return (
    <span className="fsr-amount fs-t-figure" data-amount-state={state} data-testid={testId}>
      <DigitSwap
        value={CENTS(cents)}
        changeKey={row.amountsEventId}
        animate={ctx.isLive(row.amountsEventId) && ctx.waveDelay(row.memberNo) > 0}
        delayMs={ctx.waveDelay(row.memberNo)}
      />
    </span>
  );
}

export function PremiumCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--num">
        <span className="fsr-amount fs-t-figure fsr-amount--total">{CENTS(data.premiumCents)}</span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--num" wash={amountWash(data, context)}>
      <Part cents={data.premiumCents} state={data.partsState} row={data} ctx={context} />
    </Cell>
  );
}

export function BonusCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--num">
        <span className="fsr-amount fs-t-figure fsr-amount--total">{CENTS(data.bonusCents)}</span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--num" wash={amountWash(data, context)}>
      <Part cents={data.bonusCents} state={data.partsState} row={data} ctx={context} />
    </Cell>
  );
}

const CATEGORY_WORD: Readonly<Record<"CBU" | "LOAN" | "ADVANCE", string>> = {
  CBU: en("W-TR-05.kaltas.cbu"),
  LOAN: en("W-TR-05.kaltas.loan"),
  ADVANCE: "Advance",
};

/** A deduction chip reads "CBU −1.37" (round 5: no ids for people); its rule's id and words are its title. */
export function KaltasCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--kaltas">
        <span className="fsr-amount fs-t-figure fsr-amount--total">
          {format.amount(-data.deductionsCents)}
        </span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--kaltas">
      <span className="fsr-kaltas" data-amount-state={data.partsState}>
        {data.deductions.map((d) => {
          const words = context?.ruleText?.(d.ruleId);
          return (
            <RuleChip
              key={`${d.ruleId}-${d.category}`}
              name={CATEGORY_WORD[d.category]}
              amount={format.amount(-d.amountCents)}
              rule={d.ruleId}
              {...(words ? { ruleText: words } : {})}
            />
          );
        })}
      </span>
    </Cell>
  );
}

export function CreditCell({ data }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--num">
        <span className="fsr-amount fs-t-figure fsr-amount--total">
          {data.creditsCents > 0 ? `+${CENTS(data.creditsCents)}` : CENTS(0)}
        </span>
      </Cell>
    );
  }
  if (data.pendingCredit) {
    return (
      <Cell className="fsr-cell--num">
        <span className="fsr-credit fsr-credit--pending fs-t-caption" data-amount-state="you">
          <Glyph name="hanging-scale" size={14} />
          {SPLIT.creditPending(data.pendingCredit.label)}
        </span>
      </Cell>
    );
  }
  if (data.creditsCents === 0) return <Cell className="fsr-cell--num">{null}</Cell>;
  return (
    <Cell className="fsr-cell--num">
      <span
        className="fsr-amount fs-t-figure"
        data-amount-state={data.partsState}
        title={SPLIT.creditReturned}
      >
        +{CENTS(data.creditsCents)}
      </span>
    </Cell>
  );
}

export function NetCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--num fsr-cell--net">
        <span
          className="fsr-amount fs-t-figure fsr-amount--total fsr-amount--net"
          data-testid="W-TR-05.totals.net"
        >
          {CENTS(data.netCents)}
        </span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--num fsr-cell--net" wash={amountWash(data, context)}>
      <span
        className="fsr-amount fs-t-figure fsr-amount--net"
        data-amount-state={data.amountState}
        data-testid={`W-TR-05.net.${data.memberNo}`}
      >
        <DigitSwap
          value={CENTS(data.netCents)}
          changeKey={data.amountsEventId}
          animate={context.isLive(data.amountsEventId) && context.waveDelay(data.memberNo) > 0}
          delayMs={context.waveDelay(data.memberNo)}
        />
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ a line's calculation

/**
 * A narrow grid's first column (round 3): opens the line's hidden calculation under it. The row's own click still
 * opens the line or its hold; this button only shows the parts.
 */
export function ExpandCell({ data, context }: Props) {
  if (data?.kind !== "line") return null;
  const open = data.expanded === true;
  return (
    <Cell className="fsr-cell--expand">
      <button
        type="button"
        className="fsr-expand"
        aria-expanded={open}
        aria-label={SPLIT.showParts(data.name)}
        title={SPLIT.showParts(data.name)}
        data-testid={`W-TR-05.expand.${data.memberNo}`}
        onClick={(event) => {
          event.stopPropagation();
          context?.toggleDetail?.(data.memberNo);
        }}
      >
        <Glyph name={open ? "ms:expand-less" : "ms:expand-more"} size={18} />
      </button>
    </Cell>
  );
}

/** The opened calculation: premium + bonus − each ruled deduction (+ credit) = net, the line's own figures. */
export function DetailView({ detail }: { readonly detail: DetailRow }) {
  const r = detail.line;
  return (
    <dl className="fsr-detail fs-t-caption" data-testid={`W-TR-05.detail.${detail.forMember}`}>
      <div className="fsr-detail__part">
        <dt>{en("W-TR-05.col.premium")}</dt>
        <dd className="fs-t-figure" data-amount-state={r.partsState}>
          {CENTS(r.premiumCents)}
        </dd>
      </div>
      <div className="fsr-detail__part">
        <dt>{en("W-TR-05.col.bonus")}</dt>
        <dd className="fs-t-figure" data-amount-state={r.partsState}>
          +{CENTS(r.bonusCents)}
        </dd>
      </div>
      {r.deductions.map((d) => (
        <div key={`${d.ruleId}-${d.category}`} className="fsr-detail__part">
          <dt title={ruleChipTitle(d.ruleId)}>{CATEGORY_WORD[d.category]}</dt>
          <dd className="fs-t-figure" data-amount-state={r.partsState}>
            {format.amount(-d.amountCents)}
          </dd>
        </div>
      ))}
      {r.creditsCents > 0 && (
        <div className="fsr-detail__part">
          <dt>{SPLIT.creditReturned}</dt>
          <dd className="fs-t-figure" data-amount-state={r.partsState}>
            +{CENTS(r.creditsCents)}
          </dd>
        </div>
      )}
      <div className="fsr-detail__part fsr-detail__part--net">
        <dt>{SPLIT.netColumn}</dt>
        <dd className="fs-t-figure" data-amount-state={r.amountState}>
          {CENTS(r.netCents)}
        </dd>
      </div>
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ rail

export function RailCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data || data.kind === "totals") return null;
  const cash = data.rail === "CASH" || data.movedToCash;
  return (
    <Cell className="fsr-cell--rail" wash={statusWash(data, context)}>
      {cash ? (
        <span className="fsr-rail fsr-rail--cash" data-rail="cash">
          <span className="fs-t-label">{en("cash.word")}</span>
          {data.movedToCash && <span className="fsr-rail__moved fs-t-caption">{SPLIT.movedToCash}</span>}
        </span>
      ) : (
        <span className="fsr-rail fs-t-label" data-rail="paypal">
          PayPal
        </span>
      )}
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ status

type GridTone = "jade" | "canary" | "hatch" | "ink" | "pencil" | "red";

const STATUS_LOOK: Readonly<
  Partial<Record<SplitRow["state"], { readonly tone: GridTone; readonly glyph: GlyphName }>>
> = {
  COMPUTED: { tone: "ink", glyph: "ms:check" },
  READY: { tone: "ink", glyph: "ms:check" },
  HELD: { tone: "canary", glyph: "hanging-scale-fill" },
  EXCLUDED: { tone: "pencil", glyph: "logbook" },
  LOCKED: { tone: "pencil", glyph: "rail" },
  SUBMITTED: { tone: "pencil", glyph: "rail" },
  PAYPAL_PENDING: { tone: "pencil", glyph: "rail" },
  PAID: { tone: "jade", glyph: "ms:check" },
  OFF_RAIL_DUE: { tone: "hatch", glyph: "cash" },
  OFF_RAIL_PAID: { tone: "ink", glyph: "thumbmark" },
  UNCLAIMED: { tone: "canary", glyph: "ms:pause" },
  RETURNED: { tone: "ink", glyph: "ms:arrow-back" },
  REROUTED: { tone: "pencil", glyph: "rail" },
  PAYPAL_HELD: { tone: "canary", glyph: "ms:pause" },
  NEEDS_ACTION: { tone: "red", glyph: "ms:help" },
  REVERSED: { tone: "red", glyph: "ms:restart-alt" },
};

/** The shared helper's presentation of a line's status (words, tone, replay): the grid never decides it alone. */
function linePayout(row: SplitRow) {
  return payoutStatus({
    state: row.state,
    replayed: row.replayed,
    paypal: row.rail === "PAYPAL" && !row.movedToCash,
  });
}

/**
 * A line's status word as the grid shows it. A PayPal-derived word is short ("Paid"): the screen's one honesty tag
 * covers the grid once the batch posts (unslop spec §2.2: one tag per container, never per row), and the label
 * stays in the cell for screen readers (`statusLabel`). A replayed status keeps its whole replay words.
 */
export function statusWords(row: SplitRow): string {
  // Slip 0462's line waits for a person's entry: "By hand" says it whole (round 5: no long tag clipped in the cell).
  if (row.status.kind === "held" && byHandHold(row)) return SPLIT.byHandStatus;
  if (row.status.kind === "held") return SPLIT.held;
  if (row.status.kind === "reserved") return SPLIT.reserved;
  return linePayout(row).word;
}

/** A line held for a field a person enters by hand (slip 0462): its hold's label is the slip's, not an H-tag. */
function byHandHold(row: SplitRow): boolean {
  return row.status.kind !== "line" && row.status.hold.kind === "LOW_CONFIDENCE";
}

/** The simulated rail's label a short PayPal word carries for screen readers, or null. */
export function statusLabel(row: SplitRow): string | null {
  if (row.status.kind !== "line") return null;
  const payout = linePayout(row);
  return payout.simulatedLabel && !payout.replayed ? ` (${payout.simulatedLabel})` : null;
}

/**
 * A line's look: the grid's own glyph and pre-payout tones (a ready line is ink here, not a warning), and for a
 * PayPal-derived status the helper's tone (the grid draws its neutral as ink). Jade is the helper's alone.
 */
function statusLook(row: SplitRow): { readonly tone: GridTone; readonly glyph: GlyphName } {
  const grid = STATUS_LOOK[row.state] ?? { tone: "ink" as const, glyph: "ms:check" as GlyphName };
  const payout = linePayout(row);
  if (!payout.simulatedLabel) return grid;
  return {
    tone: payout.tone === "neutral" ? "ink" : payout.tone,
    glyph: payout.replayed ? "rail" : grid.glyph,
  };
}

export function StatusCell({ data, context }: Props) {
  if (data?.kind === "note" || data?.kind === "detail") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--status">
        {/* The balance check prints once, in words, on the reconciliation line above the grid; the footer keeps
            its glyph, the word for screen readers (round 3: say each fact once). */}
        <span
          className="fsr-status"
          data-tone={data.balanced ? "ink" : "red"}
          data-testid="W-TR-05.totals.balanced"
          title={data.balanced ? SPLIT.balanced : SPLIT.unbalanced}
        >
          <Glyph name={data.balanced ? "ms:check" : "ms:help"} size={16} />
          <span className="fs-sr">{data.balanced ? SPLIT.balanced : SPLIT.unbalanced}</span>
        </span>
      </Cell>
    );
  }
  const look =
    data.status.kind === "held"
      ? { tone: "canary" as const, glyph: "hanging-scale-fill" as GlyphName }
      : data.status.kind === "reserved"
        ? { tone: "canary" as const, glyph: "logbook-fill" as GlyphName }
        : statusLook(data);
  return (
    <Cell className="fsr-cell--status" wash={statusWash(data, context)}>
      <span
        className="fsr-status"
        data-tone={look.tone}
        data-state={data.replayed ? "replay" : data.status.kind === "line" ? data.state : data.status.kind}
        data-testid={`W-TR-05.status.${data.memberNo}`}
      >
        <Glyph name={look.glyph} size={16} />
        <span
          className="fsr-status__text"
          title={data.status.kind === "reserved" ? SPLIT.reservedTitle : undefined}
        >
          <span className="fs-t-label">
            {statusWords(data)}
            {statusLabel(data) && <span className="fs-sr">{statusLabel(data)}</span>}
          </span>
          {data.status.kind !== "line" && !byHandHold(data) && (
            <>
              {" "}
              <span className="fsr-status__hold fs-t-caption">{data.status.hold.label}</span>
            </>
          )}
        </span>
      </span>
    </Cell>
  );
}
