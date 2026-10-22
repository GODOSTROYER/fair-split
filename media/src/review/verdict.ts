import type { SlipImageFixture, Slot, TrapCheck } from "../fixtures/schema.js";

/**
 * A recorded Claude read's verdict on a behavioural trap (S3, S4.10 "heroes must also behave as
 * specified"): WATER_STAIN holds when both reads score the stained fields below 0.85, so a person types
 * them (C-17); MARGIN_NOTE holds when the note is quarantined (C-16). Only this can set `HOLDS`: a look by
 * an agent or a person can show a trap renders, or that it fails, but not how a reader treats it. The
 * evidence is the recording or eval report the verdict comes from, pinned by its sha256.
 */
export interface ReadVerdict {
  slot: Slot;
  trap: TrapCheck["trap"];
  status: "HOLDS" | "FAILED";
  /** The recorded read (a WS-READ recording or eval report), as a repo-relative path. */
  evidenceFile: string;
  evidenceSha256: string;
  note?: string;
  at: string;
}

export function recordReadVerdict<F extends SlipImageFixture>(f: F, v: ReadVerdict): F {
  if (!/^[0-9a-f]{64}$/.test(v.evidenceSha256)) throw new Error("evidenceSha256 must be a sha256");
  const slip = f.slips.find((s) => s.slot === v.slot);
  if (!slip) throw new Error(`${f.id} has no slip in slot ${v.slot}`);
  const check = slip.trapChecks.find((c) => c.trap === v.trap);
  if (!check) throw new Error(`${f.id} ${v.slot} (slip ${slip.serial}) has no ${v.trap} trap`);
  Object.assign(check, {
    status: v.status,
    by: "read",
    at: v.at,
    evidence: `${v.evidenceFile} sha256:${v.evidenceSha256.slice(0, 16)}${v.note ? `; ${v.note}` : ""}`,
  });
  return f;
}
