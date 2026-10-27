/**
 * What the clerk sees for each capture, derived from its record and nothing else: the ring, the status words, a
 * second line when one helps (why the co-op refused it, a Wi-Fi asking for a login, who read it), what the clerk
 * can do about it (send it now, or remove a refusal), the day's tally, and the outbox's sections. Every state has a
 * glyph-bearing ring and a word, never colour alone; a refusal is a decision for a person (canary), never red (red
 * is only ever a PayPal failure).
 *
 * `me` is the persona of the clerk paired now. A capture someone else filed on this phone (or one filed before it
 * kept who filed it) says so before anyone acts, waits for its filer, and offers only "Ipadala isip ako" (a person's
 * takeover, after a confirm that names the filer) or, if refused, removal: never "Ipadala karon" or "Ipadala tanan".
 *
 * Pure (tested in Node): words are message keys with arguments; screens translate them.
 */
import { format } from "../../_shims/domain";
import type { MessageArgs } from "../../_shims/i18n";
import {
  AUTH_REFUSALS,
  type CaptureRecord,
  type Filer,
  isFiledBy,
  isRefused,
  isSameManilaDay,
  MANUAL_ONLY,
  type OutboxSummary,
  resendOf,
  summarise,
} from "../../lib/outbox";
import { type ClerkKey, pluralKey } from "./messages";
import { LOCAL_ERROR } from "./upload-protocol";

/** waiting (on the phone), sending, sent, read (rows came back), retrying (on its own), refused (needs a person). */
export type RingTone = "waiting" | "sending" | "sent" | "read" | "retrying" | "refused";

/**
 * Still on the phone (waiting, backing off or refused) and not filed by the clerk paired now (`me`): it never goes
 * by itself under this pairing.
 */
export function isOthers(r: Pick<CaptureRecord, "state" | "filedBy">, me: string | null): boolean {
  return (r.state === "queued" || r.state === "failed") && !isFiledBy(r, me);
}

/** The filer's name as the row says it: the pairing's name, or the persona's own word when the pairing gave none. */
export function filerName(f: Filer): string {
  const name = f.name.trim();
  if (name) return name;
  const word = f.persona.split(":").pop() ?? "";
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : f.persona;
}

/** With `me`, a capture another clerk filed is a decision for a person (canary), never "waiting its turn". */
export function ringOf(r: CaptureRecord, me?: string | null): RingTone {
  if (me !== undefined && isOthers(r, me)) return "refused";
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

const SAMPLES_ONLY = new Set(["SAMPLES_ONLY", "JUDGE_SAMPLES_ONLY"]);

const refusal = (key: ClerkKey, args?: MessageArgs): Line => ({ key, args, tone: "canaryText" });

/**
 * Why the co-op refused a capture, in words the clerk can act on. `treasurer` is the name the clerk knows her by,
 * from the pairing or the co-op (never the seed on a live phone); without one the copy says "the treasurer".
 */
export function refusalOf(r: CaptureRecord, treasurer: string | null): Line {
  const code = r.lastError ?? "";
  const receipt = r.kind === "nadawat";
  if (AUTH_REFUSALS.includes(code)) return refusal("M-CL-02.refusedAuth");
  if (code === LOCAL_ERROR.fileMissing) {
    return refusal(receipt ? "M-CL-02.refusedMissingReceipt" : "M-CL-02.refusedMissing");
  }
  if (code === "TOO_LARGE")
    return refusal(receipt ? "M-CL-02.refusedTooLargeReceipt" : "M-CL-02.refusedTooLarge");
  if (SAMPLES_ONLY.has(code)) return refusal("M-CL-02.refusedSamplesOnly");
  if (receipt && code === "LINE_ALREADY_RECEIVED") return refusal("M-CL-02.refusedReceived");
  if (receipt && code.startsWith("LINE_")) {
    return treasurer ? refusal("M-CL-02.refusedLine", { treasurer }) : refusal("M-CL-02.refusedLineAnon");
  }
  return treasurer
    ? refusal("M-CL-02.refused", { code: code || "?", treasurer })
    : refusal("M-CL-02.refusedAnon", { code: code || "?" });
}

/**
 * The same, for the Nadawat sheet, under its own lead ("The co-op didn't accept the receipt from 09:12."): a code
 * with no words of its own reads as advice there, so the sheet never says "didn't accept" twice.
 */
export function receiptAdviceOf(r: CaptureRecord, treasurer: string | null): Line {
  const line = refusalOf(r, treasurer);
  if (line.key === "M-CL-02.refused") return refusal("M-CL-01.nadawat.refusedTry", line.args);
  if (line.key === "M-CL-02.refusedAnon") return refusal("M-CL-01.nadawat.refusedTryAnon", line.args);
  return line;
}

/**
 * The status words under a capture, at `now` (the retry countdown is live). With `me`, a capture another clerk filed
 * says what it waits for instead of a countdown that will not run for this pairing (a refusal keeps its reason).
 */
export function statusOf(
  r: CaptureRecord,
  now: number,
  online: boolean,
  treasurer: string | null,
  me?: string | null,
): Line {
  if (me !== undefined && isOthers(r, me) && !isRefused(r)) {
    return r.filedBy
      ? { key: "M-CL-02.waitsFor", args: { name: filerName(r.filedBy) }, tone: "canaryText" }
      : { key: "M-CL-02.waitsUnknown", tone: "canaryText" };
  }
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
      if (isRefused(r)) return refusalOf(r, treasurer);
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

/**
 * Who filed a capture that is still on the phone and is not the paired clerk's own: always shown, so the clerk knows
 * whose work it is before sending it as theirs or removing it. Null for the clerk's own, and once the co-op has it.
 */
export function filedNoteOf(r: CaptureRecord, me: string | null): Line | null {
  if (!isOthers(r, me)) return null;
  return r.filedBy
    ? { key: "M-CL-02.filedBy", args: { name: filerName(r.filedBy) }, tone: "ink2" }
    : { key: "M-CL-02.filedByUnknown", tone: "ink2" };
}

export function metaOf(r: CaptureRecord): MessageArgs {
  return { size: format.bytes(r.bytes), time: format.time(iso(r.createdAt)) };
}

/**
 * "Ipadala karon" is offered to the paired clerk's own capture waiting on a retry, or refused for a reason a resend
 * can fix (under a new key: the old one would only replay the refusal). A photo that is gone or too large, a
 * sample-only Judge Mode, or a line that moved on are never offered it: the clerk files again, and removes the
 * refusal. Another clerk's capture is offered `canTakeOver` instead.
 */
export function canSendNow(r: CaptureRecord, me: string | null): boolean {
  return isFiledBy(r, me) && r.state === "failed" && resendOf(r) !== "none";
}

/**
 * "Ipadala isip ako" is offered to a capture someone else filed on this phone (or one whose filer is unknown) that a
 * send could still deliver; never with nobody paired, and never for what the co-op already has.
 */
export function canTakeOver(r: CaptureRecord, me: string | null): boolean {
  return me !== null && isOthers(r, me) && resendOf(r) !== "none";
}

/** "Tangtanga": only a capture the co-op refused can be removed from the phone, never one on its way or delivered. */
export function canRemove(r: CaptureRecord): boolean {
  return isRefused(r);
}

/** How many captures "Ipadala tanan karon" would send: the paired clerk's own only (it is hidden when none). */
export function sendableCount(records: readonly CaptureRecord[], me: string | null): number {
  return records.filter((r) => canSendNow(r, me)).length;
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

export function tallyOf(records: readonly CaptureRecord[], now: number, max = 24, me?: string | null): Tally {
  const today = records
    .filter((r) => r.kind === "slip" && isSameManilaDay(r.createdAt, now))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const shown = today.slice(Math.max(0, today.length - max));
  return {
    rings: shown.map((r) => ({ id: r.id, tone: ringOf(r, me), progress: r.progress })),
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

/** Captures the co-op refused since the previous list (a refused receipt sends the cash list to refresh). */
export function refusedSince(
  prev: readonly CaptureRecord[],
  next: readonly CaptureRecord[],
): CaptureRecord[] {
  const before = new Map(prev.map((r) => [r.id, r]));
  return next.filter((r) => {
    const was = before.get(r.id);
    return was !== undefined && isRefused(r) && !isRefused(was);
  });
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
