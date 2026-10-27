// @fairsplit/api-client: the typed client for fs-api, shared by the console and the app (IC-08).
//
//   import { createApiClient, isApiClientError, format } from "@fairsplit/api-client";
//   const api = createApiClient({ token: () => frameToken });
//   const { hold } = await api.resolveHold({ params: { holdId }, body: { resolution: "COUNT_ONCE" } });
//
// Subpaths: `/http` (the HTTP contract the server shares), `/format` (cents and grams, C-22), `/verify` (Proof
// "Verify in your browser"), `/msw` (a seeded, stateful mock of fs-api for UI development and tests).
export {
  contentDigest,
  fromHex,
  randomBytes,
  sha256,
  sha256Hex,
  toBase64,
  toHex,
  utf8,
  uuidv7,
} from "./bytes.js";
export {
  type ApiClient,
  type ApiClientOptions,
  type ApiResult,
  type CallArgs,
  type CallMeta,
  type CallOptions,
  type CommandMethods,
  createApiClient,
  type FetchLike,
  type RawRequest,
  type TokenSource,
} from "./client.js";
export {
  ApiClientError,
  asRateCardRatified,
  type ClientFailure,
  ContractError,
  type ErrorContext,
  failureFromBody,
  isApiClientError,
  isContractError,
  isNetworkError,
  isNotImplemented,
  NetworkError,
} from "./errors.js";
export * as format from "./format.js";
export * from "./http.js";
export {
  JUDGE_ROUTES,
  type JudgeRouteMethods,
  type JudgeRouteName,
  judgeRoutes,
  REPLAY_REASONS,
  type ReplayReason,
  type RouteArgs,
  type RouteData,
  type RouteSpec,
  TAMPER_KINDS,
  type TamperKind,
} from "./routes.js";
export {
  type SseHandlers,
  type SseOptions,
  type SseRawMessage,
  type SseState,
  type SubscribeTransport,
  type Subscription,
  subscribe,
} from "./sse.js";
