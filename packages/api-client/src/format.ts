// Deterministic formatting (register C-22), re-exported from `@fairsplit/domain/format`: UI code may not import
// `domain`, and every surface formats cents and grams through this one module, so the console, the app, print
// and the film show identical strings. Never `Intl`, never locale-dependent.
//
//   import { format } from "@fairsplit/api-client";      // or: import { money } from "@fairsplit/api-client/format"
//   format.money(433_350)              // "US$4,333.50"
//   format.pesoEstimate(4_445, fx, "ceb")  // "mga ₱2,778 (gibanabana)"
export * from "@fairsplit/domain/format";
