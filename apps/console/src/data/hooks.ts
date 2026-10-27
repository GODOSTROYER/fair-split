// The hooks screens use. Reads go through TanStack Query; state that moves arrives as RunEvents over one SSE
// stream per run and is reduced into the run's query data; commands are mutations whose results the events
// then confirm. Nothing here formats money: that is lib/format.

import type { RunEvent, SeasonSnapshot } from "@fairsplit/contracts";
import { type UseMutationOptions, type UseQueryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaypalRail } from "../lib/env.js";
import type { CallableName, CommandInput, CommandResponse, GetCommandName, StreamStatus } from "./adapter.js";
import { type DescribeContext, describeContext } from "./describe.js";
import type { CommandError } from "./errors.js";
import type { EventMeta } from "./hub.js";
import { useDataRuntime } from "./provider.js";
import { firstViewQuery, queryKeys, runViewQuery, snapshotQuery } from "./query.js";
import type { RunView } from "./run-view.js";
import type { JudgeSession, SessionState } from "./session.js";

export function useAdapter() {
  return useDataRuntime().adapter;
}

/** A command as a mutation: `const resolve = useCommand("resolveHold"); resolve.mutate({ params, body })`. */
export function useCommand<N extends CallableName>(
  name: N,
  options: Omit<UseMutationOptions<CommandResponse<N>, CommandError<N>, CommandInput<N>>, "mutationFn"> = {},
) {
  const { adapter } = useDataRuntime();
  return useMutation<CommandResponse<N>, CommandError<N>, CommandInput<N>>({
    ...options,
    mutationKey: ["command", name],
    mutationFn: (input) => adapter.call(name, input),
  });
}

/** A GET command as a query (approvalPayload, proof, proofJson, proofExport). */
export function useCommandQuery<N extends GetCommandName>(
  name: N,
  input: CommandInput<N>,
  options: Omit<UseQueryOptions<CommandResponse<N>, CommandError<N>>, "queryKey" | "queryFn"> = {},
) {
  const { adapter } = useDataRuntime();
  return useQuery<CommandResponse<N>, CommandError<N>>({
    ...options,
    queryKey: queryKeys.command(name, input),
    queryFn: ({ signal }) => adapter.call(name, input, { signal }),
  });
}

/** The IC-03 season snapshot: members, slips, photos, rate card, figures, checkpoints and the showcase run. */
export function useSnapshot() {
  const { adapter } = useDataRuntime();
  return useQuery(snapshotQuery(adapter));
}

/** Run-log wording bound to the snapshot's names and amounts. */
export function useDescribeContext(): DescribeContext | null {
  const snapshot = useSnapshot().data;
  return useMemo(() => (snapshot ? describeContext(snapshot) : null), [snapshot]);
}

export interface JudgeSessionApi extends SessionState {
  start(): Promise<JudgeSession>;
  reset(): Promise<void>;
  dismissError(): void;
}

export function useJudgeSession(): JudgeSessionApi {
  const { session, hub } = useDataRuntime();
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  return useMemo(
    () => ({
      ...state,
      start: () => session.start(),
      reset: async () => {
        hub.closeAll();
        await session.reset();
      },
      dismissError: () => session.dismissError(),
    }),
    [state, session, hub],
  );
}

/** The status of a stream nobody asked for. One constant: useSyncExternalStore needs a stable snapshot. */
const NO_STREAM: StreamStatus = { kind: "closed", reason: "unsubscribed" };

/** Keeps a run's SSE stream open while mounted and returns its status. `null` subscribes to nothing. */
export function useRunStream(runSlug: string | null): StreamStatus {
  const { hub } = useDataRuntime();
  useEffect(() => (runSlug ? hub.acquire(runSlug) : undefined), [hub, runSlug]);
  const subscribe = useCallback(
    (listener: () => void) => (runSlug ? hub.onStatus(runSlug, listener) : () => undefined),
    [hub, runSlug],
  );
  const read = useCallback((): StreamStatus => (runSlug ? hub.status(runSlug) : NO_STREAM), [hub, runSlug]);
  return useSyncExternalStore(subscribe, read, read);
}

/** A run's live view (snapshot base plus every streamed event). Pair it with useRunStream to stay live. */
export function useRunView(runSlug: string) {
  return useQuery(runViewQuery(useDataRuntime(), runSlug));
}

/**
 * Raw events for one run, with `meta.replay` true for history the stream replayed on connect. Start a moment
 * only when `!meta.replay`, passing `event.id` as its evidence.
 */
export function useRunEvents(
  runSlug: string | null,
  listener: (event: RunEvent, meta: EventMeta) => void,
): void {
  const { hub } = useDataRuntime();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!runSlug) return;
    return hub.listen(runSlug, (event, meta) => latest.current(event, meta));
  }, [hub, runSlug]);
}

export interface StageRun {
  /** The run the stage is showing: the judge session's, or the showcase first view. */
  readonly runSlug: string | null;
  readonly view: RunView | undefined;
  /** True once a judge session exists (the first press). */
  readonly inSession: boolean;
  readonly snapshot: SeasonSnapshot | undefined;
}

/** The stage's current run. Before the first press it is the first view, built with no calls (S3.9). */
export function useStageRun(): StageRun {
  const runtime = useDataRuntime();
  const { adapter, client } = runtime;
  const session = useJudgeSession();
  const snapshot = useSnapshot().data;
  const runSlug = session.session?.runSlug ?? null;
  const live = useQuery({ ...runViewQuery(runtime, runSlug ?? "none"), enabled: runSlug !== null });
  const first = useQuery({ ...firstViewQuery(adapter, client), enabled: runSlug === null });
  return {
    runSlug: runSlug ?? snapshot?.run.runSlug ?? null,
    view: runSlug ? live.data : first.data,
    inSession: runSlug !== null,
    snapshot,
  };
}

export function usePaypalRail(): PaypalRail | undefined {
  const { adapter } = useDataRuntime();
  return useQuery({
    queryKey: queryKeys.paypalRail(),
    queryFn: () => adapter.pending.paypalRail(),
    staleTime: Infinity,
  }).data;
}
