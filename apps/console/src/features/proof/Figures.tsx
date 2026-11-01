// What the run adds up to (S1.8 metrics, in order), then the fees. A ruled ledger, not a wall of stat tiles:
// labels on the left, figures on the decimal at the right, each amount in its grammar (S2.2.1). The paid tiers
// partition every line (I3): PayPal-confirmed money is jade flush, cash attested is ink, what is still due is
// hatched. A figure moves only when an event moves it: the tier that changed takes the 150 ms digit tween, keyed
// on the event's ID, and history never animates.

import type { ProofBundle } from "@fairsplit/contracts";
import { RailBar } from "@fairsplit/ui-web";
import { type CSSProperties, useId, useRef } from "react";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { FEES_COPY, FIGURE_COPY } from "./copy.js";
import type { FeeFigures, ProofFigures } from "./metrics.js";
import { type LineStates, mergeItems, type ProofItemView, paidTiers } from "./model.js";

export interface FiguresProps {
  readonly bundle: ProofBundle;
  readonly replayed?: boolean;
  readonly items?: readonly ProofItemView[];
  readonly lineStates?: LineStates;
  readonly figures: ProofFigures;
  readonly rail: PaypalRail;
  /** The SSE event that last moved the counts: a figure re-prints only on a real event. */
  readonly progressEvent: string | null;
  /** PayPal's reported payout fees (the season's run reports them in the seed). */
  readonly fees: FeeFigures | null;
}

function pct(bp: number, decimals = 1): string {
  return format.percentBp(bp, decimals);
}

/** Share of a total in percent (for bar widths only; never printed). */
function widthOf(cents: number, total: number): string {
  return total > 0 ? `${((cents * 100) / total).toFixed(3)}%` : "0%";
}

export function Figures({
  bundle,
  figures,
  rail,
  progressEvent,
  fees,
  replayed = false,
  items,
  lineStates = {},
}: FiguresProps) {
  const id = useId();
  const { rails } = figures;
  const tiers = replayed
    ? paidTiers(bundle.lines, items ?? mergeItems(bundle.batch.items), lineStates, true)
    : figures.tiers;
  const share = pct(rails.paypalValueBp);
  // The event the page opened on is history: only a newer one re-prints a figure (motion is evidence).
  const firstEvent = useRef(progressEvent);
  const moved = progressEvent !== null && progressEvent !== firstEvent.current ? progressEvent : undefined;
  const total = tiers.netCents;
  return (
    <section className="pf-figures" aria-labelledby={`${id}-figures`} data-testid="W-PF-01.figures">
      <h2 id={`${id}-figures`} className="pf-section__title">
        {FIGURE_COPY.heading}
      </h2>
      <dl className="pf-ledger">
        <div className="pf-ledger__row" data-testid="W-PF-01.metric.explained">
          <dt>{FIGURE_COPY.explained()}</dt>
          <dd>
            <span className="pf-ledger__value" data-amount-state="ink">
              {FIGURE_COPY.explainedValue(figures.lines.explained, figures.lines.total)}
            </span>
            <span className="pf-ledger__note">{FIGURE_COPY.explainedNote}</span>
          </dd>
        </div>

        <div className="pf-ledger__row" data-testid="W-PF-01.metric.premium">
          <dt>{FIGURE_COPY.premium}</dt>
          <dd>
            <span className="pf-ledger__value">
              <span data-amount-state="ink">{format.money(figures.premium.allocatedCents)}</span>
              <span className="pf-ledger__aside">{pct(figures.premium.allocatedBp, 0)}</span>
            </span>
            <span className="pf-ledger__note">
              {figures.premium.deductedFromPremiumCents === 0
                ? FIGURE_COPY.premiumNote
                : FIGURE_COPY.premiumBreach(format.money(figures.premium.deductedFromPremiumCents))}
            </span>
          </dd>
        </div>

        <div className="pf-ledger__row pf-ledger__row--tiers" data-testid="W-PF-01.metric.paid">
          <dt>{replayed ? "Replay statuses and cash, in three tiers" : FIGURE_COPY.paid}</dt>
          <dd>
            <Mirrored
              testId="W-PF-01.tierbar"
              className="pf-tierbar"
              visual={
                <span className="pf-tierbar__bar">
                  <span
                    className="pf-tierbar__seg"
                    data-tier="paypal"
                    style={{ width: widthOf(tiers.paypal.cents, total) } as CSSProperties}
                  />
                  <span
                    className="pf-tierbar__seg"
                    data-tier="attested"
                    style={{ width: widthOf(tiers.attested.cents, total) } as CSSProperties}
                  />
                  <span
                    className="pf-tierbar__seg"
                    data-tier="due"
                    style={{ width: widthOf(tiers.due.cents + tiers.reserved.cents, total) } as CSSProperties}
                  />
                </span>
              }
              table={
                <DataTable
                  caption={replayed ? "Replay statuses and cash, in three tiers" : "Paid, in three tiers"}
                  testId="W-PF-01.tierbar.table"
                  columns={[
                    { key: "tier", label: "Tier" },
                    { key: "members", label: "Members", numeric: true },
                    { key: "amount", label: "Net", numeric: true },
                  ]}
                  rows={[
                    {
                      key: "paypal",
                      cells: {
                        tier: replayed
                          ? "Replayed payout statuses (simulated PayPal sandbox): successful in the source run"
                          : FIGURE_COPY.tierPaypal(rail),
                        members: tiers.paypal.members,
                        amount: format.money(tiers.paypal.cents),
                      },
                    },
                    {
                      key: "attested",
                      cells: {
                        tier: FIGURE_COPY.tierAttested,
                        members: FIGURE_COPY.attestedOf(tiers.attested.members, tiers.attested.ofMembers),
                        amount: format.money(tiers.attested.cents),
                      },
                    },
                    {
                      key: "due",
                      cells: {
                        tier: FIGURE_COPY.tierDue,
                        members: tiers.due.members,
                        amount: format.money(tiers.due.cents),
                      },
                    },
                  ]}
                />
              }
            />
            <ul className="pf-tiers">
              <li className="pf-tier" data-tier="paypal" data-testid="W-PF-01.tier.paypal">
                <span className="pf-tier__swatch" aria-hidden />
                <span className="pf-tier__words">
                  {replayed
                    ? "Replayed payout statuses (simulated PayPal sandbox): successful in the source run"
                    : FIGURE_COPY.tierPaypal(rail)}
                </span>
                <span
                  className="pf-tier__count"
                  key={`m-${moved ?? "h"}`}
                  data-moved={moved ? "" : undefined}
                >
                  {FIGURE_COPY.members(tiers.paypal.members)}
                </span>
                <span
                  className="pf-tier__amount"
                  key={`a-${moved ?? "h"}`}
                  data-moved={moved ? "" : undefined}
                  data-amount-state="landed"
                  data-testid="W-PF-01.tier.paypal.amount"
                >
                  {format.money(tiers.paypal.cents)}
                </span>
              </li>
              <li className="pf-tier" data-tier="attested" data-testid="W-PF-01.tier.attested">
                <span className="pf-tier__swatch" aria-hidden />
                <span className="pf-tier__words">{FIGURE_COPY.tierAttested}</span>
                <span className="pf-tier__count">
                  {FIGURE_COPY.attestedOf(tiers.attested.members, tiers.attested.ofMembers)}
                </span>
                <span
                  className="pf-tier__amount"
                  data-amount-state="attested"
                  data-testid="W-PF-01.tier.attested.amount"
                >
                  {format.money(tiers.attested.cents)}
                </span>
              </li>
              <li className="pf-tier" data-tier="due" data-testid="W-PF-01.tier.due">
                <span className="pf-tier__swatch" aria-hidden />
                <span className="pf-tier__words">
                  {FIGURE_COPY.tierDue}
                  <span className="pf-tier__sub">
                    {replayed
                      ? "The payout statuses are replayed from an earlier simulated run. No new payout notice is claimed."
                      : FIGURE_COPY.dueNote(tiers.due.cash.members, tiers.due.paypal.members)}
                  </span>
                </span>
                <span className="pf-tier__count">{FIGURE_COPY.members(tiers.due.members)}</span>
                <span
                  className="pf-tier__amount"
                  data-amount-state="hollow"
                  data-testid="W-PF-01.tier.due.amount"
                >
                  {format.money(tiers.due.cents)}
                </span>
              </li>
              {tiers.reserved.members > 0 && (
                <li className="pf-tier" data-tier="reserved" data-testid="W-PF-01.tier.reserved">
                  <span className="pf-tier__swatch" aria-hidden />
                  <span className="pf-tier__words">{FIGURE_COPY.tierReserved}</span>
                  <span className="pf-tier__count">{FIGURE_COPY.members(tiers.reserved.members)}</span>
                  <span className="pf-tier__amount" data-amount-state="pencil">
                    {format.money(tiers.reserved.cents)}
                  </span>
                </li>
              )}
            </ul>
            <span className="pf-ledger__note">{FIGURE_COPY.attestedNote}</span>
          </dd>
        </div>

        <div className="pf-ledger__row" data-testid="W-PF-01.metric.holds">
          <dt>{FIGURE_COPY.holds()}</dt>
          <dd>
            {figures.holds ? (
              <>
                <span className="pf-ledger__value">
                  <span>{FIGURE_COPY.holdsValue(figures.holds.caught)}</span>
                  <span className="pf-ledger__aside" data-testid="W-PF-01.metric.kept">
                    <span data-amount-state="ink">{format.money(figures.holds.keptCents)}</span> kept for
                    members
                  </span>
                </span>
                <span className="pf-ledger__note">
                  {figures.holds.duplicateCents !== null && figures.holds.creditCents !== null
                    ? FIGURE_COPY.holdsNote(
                        format.money(figures.holds.duplicateCents),
                        format.money(figures.holds.creditCents),
                      )
                    : "From this run's public Proof metrics: duplicate slips counted once and unruled fines returned as credits."}
                </span>
              </>
            ) : (
              <span className="pf-ledger__note">{FIGURE_COPY.holdsUnknown}</span>
            )}
          </dd>
        </div>

        <div className="pf-ledger__row pf-ledger__row--rails" data-testid="W-PF-01.metric.rails">
          <dt>{FIGURE_COPY.rails()}</dt>
          <dd>
            <span className="pf-ledger__value" data-testid="W-PF-01.metric.onPaypal">
              {FIGURE_COPY.onPaypal(rails.paypalMembers, figures.lines.total, share)}
            </span>
            <Mirrored
              testId="W-PF-01.railbar"
              visual={
                <RailBar
                  paypalShare={rails.paypalValueBp / 10_000}
                  paypalText={FIGURE_COPY.railsPaypal(rails.paypalMembers, share)}
                  cashText={FIGURE_COPY.railsCash(rails.cashMembers)}
                  cashWord={FIGURE_COPY.railsWord}
                  confirmed={tiers.paypal.members > 0}
                />
              }
              table={
                <DataTable
                  caption="PayPal and cash this season"
                  testId="W-PF-01.railbar.table"
                  columns={[
                    { key: "rail", label: "Rail" },
                    { key: "members", label: "Members", numeric: true },
                    { key: "value", label: "Net", numeric: true },
                    { key: "share", label: "Share of value", numeric: true },
                  ]}
                  rows={[
                    {
                      key: "paypal",
                      cells: {
                        rail: "PayPal",
                        members: rails.paypalMembers,
                        value: format.money(rails.paypalCents),
                        share,
                      },
                    },
                    {
                      key: "cash",
                      cells: {
                        rail: "Cash at the bodega",
                        members: rails.cashMembers,
                        value: format.money(rails.cashCents),
                        share: total > 0 ? format.shareOf(rails.cashCents, total) : "0.0%",
                      },
                    },
                  ]}
                />
              }
            />
          </dd>
        </div>

        <div className="pf-ledger__row" data-testid="W-PF-01.metric.timing">
          <dt>{FIGURE_COPY.timing()}</dt>
          <dd>
            <span className="pf-ledger__value">
              {figures.timingMs === null ? FIGURE_COPY.timingPending : format.elapsedWords(figures.timingMs)}
            </span>
            <span className="pf-ledger__note">
              {replayed
                ? "Payout timing is replayed from an earlier simulated PayPal sandbox run."
                : FIGURE_COPY.timingNote}
            </span>
          </dd>
        </div>
      </dl>
      <p className="pf-figures__source">{FIGURE_COPY.source}</p>

      <details className="pf-fees" data-testid="W-PF-01.fees">
        <summary className="pf-fees__summary">
          <span className="pf-fees__title">{FEES_COPY.heading}</span>
          <span className="pf-fees__lede">
            {replayed ? "Replayed simulated payout fees and this run’s invoice" : FEES_COPY.summary}
          </span>
        </summary>
        <ul className="pf-fees__list">
          <li>
            {bundle.invoice.status === "MARKED_AS_PAID" ? FEES_COPY.invoiceMarked : FEES_COPY.invoicePaid}
          </li>
          <li>
            {replayed
              ? "Payout fee data is replayed from the earlier simulated PayPal sandbox run; no new payout charge is claimed."
              : fees
                ? FEES_COPY.payouts(rail, format.money(fees.cents), fees.payments)
                : FEES_COPY.payoutsPending}
          </li>
          <li>
            {replayed
              ? "The disbursement line is the engine’s budget; a replay does not establish a new simulator balance."
              : FEES_COPY.disbursement(
                  format.money(bundle.rateCard.canonical.pricing.disbursementCents),
                  format.money(
                    Math.max(0, bundle.rateCard.canonical.pricing.disbursementCents - (fees?.cents ?? 0)),
                  ),
                )}
          </li>
          <li>{FEES_COPY.production}</li>
        </ul>
      </details>
    </section>
  );
}
