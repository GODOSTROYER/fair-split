/**
 * What the clerk sees for each capture, derived from its record and nothing else: the ring, the status words, a
 * second line when one helps (why the co-op refused it, a Wi-Fi asking for a login, who read it), the day's tally,
 * and the outbox's sections. Every state has a glyph-bearing ring and a word, never colour alone; a refusal is a
 * decision for a person (canary), never red (red is only ever a PayPal failure).
 *
 * Pure (tested in Node): words are message keys with arguments; screens translate them.
 */
import { format } from "../../_shims/domain";
import type { MessageArgs } from "../../_shims/i18n";
import { people } from "../../_shims/seed";
import {
  type CaptureRecord,
  isSameManilaDay,
  MANUAL_ONLY,
  type OutboxSummary,
  summarise,
} from "../../lib/outbox";
import { type ClerkKey, pluralKey } from "./messages";
import { LOCAL_ERROR } from "./upload-protocol";

/** waiting (on the phone), sending, sent, read (rows came back), retrying (on its own), refused (needs a person). */
export type RingTone = "waiting" | "sending" | "sent" | "read" | "retrying" | "refused";

export function ringOf(r: CaptureRecord): RingTone {
  switch (r.state) {
    case "queued":
      return "waiting";
    case "uploading":
      return "sending";
    case "uploaded":
      return "sent";
    case "read":
      return "read";
    case "failed":
      return r.nextAttemptAt === MANUAL_ONLY ? "refused" : "retrying";
  }
}

export type LineTone = "ink" | "ink2" | "pencil" | "canaryText";

export interface Line {
  key: ClerkKey;
  args?: MessageArgs;
  tone: LineTone;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function titleOf(r: CaptureRecord): Omit<Line, "tone"> {
  if (r.kind === "nadawat" && r.nadawat)
    return { key: "M-CL-02.nadawat", args: { name: r.nadawat.memberName } };
  if (r.serial) return { key: "M-CL-02.serial", args: { serial: r.serial } };
  return { key: "M-CL-02.notRead" };
}

const AUTH = new Set(["UNAUTHENTICATED", "FORBIDDEN"]);
const SAMPLES_ONLY = new Set(["SAMPLES_ONLY", "JUDGE_SAMPLES_ONLY"]);
const LINE = new Set(["LINE_NOT_DUE", "LINE_ALREADY_RECEIVED", "LINE_HELD"]);

/** Why the co-op refused a capture, in words the clerk can act on. */
export function refusalOf(r: CaptureRecord): Line {
  const code = r.lastError ?? "";
  const treasurer = people.treasurer.first;
  if (AUTH.has(code)) return { key: "M-CL-02.refusedAuth", tone: "canaryText" };
  if (code === LOCAL_ERROR.fileMissing) return { key: "M-CL-02.refusedMissing", tone: "canaryText" };
  if (code === "TOO_LARGE") return { key: "M-CL-02.refusedTooLarge", tone: "canaryText" };
  if (SAMPLES_ONLY.has(code)) return { key: "M-CL-02.refusedSamplesOnly", tone: "canaryText" };
  if (r.kind === "nadawat" && LINE.has(code)) {
    return { key: "M-CL-02.refusedLine", args: { treasurer }, tone: "canaryText" };
  }
  return { key: "M-CL-02.refused", args: { code: code || "?", treasurer }, tone: "canaryText" };
}

/** The status words under a capture, at `now` (the retry countdown is live). */
export function statusOf(r: CaptureRecord, now: number, online: boolean): Line {
  switch (r.state) {
    case "queued":
      return { key: online ? "M-CL-02.queued" : "M-CL-02.queuedOffline", tone: "ink2" };
    case "uploading":
      return { key: "M-CL-02.uploading", args: { pct: Math.round(r.progress * 100) }, tone: "ink" };
    case "uploaded": {
      const time = format.time(iso(r.uploadedAt ?? r.createdAt));
      return {
        key: r.kind === "nadawat" ? "M-CL-02.recorded" : "M-CL-02.uploaded",
        args: { time },
        tone: "ink2",
      };
    }
    case "read":
      return {
        key: pluralKey("M-CL-02.read", r.rowsRead ?? 0),
        args: { n: r.rowsRead ?? 0 },
        tone: "pencil",
      };
    case "failed": {
      if (r.nextAttemptAt === MANUAL_ONLY) return refusalOf(r);
      if (!online) return { key: "M-CL-02.retryOffline", tone: "ink2" };
      const wait = r.nextAttemptAt - now;
      if (wait <= 0) return { key: "M-CL-02.retryNow", tone: "ink2" };
      if (wait < 60_000) return { key: "M-CL-02.retryIn", args: { s: Math.ceil(wait / 1000) }, tone: "ink2" };
      return { key: "M-CL-02.retryInMin", args: { m: Math.ceil(wait / 60_000) }, tone: "ink2" };
    }
  }
}

/** A second line when it helps: a login-hungry Wi-Fi, who read the page, or a duplicate the co-op already had. */
export function hintOf(r: CaptureRecord): Line | null {
  if (r.state === "failed" && r.nextAttemptAt !== MANUAL_ONLY && r.lastError === "NOT_OUR_SERVER") {
    return { key: "M-CL-02.hintPortal", tone: "ink2" };
  }
  if (r.duplicateOf) return { key: "M-CL-02.duplicateOf", tone: "ink2" };
  if (r.state === "read") return { key: "M-CL-02.readBy", tone: "pencil" };
  return null;
}

export function metaOf(r: CaptureRecord): MessageArgs {
  return { size: format.bytes(r.bytes), time: format.time(iso(r.createdAt)) };
}

/** Only a capture that is waiting on a retry or a person can be sent now. */
export function canSendNow(r: CaptureRecord): boolean {
  return r.state === "failed";
}

/* ------------------------------------------------------------------ the day's tally (M-CL-01) */

export interface TallyRing {
  id: string;
  tone: RingTone;
  progress: number;
}

export interface Tally {
  /** Today's slips, oldest first: the rings close left to right as they reach the co-op. */
  rings: TallyRing[];
  /** Older slips of the day not drawn (they are on the Outbox tab). */
  hidden: number;
  counts: OutboxSummary;
}

export function tallyOf(records: readonly CaptureRecord[], now: number, max = 24): Tally {
  const today = records
    .filter((r) => r.kind === "slip" && isSameManilaDay(r.createdAt, now))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const shown = today.slice(Math.max(0, today.length - max));
  return {
    rings: shown.map((r) => ({ id: r.id, tone: ringOf(r), progress: r.progress })),
    hidden: today.length - shown.length,
    counts: summarise(today),
  };
}

/* ------------------------------------------------------------------ the outbox's sections (M-CL-02) */

export interface Sections {
  /** Not yet at the co-op, in the order they will go: cash receipts first, then oldest first. */
  phone: CaptureRecord[];
  /** At the co-op, filed today, newest first. */
  today: CaptureRecord[];
  /** At the co-op, filed before today, newest first. */
  earlier: CaptureRecord[];
}

export function sectionsOf(records: readonly CaptureRecord[], now: number): Sections {
  const s: Sections = { phone: [], today: [], earlier: [] };
  for (const r of records) {
    if (r.state === "uploaded" || r.state === "read") {
      (isSameManilaDay(r.createdAt, now) ? s.today : s.earlier).push(r);
    } else s.phone.push(r);
  }
  const rank = (r: CaptureRecord) => (r.kind === "nadawat" ? 0 : 1);
  s.phone.sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const newest = (a: CaptureRecord, b: CaptureRecord) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);
  s.today.sort(newest);
  s.earlier.sort(newest);
  return s;
}

/** Captures that reached the co-op (or were read) since the previous list: for one polite announcement. */
export function settledSince(
  prev: readonly CaptureRecord[],
  next: readonly CaptureRecord[],
): CaptureRecord[] {
  const before = new Map(prev.map((r) => [r.id, r.state]));
  return next.filter((r) => {
    const was = before.get(r.id);
    return (
      was !== undefined &&
      (r.state === "uploaded" || r.state === "read") &&
      was !== "uploaded" &&
      was !== "read"
    );
  });
}
