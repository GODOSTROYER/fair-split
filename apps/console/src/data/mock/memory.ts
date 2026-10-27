// The in-memory adapter: the same mock world and the same answers as the msw handlers (./resolvers.ts), with
// no network in between. Dev falls back to it when a service worker cannot register (some embedded browsers,
// private windows); component tests use it because it is fast and needs no interception. It keeps the HTTP
// adapter's behaviour that callers can observe: contract-checked requests and responses, the auth class,
// IC-01 errors as ApiRequestError, async answers, and SSE replay from Last-Event-ID then live events.

import { API_COMMANDS, apiError, type RunEvent, type SseScope } from "@fairsplit/contracts";
import type { PaypalRail } from "../../lib/env.js";
import type {
  CallableName,
  CallInit,
  CommandInput,
  CommandResponse,
  DataAdapter,
  FramePersona,
  FrameTokenGrant,
  StreamHandlers,
  SubscribeOptions,
} from "../adapter.js";
import { ApiRequestError, TransportError } from "../errors.js";
import { resolveCommand } from "./resolvers.js";
import { MockApiError, type MockWorld } from "./world.js";

export interface MemoryAdapterOptions {
  readonly paypalRail?: PaypalRail;
}

/** World scope key for an SSE scope; line and Proof streams are not in the mock (yet). */
function worldScope(scope: SseScope): string | null {
  switch (scope.kind) {
    case "run":
      return `run:${scope.runSlug}`;
    case "workspace":
      return `workspace:${scope.ws}`;
    default:
      return null;
  }
}

function toError(name: CallableName, error: unknown): Error {
  if (error instanceof MockApiError) return new ApiRequestError(name, error.body);
  if (error instanceof ApiRequestError || error instanceof TransportError) return error;
  return new ApiRequestError(
    name,
    apiError("INTERNAL", error instanceof Error ? error.message : "The mock failed."),
  );
}

/** Lets the caller's code run first, as a network round trip would. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createMemoryAdapter(world: MockWorld, options: MemoryAdapterOptions = {}): DataAdapter {
  let token: string | null = null;

  async function call<N extends CallableName>(
    name: N,
    input: CommandInput<N>,
    init: CallInit = {},
  ): Promise<CommandResponse<N>> {
    await tick();
    if (init.signal?.aborted) throw new TransportError("The request was cancelled.", name);
    const def = API_COMMANDS[name];
    const raw = def.method === "GET" ? input.query : (input.body ?? {});
    let parsedInput: unknown = raw;
    if (def.request) {
      const parsed = def.request.safeParse(raw);
      if (!parsed.success) {
        throw new ApiRequestError(
          name,
          apiError("VALIDATION_FAILED", `${name}: the request does not match its contract.`),
        );
      }
      parsedInput = parsed.data;
    }
    const session = world.sessionForToken(token);
    if (def.auth === "frame_or_session" && !session) {
      throw new ApiRequestError(name, apiError("UNAUTHENTICATED", "Start a judge session first."));
    }
    let result: CommandResponse<N>;
    try {
      result = resolveCommand(world, name, {
        params: (input.params ?? {}) as Record<string, string>,
        input: parsedInput,
        session,
      });
    } catch (error) {
      throw toError(name, error);
    }
    if (!def.response) return null as CommandResponse<N>;
    const checked = def.response.safeParse(result);
    if (!checked.success) throw new TransportError(`${name} answered outside its contract.`, name, 200);
    return checked.data as CommandResponse<N>;
  }

  function subscribe(
    scope: SseScope,
    handlers: StreamHandlers,
    subscribeOptions: SubscribeOptions = {},
  ): () => void {
    const key = worldScope(scope);
    let closed = false;
    let stop: (() => void) | null = null;
    // Events are delivered in order on a later task, the way frames arrive over a stream: whatever is queued
    // when the task runs arrives together, like several frames in one network chunk.
    const queue: RunEvent[] = [];
    let draining = false;
    const drain = () => {
      if (draining) return;
      draining = true;
      setTimeout(() => {
        draining = false;
        while (queue.length > 0 && !closed) {
          const event = queue.shift();
          if (event) handlers.onEvent(event);
        }
      }, 0);
    };
    handlers.onStatus?.({ kind: "connecting" });
    setTimeout(() => {
      if (closed) return;
      if (!key) {
        closed = true;
        handlers.onStatus?.({ kind: "closed", reason: "not-found" });
        return;
      }
      if (token === null || world.sessionForToken(token) === null) {
        closed = true;
        handlers.onStatus?.({ kind: "closed", reason: "unauthorized" });
        return;
      }
      handlers.onStatus?.({ kind: "open", since: Date.now() });
      queue.push(...world.eventsAfter(key, subscribeOptions.lastEventId ?? null));
      stop = world.listen(key, (event) => {
        queue.push(event);
        drain();
      });
      drain();
    }, 0);
    return () => {
      if (closed) return;
      closed = true;
      stop?.();
      handlers.onStatus?.({ kind: "closed", reason: "unsubscribed" });
    };
  }

  return {
    source: "mock",
    call,
    subscribe,
    setToken(next) {
      token = next;
    },
    pending: {
      async snapshot(season: string) {
        await tick();
        if (season !== world.snapshot.season.label) {
          throw new TransportError(`No season ${season} in the seed.`, null, 404);
        }
        return world.snapshot;
      },
      async frameToken(sessionId: string, persona: FramePersona): Promise<FrameTokenGrant> {
        await tick();
        try {
          return world.frameToken(sessionId, persona);
        } catch (error) {
          throw new TransportError(error instanceof Error ? error.message : "No frame token.", null, 404);
        }
      },
      async resetSession(sessionId: string): Promise<void> {
        await tick();
        try {
          world.resetSession(sessionId);
        } catch (error) {
          throw new TransportError(error instanceof Error ? error.message : "Reset failed.", null, 404);
        }
      },
      async paypalRail(): Promise<PaypalRail> {
        return options.paypalRail ?? "simulator";
      },
    },
  };
}
