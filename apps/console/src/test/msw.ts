// msw in Node for tests: every API_COMMANDS entry, the SSE streams and the console's pending routes, answered by
// a test world's handlers (the same ones the dev build's service worker uses). Unhandled requests fail the
// test: a test never reaches the network (no live API calls, ever).

import { setupServer } from "msw/node";
import type { TestWorld } from "./world.js";

/** The origin createTestHttpAdapter() calls (the handlers match any origin). */
export const TEST_ORIGIN = "http://localhost";

export interface MockServer {
  close(): void;
}

/** Starts msw for one world. Call close() in afterEach/afterAll. */
export function startMockServer(world: TestWorld): MockServer {
  const server = setupServer(...world.mock.handlers);
  server.listen({ onUnhandledFrame: "error" });
  return { close: () => server.close() };
}
