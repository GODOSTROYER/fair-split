// "Where every dollar went" (ADR-0016, decision.md §3, unslop spec §1.9 money bar): one stacked bar on a real
// axis that adds up to Lantern Bay's invoice, cent for cent, with a legend row per segment (swatch · name · count ·
// amount). The members' share in the tiers Proof already derives (a jade segment for what the simulated PayPal
// confirmed, a hollow neutral one for PayPal items still on their way, since dashed means simulated only; hatch
// for cash at the bodega, marigold for a line reserved by a hold), then what the invoice paid beside it: the rate
// card's ruled deductions (net of the credits it returned) and the disbursement costs. What the holds kept for
// members is already inside the members' share, so it is one line under the legend, never a segment of its own.
// Every figure is the bundle's own; nothing is typed. Jade appears only once the simulated PayPal confirms, so
// Proof opens at "0 of 8" with no jade in it. The card's PayPal money carries its one micro-tag (UI gate round 3).

import type { ProofBundle } from "@fairsplit/contracts";
import { MicroTag, Swatch, type SwatchKind } from "@fairsplit/ui-web";
import { format } from "../../lib/format.js";
import type { ProofFigures } from "./metrics.js";

export type SegmentKind = "paypal" | "flight" | "cash" | "reserved" | "deductions" | "disbursement";

/**
 * A legend row's key in the one marker vocabulary (round 5): ui-web's 8 px Swatch where the vocabulary has the
 * material (jade for confirmed money, hatch for cash, amber for a hold); the in-flight ring and the two neutral costs
 * keep Proof's own 8 px key in the same shape.
 */
const SWATCH: Partial<Record<SegmentKind, SwatchKind>> = { paypal: "paid", cash: "cash", reserved: "held" };

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
    { kind: "paypal", cents: tiers.paypal.cents, members: tiers.paypal.members, label: "PayPal, confirmed" },
    {
      kind: "flight",
      cents: tiers.due.paypal.cents,
      members: tiers.due.paypal.members,
      label: "PayPal, sending",
    },
    { kind: "cash", cents: cash, members: cashMembers, label: "Cash at the bodega" },
    {
      kind: "reserved",
      cents: tiers.reserved.cents,
      members: tiers.reserved.members,
      label: "Held for members",
    },
    { kind: "deductions", cents: deductions, members: null, label: "Ruled deductions, net" },
    {
      kind: "disbursement",
      cents: bundle.invoice.amountCents - pool,
      members: null,
      label: "Disbursement costs",
    },
  ];
  return all.filter((s) => s.cents > 0);
}

/** The axis: from 0 to the next US$500 past the total, a tick every US$1,000 (every US$500 under US$2,000). */
export function axisOf(totalCents: number): { readonly max: number; readonly ticks: readonly number[] } {
  const max = Math.max(50_000, Math.ceil(totalCents / 50_000) * 50_000);
  const step = max >= 200_000 ? 100_000 : 50_000;
  const ticks: number[] = [];
  for (let v = 0; v < max; v += step) ticks.push(v);
  return { max, ticks };
}

function tickLabel(cents: number): string {
  if (cents === 0) return "0";
  const dollars = cents / 100;
  return dollars % 1000 === 0 ? `${dollars / 1000}k` : `${(dollars / 1000).toFixed(1)}k`;
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
  const { max, ticks } = axisOf(total);
  const holds = figures.holds;
  const kept = holds?.keptCents ?? 0;
  // The card's one micro-tag sits on its PayPal money: the confirmed row, or the sending row before any confirm.
  const tagged = segments.find((s) => s.kind === "paypal" || s.kind === "flight")?.kind ?? null;
  return (
    <figure className="pf-dist" data-testid="proof-distribution" aria-label={`Where ${amount} went`}>
      <div className="pf-dist__plot" aria-hidden>
        <div className="pf-dist__bar" style={{ width: `${((total * 100) / max).toFixed(3)}%` }}>
          {segments.map((s) => (
            <span
              key={s.kind}
              className="pf-dist__seg"
              data-kind={s.kind}
              style={{ flexGrow: s.cents, flexBasis: 0 }}
            />
          ))}
        </div>
        <div className="pf-dist__axis">
          {ticks.map((v) => (
            <span key={v} className="pf-dist__tick" style={{ left: `${((v * 100) / max).toFixed(3)}%` }}>
              {tickLabel(v)}
            </span>
          ))}
          <span className="pf-dist__unit">US$</span>
        </div>
      </div>
      <ul className="pf-dist__legend">
        {segments.map((s) => (
          <li
            key={s.kind}
            className="pf-dist__key"
            data-kind={s.kind}
            data-testid={`proof-distribution.${s.kind}`}
          >
            {SWATCH[s.kind] ? (
              <Swatch kind={SWATCH[s.kind] as SwatchKind} />
            ) : (
              <span className="pf-dist__swatch" aria-hidden />
            )}
            <span className="pf-dist__label">
              {s.label}
              {s.kind === tagged && <MicroTag testId="W-PF-01.money.tag" />}
            </span>
            <span className="pf-dist__count">{s.members ?? ""}</span>
            <span className="pf-dist__value">{format.money(s.cents)}</span>
          </li>
        ))}
      </ul>
      {kept > 0 && (
        <p className="pf-dist__note" data-testid="proof-distribution.holds">
          {holds ? `${holds.caught} ${holds.caught === 1 ? "hold" : "holds"} kept ` : "Holds kept "}
          <span className="pf-dist__kept">{format.money(kept)}</span> for members, inside their share
        </p>
      )}
    </figure>
  );
}
