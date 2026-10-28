// `@fairsplit/api-client/msw`: a seeded, stateful fs-api for UI development and tests.
//
//   // Node (Vitest)                                    // Browser (Vite dev, console or /app)
//   import { setupServer } from "msw/node";               import { setupWorker } from "msw/browser";
//   const mock = createMockApi({ pace: "manual" });       const mock = createMockApi({ stage: "invoiced" });
//   const server = setupServer(...mock.handlers);        await setupWorker(...mock.handlers).start();
//   server.listen({ onUnhandledFrame: "error" });
//
//   mock.world.failNext("submitApproval", "KILL_SWITCH_ON");   // reach a hard-to-reach state
//   mock.world.advance();                                       // play the next asynchronous step (manual pace)
//
// See packages/api-client/README.md for the stages and the hero path.
import { createMockHandlers, type MockHandlerOptions } from "./handlers.js";
import { createRouteHandlers } from "./routes.js";
import { createMockWorld, type MockWorld, type MockWorldOptions } from "./world.js";

export {
  createMockHandlers,
  injectableCodes,
  type MockHandlerOptions,
  urlPattern,
} from "./handlers.js";
export { freshId, mockHex, mockId, mockToken } from "./ids.js";
export { createRouteHandlers } from "./routes.js";
export {
  type CommandInvocation,
  type CommandOutcome,
  createMockWorld,
  MOCK_ALLOWED_RESOLUTIONS,
  MOCK_CONSOLE_TOKEN,
  MOCK_SESSION_ID,
  MOCK_WORKSPACE_ID,
  type MockCaller,
  MockProblem,
  type MockStage,
  type MockWorld,
  type MockWorldOptions,
} from "./world.js";

export interface MockApi {
  world: MockWorld;
  /** Every IC-01 command, the four streams, and the judge and auth routes (`JUDGE_ROUTES`). */
  handlers: ReturnType<typeof createMockHandlers>;
}

/** A world and its handlers in one call. */
export function createMockApi(options: MockWorldOptions & Omit<MockHandlerOptions, "world"> = {}): MockApi {
  const { baseUrl, latency, auth, judgeCode, operatorPassword, ...worldOptions } = options;
  const world = createMockWorld(worldOptions);
  const handlerOptions: MockHandlerOptions = {
    world,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(latency !== undefined ? { latency } : {}),
    ...(auth !== undefined ? { auth } : {}),
    ...(judgeCode !== undefined ? { judgeCode } : {}),
    ...(operatorPassword !== undefined ? { operatorPassword } : {}),
  };
  return { world, handlers: [...createMockHandlers(handlerOptions), ...createRouteHandlers(handlerOptions)] };
}
