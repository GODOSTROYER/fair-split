// The HTTP adapter: every call is driven by its API_COMMANDS entry (method, path, schemas). Requests are
// validated before they leave and responses before anyone reads them, so a contract drift fails loudly.

import { API_COMMANDS, apiPath, type SeasonSnapshot, type SseScope } from "@fairsplit/contracts";
import { z } from "zod";
import type { PaypalRail } from "../lib/env.js";
import {
  type CallableName,
  type CallInit,
  type CommandInput,
  type CommandResponse,
  type DataAdapter,
  type FramePersona,
  type FrameTokenGrant,
  type StreamHandlers,
  type SubscribeOptions,
  streamPath,
} from "./adapter.js";
import { ApiRequestError, TransportError, toApiError } from "./errors.js";
import { openEventStream } from "./sse.js";

export interface HttpAdapterOptions {
  /** Origin of the API; "" for same origin. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** IC-03 snapshot loader (the screens' read model until the API has season and run reads). */
  readonly snapshot: (season: string) => Promise<SeasonSnapshot>;
  /** The PayPal rail label to use until the API reports PP_MODE. */
  readonly paypalRail: PaypalRail;
}

const FrameTokenGrantSchema = z.strictObject({
  token: z.string().min(16),
  exp: z.number().int().positive(),
  persona: z.string().min(1),
  ws: z.string().min(1),
});

function queryString(query: unknown): string {
  if (query === undefined || query === null) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createHttpAdapter(options: HttpAdapterOptions): DataAdapter {
  const base = options.baseUrl ?? "";
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  let token: string | null = null;

  const headersFor = (extra?: Readonly<Record<string, string>>, json = false): Record<string, string> => {
    const headers: Record<string, string> = { accept: "application/json", ...extra };
    if (json) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  };

  async function call<N extends CallableName>(
    name: N,
    input: CommandInput<N>,
    init: CallInit = {},
  ): Promise<CommandResponse<N>> {
    const def = API_COMMANDS[name];
    const params = (input.params ?? {}) as Record<string, string>;
    let url = base + apiPath(def.path, params);
    let body: string | undefined;
    if (def.method === "GET") {
      const query = def.request ? def.request.parse(input.query) : undefined;
      url += queryString(query);
    } else if (def.request) {
      body = JSON.stringify(def.request.parse(input.body ?? {}));
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: def.method,
        headers: headersFor(input.headers, body !== undefined),
        body,
        credentials: "same-origin",
        signal: init.signal,
      });
    } catch (error) {
      throw new TransportError(error instanceof Error ? error.message : "The network failed.", name);
    }
    const payload = await readJson(response);
    if (!response.ok) throw new ApiRequestError(name, toApiError(response.status, payload));
    if (!def.response) return null as CommandResponse<N>;
    const parsed = def.response.safeParse(payload);
    if (!parsed.success) {
      throw new TransportError(`${name} answered outside its contract.`, name, response.status);
    }
    return parsed.data as CommandResponse<N>;
  }

  function subscribe(scope: SseScope, handlers: StreamHandlers, subscribeOptions: SubscribeOptions = {}) {
    const stream = openEventStream({
      url: base + streamPath(scope),
      token: () => token,
      lastEventId: subscribeOptions.lastEventId ?? null,
      fetch: fetchImpl,
      onEvent: handlers.onEvent,
      onStatus: handlers.onStatus,
    });
    return () => stream.close();
  }

  async function postJson(path: string, payload: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(base + path, {
        method: "POST",
        headers: headersFor(undefined, true),
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
    } catch (error) {
      throw new TransportError(error instanceof Error ? error.message : "The network failed.", null);
    }
    const body = await readJson(response);
    if (!response.ok) throw new TransportError(`${path} answered ${response.status}.`, null, response.status);
    return body;
  }

  return {
    source: "http",
    call,
    subscribe,
    setToken(next) {
      token = next;
    },
    pending: {
      snapshot: options.snapshot,
      async frameToken(sessionId: string, persona: FramePersona): Promise<FrameTokenGrant> {
        const body = await postJson(`/v1/judge/sessions/${encodeURIComponent(sessionId)}/frames`, {
          persona,
        });
        const parsed = FrameTokenGrantSchema.safeParse(body);
        if (!parsed.success) throw new TransportError("The frame token answer was not readable.", null);
        return parsed.data;
      },
      async resetSession(sessionId: string): Promise<void> {
        await postJson(`/v1/judge/sessions/${encodeURIComponent(sessionId)}/reset`, {});
      },
      async paypalRail(): Promise<PaypalRail> {
        return options.paypalRail;
      },
    },
  };
}
