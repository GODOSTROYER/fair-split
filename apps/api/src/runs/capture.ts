// IC-01 `capture` (M-CL-01, the clerk's outbox): one photographed slip page arriving from a phone that may have
// been offline. The shell has already checked `Content-Digest` over the exact body and claimed the
// `Idempotency-Key` (a retry replays the stored answer). Here:
//
//   - the Idempotency-Key is the capture's own UUIDv7 (S3.10), so a key that names another capture is refused;
//   - the same capture id again is `already_received` (no second document, nothing re-read);
//   - another capture of identical bytes is stored as an `exact_duplicate` of the first (never read twice,
//     never counted twice: the engine's DUPLICATE_SLIP rule works on rows, this one on bytes);
//   - a new photo is a `documents` row, a `capture.synced` event, and an `extract` task enqueued in the same
//     transaction (I7) for apps/tasks to read it (live read on Workflows, replay in Judge Mode).
import { TASKS } from "@fairsplit/contracts";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CommandHandler } from "../lib/command.js";
import { reply } from "../lib/command.js";
import { ApiProblem } from "../lib/problem.js";
import { allow, CAN, personaId } from "./access.js";
import { emit, factLedger } from "./events.js";

/** Runs that are still reading slips: a new capture belongs to them. */
const READING_STATES = ["FUNDED", "EXTRACTING"] as const;

export const captureHandler: CommandHandler<"capture"> = async (ctx) => {
  allow(ctx.credential, CAN.capture, "Capturing a slip");
  const { deps, scope, input } = ctx;
  const key = ctx.header("idempotency-key");
  if (key !== undefined && key.toLowerCase() !== input.captureId.toLowerCase()) {
    throw new ApiProblem("IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key of a capture is its capture id.", {
      details: { reason: "KEY_IS_NOT_THE_CAPTURE_ID" },
    });
  }
  const at = ctx.now();
  const by = personaId(ctx.credential);
  return withWorkspaceTx(deps.db, scope, async (tx) => {
    const D = schema.documents;
    const [same] = await tx
      .select()
      .from(D)
      .where(and(eq(D.workspaceId, scope.workspaceId), eq(D.captureId, input.captureId)));
    if (same) {
      if (same.sha256 !== input.sha256) {
        throw new ApiProblem(
          "IDEMPOTENCY_KEY_REUSED",
          "This capture id was already used for another photo.",
          {
            details: { reason: "CAPTURE_ID_REUSED" },
          },
        );
      }
      return reply(200, {
        documentId: same.id,
        status: "already_received",
        exactDuplicateOf: same.exactDuplicateOf,
      });
    }
    const [twin] = await tx
      .select({ id: D.id, exactDuplicateOf: D.exactDuplicateOf })
      .from(D)
      .where(and(eq(D.workspaceId, scope.workspaceId), eq(D.sha256, input.sha256)))
      .orderBy(asc(D.createdAt))
      .limit(1);
    const original = twin ? (twin.exactDuplicateOf ?? twin.id) : null;
    const [season] = await tx
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(eq(schema.seasons.workspaceId, scope.workspaceId))
      .orderBy(desc(schema.seasons.opensOn))
      .limit(1);
    const [doc] = await tx
      .insert(D)
      .values({
        workspaceId: scope.workspaceId,
        seasonId: season?.id ?? null,
        kind: "slip_photo",
        sha256: input.sha256,
        // The image bytes follow the capture record; until they land the row holds none (byte_size says how many).
        storage: "db",
        bytes: Buffer.alloc(0),
        byteSize: input.bytes,
        mime: input.mime,
        captureId: input.captureId,
        exactDuplicateOf: original,
        capturedAt: new Date(input.capturedAt),
        capturedBy: by,
        provenance: "live",
      })
      .returning({ id: D.id });
    if (!doc) throw new Error("documents insert returned no row");
    await emit(
      tx,
      scope,
      "capture.synced",
      { captureId: input.captureId, documentId: doc.id, sha256: input.sha256, exactDuplicateOf: original },
      { provenance: "live" },
    );
    await factLedger(
      tx,
      scope,
      "capture.received",
      {
        documentId: doc.id,
        captureId: input.captureId,
        sha256: input.sha256,
        station: input.station,
        exactDuplicateOf: original,
      },
      { at },
    );
    if (original) {
      return reply(200, { documentId: doc.id, status: "exact_duplicate", exactDuplicateOf: original });
    }
    // Extraction dispatch (I7): the read is an effect, so it is a task row in this transaction.
    const [reading] = season
      ? await tx
          .select({ id: schema.payRuns.id })
          .from(schema.payRuns)
          .where(
            and(
              eq(schema.payRuns.workspaceId, scope.workspaceId),
              eq(schema.payRuns.seasonId, season.id),
              inArray(schema.payRuns.state, READING_STATES),
            ),
          )
          .orderBy(desc(schema.payRuns.runSeq))
          .limit(1)
      : [];
    const args = { documentIds: [doc.id], runId: reading?.id ?? null };
    await enqueue(tx, "extract", args, TASKS.extract.dedupeKey(args), { workspaceId: scope.workspaceId });
    return reply(201, { documentId: doc.id, status: "accepted", exactDuplicateOf: null });
  });
};
