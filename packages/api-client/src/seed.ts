// The seeded season (IC-03) for UI code: the Judge first view renders it without a call (W-JG-01), and UI
// tests read it. UI apps reach @fairsplit/seed only through this entry (layer-ui, ADR-0009). Import it
// lazily in app code (`await import("@fairsplit/api-client/seed")`) so the snapshot stays out of the first
// chunk.

export { getSnapshot } from "@fairsplit/seed";
