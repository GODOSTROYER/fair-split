/**
 * TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
 *
 * Invariant I8 (architecture §0): every row carries its provenance, rendered as a label.
 */
export type Provenance = "live" | "replay" | "simulated_rail" | "seeded";
