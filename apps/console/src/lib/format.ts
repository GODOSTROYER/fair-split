// The one place the console formats numbers (register C-22: a deterministic formatter, never `Intl`).
// UI formats cents only through api-client's re-export of domain's `format` (plan, "Repo, services and
// data"). @fairsplit/api-client is still empty, so this seam re-exports domain's pure formatter today; the
// wiring step changes this one line to `export { format } from "@fairsplit/api-client"`. Slices import
// `format` from here and never from domain or api-client directly.

export * as format from "@fairsplit/domain/format";
