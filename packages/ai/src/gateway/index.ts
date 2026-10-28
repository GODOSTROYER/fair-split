// @fairsplit/ai/gateway: ClaudeGateway, the only path to Claude (register §9, S4.1, IC-07).
export {
  budgetKey,
  FileSpendMeter,
  LANE_CAPS_USD,
  laneCapsFromEnv,
  MemorySpendMeter,
  reserveAll,
  type SpendMeter,
  type SpendReservation,
  totalDailyCapFromEnv,
  totalKey,
  utcDay,
} from "./budget.js";
export { loadEnv } from "./env.js";
export { GatewayError, type GatewayErrorCode, isGatewayError, LIVE_DISABLED_COPY } from "./errors.js";
export {
  type AiFlag,
  anyFlagSource,
  envFlagSource,
  type FlagScope,
  type FlagSource,
  staticFlags,
} from "./flags.js";
export { ClaudeGateway, type GatewayOptions, measureInput, usageSummary } from "./gateway.js";
export { cacheKey, inputShaOf, jcs, sha256Hex } from "./key.js";
export { costMicros, estimateMicros, microsFromUsd, PRICES, priceOf, usd, visualTokens } from "./pricing.js";
export { assertBodyCompliant, assertWireCompliant, buildRequest } from "./request.js";
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
export { jsonForPrompt } from "./untrusted.js";
export { WARM_PROMPT, type WarmOutcome, type WarmTarget, warmStructuredOutputs } from "./warm.js";
