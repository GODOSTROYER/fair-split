import type { SlipImageFixture, Slot, TrapCheck } from "../fixtures/schema.js";
import { describeLeaks, stainLeaks, unroutedStain } from "./stain.js";

/**
 * A recorded Claude read's verdict on a behavioural trap (S3, S4.10 "heroes must also behave as
 * specified"): WATER_STAIN holds when both reads score the stained fields below 0.85, so a person types
 * them (C-17); MARGIN_NOTE holds when the note is quarantined (C-16). Only this can set `HOLDS`: a look by
 * an agent or a person can show a trap renders, or that it fails, but not how a reader treats it. The
 * evidence is the WS-READ eval report the verdict comes from (`review/evidence.ts` checks it read this
 * slip). Its path and sha256 are kept as fields (`evidenceFile`, `evidenceSha256`), so `replay-check` can
 * re-read the report and re-run those checks instead of trusting the verdict.
 */
export interface ReadVerdict {
  slot: Slot;
  trap: TrapCheck["trap"];
  status: "HOLDS" | "FAILED";
  /** The recorded read (a WS-READ eval report), as a repo-relative path. */
  evidenceFile: string;
  evidenceSha256: string;
  note?: string;
  /** The user's decision that a leaking stain is acceptable (WATER_STAIN HOLDS only; see stain.ts). */
  leakAccepted?: string;
  at: string;
}

export function recordReadVerdict<F extends SlipImageFixture>(f: F, v: ReadVerdict): F {
  if (!/^[0-9a-f]{64}$/.test(v.evidenceSha256)) throw new Error("evidenceSha256 must be a sha256");
  const slip = f.slips.find((s) => s.slot === v.slot);
  if (!slip) throw new Error(`${f.id} has no slip in slot ${v.slot}`);
  const check = slip.trapChecks.find((c) => c.trap === v.trap);
  if (!check) throw new Error(`${f.id} ${v.slot} (slip ${slip.serial}) has no ${v.trap} trap`);
  const where = `${f.id} ${v.slot} (slip ${slip.serial})`;
  const decision = v.leakAccepted?.trim();
  if (decision && v.trap !== "WATER_STAIN") throw new Error(`${where}: only a water stain can leak`);
  if (v.status === "HOLDS" && v.trap === "WATER_STAIN") {
    // A passing read shows the stain holds only if the label sends every stained field to a person.
    const unrouted = unroutedStain(slip);
    if (unrouted.length) {
      throw new Error(
        `${where}: ${unrouted.join(", ")} in this fixture, so a passing read does not show the stain holds`,
      );
    }
    const leaks = stainLeaks(slip);
    if (leaks.length && !decision) {
      throw new Error(
        `${where}: the stain leaks: ${describeLeaks(leaks)}. A read alone cannot make it hold: record the user's decision that this is acceptable with --accept-leak "<who, when, what>", or stain those boxes too`,
      );
    }
  }
  Object.assign(check, {
    status: v.status,
    by: "read",
    at: v.at,
    evidence: `${v.evidenceFile} sha256:${v.evidenceSha256.slice(0, 16)}${v.note ? `; ${v.note}` : ""}`,
    evidenceFile: v.evidenceFile,
    evidenceSha256: v.evidenceSha256,
    ...(decision ? { leakAccepted: decision } : {}),
  });
  return f;
}
