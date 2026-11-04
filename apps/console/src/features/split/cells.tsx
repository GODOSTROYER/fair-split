import { payoutStatus } from "../../data/payout-replay.js";
// SplitGrid's cell renderers (S2.7): pencil and ink values, the kilos-per-tree bar, confidence rings, rule chips,
// the hatched cash cell and the status cell. Rows never hold a slab. A cell washes jade only when PayPal changed
// it (a verified item notice) and pencil only when the engine recomputed it; both wash only for live events,
// never for replayed history. Every amount carries `data-amount-state` (S2.2.1).

import type { SnapshotSlip } from "@fairsplit/contracts";
import type { StampView } from "@fairsplit/ui-web";
import { ConfidenceRing, Glyph, type GlyphName, RuleChip } from "@fairsplit/ui-web";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { ReactNode } from "react";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { duplicateSerial, type HoldNoteRow } from "./HoldNote.js";
import type { RowConfidence, RowSlip, SplitRow, SplitTotals } from "./model.js";
import { en, SPLIT } from "./shared/copy.js";
import { DigitSwap } from "./shared/DigitSwap.js";
import { BALLPOINT, COPY_FILL, FORM_INK, SERIAL_RED } from "./shared/SlipPaper.js";

/** A grid row: a member's line, the pinned totals, or the inline hold note under H1 (a full-width row). */
export type GridRow =
  | ({ readonly kind: "line" } & SplitRow)
  | ({ readonly kind: "totals" } & SplitTotals & { readonly memberNo: "totals" })
  | HoldNoteRow;

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
  /** The seed's slip for a copy, so the slips cell crops the real sheet (its serial and Jessie's entries). */
  readonly slip?: (serial: string, copy: SnapshotSlip["copy"]) => SnapshotSlip | undefined;
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
  if (data?.kind === "note") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--member">
        <span className="fs-t-label">{SPLIT.totalsLines(data.lines)}</span>
      </Cell>
    );
  }
  return (
    <Cell className="fsr-cell--member" testId={`W-TR-05.row.${data.memberNo}`}>
      <span className="fsr-member">
        <span className="fsr-member__name fs-t-label">{data.name}</span>
        <span className="fsr-member__meta fs-t-caption">
          <span>{data.memberNo}</span>
          <span className="fsr-member__lang" title="Statement language">
            {data.lang}
          </span>
        </span>
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ slips

/**
 * A 24 × 18 crop of a slip's top corner, as the sheet is drawn everywhere else: the press's red serial and
 * Jessie's first entries in blue ballpoint on the copy's own paper. It is evidence, so it is paper.
 */
function SlipCrop({ slip, index, sheet }: { slip: RowSlip; index: number; sheet: SnapshotSlip | undefined }) {
  const values = sheet ? [sheet.boxes["1"], sheet.boxes["2"], sheet.boxes["3"]] : ["", "", ""];
  const faint = slip.copy === "PINK_DUPLICATE";
  return (
    <svg
      className="fsr-slips__crop"
      viewBox="112 6 128 96"
      width={24}
      height={18}
      aria-hidden="true"
      focusable="false"
      data-copy={slip.copy}
      style={{ ["--i" as string]: String(index) }}
    >
      <rect x={0} y={0} width={240} height={300} fill={COPY_FILL[slip.copy]} />
      <text x={226} y={30} textAnchor="end" fill={SERIAL_RED} opacity={faint ? 0.7 : 0.95} fontSize={22}>
        {slip.serial}
      </text>
      <line x1={112} x2={226} y1={44} y2={44} stroke={FORM_INK} strokeWidth={1.5} opacity={0.6} />
      {values.map((value, i) => (
        <g key={`${i}-${value}`}>
          <line
            x1={112}
            x2={226}
            y1={65 + i * 22}
            y2={65 + i * 22}
            stroke={FORM_INK}
            strokeWidth={1}
            opacity={0.5}
          />
          <text x={118} y={62 + i * 22} fill={BALLPOINT} opacity={faint ? 0.62 : 0.94} fontSize={16}>
            {value || "—"}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SlipsCell({ data, context }: Props) {
  if (data?.kind === "note") return null;
  if (!data || data.kind === "totals") return null;
  const shown = data.slips.slice(0, 3);
  // The carbon-copy chip: a serial on this line twice (the pink duplicate of H1), in the pink copy's own colour.
  const dup = duplicateSerial(data.slips);
  return (
    <Cell className="fsr-cell--slips">
      <span className="fsr-slips">
        <span className="fsr-slips__stack" aria-hidden style={{ ["--n" as string]: String(shown.length) }}>
          {shown.map((s, i) => (
            <SlipCrop
              key={`${s.serial}-${s.copy}-${s.photoId}`}
              slip={s}
              index={i}
              sheet={context?.slip?.(s.serial, s.copy)}
            />
          ))}
        </span>
        <span className="fs-t-figure" aria-hidden>
          {data.slips.length}
        </span>
        <span className="fs-sr">{SPLIT.slipCount(data.slips.length)}</span>
        {dup && (
          <span className="fsr-dupchip fs-t-caption" data-testid={`W-TR-05.dup.${data.memberNo}`}>
            {dup} ×2
          </span>
        )}
      </span>
    </Cell>
  );
}

// ------------------------------------------------------------------------------------------------ kilos

export function KgCell({ data, context }: Props) {
  if (data?.kind === "note") return null;
  if (!data) return null;
  if (data.kind === "totals") return null;
  const ratio = Math.max(0, Math.min(2, data.treeRatio));
  // Verified kilos are the engine's figure, like the money beside them: pencil until the two keys turn it to ink.
  return (
    <Cell className="fsr-cell--kg">
      <span className="fsr-kg">
        <span className="fsr-kg__value fs-t-figure" data-amount-state={data.partsState}>
          {format.kgNumber(data.verifiedG)}
        </span>
        <span
          className="fsr-kg__bar"
          data-over={data.overYield ? "" : undefined}
          title={`${data.kgPerTree} kg a tree from ${data.trees} registered trees; the limit is ${context.yieldLimit}`}
          aria-hidden
        >
          <span className="fsr-kg__fill" style={{ width: `${Math.min(1, ratio) * 50}%` }} />
          {ratio > 1 && <span className="fsr-kg__over" style={{ width: `${(ratio - 1) * 50}%` }} />}
          <span className="fsr-kg__limit" />
        </span>
        {data.overYield && (
          <span className="fsr-kg__note fs-t-caption">
            {SPLIT.perTreeOver(data.kgPerTree, context.yieldLimit)}
          </span>
        )}
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
  if (data?.kind === "note") return null;
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
  if (data?.kind === "note") return null;
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
  if (data?.kind === "note") return null;
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

export function KaltasCell({ data }: Props) {
  if (data?.kind === "note") return null;
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
        {data.deductions.map((d) => (
          <RuleChip
            key={`${d.ruleId}-${d.category}`}
            name={CATEGORY_WORD[d.category]}
            amount={format.amount(-d.amountCents)}
            rule={d.ruleId}
          />
        ))}
      </span>
    </Cell>
  );
}

export function CreditCell({ data }: Props) {
  if (data?.kind === "note") return null;
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
  if (data?.kind === "note") return null;
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

// ------------------------------------------------------------------------------------------------ rail

export function RailCell({ data, context }: Props) {
  if (data?.kind === "note") return null;
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

export function statusWords(row: SplitRow): string {
  if (row.status.kind === "held") return SPLIT.held;
  if (row.status.kind === "reserved") return SPLIT.reserved;
  return linePayout(row).statusWord;
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
  if (data?.kind === "note") return null;
  if (!data) return null;
  if (data.kind === "totals") {
    return (
      <Cell className="fsr-cell--status">
        <span
          className="fsr-status"
          data-tone={data.balanced ? "ink" : "red"}
          data-testid="W-TR-05.totals.balanced"
        >
          <Glyph name={data.balanced ? "ms:check" : "ms:help"} size={16} />
          <span className="fs-t-label">{data.balanced ? SPLIT.balanced : SPLIT.unbalanced}</span>
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
        <span className="fsr-status__text">
          <span className={data.status.kind === "reserved" ? "fs-t-caption" : "fs-t-label"}>
            {statusWords(data)}
          </span>
          {data.status.kind !== "line" && (
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
