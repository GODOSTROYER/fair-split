// IC-01 `resolveHold` (MM-3 "the pink copy"): a person picks a hold card's slab; code recomputes every line.
//
//   OPEN ──(ASK_CHAIR)──▶ ASKED_CHAIR ──▶ RESOLVED | EXCLUDED          (forward only, compare-and-set)
//
// The resolution must be one the engine allows for the hold's kind (`ALLOWED_RESOLUTIONS`); MASS_BALANCE is
// raised and cleared by the engine only. The recompute runs in the same transaction, so the response and
// the SSE events (hold.resolved, line.state, the engine-cleared dial) describe one committed state.
// An override (TWO_DELIVERIES, CONFIRM_AS_READ on a rate or injection hold) needs the Chair (R5).
import type { HoldResolutionKind, HoldState, ResolveHoldRequest } from "@fairsplit/contracts";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { ALLOWED_RESOLUTIONS, isOverride, isResolutionAllowed } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import type { CommandHandler } from "../lib/command.js";
import { ApiProblem, problem } from "../lib/problem.js";
import { allow, CAN, initialsOf, personaId } from "./access.js";
import { holdDto } from "./dto.js";
import { recomputeRun } from "./engine.js";
import { factLedger, noteSha256 } from "./events.js";
import { casGuard, lockRun } from "./load.js";
import { type HoldRow, moveHold, touchRun } from "./machine.js";
import { openForEdit } from "./review.js";

function holdNotOpen(hold: HoldRow): ApiProblem {
  return new ApiProblem(
    "HOLD_NOT_OPEN",
    `${hold.code ?? "This hold"} is already ${hold.state.toLowerCase().replace("_", " ")}.`,
    {
      details: { holdState: hold.state },
    },
  );
}

/** What a resolution stores (`holds.resolution`), with the parameters the engine reads back. */
function storedResolution(input: ResolveHoldRequest, by: string, at: string) {
  const base = { kind: input.resolution as HoldResolutionKind, by, at };
  switch (input.resolution) {
    case "TWO_DELIVERIES":
    case "EXCLUDE_LINE":
      return { ...base, reason: input.reason };
    case "REGISTER_PLOT":
      return { ...base, reason: null, plot: input.plot };
    case "APPLY_RULE":
      return { ...base, reason: null, ruleId: input.ruleId };
    default:
      return { ...base, reason: null };
  }
}

export const resolveHoldHandler: CommandHandler<"resolveHold"> = async (ctx) => {
  const { deps, scope, input } = ctx;
  const at = ctx.now();
  const actorId = personaId(ctx.credential);
  const by = initialsOf(actorId);
  return casGuard(() =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      const [hold] = await tx
        .select()
        .from(schema.holds)
        .where(and(eq(schema.holds.workspaceId, scope.workspaceId), eq(schema.holds.id, ctx.params.holdId)))
        .for("update");
      if (!hold) throw problem.notFound("No such hold in this workspace.");
      allow(
        ctx.credential,
        hold.state === "ASKED_CHAIR" ? CAN.resolveAskedHold : CAN.resolveHold,
        "Resolving a hold",
      );
      if (hold.state !== "OPEN" && hold.state !== "ASKED_CHAIR") throw holdNotOpen(hold);
      if (input.resolution === "ASK_CHAIR" && hold.state === "ASKED_CHAIR") throw holdNotOpen(hold);
      if (input.resolution !== "ASK_CHAIR" && !isResolutionAllowed(hold.kind, input.resolution)) {
        throw new ApiProblem(
          "RESOLUTION_NOT_ALLOWED",
          hold.kind === "MASS_BALANCE"
            ? "The mass balance clears itself when the kilos add up; resolve the holds behind it."
            : `${input.resolution} does not resolve a ${hold.kind} hold.`,
          { details: { kind: hold.kind, allowed: [...ALLOWED_RESOLUTIONS[hold.kind]] } },
        );
      }
      const locked = await lockRun(tx, scope, hold.runId);
      const { run } = await openForEdit(tx, scope, locked, {
        at,
        provenance: "live",
        what: "a hold resolution",
      });

      if (input.resolution === "ASK_CHAIR") {
        const asked = await moveHold(tx, scope, {
          hold,
          to: "ASKED_CHAIR",
          resolvedBy: actorId,
          provenance: "live",
          at,
        });
        await factLedger(
          tx,
          scope,
          "hold.asked_chair",
          { runId: run.id, holdId: hold.id, kind: hold.kind, reasonSha256: noteSha256(input.reason) },
          { runId: run.id, at },
        );
        const touched = await touchRun(tx, scope, { id: run.id, state: "IN_REVIEW" });
        return {
          hold: holdDto(asked),
          resolution: null,
          runVersion: touched.version,
          recomputed: false,
          needsChair: true,
        };
      }

      const resolution = storedResolution(input, by, at.toISOString());
      const to: HoldState = input.resolution === "EXCLUDE_LINE" ? "EXCLUDED" : "RESOLVED";
      await moveHold(tx, scope, { hold, to, resolution, resolvedBy: actorId, provenance: "live", at });
      await factLedger(
        tx,
        scope,
        "hold.resolved",
        {
          runId: run.id,
          holdId: hold.id,
          kind: hold.kind,
          resolution: input.resolution,
          ...("reason" in input ? { reasonSha256: noteSha256(input.reason) } : {}),
        },
        { runId: run.id, at },
      );
      await recomputeRun(tx, scope, run, { at, actor: scope.actor, provenance: "live" });
      const touched = await touchRun(tx, scope, { id: run.id, state: "IN_REVIEW" });
      const [after] = await tx
        .select()
        .from(schema.holds)
        .where(and(eq(schema.holds.workspaceId, scope.workspaceId), eq(schema.holds.id, hold.id)));
      return {
        hold: holdDto(after ?? hold),
        resolution: input.resolution,
        runVersion: touched.version,
        recomputed: true,
        needsChair: isOverride(hold.kind, input.resolution),
      };
    }),
  );
};
