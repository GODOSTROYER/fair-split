// Who may do what in the runs slice (S3.8 role table). The workspace always comes from the credential; these
// checks only decide whether the credential's role may act. A judge acts as the personas of their own
// workspace (S3.8 "judge: act as personas in their own workspace"), so `judge` is accepted wherever a
// persona is, and every write still records the persona and `impersonated_by`.
import type { Role } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import type { ActingCredential } from "../credentials/verify/index.js";
import { problem } from "../lib/problem.js";

export const CAN = {
  /** Resolve holds; sign; re-route; use the kill switch (S3.8 treasurer row). */
  resolveHold: ["treasurer", "judge"],
  /** The Chair decides a hold the treasurer asked her about (OPEN → ASKED_CHAIR → RESOLVED). */
  resolveAskedHold: ["treasurer", "board", "judge"],
  /** By hand: the treasurer at the console, or the clerk at the bodega. */
  enterField: ["treasurer", "clerk", "judge"],
  markPaid: ["treasurer", "judge"],
  setFlag: ["treasurer", "judge"],
  payCash: ["treasurer", "judge"],
  resend: ["treasurer", "judge"],
  capture: ["clerk", "treasurer", "judge"],
  /** The board ratifies the card (Secretary certifies, Chair attests). */
  ratify: ["board", "judge"],
  readRuns: ["treasurer", "board", "clerk", "judge", "brand"],
} as const satisfies Record<string, readonly Role[]>;

export function allow(credential: ActingCredential, roles: readonly Role[], what: string): void {
  if (!roles.includes(credential.role)) {
    throw problem.forbidden(`${what} needs the ${roles.filter((r) => r !== "judge").join(" or ")} role.`);
  }
}

/** `{role}:{persona}` as every event and ledger entry records it ("judge" for the judge cookie). */
export function personaId(credential: ActingCredential): string {
  return credential.kind === "judge_session" ? "judge" : `${credential.role}:${credential.persona}`;
}

/** The officer initials stamped on a decision (canary "ink"): from the seeded officer list, else derived. */
export function initialsOf(actorId: string): string {
  const officer = getSnapshot().officers.find((o) => o.persona === actorId);
  if (officer) return officer.initials;
  if (actorId === "judge") return "JG";
  const name = actorId.includes(":") ? (actorId.split(":")[1] ?? actorId) : actorId;
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "FS").padEnd(2, "X");
}
