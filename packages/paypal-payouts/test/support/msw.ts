// msw harness. The payouts package talks to PayPal only through the injected IC-05 PayPalHttp; in
// tests that is FetchPayPalHttp (below), so every request crosses a real fetch and msw answers it.

import { type DefaultBodyType, HttpResponse, http, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const SANDBOX = "https://api-m.sandbox.paypal.com";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

export const server = setupServer();
export const requests: RecordedRequest[] = [];

export function useMsw(): void {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    requests.length = 0;
  });
  afterAll(() => server.close());
}

async function record(request: Request): Promise<RecordedRequest> {
  const text = await request.clone().text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const entry = { method: request.method, url: new URL(request.url), headers: request.headers, body };
  requests.push(entry);
  return entry;
}

export type Reply = (req: RecordedRequest, params: Record<string, string>) => Response | Promise<Response>;

function handler(method: "get" | "post", path: string, reply: Reply) {
  return http[method](`${SANDBOX}${path}`, async ({ request, params }) =>
    reply(await record(request), params as Record<string, string>),
  );
}

export const onGet = (path: string, reply: Reply) => server.use(handler("get", path, reply));
export const onPost = (path: string, reply: Reply) => server.use(handler("post", path, reply));

export function paypalJson(body: JsonBodyType, status = 200, debugId = "8f3c2a1b9d0e7"): Response {
  return HttpResponse.json(body, { status, headers: { "paypal-debug-id": debugId } });
}

export function paypalEmpty(status = 204): Response {
  return new HttpResponse(null as DefaultBodyType, { status });
}

/** First reply, then the next, …; the last one repeats. */
export function sequence(...replies: Reply[]): Reply {
  let i = 0;
  return (req, params) => {
    const reply = replies[Math.min(i, replies.length - 1)] as Reply;
    i += 1;
    return reply(req, params);
  };
}
