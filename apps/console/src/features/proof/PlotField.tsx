// The plot field (S1.8, design §2.6): one abstract dot per member, its area by verified kilos, placed by a hash-
// seeded layout with no basemap and no coordinates. A picture of how the season's kilos spread across the co-op,
// never a map. Hidden from screen readers and mirrored in a table (S1.12); in Data mode the table replaces it.

import type { ProofBundle } from "@fairsplit/contracts";
import { useId, useMemo } from "react";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { format } from "../../lib/format.js";
import { PLOT_COPY } from "./copy.js";
import { plotField } from "./model.js";

const W = 640;
const H = 220;

export function PlotField({ bundle }: { readonly bundle: ProofBundle }) {
  const id = useId();
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
            {dots.map((d) => (
              <circle key={d.memberNo} cx={d.x} cy={d.y} r={d.r} className="pf-plots__dot" />
            ))}
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
      <p className="pf-plots__caption">{PLOT_COPY.caption()}</p>
    </section>
  );
}
