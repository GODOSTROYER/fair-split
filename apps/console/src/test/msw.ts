// msw in Node for tests: every API_COMMANDS entry (and the SSE streams) answered by a MockWorld over the seed,
// through the same handlers the dev build's service worker uses. Unhandled requests fail the test: a test
// never reaches the network (no live API calls, ever).

import { setupServer } from "msw/node";
import { createMockHandlers } from "../data/mock/handlers.js";
import type { MockWorld } from "../data/mock/world.js";

export const TEST_ORIGIN = "http://localhost";

export interface MockServer {
  close(): void;
}

/** Starts msw for one world. Call close() in afterEach/afterAll. */
export function startMockServer(world: MockWorld, origin: string = TEST_ORIGIN): MockServer {
  const server = setupServer(...createMockHandlers(world, { origin }));
  server.listen({ onUnhandledFrame: "error" });
  return { close: () => server.close() };
}
