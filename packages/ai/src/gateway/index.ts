// @fairsplit/ai/gateway: ClaudeGateway, the only path to Claude (register §9, S4.1, IC-07).
export {
  budgetKey,
  capsFromEnv,
  DEFAULT_CAPS_USD,
  FileSpendMeter,
  MemorySpendMeter,
  type SpendMeter,
  type SpendReservation,
  utcDay,
} from "./budget.js";
export { loadEnv } from "./env.js";
export { GatewayError, type GatewayErrorCode, isGatewayError, LIVE_DISABLED_COPY } from "./errors.js";
export { type AiFlag, anyFlagSource, envFlagSource, type FlagSource, staticFlags } from "./flags.js";
export { ClaudeGateway, fallbackServed, type GatewayOptions, measureInput, usageSummary } from "./gateway.js";
export { cacheKey, inputShaOf, jcs, sha256Hex } from "./key.js";
export { costMicros, estimateMicros, microsFromUsd, PRICES, priceOf, usd, visualTokens } from "./pricing.js";
export {
  assertBodyCompliant,
  assertWireCompliant,
  buildRequest,
  FALLBACK_BETA,
  supportsServerFallback,
} from "./request.js";
export { scrubRecording, scrubString } from "./scrub.js";
export { processSemaphore, Semaphore } from "./semaphore.js";
export {
  type CallLedger,
  ensureSelfIgnoringDir,
  FsReplayStore,
  JsonlCallLedger,
  LayeredReplayStore,
  MemoryCallLedger,
  MemoryReplayStore,
  type ReplayStore,
} from "./store.js";
export {
  coerceEnumCase,
  jsonOutputFormat,
  jsonSchemaOf,
  parseStructured,
  structuredText,
} from "./structured.js";
export { realSleep, replayTimeline, type Sleep, TimelineRecorder } from "./timeline.js";
export * from "./types.js";
