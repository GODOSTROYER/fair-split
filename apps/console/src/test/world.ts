// The mock world tests run against: api-client's contract-faithful mock of fs-api over the seed (IC-03), at the
// Judge stage's first press (`invoiced`), in manual pace so nothing moves on a timer. A test drives the run as
// the people would (`world.markPaid()`, `world.resolve("H1")`, `world.cosign()`: each settles the reading or
// fan-out it starts); a command pressed through the UI leaves those asynchronous steps queued until
// `world.settle()`. The same handlers answer the in-memory adapter (fast component tests) and msw/node (HTTP and
// SSE tests).

import type { MockWorld } from "@fairsplit/api-client/msw";
import type { SeasonSnapshot } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import type { RequestHandler } from "msw";
import type { DataAdapter } from "../data/adapter.js";
import { createApiAdapter } from "../data/api.js";
import {
  type ConsoleMock,
  type ConsoleMockOptions,
  createConsoleMock,
  createMemoryFetch,
  createMockAdapter,
  type MockDriver,
} from "../data/mock/index.js";
import { createDataRuntime, type DataRuntime } from "../data/provider.js";
import { createQueryClient } from "../data/query.js";

/** The seeded season (validated once by @fairsplit/seed). */
export function seedSnapshot(): SeasonSnapshot {
  return getSnapshot();
}

/** The mock world plus a driver acting as the people in the story, and the handlers that serve it. */
export type TestWorld = MockWorld & MockDriver & { readonly mock: ConsoleMock };

export function createTestWorld(options: ConsoleMockOptions = {}): TestWorld {
  const mock = createConsoleMock({ stage: "invoiced", pace: "manual", ...options });
  // The world's own getters (stage, run, pending) close over its state, so a prototype link keeps them live.
  const world = Object.create(mock.world) as TestWorld;
  return Object.assign(world, mock.driver, { mock });
}

/** A data runtime over the world through the in-memory adapter (msw's handlers, no interception). */
export function createTestRuntime(
  world: TestWorld = createTestWorld(),
  /** msw handlers answered before the world's (record requests, or answer as fs-api would where the mock differs). */
  handlers: readonly RequestHandler[] = [],
  /** The IC-03 snapshot loader (default: the seed, at once). */
  snapshot: (season: string) => Promise<SeasonSnapshot> = async () => seedSnapshot(),
): {
  readonly runtime: DataRuntime;
  readonly adapter: DataAdapter;
  readonly world: TestWorld;
} {
  const adapter = createMockAdapter(world.mock, {
    snapshot,
    ...(handlers.length > 0 ? { fetch: createMemoryFetch([...handlers, ...world.mock.handlers]) } : {}),
  });
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return { runtime: createDataRuntime(adapter, client), adapter, world };
}

/** The adapter over real fetch at msw's origin in Node (pair it with startMockServer). */
export function createTestHttpAdapter(origin = "http://localhost"): DataAdapter {
  return createApiAdapter({
    source: "mock",
    baseUrl: origin,
    snapshot: async () => seedSnapshot(),
    paypalRail: "simulator",
  });
}
