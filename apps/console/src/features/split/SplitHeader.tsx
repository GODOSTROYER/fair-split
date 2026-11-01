// Split review's bench (S1.7 W-TR-05 header): the bodega's hanging-scale dial for mass balance; the pool, the
// screen's money, in pencil (the engine's figure, nobody has signed) with its two parts, the balance check and the
// engine's provenance beneath it; the open decisions as one sentence with the next one linked, and flat filter
// chips with live counts. The dial swings only on a live decision (the needle spring, MM-3); replayed history sets
// it in place. In reduced motion the needle cuts to its new value under a 200 ms crossfade instead of swinging.

import { Glyph, MassBalanceDial, useMotionMode } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { format } from "../../lib/format.js";
import { type MassBalanceView, SPLIT_FILTERS, type SplitFilter } from "./model.js";
import { en, SPLIT } from "./shared/copy.js";

export interface PoolsView {
  readonly premiumCents: number;
  readonly bonusCents: number;
  readonly poolCents: number;
  /** The pool's amount state: pencil until both keys turn the run to ink (S2.2.1). */
  readonly amountState?: "pencil" | "ink";
}

export interface NextDecision {
  readonly href: string;
  readonly words: string;
  readonly kind: "hold" | "by-hand" | "approve";
}

export interface SplitHeaderProps {
  readonly dial: MassBalanceView;
  /** Swing the needle: the dial changed because of a live decision. */
  readonly swing: boolean;
  readonly pools: PoolsView;
  readonly open: { readonly holds: number; readonly byHand: number };
  readonly next: NextDecision | null;
  readonly counts: Readonly<Record<SplitFilter, number>>;
  readonly filter: SplitFilter;
  readonly onFilter: (filter: SplitFilter) => void;
  /** What the run says once every hold is decided (it differs before and after the two keys). */
  readonly decidedWords?: string;
  /** The dial's own testId root ("W-TR-05.dial"); the drawer reuses the dial with its own. */
  readonly dialTestId?: string;
  /** Beneath the pool: the balance check and the engine's provenance for every figure on the screen. */
  readonly proof?: ReactNode;
  /** After the filters: the grid's "All columns" toggle. */
  readonly columns?: ReactNode;
}

const FILTER_KEY = {
  all: "W-TR-05.filter.all",
  held: "W-TR-05.filter.held",
  byHand: "W-TR-05.filter.byHand",
  paypal: "W-TR-05.filter.paypal",
  cash: "W-TR-05.filter.cash",
} as const;

export function dialLabel(dial: MassBalanceView): string {
  if (dial.status === "PENDING") return SPLIT.dialPending(dial.waitingFor ?? "");
  return dial.status === "INSIDE" ? SPLIT.dialInside : SPLIT.dialOutside;
}

/** The mass-balance dial, mirrored as a table for screen readers and Data mode (S1.12). */
export function Dial({
  dial,
  swing,
  size = 132,
  testId,
}: {
  readonly dial: MassBalanceView;
  readonly swing: boolean;
  readonly size?: number;
  readonly testId: string;
}) {
  const mode = useMotionMode();
  // MM-3 reduced: no swing. The needle cuts to the new value and fades in over 200 ms; keying the dial to the
  // value replays the fade for each live change (history never sets `swing`, so it never fades).
  const cut = swing && mode === "reduced";
  return (
    <Mirrored
      testId={testId}
      className="fsr-dial"
      visual={
        <div
          key={cut ? `cut-${dial.display}` : "dial"}
          className="fsr-dial__visual"
          data-status={dial.status}
          data-swing={swing ? "" : undefined}
          data-motion={mode}
          data-cut={cut ? "" : undefined}
        >
          <MassBalanceDial
            value={dial.value}
            display={dial.display}
            limit={dial.tolBp / 100}
            limitDisplay={en("W-TR-05.dialLimit", { limit: dial.limitDisplay })}
            label={en("W-TR-05.dial")}
            size={size}
            animateNeedle={swing}
            testId={`${testId}.visual`}
          />
        </div>
      }
      table={
        <DataTable
          caption={en("W-TR-05.dial")}
          testId={`${testId}.table`}
          columns={[
            { key: "measure", label: "Measure" },
            { key: "value", label: "Value", numeric: true },
          ]}
          rows={[
            { key: "shrink", cells: { measure: "Shrink", value: dial.display } },
            { key: "limit", cells: { measure: "Limit", value: `±${dial.limitDisplay}` } },
            { key: "status", cells: { measure: "Status", value: dialLabel(dial) } },
            { key: "verified", cells: { measure: "Verified", value: dial.verified } },
            { key: "shipped", cells: { measure: "Shipped", value: dial.shipped } },
          ]}
        />
      }
    />
  );
}

export function SplitHeader({
  dial,
  swing,
  pools,
  open,
  next,
  counts,
  filter,
  onFilter,
  decidedWords = SPLIT.allDecided,
  dialTestId = "W-TR-05.dial",
  proof,
  columns,
}: SplitHeaderProps) {
  const decided = open.holds === 0 && open.byHand === 0;
  const money = pools.amountState ?? "pencil";
  return (
    <section className="fsr-bench" aria-label="Pools, mass balance and filters" data-testid="W-TR-05.bench">
      <div className="fsr-bench__dial">
        <Dial dial={dial} swing={swing} size={168} testId={dialTestId} />
        <p
          className="fsr-bench__dial-note fs-t-caption"
          data-status={dial.status}
          data-testid="W-TR-05.dial.status"
        >
          {dialLabel(dial)}
        </p>
      </div>
      <div className="fsr-pools" data-testid="W-TR-05.pools">
        <p className="fsr-pools__label fs-t-caption">{en("W-TR-05.pool")}</p>
        <p className="fsr-pools__total fs-t-amount-l" data-amount-state={money} data-testid="W-TR-05.pool">
          {format.money(pools.poolCents)}
        </p>
        <dl className="fsr-pools__parts">
          <div className="fsr-pools__item">
            <dt className="fs-t-caption">
              {en("W-TR-01.pool.premium")}
              <Glyph name="ms:lock" size={12} />
            </dt>
            <dd className="fs-t-figure" data-amount-state={money}>
              {format.money(pools.premiumCents)}
            </dd>
          </div>
          <div className="fsr-pools__item">
            <dt className="fs-t-caption">{en("W-TR-01.pool.bonus")}</dt>
            <dd className="fs-t-figure" data-amount-state={money}>
              {format.money(pools.bonusCents)}
            </dd>
          </div>
        </dl>
        <p className="fsr-pools__note fs-t-caption">{en("W-TR-01.pool.premiumNote")}</p>
        {proof}
      </div>
      <div className="fsr-bench__summary">
        <h2 className="fs-t-title-2" data-testid="W-TR-05.summary">
          {decided ? decidedWords : en("W-TR-05.summary", { holds: open.holds, byHand: open.byHand })}
        </h2>
        {next && (
          <p className="fsr-next" data-kind={next.kind}>
            <span className="fsr-next__mark" aria-hidden />
            <AppLink href={next.href} className="fs-link fs-t-label" data-testid="W-TR-05.next">
              {next.words}
            </AppLink>
          </p>
        )}
        <fieldset className="fsr-chips" data-testid="W-TR-05.filters">
          <legend className="fs-sr">{SPLIT.filters}</legend>
          {SPLIT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="fsr-chip fs-t-label"
              aria-pressed={filter === f}
              onClick={() => onFilter(f)}
              data-testid={`W-TR-05.filter.${f}`}
            >
              {en(FILTER_KEY[f], { count: counts[f] })}
            </button>
          ))}
        </fieldset>
        {columns}
      </div>
    </section>
  );
}
