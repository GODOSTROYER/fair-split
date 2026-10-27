// TanStack Query: one client per app, query keys in one place, and the query options the hooks share.
// Server state that changes arrives as RunEvents, so mutations do not refetch; queries are for reads.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { DataAdapter } from "./adapter.js";
import { isApiRequestError } from "./errors.js";
import { baseRunView, firstView, type RunView } from "./run-view.js";
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
        // A 4xx is an answer, not a blip: retry only transport failures and 5xx, twice.
        retry: (count, error) => {
          if (isApiRequestError(error) && error.status < 500) return false;
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

/** A run's live view: the snapshot-based base, then every streamed event reduced onto it. */
export function runViewQuery(adapter: DataAdapter, client: QueryClient, runSlug: string) {
  return queryOptions<RunView>({
    queryKey: queryKeys.run(runSlug),
    queryFn: async () => baseRunView(await client.ensureQueryData(snapshotQuery(adapter)), runSlug),
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
