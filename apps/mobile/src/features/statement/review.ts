/**
 * "Ipasusi pag-usab" (S1.9, M-MB-04): a member's request for a re-check, sent with her line, an optional slip and an
 * optional note to the Mediation and Conciliation Committee (RA 9520 Art. 43). Pure helpers, tested in Node: the
 * record kept on this phone so the request's status survives a restart, and the screen state.
 */
import type { ScreenStateOf } from "../../_shims/contracts";

/** What this phone remembers about the request it sent (never the note's text). */
export interface ReviewRecord {
  id: string;
  /** When the Committee's inbox accepted it (RFC 3339). */
  at: string;
  /** The slip it is about, or null for the whole line. */
  slip: string | null;
}

/** Notes are short: one or two sentences for the Committee. */
export const NOTE_MAX = 280;

export const reviewPrefKey = (lineId: string) => `fs.review.${lineId}`;

export function parseReview(raw: string | null): ReviewRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReviewRecord>;
    if (typeof v.id !== "string" || !v.id || typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) {
      return null;
    }
    const slip = typeof v.slip === "string" && /^\d{4}$/.test(v.slip) ? v.slip : null;
    return { id: v.id, at: v.at, slip };
  } catch {
    return null;
  }
}

export function serializeReview(r: ReviewRecord): string {
  return JSON.stringify({ id: r.id, at: r.at, slip: r.slip });
}

/** The note as sent: trimmed, at most `NOTE_MAX` characters, or nothing. */
export function cleanNote(note: string): string | undefined {
  const t = note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t ? t : undefined;
}

export type ReviewPhase = "idle" | "sending" | "failed";

/** `data-state` of M-MB-04. */
export function reviewScreenState(o: {
  record: ReviewRecord | null;
  phase: ReviewPhase;
  composing: boolean;
  online: boolean;
}): ScreenStateOf<"M-MB-04"> {
  if (o.record) return "sent";
  if (o.phase === "sending") return "sending";
  if (o.phase === "failed") return "failed";
  if (!o.online) return "offline";
  return o.composing ? "composing" : "none";
}
