// The console's data port, shaped exactly like API_COMMANDS (IC-08): one typed `call(name, input)` whose
// method, path, request and response come from the contracts registry, one SSE `subscribe` with
// Last-Event-ID replay, and a small `pending` group for reads the console needs that API_COMMANDS does not
// list yet. Two implementations exist: HTTP (./http.ts, the API on this origin) and mock (./mock, msw over
// the seed snapshot). The wiring step moves both onto @fairsplit/api-client.

import type { API_COMMANDS, ApiCommandName, RunEvent, SeasonSnapshot, SseScope } from "@fairsplit/contracts";
import type { z } from "zod";
import type { DataSource, PaypalRail } from "../lib/env.js";

type Commands = typeof API_COMMANDS;
type Def<N extends ApiCommandName> = Commands[N];

/** Commands answered over SSE are not called; they are subscribed to. */
export type CallableName = {
  [N in ApiCommandName]: Def<N> extends { readonly sse: true } ? never : N;
}[ApiCommandName];

export type GetCommandName = {
  [N in CallableName]: Def<N>["method"] extends "GET" ? N : never;
}[CallableName];

export type PostCommandName = Exclude<CallableName, GetCommandName>;

type StripExtension<S extends string> = S extends `${infer Name}.${string}` ? Name : S;

/** `":runSlug"` names in a path literal, the same letters-only rule as contracts' `apiPath()`. */
export type PathParamNames<P extends string> = P extends `${string}:${infer Rest}`
  ? Rest extends `${infer Name}/${infer Tail}`
    ? StripExtension<Name> | PathParamNames<`/${Tail}`>
    : StripExtension<Rest>
  : never;

export type PathParams<N extends ApiCommandName> = {
  readonly [K in PathParamNames<Def<N>["path"]>]: string;
};

export type CommandRequest<N extends ApiCommandName> = Def<N>["request"] extends z.ZodType
  ? z.input<Def<N>["request"]>
  : undefined;

/** The parsed body. `null` for addDeduction, which always answers 409 RATE_CARD_RATIFIED. */
export type CommandResponse<N extends ApiCommandName> = Def<N>["response"] extends z.ZodType
  ? z.output<Def<N>["response"]>
  : null;

type ParamsPart<N extends ApiCommandName> = [PathParamNames<Def<N>["path"]>] extends [never]
  ? { readonly params?: undefined }
  : { readonly params: PathParams<N> };

type PayloadPart<N extends ApiCommandName> = Def<N>["method"] extends "GET"
  ? Def<N>["request"] extends z.ZodType
    ? { readonly query: CommandRequest<N>; readonly body?: undefined }
    : { readonly query?: undefined; readonly body?: undefined }
  : Def<N>["request"] extends z.ZodType
    ? { readonly body: CommandRequest<N>; readonly query?: undefined }
    : { readonly body?: undefined; readonly query?: undefined };

/** What a caller passes: path params, the query (GET) or body (POST), and extra headers (capture). */
export type CommandInput<N extends CallableName> = ParamsPart<N> &
  PayloadPart<N> & { readonly headers?: Readonly<Record<string, string>> };

export interface CallInit {
  readonly signal?: AbortSignal;
}

export type StreamStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "open"; readonly since: number }
  | {
      readonly kind: "reconnecting";
      readonly attempt: number;
      readonly inMs: number;
      readonly lastEventId: string | null;
      /** When the last event was applied, for "Showing changes up to 10:21:41." */
      readonly lastEventAt: string | null;
    }
  | { readonly kind: "closed"; readonly reason: "unsubscribed" | "unauthorized" | "not-found" };

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

export interface FrameTokenGrant {
  readonly token: string;
  /** Epoch milliseconds. The stage refreshes 5 minutes before. */
  readonly exp: number;
  /** The credential scope, e.g. "member:M-014". */
  readonly persona: string;
  readonly ws: string;
}

/**
 * Reads and actions the console needs that API_COMMANDS does not list yet (reported to WS-API and
 * WS-CORE). Each one names the spec line it comes from; the wiring step maps them onto the API.
 */
export interface PendingApi {
  /** IC-03: the season snapshot the screens read. No season or run read exists in API_COMMANDS. */
  snapshot(season: string): Promise<SeasonSnapshot>;
  /** S3.8: `POST /v1/judge/sessions/:sid/frames {persona}` mints a 2-hour frame token. */
  frameToken(sessionId: string, persona: FramePersona): Promise<FrameTokenGrant>;
  /** S3.9: Reset cancels parked items and expires the session's workspace (about 10 s). */
  resetSession(sessionId: string): Promise<void>;
  /** ADR-0002: which PayPal rail the API runs (PP_MODE), so every PayPal step is labelled (I8). */
  paypalRail(): Promise<PaypalRail>;
}

export interface DataAdapter {
  readonly source: DataSource;
  call<N extends CallableName>(name: N, input: CommandInput<N>, init?: CallInit): Promise<CommandResponse<N>>;
  /** One SSE stream per scope; returns the unsubscribe function. */
  subscribe(scope: SseScope, handlers: StreamHandlers, options?: SubscribeOptions): () => void;
  /** The console bearer token from createJudgeSession (2 h). Held in memory only, never in a URL. */
  setToken(token: string | null): void;
  readonly pending: PendingApi;
}

/** SSE paths per scope. Run and workspace streams are in API_COMMANDS; line and Proof streams are S3.7's. */
export function streamPath(scope: SseScope): string {
  const enc = encodeURIComponent;
  switch (scope.kind) {
    case "run":
      return `/v1/runs/${enc(scope.runSlug)}/events`;
    case "workspace":
      return `/v1/workspaces/${enc(scope.ws)}/events`;
    case "line":
      return `/v1/lines/${enc(scope.lineId)}/events`;
    case "proof":
      return `/v1/proof/${enc(scope.runSlug)}/events`;
  }
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
