// The one place the console formats numbers (register C-22: a deterministic formatter, never `Intl`).
// UI formats cents only through api-client's re-export of domain's `format` (plan, "Repo, services and
// data"; the layer-ui dependency rule). Slices import `format` from here and never from domain or api-client
// directly.

export * as format from "@fairsplit/api-client/format";
