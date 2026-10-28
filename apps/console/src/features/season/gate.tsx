// What every season screen shows before it has its season: dashed print beds at their final size while the
// snapshot loads (never a shimmer), the failure in the console's words, or the season that is open when the
// URL names another one. Each renders the screen's own root, so `data-state` is always the screen's.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { webRoutes } from "@fairsplit/contracts";
import type { ReactNode } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed, type PrintBedShape } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { useSnapshot } from "../../data/hooks.js";
import type { ConsoleScreenId } from "../../lib/screens.js";
import { GATE_COPY } from "./copy.js";
import "./season.css";

export type SeasonScreenId = Extract<
  ConsoleScreenId,
  "W-JG-01" | "W-TR-01" | "W-TR-02" | "W-TR-03" | "W-TR-04"
>;

export interface GateBed {
  readonly shape: PrintBedShape;
  readonly count?: number;
  readonly height?: number | string;
  readonly width?: number | string;
  readonly labels?: readonly string[];
}

/** A column of beds: the screen's layout drawn dashed, at the size its print will take. */
export type GateLayout = readonly (readonly GateBed[])[];

/** The beds each season screen prints into, column by column (S1.7: "dashed print beds at their final size"). */
export const gateBeds = {
  judge: [
    [{ shape: "photo", count: 12 }],
    [
      { shape: "plate", height: 300, labels: ["Invoice"] },
      { shape: "plate", height: 180, labels: ["The pool"] },
      { shape: "slab" },
    ],
  ],
  season: [
    [
      { shape: "line", count: 3 },
      { shape: "block", height: 56, labels: ["Run stages"] },
      { shape: "plate", height: 320, labels: ["Invoice"] },
    ],
    [
      { shape: "plate", height: 320, labels: ["The pool"] },
      { shape: "block", height: 140, labels: ["Reading eval"] },
    ],
  ],
  rateCard: [
    [{ shape: "photo", count: 2, labels: ["Page 1", "Page 2"] }],
    [
      { shape: "line", count: 8 },
      { shape: "plate", height: 140, labels: ["Bolted"] },
    ],
  ],
  reading: [
    [
      { shape: "block", height: 72, labels: ["Photos A to L"] },
      { shape: "photo", labels: ["Photo"] },
    ],
    [
      { shape: "row", count: 4 },
      { shape: "line", count: 2 },
    ],
  ],
  byHand: [
    [
      { shape: "block", height: 240, labels: ["The crop, three times"] },
      { shape: "block", height: 120, labels: ["Logbook page"] },
    ],
    [{ shape: "line", count: 3 }, { shape: "block", height: 64 }, { shape: "slab" }],
  ],
} as const satisfies Record<string, GateLayout>;

export interface SeasonGateProps {
  readonly id: SeasonScreenId;
  /** The season the route names; the Judge stage passes none. */
  readonly seasonCode?: string;
  /** The beds the screen's print will land in, one array per column. */
  readonly beds: GateLayout;
  readonly children: (snapshot: SeasonSnapshot) => ReactNode;
}

export function SeasonGate({ id, seasonCode, beds, children }: SeasonGateProps) {
  const query = useSnapshot();
  if (query.error) {
    return (
      <ScreenRoot id={id} state="error" className="fsc-gate" labelledBy={`${id}-gate-title`}>
        <h1 id={`${id}-gate-title`} className="fs-t-title-1">
          {GATE_COPY.failed}
        </h1>
        <CommandNotice error={query.error} testId={`${id}.error`} onRetry={() => void query.refetch()} />
      </ScreenRoot>
    );
  }
  const snapshot = query.data;
  if (!snapshot) {
    return (
      <ScreenRoot id={id} state="loading" className="fsc-gate">
        <p className="fs-sr" role="status">
          {GATE_COPY.loading}
        </p>
        <div className="fsc-gate__beds" aria-hidden data-columns={beds.length}>
          {beds.map((column, c) => (
            <div key={c} className="fsc-gate__column">
              {column.map((bed, i) => (
                <div key={i} className="fsc-gate__group" data-shape={bed.shape}>
                  <PrintBed
                    shape={bed.shape}
                    count={bed.count}
                    height={bed.height}
                    width={bed.width}
                    labels={bed.labels}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScreenRoot>
    );
  }
  if (seasonCode !== undefined && seasonCode !== snapshot.season.label) {
    return (
      <ScreenRoot id={id} state="error" className="fsc-gate" labelledBy={`${id}-missing`}>
        <h1 id={`${id}-missing`} className="fs-t-title-1">
          {GATE_COPY.noSeason(seasonCode)}
        </h1>
        <p className="fsc-gate__lede">
          {GATE_COPY.oneSeason}{" "}
          <AppLink href={webRoutes.season(snapshot.season.label)} className="fs-link">
            {GATE_COPY.openSeason(snapshot.season.label)}
          </AppLink>
        </p>
      </ScreenRoot>
    );
  }
  return <>{children(snapshot)}</>;
}
