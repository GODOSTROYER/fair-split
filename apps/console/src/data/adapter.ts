// The console's data port, shaped exactly like API_COMMANDS (IC-08) and served by @fairsplit/api-client: one
// typed `call(name, input)` whose method, path, request, response and error codes come from the contracts
// registry, one SSE `subscribe` with Last-Event-ID replay, and a small `pending` group for reads the console
// needs that API_COMMANDS does not list yet. One implementation (./api.ts) runs over any fetch: the API on this
// origin, msw's service worker in `vite dev`, or the same msw handlers in memory (tests, and dev where a service
// worker cannot register). `api` is the typed client itself, for links (`api.url`) and routes outside IC-01.

import type { ApiClient, CallArgs, ClientFailure, CommandData, JsonCommandName } from "@fairsplit/api-client";
import type { API_COMMANDS, ApiCommandName, RunEvent, SeasonSnapshot, SseScope } from "@fairsplit/contracts";
import type { DataSource, PaypalRail } from "../lib/env.js";

/** Commands answered over SSE are not called; they are subscribed to. */
export type CallableName = JsonCommandName;

export type GetCommandName = {
  [N in CallableName]: (typeof API_COMMANDS)[N]["method"] extends "GET" ? N : never;
}[CallableName];

export type PostCommandName = Exclude<CallableName, GetCommandName>;

/**
 * What a caller passes: `params` for path params, `body` (POST) or `query` (GET), and per-call `headers` or an
 * `idempotencyKey`. A body or query with no required field may be left out (`markPaid({ params })`).
 */
export type CommandInput<N extends CallableName> = Omit<CallArgs<N>, "signal" | "token">;

/** The parsed body (the response schema's output). `never` for addDeduction, which always answers 409. */
export type CommandResponse<N extends ApiCommandName> = CommandData<N>;

export interface CallInit {
  readonly signal?: AbortSignal;
}

export type StreamStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "open"; readonly since: number }
  | {
      readonly kind: "reconnecting";
      readonly attempt: number;
      /** The longest the next try waits (S3.7 backoff, 0.5 to 8 s with jitter, raised by the server's hint). */
      readonly inMs: number;
      readonly lastEventId: string | null;
      /** When the last event was applied, for "Showing changes up to 10:21:41." */
      readonly lastEventAt: string | null;
    }
  | { readonly kind: "closed"; readonly reason: StreamCloseReason };

/** Why a stream stopped: unsubscribed, no valid credential (401: expired or missing), refused (403), or gone. */
export type StreamCloseReason = "unsubscribed" | "expired" | "unauthorized" | "not-found";

export interface StreamHandlers {
  onEvent(event: RunEvent): void;
  onStatus?(status: StreamStatus): void;
}

export interface SubscribeOptions {
  /** Resume after this event (SSE `Last-Event-ID`). */
  readonly lastEventId?: string | null;
}

/** The three phone-frame personas on the Judge stage (S1.6) and the credential each frame holds (S3.8). */
export type FramePersona = "member" | "chair" | "clerk";

/** Each frame's credential scope, `{role}:{persona}` as fs-api's frame-token route takes it (S3.8). */
export const FRAME_SCOPES: Readonly<Record<FramePersona, string>> = {
  member: "member:M-014",
  chair: "board:ernesto",
  clerk: "clerk:jessie",
};

export interface FrameTokenGrant {
  readonly token: string;
  /** Epoch milliseconds. The stage refreshes 5 minutes before. */
  readonly exp: number;
  /** The credential scope, e.g. "member:M-014". */
  readonly persona: string;
  readonly ws: string;
}

/**
 * Reads and actions the console needs that API_COMMANDS does not list yet (reported to WS-API and WS-CORE).
 * Each one names the spec line it comes from and the route it calls through `api.request`.
 */
export interface PendingApi {
  /** IC-03: the season snapshot the screens read (from the seed: no season or run read exists yet). */
  snapshot(season: string): Promise<SeasonSnapshot>;
  /** S3.8: `POST /v1/judge/sessions/:sid/frames {persona}` mints a 2-hour frame token. */
  frameToken(sessionId: string, persona: FramePersona): Promise<FrameTokenGrant>;
  /** S3.9: `POST /v1/judge/sessions/:sid/reset` cancels parked items and expires the workspace (about 10 s). */
  resetSession(sessionId: string): Promise<void>;
  /** ADR-0002: which PayPal rail the API runs (`GET /healthz` → `rail`), so every PayPal step is labelled (I8). */
  paypalRail(): Promise<PaypalRail>;
}

export interface DataAdapter {
  readonly source: DataSource;
  /** The typed client underneath (links, downloads, routes outside IC-01). Prefer `call` for commands. */
  readonly api: ApiClient;
  call<N extends CallableName>(name: N, input: CommandInput<N>, init?: CallInit): Promise<CommandResponse<N>>;
  /** One SSE stream per scope; returns the unsubscribe function. */
  subscribe(scope: SseScope, handlers: StreamHandlers, options?: SubscribeOptions): () => void;
  /** The console bearer token from createJudgeSession (2 h). Held in memory only, never in a URL. */
  setToken(token: string | null): void;
  /** Every refusal the client reports (the session renews its token on FRAME_TOKEN_EXPIRED). */
  onFailure(listener: (failure: ClientFailure) => void): () => void;
  readonly pending: PendingApi;
}

export function scopeKey(scope: SseScope): string {
  switch (scope.kind) {
    case "run":
      return `run:${scope.runSlug}`;
    case "workspace":
      return `workspace:${scope.ws}`;
    case "line":
      return `line:${scope.lineId}`;
    case "proof":
      return `proof:${scope.runSlug}`;
  }
}
