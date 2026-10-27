// The data runtime the whole console shares: the adapter (HTTP or mock), the TanStack Query client, the
// judge session and the SSE hub. Tests build their own runtime over a mock world.

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import type { DataAdapter } from "./adapter.js";
import { StreamHub } from "./hub.js";
import { createQueryClient } from "./query.js";
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
  return { adapter, client, session: new SessionStore(adapter), hub: new StreamHub(adapter, client) };
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
