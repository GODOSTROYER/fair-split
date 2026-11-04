// The plot field (S1.8, design §2.6): one abstract dot per member, its area by verified kilos, placed by a hash-
// seeded layout with no basemap and no coordinates. A picture of how the season's kilos spread across the co-op,
// never a map. Each dot wears its line's tier (ADR-0016): flush jade only where the simulated PayPal confirmed the
// payment, the dashed jade outline while it is on its way, hatch for cash at the bodega, marigold for a line a hold
// reserved. A replay confirms nothing, so it draws no jade. Hidden from screen readers and mirrored in a table
// (S1.12); in Data mode the table replaces it.

import type { ProofBundle } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useId, useMemo } from "react";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { format } from "../../lib/format.js";
import { PLOT_COPY } from "./copy.js";
import {
  itemsByMember,
  type LineStates,
  type LineTier,
  lineTier,
  type ProofItemView,
  paidMembers,
  plotField,
} from "./model.js";

const W = 640;
const H = 220;

/** Each member's tier for the dots; a replay confirms nothing, so its PayPal lines stay on their way. */
export function plotTiers(
  lines: ProofBundle["lines"],
  items: readonly ProofItemView[],
  lineStates: LineStates,
  replayed: boolean,
): ReadonlyMap<string, LineTier> {
  const paid = replayed ? new Set<string>() : paidMembers(items);
  const byMember = itemsByMember(items);
  return new Map(lines.map((l) => [l.memberNo, lineTier(l, byMember.get(l.memberNo), paid, lineStates)]));
}

export function PlotField({
  bundle,
  tiers,
}: {
  readonly bundle: ProofBundle;
  /** Each member's tier (plotTiers); without it every dot is neutral. */
  readonly tiers?: ReadonlyMap<string, LineTier>;
}) {
  const id = useId();
  const hatch = `${id.replaceAll(":", "")}-hatch`;
  const dots = useMemo(() => plotField(bundle.lines, W, H), [bundle.lines]);
  const byMember = useMemo(
    () => [...bundle.lines].sort((a, b) => b.canonical.verifiedG - a.canonical.verifiedG),
    [bundle.lines],
  );
  return (
    <section className="pf-plots" aria-labelledby={`${id}-plots`} data-testid="W-PF-01.plots">
      <h2 id={`${id}-plots`} className="pf-section__title">
        {PLOT_COPY.heading}
      </h2>
      <Mirrored
        testId="W-PF-01.plotfield"
        className="pf-plots__field"
        visual={
          <svg viewBox={`0 0 ${W} ${H}`} className="pf-plots__svg" role="presentation">
            <defs>
              <pattern
                id={hatch}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" className="pf-plots__hatch-ground" />
                <rect width="1.5" height="5" className="pf-plots__hatch-line" />
              </pattern>
            </defs>
            {dots.map((d) => {
              const tier = tiers?.get(d.memberNo);
              const cash = tier === "attested" || tier === "due-cash";
              return (
                <circle
                  key={d.memberNo}
                  cx={d.x}
                  cy={d.y}
                  r={d.r}
                  className="pf-plots__dot"
                  data-tier={tier}
                  style={cash ? { fill: `url(#${hatch})` } : undefined}
                />
              );
            })}
          </svg>
        }
        table={
          <DataTable
            caption={PLOT_COPY.table}
            testId="W-PF-01.plotfield.table"
            columns={[
              { key: "member", label: "Member" },
              { key: "kg", label: "Verified", numeric: true },
              { key: "g1", label: "Grade 1", numeric: true },
            ]}
            rows={byMember.map((l) => ({
              key: l.memberNo,
              cells: {
                member: l.memberNo,
                kg: format.kg(l.canonical.verifiedG),
                g1: format.kg(l.canonical.grade1G),
              },
            }))}
          />
        }
      />
      <p className="pf-plots__caption fs-t-micro" title={PLOT_COPY.captionTitle()}>
        <Glyph name="ms:lock" size={14} />
        <span>{PLOT_COPY.caption}</span>
      </p>
    </section>
  );
}
