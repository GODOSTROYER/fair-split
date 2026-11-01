// The data runtime the whole console shares: the adapter (HTTP or mock), the TanStack Query client, the
// judge session and the SSE hub. Tests build their own runtime over a mock world.

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import type { DataAdapter } from "./adapter.js";
import { StreamHub } from "./hub.js";
import { createQueryClient, queryKeys } from "./query.js";
import { SessionStore } from "./session.js";

export interface DataRuntime {
  readonly adapter: DataAdapter;
  readonly client: QueryClient;
  readonly session: SessionStore;
  readonly hub: StreamHub;
}

export function createDataRuntime(
  adapter: DataAdapter,
  client: QueryClient = createQueryClient(),
): DataRuntime {
  const session = new SessionStore(adapter);
  const hub = new StreamHub({ adapter, client, session });
  // A renewed console token reopens the streams the lapsed one closed.
  session.onRenewed(() => hub.reconnect());
  // A session's run starts from its own base and its own stream: whatever was cached under its slug (the
  // showcase read, or the run of the session Reset just ended) is dropped when a session starts and when it ends.
  let sessionRun: string | null = null;
  session.subscribe(() => {
    const next = session.getState().session?.runSlug ?? null;
    if (next === sessionRun) return;
    for (const slug of [sessionRun, next]) {
      if (slug) client.removeQueries({ queryKey: queryKeys.run(slug), exact: true });
    }
    sessionRun = next;
  });
  return { adapter, client, session, hub };
}

const DataContext = createContext<DataRuntime | null>(null);

export function DataProvider({
  runtime,
  children,
}: {
  readonly runtime: DataRuntime;
  readonly children: ReactNode;
}) {
  return (
    <DataContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.client}>{children}</QueryClientProvider>
    </DataContext.Provider>
  );
}

export function useDataRuntime(): DataRuntime {
  const runtime = useContext(DataContext);
  if (!runtime) throw new Error("useDataRuntime needs a <DataProvider> above it.");
  return runtime;
}
