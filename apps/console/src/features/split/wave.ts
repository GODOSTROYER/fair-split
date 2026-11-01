// The MM-3 wave (S2.9): when a person's decision makes the engine recompute, every line whose amounts changed
// gains its cents in a downward wave, 6 ms a row and at most 380 ms in all, starting at the act's `wave` step.
// Which lines change is a pure comparison of the two engine computations, so the delays are known in the same
// frame the new amounts are, and replays (which never animate) cost nothing.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { TIMELINES, TIMING } from "@fairsplit/motion";
import type { RunView } from "../../data/run-view.js";
import { type SplitBasis, type SplitRow, splitBasis } from "./model.js";

/** The computation a decision moved the run from: reading → by hand → resolved. */
export function previousBasis(basis: SplitBasis): SplitBasis | null {
  if (basis === "resolved") return "byHand";
  if (basis === "byHand") return "read";
  return null;
}

/** When the wave starts after the deciding event: the MM-3 `count-once` act's `wave` step (200 ms). */
export function waveStartMs(): number {
  const act = TIMELINES["MM-3"].acts.find((a) => a.id === "count-once");
  return act?.full.find((s) => s.phase === "wave")?.at ?? 0;
}

/**
 * Per-member delay for a wave from the previous computation to this one, in display order. Only lines whose
 * net changed get a delay; the rest keep still.
 */
export function waveDelays(
  snapshot: SeasonSnapshot,
  view: RunView,
  displayRows: readonly SplitRow[],
): ReadonlyMap<string, number> {
  const basis = splitBasis(view);
  const from = previousBasis(basis);
  const out = new Map<string, number>();
  if (!from) return out;
  const before = new Map(snapshot.checkpoints[from].lines.map((l) => [l.memberNo, l.netCents]));
  const after = new Map(snapshot.checkpoints[basis].lines.map((l) => [l.memberNo, l.netCents]));
  const start = waveStartMs();
  let i = 0;
  for (const row of displayRows) {
    const was = before.get(row.memberNo);
    const now = after.get(row.memberNo);
    if (was === undefined || now === undefined || was === now) continue;
    out.set(row.memberNo, start + Math.min(i * TIMING.waveStep, TIMING.waveCap));
    i += 1;
  }
  return out;
}
