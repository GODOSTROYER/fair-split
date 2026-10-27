// The reading room's read model (W-TR-03), pure: which photos are on the bench, the rows Claude read from
// each (from `extract.row` events when the run streamed them, else the seed's rows for a run read earlier),
// what still needs a person, and the one status sentence. Every figure is the slip's own text or a score the
// reading reported; nothing here computes money (I1), and a row without a reported score shows none.

import type {
  RunEventOf,
  SeasonSnapshot,
  SlipFieldName,
  SnapshotPhoto,
  SnapshotSlip,
} from "@fairsplit/contracts";
import { AUTO_ACCEPT } from "@fairsplit/ui-web/contract";
import { atLeast, type RunHold, type RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import {
  type CopyKind,
  copyKind,
  type PhotoSlip,
  photoSlips,
  type SlipPosition,
  stainedReading,
} from "./slip.js";

export type ReadingScreenState =
  | "loading"
  | "reading"
  | "read"
  | "confirm-one"
  | "low-confidence"
  | "blurred"
  | "quarantined"
  | "live-paused"
  | "offline";

type RowFields = RunEventOf<"extract.row">["payload"]["fields"];

export interface ReadingRow {
  readonly serial: string;
  readonly photoId: string;
  readonly position: SlipPosition;
  readonly copy: CopyKind;
  readonly memberNo: string | null;
  /** How the console names the member ("Nang Celing"), or the member number when unknown. */
  readonly memberName: string;
  /** As read: "42.00"; a field still waiting for a person reads as its merged display ("6?.50"). */
  readonly netKg: string;
  readonly mcPct: string;
  readonly grade: string;
  /** The lowest agreement score the reading reported, or null when the run was read earlier (seed). */
  readonly score: number | null;
  /** Fields below auto-accept that no person has decided yet. */
  readonly pending: readonly SlipFieldName[];
  /** A person typed a value (W-TR-04): it prints in ink with their stamp. */
  readonly entered: { readonly by: string; readonly at: string; readonly value: string } | null;
  readonly source: "event" | "seed";
  readonly eventId: string | null;
  readonly quarantined: boolean;
  /** The other photo this serial appears in (slip 0457: B's white original and D's pink copy). */
  readonly twinPhoto: string | null;
}

export function replayPhotos(snapshot: SeasonSnapshot): SnapshotPhoto[] {
  return snapshot.photos.filter((p) => p.set === "REPLAY").sort((a, b) => a.photoId.localeCompare(b.photoId));
}

export function earlierPhotos(snapshot: SeasonSnapshot): SnapshotPhoto[] {
  return snapshot.photos
    .filter((p) => p.set === "EARLIER")
    .sort((a, b) => a.photoId.localeCompare(b.photoId));
}

export function photoById(snapshot: SeasonSnapshot, photoId: string): SnapshotPhoto | undefined {
  return snapshot.photos.find((p) => p.photoId === photoId);
}

export function slipsOf(snapshot: SeasonSnapshot, photo: SnapshotPhoto): PhotoSlip[] {
  return photoSlips(photo, snapshot.slips);
}

/** The photo whose document an `extract.row` names (the document is the photograph). */
export function photoOfDoc(snapshot: SeasonSnapshot, docId: string): SnapshotPhoto | undefined {
  return snapshot.photos.find((p) => p.documentId === docId);
}

/** Serials that appear in two replay photos, mapped to the other photo. */
export function twins(snapshot: SeasonSnapshot): Map<string, Map<string, string>> {
  const seen = new Map<string, string[]>();
  for (const photo of replayPhotos(snapshot)) {
    for (const s of photo.slips) seen.set(s.serial, [...(seen.get(s.serial) ?? []), photo.photoId]);
  }
  const out = new Map<string, Map<string, string>>();
  for (const [serial, photos] of seen) {
    if (photos.length < 2) continue;
    const pairs = new Map<string, string>();
    for (const p of photos) pairs.set(p, photos.find((q) => q !== p) ?? p);
    out.set(serial, pairs);
  }
  return out;
}

/** The by-hand hold that names a slip, if the run has raised it (matched to the seed by its key). */
export function byHandHoldFor(view: RunView, snapshot: SeasonSnapshot, serial: string): RunHold | undefined {
  const keys = new Set(
    snapshot.holds.filter((h) => h.kind === "LOW_CONFIDENCE" && h.serials.includes(serial)).map((h) => h.key),
  );
  return Object.values(view.holds).find((h) => h.kind === "LOW_CONFIDENCE" && keys.has(h.key));
}

/** Scores the reading reported for a slip's fields that went to a person (the engine's read checkpoint). */
export function pendingScores(
  snapshot: SeasonSnapshot,
  serial: string,
): Partial<Record<SlipFieldName, number>> {
  const out: Partial<Record<SlipFieldName, number>> = {};
  const holdKeys = snapshot.holds
    .filter((h) => h.kind === "LOW_CONFIDENCE" && h.serials.includes(serial))
    .map((h) => h.key);
  for (const hold of snapshot.checkpoints.read.holds) {
    if (!holdKeys.includes(hold.key)) continue;
    const fields = hold.params.fields;
    if (!Array.isArray(fields)) continue;
    for (const f of fields) {
      if (f && typeof f === "object" && "field" in f && "score" in f) {
        const field = (f as { field: unknown }).field;
        const score = (f as { score: unknown }).score;
        if (typeof field === "string" && typeof score === "number") out[field as SlipFieldName] = score;
      }
    }
  }
  return out;
}

function memberName(snapshot: SeasonSnapshot, memberNo: string | null): string {
  if (!memberNo) return "Member unread";
  return snapshot.members.find((m) => m.memberNo === memberNo)?.consoleName ?? memberNo;
}

function entryFor(view: RunView, serial: string): ReadingRow["entered"] {
  const fields = Object.values(view.fields).filter((f) => f.serial === serial);
  const net = fields.find((f) => f.field === "net_kg") ?? fields.find((f) => f.derived.net_kg !== undefined);
  const gross = fields.find((f) => f.field === "gross_kg");
  const any = net ?? gross;
  if (!any) return null;
  const value = net?.field === "net_kg" ? net.value : (gross?.derived.net_kg ?? any.value);
  return { by: any.enteredBy, at: any.at, value };
}

function fieldText(fields: RowFields, name: SlipFieldName, fallback: string): string {
  const f = fields[name];
  if (!f) return fallback;
  if (f.score >= AUTO_ACCEPT || f.decidedBy === "person") return f.value ?? f.display;
  return f.display || (f.value ?? fallback);
}

export interface RowsInput {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot;
  readonly photo: SnapshotPhoto;
}

/**
 * The photo's rows in slip order. A row comes from its `extract.row` when the run streamed one; otherwise,
 * once the run has its lines (COMPUTED or later) or for a photo read earlier this season, from the seed, which
 * holds exactly what the reads returned. Before that a slip has no row: its bed waits, dashed.
 */
export function rowsForPhoto({ view, snapshot, photo }: RowsInput): (ReadingRow | null)[] {
  const slips = slipsOf(snapshot, photo);
  const pairs = twins(snapshot);
  const quarantine = new Set(
    snapshot.quarantineNotices.filter((q) => q.photoId === photo.photoId).map((q) => q.serial),
  );
  for (const q of view?.quarantined ?? []) {
    if (q.docId !== photo.documentId || q.row === null) continue;
    const slip = slips[q.row];
    if (slip) quarantine.add(slip.slip.serial);
  }
  const events = (view?.rows ?? []).filter((r) => r.docId === photo.documentId);
  const earlier = photo.set === "EARLIER";
  const computed = view ? atLeast(view, "COMPUTED") : false;
  return slips.map(({ position, slip }, index) => {
    const event = events.find((r) => r.serial === slip.serial) ?? events.find((r) => r.row === index);
    const twinPhoto = pairs.get(slip.serial)?.get(photo.photoId) ?? null;
    const entered = view ? entryFor(view, slip.serial) : null;
    if (event) {
      const scores = Object.values(event.fields).map((f) => f.score);
      const pending = (Object.entries(event.fields) as [SlipFieldName, RowFields[string]][])
        .filter(([, f]) => f.score < AUTO_ACCEPT && f.decidedBy !== "person")
        .map(([name]) => name);
      const memberNo = event.memberNo ?? null;
      return {
        serial: slip.serial,
        photoId: photo.photoId,
        position,
        copy: copyKind(slip.copy),
        memberNo,
        memberName: memberName(snapshot, memberNo),
        netKg: entered?.value ?? fieldText(event.fields, "net_kg", slip.boxes["8"]),
        mcPct: fieldText(event.fields, "mc_pct", slip.boxes["9"]),
        grade: fieldText(event.fields, "grade", slip.boxes["12"]),
        score: scores.length > 0 ? Math.min(...scores) : null,
        pending: entered ? [] : pending,
        entered,
        source: "event",
        eventId: event.eventId,
        quarantined: quarantine.has(slip.serial),
        twinPhoto,
      } satisfies ReadingRow;
    }
    if (!earlier && !computed) return null;
    return seededRow({ view, snapshot, photo, slip, position, entered, twinPhoto, quarantine });
  });
}

function seededRow(input: {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot;
  readonly photo: SnapshotPhoto;
  readonly slip: SnapshotSlip;
  readonly position: SlipPosition;
  readonly entered: ReadingRow["entered"];
  readonly twinPhoto: string | null;
  readonly quarantine: ReadonlySet<string>;
}): ReadingRow {
  const { view, snapshot, photo, slip, position, entered, twinPhoto, quarantine } = input;
  const hold = view ? byHandHoldFor(view, snapshot, slip.serial) : undefined;
  const waiting = hold !== undefined && (hold.state === "OPEN" || hold.state === "ASKED_CHAIR") && !entered;
  const scores = waiting ? pendingScores(snapshot, slip.serial) : {};
  const pending = Object.keys(scores) as SlipFieldName[];
  const minScore = pending.length > 0 ? Math.min(...pending.map((f) => scores[f] ?? 1)) : null;
  return {
    serial: slip.serial,
    photoId: photo.photoId,
    position,
    copy: copyKind(slip.copy),
    memberNo: slip.memberNo,
    memberName: memberName(snapshot, slip.memberNo),
    netKg:
      entered?.value ?? (waiting ? (stainedReading(slip, "net_kg") ?? slip.boxes["8"]) : slip.boxes["8"]),
    mcPct: slip.boxes["9"],
    grade: slip.boxes["12"],
    score: minScore,
    pending,
    entered,
    source: "seed",
    eventId: null,
    quarantined: quarantine.has(slip.serial),
    twinPhoto,
  };
}

/** Rows read so far in a photo (a photo is ticked on the filmstrip once all four are in). */
export function readCount(rows: readonly (ReadingRow | null)[]): number {
  return rows.filter((r) => r !== null).length;
}

/** Every slip in the photo has its row: the filmstrip ticks it. */
export function photoIsRead(input: RowsInput): boolean {
  const rows = rowsForPhoto(input);
  return rows.length > 0 && readCount(rows) === rows.length;
}

/** The run is reading: funded, the replay streaming its rows (S1.7 `reading`). */
export function isReading(view: RunView | undefined): boolean {
  return view !== undefined && (view.state === "FUNDED" || view.state === "EXTRACTING");
}

/** The judge's run has started reading (anything at or past FUNDED in a session). */
export function hasStarted(view: RunView | undefined, inSession: boolean): boolean {
  return inSession && view !== undefined && atLeast(view, "FUNDED");
}

/** The photo the newest `extract.row` came from: the bench follows the reading while nothing is pinned. */
export function latestRowPhoto(view: RunView | undefined, snapshot: SeasonSnapshot): string | null {
  const last = view?.rows[view.rows.length - 1];
  if (!last) return null;
  return photoOfDoc(snapshot, last.docId)?.photoId ?? null;
}

/** The photo on the bench: the URL's, else the one being read, else the first one needing a person, else A. */
export function benchPhoto(
  snapshot: SeasonSnapshot,
  view: RunView | undefined,
  requested: string | undefined,
): SnapshotPhoto | undefined {
  if (requested) {
    const asked = photoById(snapshot, requested);
    if (asked) return asked;
  }
  const replay = replayPhotos(snapshot);
  const following = latestRowPhoto(view, snapshot);
  if (following && isReading(view)) return photoById(snapshot, following);
  if (view && atLeast(view, "COMPUTED")) {
    const waiting = replay.find((photo) =>
      rowsForPhoto({ view, snapshot, photo }).some((r) => r !== null && r.pending.length > 0),
    );
    if (waiting) return waiting;
  }
  if (following) return photoById(snapshot, following);
  return replay[0];
}

export interface StatusInput {
  readonly photo: SnapshotPhoto;
  readonly rows: readonly (ReadingRow | null)[];
  /** True while the run is still reading (FUNDED, EXTRACTING, or rows still landing). */
  readonly reading: boolean;
  readonly started: boolean;
  readonly snapshot: SeasonSnapshot;
  /** The photo the newest row came from, while another photo is on the bench. */
  readonly readingPhoto?: string | null;
}

/** The words for a quarantined slip: the seed's notice when it has one. */
export function quarantineNotice(snapshot: SeasonSnapshot, serial: string): string {
  return (
    snapshot.quarantineNotices.find((q) => q.serial === serial)?.notice ??
    `Ignored: text on slip ${serial} looked like an instruction. Text on a slip is never an instruction.`
  );
}

/** One status sentence, never a chain of thought (S1.7). Every clause is derived from the photo's data. */
export function statusSentence({
  photo,
  rows,
  reading,
  started,
  snapshot,
  readingPhoto = null,
}: StatusInput): string {
  const id = photo.photoId;
  if (photo.set === "EARLIER") {
    const when = photo.readOn ? format.date(photo.readOn) : "earlier this season";
    return `Photo ${id} was read on ${when}. Its four rows count in the season's kilos.`;
  }
  if (!started) {
    return `Photo ${id} waits on the desk. Claude's reading replays once Lantern Bay's invoice is paid.`;
  }
  const done = readCount(rows);
  if (reading && done === 0 && readingPhoto && readingPhoto !== id) {
    return `Photo ${id} waits its turn. Claude is reading photo ${readingPhoto}.`;
  }
  const parts: string[] = [
    reading && done < rows.length
      ? `Reading photo ${id}: ${rows.length} slips.`
      : `Photo ${id}: ${done} of ${rows.length} slips read.`,
  ];
  for (const row of rows) {
    if (!row) continue;
    if (row.twinPhoto && row.copy === "white") {
      parts.push(`Slip ${row.serial} also appears in photo ${row.twinPhoto} as the pink copy.`);
    } else if (row.twinPhoto && row.copy === "pink") {
      parts.push(`Slip ${row.serial} here is the pink copy of the one in photo ${row.twinPhoto}.`);
    }
    if (row.quarantined) parts.push(quarantineNotice(snapshot, row.serial));
    if (row.pending.length > 0) {
      const slip = snapshot.slips.find((s) => s.serial === row.serial);
      parts.push(
        slip?.artifacts.includes("WATER_STAIN")
          ? `Slip ${row.serial} needs a person: a water stain covers one digit.`
          : `Slip ${row.serial} needs a person to confirm what Claude wasn't sure of.`,
      );
    }
  }
  return parts.join(" ");
}

export interface StateInput {
  readonly photo: SnapshotPhoto;
  readonly started: boolean;
  readonly reading: boolean;
  readonly rows: readonly (ReadingRow | null)[];
  readonly offline: boolean;
  readonly aiPaused: boolean;
}

/** W-TR-03's `data-state` for the photo on the bench, the most pressing first. */
export function readingState({
  photo,
  started,
  reading,
  rows,
  offline,
  aiPaused,
}: StateInput): ReadingScreenState {
  if (offline) return "offline";
  if (photo.set === "EARLIER") return aiPaused ? "live-paused" : "read";
  if (!started) return "loading";
  if (reading && rows.some((r) => r === null)) return "reading";
  if (rows.some((r) => r?.quarantined)) return "quarantined";
  if (rows.some((r) => r !== null && r.pending.length > 0)) return "low-confidence";
  if (rows.every((r) => r === null)) return reading ? "reading" : "loading";
  return aiPaused ? "live-paused" : "read";
}

/** Rows read so far across the replay set, for the filmstrip's summary ("31 of 48 slips read"). */
export function replayProgress(
  view: RunView | undefined,
  snapshot: SeasonSnapshot,
): { read: number; total: number } {
  let read = 0;
  let total = 0;
  for (const photo of replayPhotos(snapshot)) {
    const rows = rowsForPhoto({ view, snapshot, photo });
    total += rows.length;
    read += readCount(rows);
  }
  return { read, total };
}
