// The mock world tests run against: the contract-faithful mock of fs-api over the seed snapshot (IC-03), with
// every step's events emitted at once ("instant") so a test drives a whole judge run synchronously. The same
// world answers the in-memory adapter (fast component tests) and the msw handlers (HTTP and SSE tests).

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import type { DataAdapter } from "../data/adapter.js";
import { createHttpAdapter } from "../data/http.js";
import { createMemoryAdapter } from "../data/mock/memory.js";
import { MockWorld, type MockWorldOptions } from "../data/mock/world.js";
import { createDataRuntime, type DataRuntime } from "../data/provider.js";
import { createQueryClient } from "../data/query.js";

/** The seeded season (validated once by @fairsplit/seed). */
export function seedSnapshot(): SeasonSnapshot {
  return getSnapshot();
}

export function createTestWorld(options: Partial<MockWorldOptions> = {}): MockWorld {
  return new MockWorld({ snapshot: seedSnapshot(), pace: "instant", runBlock: 417, ...options });
}

/** A data runtime over the world through the in-memory adapter (no network, no msw). */
export function createTestRuntime(world: MockWorld = createTestWorld()): {
  readonly runtime: DataRuntime;
  readonly adapter: DataAdapter;
  readonly world: MockWorld;
} {
  const adapter = createMemoryAdapter(world, { paypalRail: "simulator" });
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return { runtime: createDataRuntime(adapter, client), adapter, world };
}

/** The HTTP adapter pointed at msw's origin in Node (pair it with startMockServer). */
export function createTestHttpAdapter(origin = "http://localhost"): DataAdapter {
  return createHttpAdapter({
    baseUrl: origin,
    snapshot: async () => seedSnapshot(),
    paypalRail: "simulator",
  });
}
