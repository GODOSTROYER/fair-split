// The hooks screens use. Reads go through TanStack Query; state that moves arrives as RunEvents over one SSE
// stream per run and is reduced into the run's query data; commands are mutations whose results the events
// then confirm. Nothing here formats money: that is lib/format.

import { judgeRoutes } from "@fairsplit/api-client";
import { PAY_RUN_RANK, type RunEvent, type SeasonSnapshot } from "@fairsplit/contracts";
import { type UseMutationOptions, type UseQueryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PaypalRail } from "../lib/env.js";
import type { CallableName, CommandInput, CommandResponse, GetCommandName, StreamStatus } from "./adapter.js";
import { type DescribeContext, describeContext } from "./describe.js";
import type { CommandError } from "./errors.js";
import { isApiClientError } from "./errors.js";
import type { EventMeta } from "./hub.js";
import { pacedCall } from "./pacing.js";
import { useDataRuntime } from "./provider.js";
import { firstViewQuery, queryKeys, runViewQuery, snapshotQuery } from "./query.js";
import type { RunView } from "./run-view.js";
import type { InvoiceReadiness, JudgeSession, SessionState } from "./session.js";

export function useAdapter() {
  return useDataRuntime().adapter;
}

/** A command as a mutation: `const resolve = useCommand("resolveHold"); resolve.mutate({ params, body })`. */
export function useCommand<N extends CallableName>(
  name: N,
  options: Omit<UseMutationOptions<CommandResponse<N>, CommandError<N>, CommandInput<N>>, "mutationFn"> = {},
) {
  const { adapter, session } = useDataRuntime();
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [queue, setQueue] = useState<{ workspace: string | undefined; ms: number } | null>(null);
  const attempt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (state.status !== "active") abort.current?.abort();
    return () => {
      abort.current?.abort();
    };
  }, [state.session?.workspaceId, state.status]);
  const mutation = useMutation<CommandResponse<N>, CommandError<N>, CommandInput<N>>({
    ...options,
    mutationKey: ["command", name],
    mutationFn: async (input) => {
      const workspace = session.getState().session?.workspaceId;
      const serial = ++attempt.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const current = () =>
        session.getState().session?.workspaceId === workspace && session.getState().status !== "resetting";
      return pacedCall(
        async () => {
          try {
            return await adapter.call(name, input);
          } catch (error) {
            // A duplicate Mark paid races the first payment: read its run before calling it a refusal.
            if (name === "markPaid" && isApiClientError(error) && error.status === 409) {
              const status = await judgeRoutes(adapter.api).judgeSession();
              const rank = status.runState ? PAY_RUN_RANK[status.runState] : 0;
              if (
                status.runSlug === (input as { params?: { runSlug?: string } }).params?.runSlug &&
                rank >= PAY_RUN_RANK.FUNDED &&
                rank < 99
              ) {
                return { runState: status.runState } as CommandResponse<N>;
              }
            }
            throw error;
          }
        },
        (ms) => {
          if (serial === attempt.current) setQueue(ms === null ? null : { workspace, ms });
        },
        current,
        controller.signal,
      );
    },
  });
  return {
    ...mutation,
    queuedMs:
      queue?.workspace === state.session?.workspaceId && state.status === "active"
        ? (queue?.ms ?? null)
        : null,
  };
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
  /** Waits until the session's run is invoiced, or past it (the first press records the payment only then). */
  whenInvoiced(session: JudgeSession): Promise<InvoiceReadiness>;
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
      whenInvoiced: (started: JudgeSession) => session.whenInvoiced(started),
      reset: async () => {
        // Throws when the server still holds the session: its streams stay open then.
        await session.reset();
        hub.closeAll();
      },
      dismissError: () => session.dismissError(),
    }),
    [state, session, hub],
  );
}

/**
 * Why the API replays PayPal steps for this judge session (S3.9, GET /v1/judge/session `rail.reason`), or null:
 * read while a session is active and every 15 s after, so the stage can name the circuit and a low balance.
 */
export function useJudgeReplayRail() {
  const { adapter, session } = useDataRuntime();
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const sessionId = state.status === "active" ? (state.session?.sessionId ?? null) : null;
  const query = useQuery({
    queryKey: ["judge-session-status", sessionId, state.session?.workspaceId] as const,
    queryFn: () => judgeRoutes(adapter.api).judgeSession(),
    enabled: sessionId !== null,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
  if (sessionId === null || !query.data?.rail) return null;
  return { ...query.data.rail, runState: query.data.runState };
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
