// "Where every dollar went" (ADR-0016, decision.md §3, graft 2 from C): one bar under Proof's hero sentence that
// adds up to Lantern Bay's invoice, cent for cent. The members' share in the tiers Proof already derives (a jade
// segment for what the simulated PayPal confirmed, a dashed jade one for PayPal items still on their way, hatch for
// cash at the bodega, marigold for a line reserved by a hold), then what the invoice paid beside it: the rate
// card's ruled deductions (net of the credits it returned) and the disbursement costs. What the holds kept for
// members is already inside the members' share, so it is a note under the legend, never a segment of its own.
// Every figure is the bundle's own; nothing is typed. Jade appears only once the simulated PayPal confirms, so Proof
// opens at "0 of 8 confirmed" with no jade in the bar.

import type { ProofBundle } from "@fairsplit/contracts";
import { format } from "../../lib/format.js";
import type { ProofFigures } from "./metrics.js";

export type SegmentKind = "paypal" | "flight" | "cash" | "reserved" | "deductions" | "disbursement";

interface Segment {
  readonly kind: SegmentKind;
  readonly cents: number;
  readonly members: number | null;
  readonly label: string;
}

type BundleMoney = Pick<ProofBundle, "invoice" | "pools" | "lines">;

/**
 * The bar's segments, in order, from the bundle and Proof's own tiers; empty segments are left out. They sum to
 * the invoice: the tiers add up to Σ net (I3), Σ net + deductions − credits is the pool, and the pool plus the
 * disbursement costs is the invoice.
 */
export function distribution(bundle: BundleMoney, figures: Pick<ProofFigures, "tiers">): readonly Segment[] {
  const { tiers } = figures;
  const cash = tiers.attested.cents + tiers.due.cash.cents;
  const cashMembers = tiers.attested.members + tiers.due.cash.members;
  const pool = bundle.pools.premiumPoolCents + bundle.pools.bonusPoolCents;
  const deductions = bundle.lines.reduce((n, l) => n + l.deductionsCents - l.creditsCents, 0);
  const all: Segment[] = [
    {
      kind: "paypal",
      cents: tiers.paypal.cents,
      members: tiers.paypal.members,
      label: `${tiers.paypal.members} on PayPal, confirmed in the simulated sandbox`,
    },
    {
      kind: "flight",
      cents: tiers.due.paypal.cents,
      members: tiers.due.paypal.members,
      label: `${tiers.due.paypal.members} on their way through the simulated PayPal sandbox`,
    },
    { kind: "cash", cents: cash, members: cashMembers, label: `${cashMembers} in cash at the bodega` },
    {
      kind: "reserved",
      cents: tiers.reserved.cents,
      members: tiers.reserved.members,
      label: `${tiers.reserved.members} held, reserved for their members`,
    },
    { kind: "deductions", cents: deductions, members: null, label: "Ruled deductions, net of credits" },
    {
      kind: "disbursement",
      cents: bundle.invoice.amountCents - pool,
      members: null,
      label: "Disbursement costs",
    },
  ];
  return all.filter((s) => s.cents > 0);
}

export function Distribution({
  bundle,
  figures,
  amount,
}: {
  readonly bundle: BundleMoney;
  readonly figures: Pick<ProofFigures, "tiers" | "holds">;
  readonly amount: string;
}) {
  const segments = distribution(bundle, figures);
  const total = segments.reduce((n, s) => n + s.cents, 0);
  if (total <= 0) return null;
  const kept = figures.holds?.keptCents ?? 0;
  return (
    <figure className="pf-dist" data-testid="proof-distribution" aria-labelledby="pf-dist-title">
      <figcaption id="pf-dist-title" className="pf-dist__title">
        Lantern Bay's {amount}, and where every dollar went
      </figcaption>
      <div className="pf-dist__bar" aria-hidden>
        {segments.map((s) => (
          <span
            key={s.kind}
            className="pf-dist__seg"
            data-kind={s.kind}
            style={{ flexGrow: s.cents, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="pf-dist__legend">
        {segments.map((s) => (
          <li
            key={s.kind}
            className="pf-dist__key"
            data-kind={s.kind}
            data-testid={`proof-distribution.${s.kind}`}
          >
            <span className="pf-dist__swatch" aria-hidden />
            <span className="pf-dist__label">{s.label}</span>
            <span className="pf-dist__value fs-amount">{format.money(s.cents)}</span>
          </li>
        ))}
      </ul>
      {kept > 0 && (
        <p className="pf-dist__note" data-testid="proof-distribution.holds">
          Inside the members' share: <span className="pf-dist__value">{format.money(kept)}</span> the holds
          kept for members.
        </p>
      )}
    </figure>
  );
}
