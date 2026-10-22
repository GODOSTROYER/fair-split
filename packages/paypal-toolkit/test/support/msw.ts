// msw harness for the toolkit path. The toolkit's PayPalClient sends to api.sandbox.paypal.com
// (not api-m), through its own axios; msw intercepts it at the Node http layer, so the real
// toolkit code runs end to end and no request leaves the machine.

import { type DefaultBodyType, HttpResponse, http, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const TOOLKIT_BASE = "https://api.sandbox.paypal.com";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

export const server = setupServer();
export const requests: RecordedRequest[] = [];

/** Starts msw for the file: unhandled requests fail the test, and the log resets per test. */
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

type Reply = (req: RecordedRequest, params: Record<string, string>) => Response | Promise<Response>;

function handler(method: "get" | "post", path: string, reply: Reply) {
  return http[method](`${TOOLKIT_BASE}${path}`, async ({ request, params }) => {
    const entry = await record(request);
    return reply(entry, params as Record<string, string>);
  });
}

export const onGet = (path: string, reply: Reply) => server.use(handler("get", path, reply));
export const onPost = (path: string, reply: Reply) => server.use(handler("post", path, reply));

/** A PayPal JSON response carrying a paypal-debug-id header, as every PayPal REST response does. */
export function paypalJson(body: JsonBodyType, status = 200, debugId = "f0d1e2c3b4a59"): Response {
  return HttpResponse.json(body, { status, headers: { "paypal-debug-id": debugId } });
}

export function paypalEmpty(status = 204, debugId = "f0d1e2c3b4a5a"): Response {
  return new HttpResponse(null as DefaultBodyType, { status, headers: { "paypal-debug-id": debugId } });
}

/** Responds once with the first reply, then with the next, … (the last one repeats). */
export function sequence(...replies: Reply[]): Reply {
  let i = 0;
  return (req, params) => {
    const reply = replies[Math.min(i, replies.length - 1)] as Reply;
    i += 1;
    return reply(req, params);
  };
}

export const paths = (method: string) =>
  requests.filter((r) => r.method === method).map((r) => r.url.pathname);
