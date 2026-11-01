// TanStack Query: one client per app, query keys in one place, and the query options the hooks share.
// Server state that changes arrives as RunEvents, so mutations do not refetch; queries are for reads.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { DataAdapter } from "./adapter.js";
import { isApiClientError, isContractError } from "./errors.js";
import { baseRunView, firstView, type RunView, sessionView } from "./run-view.js";
import type { JudgeSession } from "./session.js";
import { SHOWCASE_SEASON } from "./snapshot.js";

export const queryKeys = {
  snapshot: (season: string) => ["snapshot", season] as const,
  run: (runSlug: string) => ["run", runSlug] as const,
  firstView: () => ["run", "first-view"] as const,
  command: (name: string, input: unknown) => ["command", name, input] as const,
  paypalRail: () => ["paypal-rail"] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx is an answer and a contract drift will not fix itself: retry only network failures and 5xx, twice.
        retry: (count, error) => {
          if (isApiClientError(error) && error.status < 500) return false;
          if (isContractError(error)) return false;
          return count < 2;
        },
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

export function snapshotQuery(adapter: DataAdapter, season: string = SHOWCASE_SEASON) {
  return queryOptions<SeasonSnapshot>({
    queryKey: queryKeys.snapshot(season),
    queryFn: () => adapter.pending.snapshot(season),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** What a run view is built from: the adapter, the query client and the judge session (if one is active). */
export interface RunViewDeps {
  readonly adapter: DataAdapter;
  readonly client: QueryClient;
  readonly session?: { getState(): { readonly session: JudgeSession | null } };
}

/**
 * A run's live view: its base, then every streamed event reduced onto it. The judge session's run starts from
 * the INVOICED clone (sessionView) and replays its stream from the start; any other run is read from the
 * snapshot (the showcase, r37) until the API has run reads.
 */
export function runViewQuery(deps: RunViewDeps, runSlug: string) {
  return queryOptions<RunView>({
    queryKey: queryKeys.run(runSlug),
    queryFn: async () => {
      const snapshot = await deps.client.ensureQueryData(snapshotQuery(deps.adapter));
      const session = deps.session?.getState().session ?? null;
      return session?.runSlug === runSlug ? sessionView(snapshot, session) : baseRunView(snapshot, runSlug);
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  });
}

/** The Judge stage's first view: the showcase at INVOICED, rendered with no session and no calls. */
export function firstViewQuery(adapter: DataAdapter, client: QueryClient) {
  return queryOptions<RunView>({
    queryKey: queryKeys.firstView(),
    queryFn: async () => firstView(await client.ensureQueryData(snapshotQuery(adapter))),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
