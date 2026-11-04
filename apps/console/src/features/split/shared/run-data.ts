// What every runs-slice screen reads: the IC-03 snapshot (names, slips, the engine's checkpoints) and the run's
// live view (the snapshot base plus every streamed RunEvent). The stage already holds its own run's stream open;
// a screen asks for it too while it shows that run, so the view stays live when the screen renders outside the
// stage (tests, the print surface). The showcase run (no session) has no stream: it is the seeded end state.

import type { RunEvent, SeasonSnapshot } from "@fairsplit/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  useJudgeSession,
  usePaypalRail,
  useRunEvents,
  useRunStream,
  useRunView,
  useSnapshot,
  useStageRun,
} from "../../../data/hooks.js";
import type { RunView } from "../../../data/run-view.js";
import type { SessionState } from "../../../data/session.js";
import type { PaypalRail } from "../../../lib/env.js";
import { davaoIsoDate } from "../../proof/davao.js";

export type RunAccess = "pending" | "allowed" | "missing";

export function runAccess(
  runSlug: string,
  session: SessionState,
  snapshot: SeasonSnapshot | undefined,
): RunAccess {
  if (session.status === "resuming" || session.status === "starting" || !snapshot) return "pending";
  if (session.session) return session.session.runSlug === runSlug ? "allowed" : "missing";
  return runSlug === snapshot.run.runSlug ? "allowed" : "missing";
}

/** Preserve the seed's collection interval, anchored to this run's first recorded event in Davao. */
export function cashDayForRun(snapshot: SeasonSnapshot, view: RunView): string {
  const first = view.events[0];
  if (!first) return snapshot.run.cashDay;
  const start = davaoIsoDate(first.at);
  const offset = Math.max(0, Date.parse(snapshot.run.cashDay) - Date.parse(snapshot.run.recordedOn));
  return new Date(Date.parse(start) + offset).toISOString().slice(0, 10);
}

export interface RunData {
  readonly access: RunAccess;
  readonly snapshot: SeasonSnapshot | undefined;
  readonly view: RunView | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  /** True when this run is the judge session's live run (a stream feeds it). */
  readonly live: boolean;
  /** ADR-0002: which PayPal rail labels every PayPal-derived value (I8). */
  readonly rail: PaypalRail;
  retry(): void;
}

export function useRunData(runSlug: string): RunData {
  const snapshot = useSnapshot();
  const run = useRunView(runSlug);
  const stage = useStageRun();
  const session = useJudgeSession();
  const access = runAccess(runSlug, session, snapshot.data);
  const live = stage.inSession && stage.runSlug === runSlug;
  useRunStream(live ? runSlug : null);
  const rail = usePaypalRail() ?? "simulator";
  const refetchSnapshot = snapshot.refetch;
  const refetchRun = run.refetch;
  const retry = useCallback(() => {
    void refetchSnapshot();
    void refetchRun();
  }, [refetchSnapshot, refetchRun]);
  return {
    access,
    snapshot: snapshot.data,
    view: access === "allowed" ? run.data : undefined,
    loading: access === "pending" || snapshot.isPending || run.isPending,
    error: snapshot.error ?? run.error ?? null,
    live,
    rail,
    retry,
  };
}

/** The IDs of events that arrived live (not replayed history) since this screen mounted. */
export interface LiveEvents {
  /** True when this event came over the stream after the screen subscribed: only those may animate. */
  isLive(eventId: string | null | undefined): boolean;
  /** The newest live event of a type, for moments that start from it. */
  readonly latest: RunEvent | null;
}

/**
 * Collects live event IDs synchronously as the hub delivers them (before the re-render that shows their effect),
 * so a component rendering the new state can tell a live change (animate) from history (show as is). Motion is
 * evidence: replays change `data-state` but never move anything.
 */
export function useLiveEvents(runSlug: string | null, onLive?: (event: RunEvent) => void): LiveEvents {
  const ids = useRef(new Set<string>());
  const [latest, setLatest] = useState<RunEvent | null>(null);
  const handler = useRef(onLive);
  handler.current = onLive;
  useRunEvents(runSlug, (event, meta) => {
    if (meta.replay) return;
    ids.current.add(event.id);
    if (ids.current.size > 512) {
      const first = ids.current.values().next().value;
      if (first !== undefined) ids.current.delete(first);
    }
    setLatest(event);
    handler.current?.(event);
  });
  return useMemo(
    () => ({
      isLive: (eventId) => typeof eventId === "string" && ids.current.has(eventId),
      latest,
    }),
    [latest],
  );
}
