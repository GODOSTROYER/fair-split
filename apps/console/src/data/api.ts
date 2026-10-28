// The console's adapter over @fairsplit/api-client. Every command is the typed client's: its path, request,
// response schema, success statuses and error codes come from API_COMMANDS and IC-08's HTTP contract, so a
// drift is a typed `ContractError`, never a guess. The run streams are the client's SSE (bearer token in a
// header, Last-Event-ID on every reconnect, 0.5 to 8 s backoff, final on 401/403/404/410), reported in the
// console's `StreamStatus`. The same adapter serves the API, msw's service worker and msw in memory: only the
// `fetch` underneath changes.

import {
  type ApiClient,
  type ClientFailure,
  createApiClient,
  type FetchLike,
  judgeRoutes,
  SSE_BACKOFF,
  type SseState,
} from "@fairsplit/api-client";
import type { SeasonSnapshot, SseScope } from "@fairsplit/contracts";
import { z } from "zod";
import type { DataSource, PaypalRail } from "../lib/env.js";
import type {
  CallableName,
  CallInit,
  CommandInput,
  CommandResponse,
  DataAdapter,
  FramePersona,
  FrameTokenGrant,
  StreamHandlers,
  StreamStatus,
  SubscribeOptions,
} from "./adapter.js";
import { FRAME_SCOPES } from "./adapter.js";

export interface ApiAdapterOptions {
  /** "http" for fs-api, "mock" when msw answers (the stage labels mock data). */
  readonly source: DataSource;
  /** Origin of the API; "" for same origin (fs-api serves the console, register §4). */
  readonly baseUrl?: string;
  /** The fetch underneath: the browser's, or msw's handlers in memory (./mock/memory.ts). */
  readonly fetch?: FetchLike;
  /** IC-03 snapshot loader (the screens' read model until the API has season and run reads). */
  readonly snapshot: (season: string) => Promise<SeasonSnapshot>;
  /** The rail label to use when the API cannot say (no answer from `/healthz`). */
  readonly paypalRail: PaypalRail;
}

/** S3.8 / S3.9 routes outside API_COMMANDS: api-client's typed judge routes (`JUDGE_ROUTES`), and /healthz. */
export const PENDING_PATHS = {
  frames: "/v1/judge/sessions/:sid/frames",
  reset: "/v1/judge/sessions/:sid/reset",
  health: "/healthz",
} as const;

const HealthSchema = z.looseObject({ rail: z.enum(["simulated", "sandbox"]) });

/** IC-08's `X-FS-Rail` / `/healthz` label, in the console's words (ADR-0002). */
export function railFromLabel(label: "simulated" | "sandbox"): PaypalRail {
  return label === "sandbox" ? "sandbox" : "simulator";
}

/** The longest wait before reconnect attempt n (0-based), the client's S3.7 bound before jitter. */
export function reconnectBound(attempt: number): number {
  return Math.min(SSE_BACKOFF.maxMs, SSE_BACKOFF.minMs * 2 ** Math.max(0, attempt));
}

/** Why a stream stopped for good: no valid credential (401), a refused one (403), or the scope (404/410). */
export function closeReasonOf(failure: ClientFailure): "expired" | "unauthorized" | "not-found" {
  const status = "status" in failure ? failure.status : 0;
  if (status === 401) return "expired";
  return status === 403 ? "unauthorized" : "not-found";
}

export function createApiAdapter(options: ApiAdapterOptions): DataAdapter {
  let token: string | null = null;
  const failureListeners = new Set<(failure: ClientFailure) => void>();
  const api: ApiClient = createApiClient({
    baseUrl: options.baseUrl ?? "",
    ...(options.fetch ? { fetch: options.fetch } : {}),
    token: () => token,
    onError: (failure) => {
      for (const listener of failureListeners) listener(failure);
    },
  });
  const judge = judgeRoutes(api);

  function call<N extends CallableName>(
    name: N,
    input: CommandInput<N>,
    init: CallInit = {},
  ): Promise<CommandResponse<N>> {
    const args = init.signal ? { ...input, signal: init.signal } : input;
    return (api.call as (n: N, a: unknown) => Promise<CommandResponse<N>>)(name, args);
  }

  function subscribe(scope: SseScope, handlers: StreamHandlers, subscribeOptions: SubscribeOptions = {}) {
    let stopped = false;
    let finalReason: "expired" | "unauthorized" | "not-found" | null = null;
    let lastEventAt: string | null = null;
    const report = (status: StreamStatus) => {
      if (!stopped || status.kind === "closed") handlers.onStatus?.(status);
    };
    const onState = (state: SseState, info: { attempt: number; lastEventId: string | null }) => {
      if (stopped) return;
      switch (state) {
        case "connecting":
          report({ kind: "connecting" });
          return;
        case "open":
          report({ kind: "open", since: Date.now() });
          return;
        case "reconnecting":
          report({
            kind: "reconnecting",
            attempt: info.attempt + 1,
            inMs: reconnectBound(info.attempt),
            lastEventId: info.lastEventId,
            lastEventAt,
          });
          return;
        case "closed":
          stopped = true;
          report({ kind: "closed", reason: finalReason ?? "unsubscribed" });
          return;
      }
    };
    const subscription = api.subscribe(
      scope,
      {
        onEvent: (event) => {
          if (stopped) return;
          lastEventAt = event.at;
          handlers.onEvent(event);
        },
        onState,
        onError: (failure, willRetry) => {
          if (!willRetry) finalReason = closeReasonOf(failure);
        },
      },
      { lastEventId: subscribeOptions.lastEventId ?? null },
    );
    return () => {
      if (stopped) return;
      stopped = true;
      subscription.close();
      handlers.onStatus?.({ kind: "closed", reason: "unsubscribed" });
    };
  }

  return {
    source: options.source,
    api,
    call,
    subscribe,
    setToken(next) {
      token = next;
    },
    onFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    pending: {
      snapshot: options.snapshot,
      // Reset and frame tokens answer only to the judge cookie of the session (fs-api's requireOwnSession), and a
      // bearer wins over the cookie there: these two never send the console's bearer, so the cookie speaks.
      async frameToken(sessionId: string, persona: FramePersona): Promise<FrameTokenGrant> {
        const grant = await judge.frameToken({
          params: { sid: sessionId },
          body: { persona: FRAME_SCOPES[persona] },
          token: null,
        });
        return {
          token: grant.token,
          exp: Date.parse(grant.expiresAt),
          persona: `${grant.role}:${grant.persona}`,
          ws: grant.workspaceId,
        };
      },
      async resetSession(sessionId: string): Promise<void> {
        await judge.resetJudgeSession({ params: { sid: sessionId }, token: null });
      },
      async paypalRail(): Promise<PaypalRail> {
        try {
          const health = await api.request({
            path: PENDING_PATHS.health,
            schema: HealthSchema,
            name: "health",
          });
          return railFromLabel(health.rail);
        } catch {
          // No answer (the database probe failed, or an older API): the build's label, never "live".
          return api.rail ? railFromLabel(api.rail) : options.paypalRail;
        }
      },
    },
  };
}
