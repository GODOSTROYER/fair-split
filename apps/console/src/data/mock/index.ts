// The console's mock API: api-client's seeded, stateful fs-api (`@fairsplit/api-client/msw`, IC-03 snapshot,
// every IC-01 command, SSE with Last-Event-ID replay, X-FS-Rail: simulated) plus the console's pending routes
// (./pending.ts), and a driver that acts as the people in the story (./driver.ts). The Judge stage starts at
// `invoiced`: the first press is `markPaid`. The adapter runs over msw in memory, or over HTTP when a service
// worker or msw/node intercepts.

import type { FetchLike } from "@fairsplit/api-client";
import {
  createMockApi,
  type MockStage,
  type MockWorld,
  type MockWorldOptions,
} from "@fairsplit/api-client/msw";
import { getSnapshot } from "@fairsplit/api-client/seed";
import type { SeasonSnapshot } from "@fairsplit/contracts";
import type { RequestHandler } from "msw";
import type { DataAdapter } from "../adapter.js";
import { createApiAdapter } from "../api.js";
import { createMockDriver, type MockDriver } from "./driver.js";
import { createFidelityHandlers } from "./fidelity.js";
import { createMemoryFetch } from "./memory.js";
import { createPendingHandlers } from "./pending.js";

export interface ConsoleMockOptions extends MockWorldOptions {
  /** Origin to match (`http://localhost` in Node tests); default any origin. */
  readonly baseUrl?: string;
  /** Simulated latency per request (ms, or msw's "real"). */
  readonly latency?: number | "real";
  /** The workspace's rate card ID, as a judge workspace's clone mints its own (default: the seed's). */
  readonly rateCardId?: string;
}

export interface ConsoleMock {
  readonly world: MockWorld;
  readonly driver: MockDriver;
  /** The pending routes and fs-api's rules api-client's mock lacks (./fidelity.ts), then every IC-01 command and stream. */
  readonly handlers: readonly RequestHandler[];
  /** Where the world starts, and where Reset returns it. */
  readonly stage: MockStage;
}

export function createConsoleMock(options: ConsoleMockOptions = {}): ConsoleMock {
  const { baseUrl, latency, rateCardId, ...worldOptions } = options;
  const stage = worldOptions.stage ?? "invoiced";
  const { world, handlers } = createMockApi({
    ...worldOptions,
    stage,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(latency !== undefined ? { latency } : {}),
  });
  const clock = worldOptions.now;
  const pending = createPendingHandlers({
    world,
    resetStage: stage,
    ...(clock ? { now: () => clock().getTime() } : {}),
  });
  const fidelity = createFidelityHandlers({
    world,
    rateCardId: rateCardId ?? getSnapshot().rateCard.id,
    upstream: handlers,
  });
  return {
    world,
    driver: createMockDriver(world, { settle: (worldOptions.pace ?? "auto") === "manual" }),
    handlers: [...pending, ...fidelity, ...handlers],
    stage,
  };
}

export interface MockAdapterOptions {
  readonly snapshot: (season: string) => Promise<SeasonSnapshot>;
  /** Over HTTP (a service worker or msw/node intercepts); default: msw in memory. */
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

/** The console's adapter over a mock: the same adapter as production, labelled `mock`. */
export function createMockAdapter(mock: ConsoleMock, options: MockAdapterOptions): DataAdapter {
  return createApiAdapter({
    source: "mock",
    baseUrl: options.baseUrl ?? "",
    fetch: options.fetch ?? createMemoryFetch(mock.handlers),
    snapshot: options.snapshot,
    paypalRail: mock.world.rail === "sandbox" ? "sandbox" : "simulator",
  });
}

export { createMockDriver, type MockDriver } from "./driver.js";
export { createMemoryFetch, MEMORY_ORIGIN } from "./memory.js";
