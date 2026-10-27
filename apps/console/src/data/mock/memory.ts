// msw without a network: a `fetch` that hands each request straight to the mock handlers (msw's `getResponse`).
// Component tests use it because it is fast and needs no interception; `vite dev` falls back to it where a
// service worker cannot register (some embedded browsers, private windows). Callers see what they would over
// HTTP: the same handlers, statuses, headers, IC-01 error bodies and SSE frames. An abort ends a streamed body
// the way a closed connection does, so the mock's SSE subscription is released.

import type { FetchLike } from "@fairsplit/api-client";
import { getResponse, type RequestHandler } from "msw";

/** The origin relative URLs resolve against in memory (nothing is ever sent there). */
export const MEMORY_ORIGIN = "http://console.mock.invalid";

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

/** Re-wraps a streamed body so that `signal` ends it (and cancels the handler's stream). */
function abortable(response: Response, signal: AbortSignal): Response {
  const body = response.body;
  if (!body) return response;
  const source = body.getReader();
  const stop = () => {
    source.cancel(abortError()).catch(() => undefined);
  };
  signal.addEventListener("abort", stop, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) {
          signal.removeEventListener("abort", stop);
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      signal.removeEventListener("abort", stop);
      return source.cancel(reason);
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * A fetch over msw handlers, in memory. A request no handler answers rejects like a refused connection: the
 * mock is the whole world, so nothing reaches the network.
 */
export function createMemoryFetch(
  handlers: readonly RequestHandler[],
  origin: string = MEMORY_ORIGIN,
): FetchLike {
  return async (input, init = {}) => {
    const { signal, ...rest } = init;
    if (signal?.aborted) throw abortError();
    // A network round trip never answers in the same task: let the caller's code run first.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw abortError();
    const request = new Request(new URL(input, origin), rest);
    const response = await getResponse([...handlers], request);
    if (!response) {
      throw new TypeError(`No mock answers ${request.method} ${new URL(request.url).pathname}.`);
    }
    return signal ? abortable(response, signal) : response;
  };
}
