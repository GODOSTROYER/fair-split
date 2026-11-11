// Split review's bench (S1.7 W-TR-05 header; unslop spec §3.6), one short band so the lines get the height: the
// shrink tick ring with its reading as the screen's one hero numeral (FS Sans, round 3), "Shrink · limit 2.0%" as
// micro (one term everywhere, round 5) and the state as a pill; then, round 6, the screen's money said once: one
// sum, "Pool − deductions = member net", each term its word over its figure, the balance check at its end (no Pool
// block, no "Next" column: the top bar's pill and the held rows carry the next decision). The filters run beneath
// it as one segmented row. The dial swings only on a live decision (the needle spring, MM-3); replayed history sets
// it in place. In reduced motion the needle cuts under a 200 ms fade.
import { Glyph, MassBalanceDial, Numeral, useMotionMode } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { format } from "../../lib/format.js";
import { SHRINK, shrinkLabel } from "../../lib/plain.js";
import { type MassBalanceView, SPLIT_FILTERS, type SplitFilter, type SplitTotals } from "./model.js";
import { en, SPLIT } from "./shared/copy.js";

export interface SplitHeaderProps {
  readonly dial: MassBalanceView;
  /** Swing the needle: the dial changed because of a live decision. */
  readonly swing: boolean;
  /** The reading before the last decision moved it ("2.05%"), shown as micro "was 2.05%". */
  readonly was?: string | null;
  readonly counts: Readonly<Record<SplitFilter, number>>;
  readonly filter: SplitFilter;
  readonly onFilter: (filter: SplitFilter) => void;
  /** The rail filters count planned rails (before the batch posts) rather than payments. */
  readonly railsPlanned?: boolean;
  /** The dial's own testId root ("W-TR-05.dial"); the drawer reuses the dial with its own. */
  readonly dialTestId?: string;
  /** Beside the dial: the screen's one money summary (pool − deductions = member net) and its balance check. */
  readonly reconcile?: ReactNode;
  /** After the filters: the grid's "All columns" toggle. */
  readonly columns?: ReactNode;
}

/**
 * The grid's arithmetic in one line above it (UI gate round 3): pool − deductions (+ credits) = member net, the
 * footer's "Member net total". Every figure is the engine's conservation proof; the balance check sits at its end.
 */
export function Reconcile({
  totals,
  check,
  poolState = "ink",
}: {
  readonly totals: Pick<SplitTotals, "poolCents" | "deductionsCents" | "creditsCents" | "netCents">;
  readonly check?: ReactNode;
  /** The pool's amount state on the bench: pencil until both keys turn the run to ink (S2.2.1). */
  readonly poolState?: "pencil" | "ink";
}) {
  const pool = format.money(totals.poolCents);
  const deductions = format.amount(totals.deductionsCents);
  const credits = totals.creditsCents > 0 ? format.amount(totals.creditsCents) : null;
  const net = format.money(totals.netCents);
  // Round 6: each term is its word over its figure (the bench's one money summary), so the line reads as a sum at
  // every width: Pool − deductions (+ credits) = member net.
  const term = (word: string, figure: string, o: { testId?: string; state?: "pencil" | "ink" } = {}) => (
    <span className="fsr-recon__term">
      <span className="fsr-recon__word fs-t-caption">{word}</span>
      <span className="fsr-recon__figure fs-t-amount-l" data-testid={o.testId} data-amount-state={o.state}>
        {figure}
      </span>
    </span>
  );
  return (
    <div className="fsr-recon" data-testid="W-TR-05.reconcile">
      <p className="fsr-recon__eq">
        <span className="fs-sr">{SPLIT.reconcileSpoken(pool, deductions, credits, net)}</span>
        <span className="fsr-recon__line" aria-hidden>
          {term(en("W-TR-05.pool"), pool, { testId: "W-TR-05.pool", state: poolState })}
          <span className="fsr-recon__op">−</span>
          {term(SPLIT.reconcile.deductions, deductions)}
          {credits && (
            <>
              <span className="fsr-recon__op">+</span>
              {term(SPLIT.reconcile.credits, credits)}
            </>
          )}
          <span className="fsr-recon__op">=</span>
          {term(SPLIT.reconcile.net, net, { testId: "W-TR-05.reconcile.net" })}
        </span>
      </p>
      {check}
    </div>
  );
}
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
  valueRole = "figure",
}: {
  readonly dial: MassBalanceView;
  readonly swing: boolean;
  readonly size?: number;
  readonly testId: string;
  /** The bench reads its dial at amount-l, a hero reading; the drawer keeps the small figure. */
  readonly valueRole?: "figure" | "amount-l";
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
            label={SHRINK}
            size={size}
            animateNeedle={swing}
            valueRole={valueRole}
            testId={`${testId}.visual`}
          />
        </div>
      }
      table={
        <DataTable
          caption={SHRINK}
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

/**
 * The dial's state as the spec's status pill: over the limit is a person's decision (a marigold dot in a white
 * pill), inside is a checked fact (a check and the word, no pill), waiting names the slip it waits for.
 */
export function DialState({ dial, testId }: { readonly dial: MassBalanceView; readonly testId: string }) {
  return (
    <span className="fsr-dialstate fs-t-label" data-status={dial.status} data-testid={testId}>
      {dial.status === "INSIDE" && <Glyph name="ms:check" size={14} />}
      {dialLabel(dial)}
    </span>
  );
}

/** The reading as the screen's one hero numeral (FS Sans tabular figures), its unit and limit as micro beside it. */
export function DialReading({
  dial,
  was,
  size = "hero",
  testId,
}: {
  readonly dial: MassBalanceView;
  readonly was?: string | null;
  /** The type step: the bench's hero, or the title step beside a smaller dial. */
  readonly size?: "hero" | "title";
  readonly testId?: string;
}) {
  if (dial.status === "PENDING") return null;
  const value = dial.display.replace("%", "");
  return (
    <span className="fsr-reading" data-testid={testId}>
      <span className="fsr-reading__value">
        {/* The reading stays ink (amber is never text): over the limit, the needle and the limit tick say it. */}
        <Numeral value={value} size={size} label={SPLIT.dialSpoken(value)} />
        <span className="fsr-reading__unit" aria-hidden>
          %
        </span>
      </span>
      {/* One term for the dial everywhere (round 5): "Shrink · limit 2.0%", as Approve's checklist says it. */}
      <span className="fsr-reading__micro fs-t-micro">
        {shrinkLabel(dial.tolBp)}
        {was && was !== dial.display ? ` · ${SPLIT.dialWas(was)}` : ""}
      </span>
    </span>
  );
}

export function SplitHeader({
  dial,
  swing,
  was = null,
  counts,
  filter,
  onFilter,
  railsPlanned = false,
  dialTestId = "W-TR-05.dial",
  reconcile,
  columns,
}: SplitHeaderProps) {
  return (
    <section className="fsr-bench" aria-label="Pool, shrink and filters" data-testid="W-TR-05.bench">
      <div className="fsr-bench__dial">
        <Dial dial={dial} swing={swing} size={112} testId={dialTestId} />
        <div className="fsr-bench__reading">
          {dial.status === "PENDING" && <p className="fsr-bench__label fs-t-label">{SHRINK}</p>}
          <DialReading dial={dial} was={was} testId="W-TR-05.reading" />
          <DialState dial={dial} testId="W-TR-05.dial.status" />
        </div>
      </div>
      {/* Round 6: the bench says the money once. The pool, what the rules deduct and the members' net are one sum
          beside the dial, with the balance check at its end; the next decision is the top bar's pill and the held
          rows' own buttons, so the bench names none. */}
      <div className="fsr-pools" data-testid="W-TR-05.pools">
        {reconcile}
      </div>
      <div className="fsr-bench__tools">
        <fieldset className="fsr-chips" data-testid="W-TR-05.filters">
          <legend className="fs-sr">{SPLIT.filters}</legend>
          {SPLIT_FILTERS.map((f) => (
            <FilterChip
              key={f}
              filter={f}
              count={counts[f]}
              pressed={filter === f}
              onFilter={onFilter}
              planned={railsPlanned && (f === "paypal" || f === "cash")}
            />
          ))}
        </fieldset>
        {columns}
      </div>
    </section>
  );
}

function FilterChip({
  filter,
  count,
  pressed,
  onFilter,
  planned,
}: {
  readonly filter: SplitFilter;
  readonly count: number;
  readonly pressed: boolean;
  readonly onFilter: (filter: SplitFilter) => void;
  readonly planned: boolean;
}) {
  return (
    <button
      type="button"
      className="fsr-chip fs-t-label"
      data-filter={filter}
      aria-pressed={pressed}
      onClick={() => onFilter(filter)}
      title={planned ? SPLIT.railPlannedTitle : undefined}
      data-testid={`W-TR-05.filter.${filter}`}
    >
      {SPLIT.filter[filter]}{" "}
      <span className="fsr-chip__count fs-t-micro">
        {count}
        {planned ? ` ${SPLIT.railPlanned}` : ""}
      </span>
    </button>
  );
}
