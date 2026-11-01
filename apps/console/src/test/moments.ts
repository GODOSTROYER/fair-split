// Moment assertions (S2.12): every moment root writes data-moment-phase, and in test builds appends
// {m, phase, t} to window.__fsMoments. Tests read the phases a moment went through, in full and reduced
// motion, and assert them against @fairsplit/motion's catalogue (never against phase names of their own).

import { MOMENTS, type MomentId, type MomentPhase } from "@fairsplit/motion";

/** Phases a moment entered, in order, from the trace. */
export function tracedPhases<M extends MomentId>(id: M): MomentPhase<M>[] {
  return (window.__fsMoments ?? []).filter((e) => e.m === id).map((e) => e.phase as MomentPhase<M>);
}

export function clearMomentTrace(): void {
  window.__fsMoments = [];
}

/** True when every traced phase is one the catalogue defines for this moment. */
export function phasesAreCatalogued<M extends MomentId>(id: M, phases: readonly string[]): boolean {
  const known = MOMENTS[id] as readonly string[];
  return phases.every((p) => known.includes(p));
}

/** The `data-moment-phase` of the moment root inside `root` (or null when there is none). */
export function momentPhase(root: ParentNode, id: MomentId): string | null {
  return root.querySelector<HTMLElement>(`[data-moment="${id}"]`)?.dataset.momentPhase ?? null;
}
