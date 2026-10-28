// A request log for component tests: an msw handler that notes every request the console sends and lets it
// through to the world, installed before the first render (renderConsole's `handlers`), so a "no calls" check
// sees what the page sent while mounting too.

import { http, type RequestHandler } from "msw";

export interface SentRequest {
  readonly method: string;
  readonly path: string;
  /** The Authorization header, when one was sent. */
  readonly authorization: string | null;
}

export interface RequestLog {
  readonly handler: RequestHandler;
  readonly sent: SentRequest[];
  /** The requests other than the rail label read (`GET /healthz`, which never changes anything). */
  calls(): SentRequest[];
}

export function recordRequests(): RequestLog {
  const sent: SentRequest[] = [];
  const handler = http.all("*", ({ request }) => {
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get("authorization"),
    });
    // No answer: the world's own handlers answer it.
    return undefined;
  });
  return {
    handler,
    sent,
    calls: () => sent.filter((r) => !(r.method === "GET" && r.path === "/healthz")),
  };
}
