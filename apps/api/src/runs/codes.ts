// Small, total mappings between the database's spellings and the IC-01 contract's. The persistence layer
// (WS-DATA) stores a line's rail as ON/OFF and the Chair's approvals under the `board` role; the contract
// speaks PAYPAL/CASH and `chair`. Every DTO and event the slice emits goes through these, so the two
// vocabularies never leak into each other.
import type { ApprovalRole, Provenance, Rail } from "@fairsplit/contracts";

export type DbRail = "ON" | "OFF";
export type DbApprovalRole = "treasurer" | "board";

export const railOf = (r: string): Rail => (r === "ON" ? "PAYPAL" : "CASH");
export const dbRailOf = (r: Rail): DbRail => (r === "PAYPAL" ? "ON" : "OFF");

export const dbApprovalRoleOf = (r: ApprovalRole): DbApprovalRole => (r === "chair" ? "board" : "treasurer");
export const approvalRoleOf = (r: string): ApprovalRole => (r === "board" ? "chair" : "treasurer");

/** I8: a stored provenance is one of the four labels; anything else is treated as seeded data. */
export function provenanceOf(p: string): Provenance {
  return p === "live" || p === "replay" || p === "simulated_rail" || p === "seeded" ? p : "seeded";
}

/** bigint cents (Drizzle `mode: "bigint"`) → a safe JS integer; refuses anything outside the safe range. */
export function toInt(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "bigint" ? Number(v) : v;
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer: ${String(v)}`);
  return n;
}

export function toIntOrNull(v: bigint | number | null | undefined): number | null {
  return v === null || v === undefined ? null : toInt(v);
}

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
