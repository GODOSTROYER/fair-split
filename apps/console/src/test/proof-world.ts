// Test-only helpers for the proof slice's screens (W-PF-01, W-BR-01, W-OP-01); the app never imports this file.
// `withHandlers` puts msw handlers in front of the mock world's own, to hold a request open (the loading state),
// answer with a tampered bundle (a mismatch), a 503 (degraded) or a route the mock doesn't serve yet.

import type { RequestHandler } from "msw";
import type { TestWorld } from "./index.js";

/** The same world, with `handlers` answering first (msw takes the first handler that returns a response). */
export function withHandlers(world: TestWorld, handlers: readonly RequestHandler[]): TestWorld {
  const mock = { ...world.mock, handlers: [...handlers, ...world.mock.handlers] };
  return Object.assign(Object.create(world) as TestWorld, { mock });
}

export interface Gate {
  /** Resolves once `release()` is called. */
  readonly opened: Promise<void>;
  release(): void;
}

/**
 * Holds a request until released: a handler that awaits `opened` and returns nothing passes the request on to
 * the mock's own handler, so the screen sits in its loading state until the test lets the answer through.
 */
export function gate(): Gate {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
}
