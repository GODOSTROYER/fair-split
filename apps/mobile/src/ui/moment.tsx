/**
 * Magic-moment plumbing (S2.8 `useMoment`, S2.9 markers). A moment's phases are the test contract: they come only from
 * `_shims/moments.ts` (IC-10), so an unknown phase fails to compile, and the full and reduced renderers emit the same
 * phases.
 *
 *   const mm1 = useMoment("MM-1", "pending");
 *   if (mm1.start(event.id, "press")) { … mm1.timers.at(TIMELINE["MM-1"].flood, () => mm1.set("flood")) … }
 *   <View {...mm1.rootProps}><MomentMarker id="MM-1" phase={mm1.phase} />…</View>
 *
 * - `rootProps` gives the root `testID="moment-MM-1"` and `data-moment` / `data-moment-phase` on the web export.
 * - `MomentMarker` is the 1×1 native marker `moment-MM-1-phase-<phase>` that Maestro waits for.
 * - Every phase change is forwarded to the judge stage (IC-12 `fs.moment`) and, in dev builds or with
 *   `?fsTrace=1`, appended to `window.__fsMoments` as `{m, phase, t}`.
 * - `start(eventId, phase)` refuses to start without a real event id, and never plays the same event twice
 *   (motion is evidence: a redelivered webhook changes nothing, MM-6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MOMENTS, type MomentId, type MomentPhase } from "../_shims/moments";
import { webQuery } from "../platform/query";
import { stage } from "../services/frame-bridge";

export { isPhase, MOMENTS, type MomentId, type MomentPhase } from "../_shims/moments";

interface TraceEntry {
  m: string;
  phase: string;
  t: number;
}

const tracing = (typeof __DEV__ !== "undefined" && __DEV__) || webQuery("fsTrace") === "1";

function trace(m: string, phase: string): void {
  if (!tracing) return;
  const g = globalThis as { __fsMoments?: TraceEntry[] };
  g.__fsMoments ??= [];
  g.__fsMoments.push({ m, phase, t: Date.now() });
}

/** setTimeout bookkeeping that is cleared on unmount, so a moment never fires into an unmounted screen. */
export function useTimers() {
  const ids = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = useCallback(() => {
    for (const id of ids.current) clearTimeout(id);
    ids.current = [];
  }, []);
  const at = useCallback((ms: number, fn: () => void) => {
    ids.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => clear, [clear]);
  return useMemo(() => ({ at, clear }), [at, clear]);
}

export function useMoment<M extends MomentId>(id: M, initial: MomentPhase<M>) {
  const [phase, setPhase] = useState<MomentPhase<M>>(initial);
  const played = useRef<string | null>(null);
  const timers = useTimers();

  const set = useCallback(
    (p: MomentPhase<M>) => {
      if (!(MOMENTS[id] as readonly string[]).includes(p)) return;
      trace(id, p);
      stage.moment(id, p);
      setPhase(p);
    },
    [id],
  );

  /** Starts the moment for one real event (an SSE `RunEvent` id, a 201 or a signature). */
  const start = useCallback(
    (eventId: string | null | undefined, first: MomentPhase<M>): boolean => {
      if (!eventId || played.current === eventId) return false;
      played.current = eventId;
      timers.clear();
      set(first);
      return true;
    },
    [set, timers],
  );

  /** Shows a phase without playing anything (a cold load that is already paid shows `done`). */
  const rest = useCallback(
    (p: MomentPhase<M>) => {
      timers.clear();
      set(p);
    },
    [set, timers],
  );

  const rootProps = useMemo(
    () => ({ testID: `moment-${id}`, dataSet: { moment: id, momentPhase: phase } }),
    [id, phase],
  );

  return { id, phase, set, start, rest, timers, rootProps };
}

/** The native test marker for the current phase: a 1×1 view Maestro can wait for. */
export function MomentMarker<M extends MomentId>({ id, phase }: { id: M; phase: MomentPhase<M> }) {
  return (
    <View
      collapsable={false}
      testID={`moment-${id}-phase-${phase}`}
      style={styles.marker}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}

const styles = StyleSheet.create({
  marker: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
