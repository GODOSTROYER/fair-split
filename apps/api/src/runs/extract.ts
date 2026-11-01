// IC-01 `extract`, inline in fs-api: the reading of a seeded workspace's replay photos (A–L, 48 slips), replayed
// from the seed as a labelled stand-in. No model reads anything here and nothing claims one did: every row, field,
// mark, event and ledger entry is provenance `seeded`, the events are the seed's (`system:seed`), and the reading is
// "Seed stand-in, not a Claude recording". The figures are IC-03's own (`@fairsplit/seed`, never typed here); the
// agreement scores come from code (domain `agreement`, S4.2) over two reads that are both the seed's text, with
// slip 0462's water stain hiding the second character of gross and net (media/fixtures/spike-0462.json shows
// "6?.80" and "6?.50"), so those two fields wait for a person at 0.40, as the seed's hold says.
//
// One photo per step. A step owns the first photo of its arguments (in the seed's order A → L): it writes that
// photo's rows, fields, marks and quarantine, emits the IC-01 events (`extract.field` for reads A and B, then
// `extract.row`, and `extract.quarantined` after slip 0449's row) and the photo's `rows.accepted` (Proof plate 3),
// then queues the rest as the next step's row, due one pace after its own, in the same transaction, which also
// marks this row done (I7). So the pacing holds no request and no executor slot (each step is a short
// transaction), survives a restart (the next step is a committed row with its due time), and a second delivery of
// a step finds its photo read and its next row already queued: it changes nothing. The last step queues computeRun
// once (`compute:{runId}:read`; the funding's computeRun found the photos unread and computed nothing).
//
// A photo with no seed stand-in (a capture in a real workspace, anything whose hash is not the seed's) is not read:
// a live reader is not built in this build, so it stays unread and the outcome says so. In a seeded workspace that
// would leave the run reading forever (computeRun waits for every photo of the season), so a step that meets such a
// photo for a run still FUNDED or EXTRACTING HALTs it instead (the run machine's HALT edge, below POSTING), with the
// IC-01 `run.state` cause NO_SEED_STAND_IN naming the document and `halted_reason` set, and reads nothing more: no
// row, field or event is invented for any photo. A judge's Reset then starts a fresh workspace.
import { createHash } from "node:crypto";
import {
  type FieldRead,
  type PayRunState,
  RunEventPayloads,
  type RunEventType,
  type SlipFieldName,
  type SnapshotPhoto,
  type SnapshotSlip,
  TASKS,
  TaskArgs,
  type TaskArgsOf,
} from "@fairsplit/contracts";
import {
  type Actor,
  appendEvents,
  type DbOrTx,
  type NewRunEvent,
  schema,
  systemScope,
  type Tx,
  type WorkspaceScope,
  withWorkspaceTx,
} from "@fairsplit/db";
import { AUTO_ACCEPT, agreement, runMachine } from "@fairsplit/domain";
import { enqueue, type TaskContext, type TaskHandler } from "@fairsplit/outbox";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { proofLedger } from "./events.js";
import { cause, moveRun } from "./machine.js";
import { report } from "./now.js";

/** How the stand-in is labelled wherever it lands (rows, events, ledger, the task's outcome). */
export const SEED_STAND_IN = {
  provenance: "seeded",
  label: "Seed stand-in, not a Claude recording",
  actor: { kind: "system", id: "system:seed", impersonatedBy: null },
} as const satisfies { provenance: "seeded"; label: string; actor: Actor };

/**
 * The pace: one photo a second, so the twelfth lands about 11 s after the first (S1.7: the 48 rows within 12 s;
 * Judge Mode's whole reading within 20 s). A step that runs late (a restart) keeps at least MM-2's row spacing.
 */
export const READING_PACE = { photoGapMs: 1_000, minGapMs: 180 } as const;

const NOT_BUILT =
  "Live slip reading is not built in this build: this photo has no seed stand-in, so it stays unread.";

/**
 * How a seeded run whose reading cannot finish ends: HALTED, the `run.state` cause code naming the first such
 * document as its ref, `pay_runs.halted_reason`, and the label for the outcome and any surface that shows it.
 */
export const NO_SEED_STAND_IN = {
  code: "NO_SEED_STAND_IN",
  haltedReason: "no_seed_stand_in",
  label:
    "This run's reading cannot finish: a slip photo has no seed stand-in, and live slip reading is not built in this build. The run halted; nothing was read for that photo.",
} as const;
/** The halt is fs-api's own decision about the reading, not a replay of the seed. */
const READING_ACTOR = { kind: "system", id: "system:reading", impersonatedBy: null } as const satisfies Actor;
/** The run states a reading serves (runs/capture.ts READING_STATES). */
const READING: ReadonlySet<string> = new Set(["FUNDED", "EXTRACTING"]);

/** The fields a slip's reading reports (S4.2's required slip fields): the printed serial and boxes 1–12. */
const READ_FIELDS: readonly (readonly [SlipFieldName, keyof SnapshotSlip["boxes"] | null])[] = [
  ["serial", null],
  ["date", "1"],
  ["member_no", "2"],
  ["member_name", "3"],
  ["plot_no", "4"],
  ["sacks", "5"],
  ["gross_kg", "6"],
  ["tare_kg", "7"],
  ["net_kg", "8"],
  ["mc_pct", "9"],
  ["mc_less_kg", "10"],
  ["payable_kg", "11"],
  ["grade", "12"],
];
/** What slip 0462's WATER_STAIN covers: the second character of gross and net. */
const STAINED: ReadonlySet<SlipFieldName> = new Set(["gross_kg", "net_kg"]);
/** `slip_rows.row_no` by position; the events' `row` is the photo slot, row_no − 1 (as the reader numbers it). */
const ROW_NO = { TL: 1, TR: 2, BL: 3, BR: 4 } as const;
/** A model box would place the live band; a stand-in has none, so its boxes are the zero box ("no box"). */
const NO_BOX = { x1: 0, y1: 0, x2: 0, y2: 0 } as const;
const SEEDED_WORKSPACES = new Set(["judge", "showcase"]);

/** IC-01's extract key, or its sha256 when the photo list makes it longer than the outbox's 200 characters. */
export function extractDedupeKey(args: TaskArgsOf<"extract">): string {
  const key = TASKS.extract.dedupeKey(args);
  return key.length <= 200 ? key : `extract:sha256:${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

/** The provenance of a run's reading (`seeded` for this stand-in), or null before any row was read for it. */
export async function readingProvenance(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<string | null> {
  const e = schema.runEvents;
  const [row] = await db
    .select({ provenance: e.provenance })
    .from(e)
    .where(and(eq(e.workspaceId, workspaceId), eq(e.runId, runId), eq(e.type, "extract.row")))
    .limit(1);
  return row?.provenance ?? null;
}

interface SeedReading {
  photos: Map<string, { photo: SnapshotPhoto; slips: SnapshotSlip[]; order: number }>;
}

let seedReading: SeedReading | null = null;

/** The seed's replay photos and their slips, in the seed's order (A → L), each photo's slips in slot order. */
function seed(): SeedReading {
  if (seedReading) return seedReading;
  const s = getSnapshot();
  const photos = new Map<string, { photo: SnapshotPhoto; slips: SnapshotSlip[]; order: number }>();
  s.photos
    .filter((p) => p.set === "REPLAY")
    .forEach((photo, order) => {
      const slips = photo.slips.map((at) => {
        const slip = s.slips.find(
          (x) => x.photoId === photo.photoId && x.serial === at.serial && x.copy === at.copy,
        );
        if (!slip)
          throw new Error(`seed: photo ${photo.photoId} names slip ${at.serial} ${at.copy}, which it lacks`);
        return slip;
      });
      photos.set(photo.photoId, { photo, slips, order });
    });
  seedReading = { photos };
  return seedReading;
}

/** Read A and read B of one field: both are the seed's text, with the stain's hidden character as "?". */
function readOf(slip: SnapshotSlip, field: SlipFieldName, text: string): FieldRead {
  if (slip.artifacts.includes("WATER_STAIN") && STAINED.has(field)) {
    return { valueText: `${text.slice(0, 1)}?${text.slice(2)}`, legibility: "SMUDGED", overwrittenFrom: "" };
  }
  return { valueText: text, legibility: "CLEAR", overwrittenFrom: "" };
}

/** One slip as the reading reports it: each field's reads and code's agreement over them. */
function readSlip(slip: SnapshotSlip) {
  const fields = READ_FIELDS.map(([field, box]) => {
    const text = box === null ? slip.serial : (slip.boxes[box] as string);
    const read = readOf(slip, field, text);
    const scored = agreement(read, read);
    return { field, read, scored, accepted: scored.autoAccept };
  });
  const accepted = (name: SlipFieldName) => fields.find((f) => f.field === name)?.accepted ?? false;
  const minScore = Math.min(...fields.map((f) => f.scored.score));
  return {
    fields,
    accepted,
    minScore,
    state: minScore >= AUTO_ACCEPT ? "AUTO_ACCEPTED" : "NEEDS_HUMAN",
  } as const;
}

function event<T extends RunEventType>(
  scope: WorkspaceScope,
  runId: string | null,
  type: T,
  payload: unknown,
): NewRunEvent {
  return {
    workspaceId: scope.workspaceId,
    runId,
    type,
    actor: SEED_STAND_IN.actor,
    provenance: SEED_STAND_IN.provenance,
    // the IC-01 payload schema, so nothing written here can fail the typed SSE client
    payload: RunEventPayloads[type].parse(payload) as Record<string, unknown>,
  };
}

type DocRow = Pick<typeof schema.documents.$inferSelect, "id" | "photoCode" | "sha256" | "seasonId">;

/** Writes one photo's reading: rows, fields, marks, the quarantined note, the events and `rows.accepted`. */
async function readPhoto(
  tx: Tx,
  scope: WorkspaceScope,
  o: { doc: DocRow & { seasonId: string }; runId: string | null; at: Date },
): Promise<number> {
  const ws = scope.workspaceId;
  const entry = seed().photos.get(o.doc.photoCode as string);
  if (!entry) return 0;
  const members = await tx
    .select({ id: schema.members.id, memberNo: schema.members.memberNo })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, ws),
        inArray(
          schema.members.memberNo,
          entry.slips.map((x) => x.memberNo),
        ),
      ),
    );
  const memberId = new Map(members.map((m) => [m.memberNo, m.id]));
  const reads = entry.slips.map((slip) => ({ slip, reading: readSlip(slip) }));
  const rows = await tx
    .insert(schema.slipRows)
    .values(
      reads.map(({ slip, reading }) => ({
        workspaceId: ws,
        seasonId: o.doc.seasonId,
        documentId: o.doc.id,
        serial: slip.serial,
        rowNo: ROW_NO[slip.position],
        memberId: memberId.get(slip.memberNo) ?? null,
        slipDate: slip.slipDate,
        grossG: reading.accepted("gross_kg") ? BigInt(slip.grossG) : null,
        tareG: reading.accepted("tare_kg") ? BigInt(slip.tareG) : null,
        netG: reading.accepted("net_kg") ? BigInt(slip.netG) : null,
        grade: slip.grade,
        minConfidence: reading.minScore,
        state: reading.state,
        copyColor: slip.copy,
        provenance: SEED_STAND_IN.provenance,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.slipRows.id, serial: schema.slipRows.serial, rowNo: schema.slipRows.rowNo });
  // another delivery wrote this photo first (the document lock makes that the only way): nothing more to do
  if (rows.length !== reads.length)
    throw new Error(`extract: photo ${o.doc.photoCode} was partly read already`);
  const rowId = (slip: SnapshotSlip) =>
    rows.find((r) => r.serial === slip.serial && r.rowNo === ROW_NO[slip.position])?.id as string;

  await tx.insert(schema.slipFields).values(
    reads.flatMap(({ slip, reading }) =>
      reading.fields.map((f) => ({
        workspaceId: ws,
        slipRowId: rowId(slip),
        field: f.field,
        readA: { valueText: f.read.valueText, legibility: f.read.legibility },
        readB: { valueText: f.read.valueText, legibility: f.read.legibility },
        legibility: f.read.legibility,
        agreement: f.scored.score,
        finalValue: f.accepted ? f.scored.value : null,
        decidedBy: f.accepted ? ("agreement" as const) : null,
        provenance: SEED_STAND_IN.provenance,
      })),
    ),
  );
  const marks = reads.flatMap(({ slip }) =>
    slip.marks.map((m) => ({
      workspaceId: ws,
      slipRowId: rowId(slip),
      textVerbatim: m.text,
      ruleId: m.ruleId,
      writtenCents: m.writtenCentavos === null ? null : BigInt(m.writtenCentavos),
      currency: "PHP",
      provenance: SEED_STAND_IN.provenance,
    })),
  );
  if (marks.length > 0) await tx.insert(schema.deductionMarks).values(marks);
  // Slip 0449's margin note: quarantined (C-16), shown as a notice, never a field and never an instruction
  const noted = reads.filter(({ slip }) => slip.marginNote !== null);
  if (noted.length > 0) {
    await tx.insert(schema.slipAnomalies).values(
      noted.map(({ slip }) => ({
        workspaceId: ws,
        documentId: o.doc.id,
        slipRowId: rowId(slip),
        kind: "INSTRUCTION_LIKE_TEXT",
        detail: { source: "read_a", overlap: "NONE" },
        quarantinedText: slip.marginNote,
        provenance: SEED_STAND_IN.provenance,
      })),
    );
  }

  // The events: both reads' fields as they complete, then each row as it prints (0449's quarantine after its row)
  const docId = o.doc.id;
  const events: NewRunEvent[] = [];
  for (const { slip, reading } of reads) {
    const row = ROW_NO[slip.position] - 1;
    for (const variant of ["A", "B"] as const) {
      for (const f of reading.fields) {
        events.push(
          event(scope, o.runId, "extract.field", { docId, row, field: f.field, variant, box: NO_BOX }),
        );
      }
    }
  }
  for (const { slip, reading } of reads) {
    const row = ROW_NO[slip.position] - 1;
    events.push(
      event(scope, o.runId, "extract.row", {
        docId,
        row,
        serial: slip.serial,
        memberNo: slip.memberNo,
        fields: Object.fromEntries(
          reading.fields.map((f) => [
            f.field,
            {
              value: f.accepted ? f.scored.value : null,
              score: f.scored.score,
              decidedBy: f.accepted ? "agreement" : null,
              display: f.scored.display,
            },
          ]),
        ),
      }),
    );
    if (slip.marginNote !== null) {
      events.push(event(scope, o.runId, "extract.quarantined", { docId, row, box: null, source: "read_a" }));
    }
  }
  await appendEvents(tx, events);

  // Proof plate 3: the photo's hash is attested by the chain (the seed's `rows.accepted`, with this clone's id)
  await proofLedger(
    tx,
    scope,
    "rows.accepted",
    {
      documentId: docId,
      photoId: entry.photo.photoId,
      sha256: o.doc.sha256,
      serials: entry.slips.map((x) => x.serial),
      slipDates: entry.slips.map((x) => x.slipDate),
      provenance: SEED_STAND_IN.provenance,
    },
    { runId: o.runId, at: o.at, actor: SEED_STAND_IN.actor },
  );
  return rows.length;
}

/** The first of `docs` (in the task's order) that no row has been read from, or null when every one is read. */
async function unreadOf(
  tx: Tx,
  ws: string,
  docs: readonly { id: string }[],
  order: readonly string[],
): Promise<string | null> {
  const read = await tx
    .selectDistinct({ documentId: schema.slipRows.documentId })
    .from(schema.slipRows)
    .where(
      and(
        eq(schema.slipRows.workspaceId, ws),
        inArray(
          schema.slipRows.documentId,
          docs.map((d) => d.id),
        ),
      ),
    );
  const done = new Set(read.map((r) => r.documentId));
  const unread = docs.filter((d) => !done.has(d.id)).map((d) => d.id);
  unread.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return unread[0] ?? null;
}

/** The outcome a step leaves for /ops and an inline caller (runs/now.ts `report`). */
interface StepOutcome {
  photo: string | null;
  rows: number;
  remaining: number;
  notBuilt: number;
  computeQueued: boolean;
  /** The run this step HALTed because its reading cannot finish (NO_SEED_STAND_IN), else null. */
  halted: string | null;
  /** The run named had already ended (a halted reading stops), so the step read nothing. */
  runEnded: boolean;
}

async function step(deps: AppDeps, raw: unknown, ctx: TaskContext): Promise<StepOutcome> {
  const args = TaskArgs.extract.parse(raw);
  if (!ctx.workspaceId) throw new Error("extract needs the workspace of its outbox row");
  const scope = systemScope(ctx.workspaceId, SEED_STAND_IN.actor);
  return withWorkspaceTx(deps.db, scope, async (tx) => {
    const ws = scope.workspaceId;
    const [workspace] = await tx
      .select({ kind: schema.workspaces.kind })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws));
    const docs = await tx
      .select({
        id: schema.documents.id,
        photoCode: schema.documents.photoCode,
        sha256: schema.documents.sha256,
        seasonId: schema.documents.seasonId,
        kind: schema.documents.kind,
        exactDuplicateOf: schema.documents.exactDuplicateOf,
      })
      .from(schema.documents)
      .where(and(eq(schema.documents.workspaceId, ws), inArray(schema.documents.id, args.documentIds)));
    // the photos this build can read: a seeded workspace's replay photos, with the seed's own manifest hash
    const photos = seed().photos;
    const standIns = SEEDED_WORKSPACES.has(workspace?.kind ?? "real")
      ? docs
          .filter((d): d is typeof d & { seasonId: string; photoCode: string } => {
            const p = d.photoCode ? photos.get(d.photoCode) : undefined;
            return (
              !!p &&
              d.kind === "slip_photo" &&
              d.seasonId !== null &&
              d.exactDuplicateOf === null &&
              d.sha256 === p.photo.manifestSha256
            );
          })
          .sort((a, b) => (photos.get(a.photoCode)?.order ?? 0) - (photos.get(b.photoCode)?.order ?? 0))
      : [];
    const notBuilt = docs.length - standIns.length;
    const [head, ...rest] = standIns;
    const out: StepOutcome = {
      photo: null,
      rows: 0,
      remaining: rest.length,
      notBuilt,
      computeQueued: false,
      halted: null,
      runEnded: false,
    };
    if (args.runId) {
      const [run] = await tx
        .select({
          id: schema.payRuns.id,
          state: schema.payRuns.state,
          version: schema.payRuns.version,
          seasonId: schema.payRuns.seasonId,
        })
        .from(schema.payRuns)
        .where(and(eq(schema.payRuns.workspaceId, ws), eq(schema.payRuns.id, args.runId)))
        .for("update");
      if (run && runMachine.isTerminal(run.state as PayRunState)) {
        // the run this reading served has ended (a halted reading stops): nothing more is read for it
        out.remaining = 0;
        out.runEnded = true;
        await ctx.complete(tx);
        return out;
      }
      // a photo computeRun would wait for (the run's season, a slip photo, not a duplicate, unread) that this build
      // cannot read: the reading can never finish, so the run HALTs now, naming it, instead of reading on forever
      const standInIds = new Set<string>(standIns.map((d) => d.id));
      const blocking = SEEDED_WORKSPACES.has(workspace?.kind ?? "real")
        ? docs.filter(
            (d) =>
              !standInIds.has(d.id) &&
              d.kind === "slip_photo" &&
              d.exactDuplicateOf === null &&
              d.seasonId !== null &&
              d.seasonId === run?.seasonId,
          )
        : [];
      const unread = blocking.length > 0 ? await unreadOf(tx, ws, blocking, args.documentIds) : null;
      if (run && READING.has(run.state) && unread) {
        await moveRun(tx, scope, {
          id: run.id,
          from: run.state as PayRunState,
          to: "HALTED",
          version: run.version,
          cause: cause(NO_SEED_STAND_IN.code, unread),
          provenance: "live",
          actor: READING_ACTOR,
          patch: { haltedReason: NO_SEED_STAND_IN.haltedReason },
        });
        out.halted = run.id;
        out.remaining = 0;
        await ctx.complete(tx);
        return out;
      }
    }
    if (head) {
      out.photo = head.photoCode;
      // this step's photo, locked: a second delivery waits here, then finds it read and writes nothing
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.workspaceId, ws), eq(schema.documents.id, head.id)))
        .for("update");
      const [read] = await tx
        .select({ id: schema.slipRows.id })
        .from(schema.slipRows)
        .where(and(eq(schema.slipRows.workspaceId, ws), eq(schema.slipRows.documentId, head.id)))
        .limit(1);
      if (!read)
        out.rows = await readPhoto(tx, scope, { doc: head, runId: args.runId, at: deps.clock.now() });
      if (rest.length > 0) {
        // the next photo one pace after this step was due (the outbox's real clock, not domain time)
        const [me] = await tx
          .select({ runAfter: schema.taskOutbox.runAfter })
          .from(schema.taskOutbox)
          .where(eq(schema.taskOutbox.id, ctx.outboxId));
        const due = Math.max(
          (me?.runAfter.getTime() ?? Date.now()) + READING_PACE.photoGapMs,
          Date.now() + READING_PACE.minGapMs,
        );
        const next = { documentIds: rest.map((d) => d.id), runId: args.runId };
        await enqueue(tx, "extract", next, extractDedupeKey(next), {
          workspaceId: ws,
          runAfter: new Date(due),
        });
      } else if (args.runId) {
        const [run] = await tx
          .select({ state: schema.payRuns.state, version: schema.payRuns.version })
          .from(schema.payRuns)
          .where(and(eq(schema.payRuns.workspaceId, ws), eq(schema.payRuns.id, args.runId)));
        if (run?.state === "EXTRACTING") {
          // every photo is read: the engine computes, once (the funding's computeRun found them unread)
          const compute = { runId: args.runId, version: run.version };
          await enqueue(tx, "computeRun", compute, `compute:${args.runId}:read`, { workspaceId: ws });
          out.computeQueued = true;
        }
      }
    }
    await ctx.complete(tx);
    return out;
  });
}

/** The `extract` task handler (registered by the slips route folder). */
export function extractTask(deps: AppDeps): TaskHandler {
  return async (raw, ctx) => {
    const out = await step(deps, raw, ctx);
    if (out.halted) {
      deps.logger.error(
        {
          outboxId: ctx.outboxId,
          workspaceId: ctx.workspaceId,
          runId: out.halted,
          cause: NO_SEED_STAND_IN.code,
        },
        NO_SEED_STAND_IN.label,
      );
    } else if (out.notBuilt > 0) {
      deps.logger.warn({ outboxId: ctx.outboxId, photos: out.notBuilt }, NOT_BUILT);
    }
    if (out.photo && out.remaining === 0) {
      deps.logger.info(
        { outboxId: ctx.outboxId, workspaceId: ctx.workspaceId, computeQueued: out.computeQueued },
        `reading replayed: ${SEED_STAND_IN.label}`,
      );
    }
    report(ctx.outboxId, {
      ok: true,
      detail: {
        ...out,
        provenance: SEED_STAND_IN.provenance,
        label: out.halted ? NO_SEED_STAND_IN.label : out.photo ? SEED_STAND_IN.label : NOT_BUILT,
      },
    });
  };
}
