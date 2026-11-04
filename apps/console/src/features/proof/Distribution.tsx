// "Where every dollar went" (ADR-0016, decision.md §3, graft 2 from C): one bar under Proof's hero sentence. A jade
// segment for what the simulated PayPal confirmed, a dashed jade segment for PayPal items still on their way, a
// hatched segment for cash at the bodega, and a neutral sliver for what the holds kept for members, with a legend.
// Every figure is the run's own (the tiers Proof already derives); nothing is typed. Jade appears only once the
// simulated PayPal confirms, so Proof opens at "0 of 8 confirmed" with no jade in the bar.

import { format } from "../../lib/format.js";
import type { ProofFigures } from "./metrics.js";

interface Segment {
  readonly kind: "paypal" | "flight" | "cash" | "kept";
  readonly cents: number;
  readonly members: number | null;
  readonly label: string;
}

/** The bar's segments, in order, from Proof's own figures. Empty segments are left out. */
export function distribution(figures: Pick<ProofFigures, "tiers" | "holds">): readonly Segment[] {
  const { tiers, holds } = figures;
  const cash = tiers.attested.cents + tiers.due.cash.cents;
  const cashMembers = tiers.attested.members + tiers.due.cash.members;
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
    { kind: "kept", cents: holds?.keptCents ?? 0, members: null, label: "Kept for members" },
  ];
  return all.filter((s) => s.cents > 0);
}

export function Distribution({
  figures,
  amount,
}: {
  readonly figures: ProofFigures;
  readonly amount: string;
}) {
  const segments = distribution(figures);
  const total = segments.reduce((n, s) => n + s.cents, 0);
  if (total <= 0) return null;
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
    </figure>
  );
}
