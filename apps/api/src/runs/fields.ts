// IC-01 `enterField` (W-TR-04 "By hand", slip 0462's stained digit): a person types as few values as possible
// and code derives the rest (net = gross − tare). The entry is parsed and normalised by code (kilos become
// integer grams, printed back as the slip writes them: "64.80"), the derived fields are written too, the
// slip row is confirmed once no blocking field waits for a person, and the run is recomputed in the same
// transaction: the LOW_CONFIDENCE hold clears as ENTERED_BY_HAND and the mass-balance dial opens (MM-2).
// The logbook line is the witness: `logbookMatch` says whether the derived net equals what the clerk
// wrote in the bodega logbook. A value read by agreement is never overwritten by a derivation.
import { BLOCKING_SLIP_FIELDS, type PayRunState, type SlipFieldName } from "@fairsplit/contracts";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { deriveKilos, fitsPattern, format, normalise, validate } from "@fairsplit/domain";
import { getLogbook } from "@fairsplit/seed";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { CommandHandler } from "../lib/command.js";
import { problem } from "../lib/problem.js";
import { allow, CAN, initialsOf, personaId } from "./access.js";
import { toIntOrNull } from "./codes.js";
import { fieldDto, merge } from "./dto.js";
import { recomputeRun } from "./engine.js";
import { emit, factLedger } from "./events.js";
import { casGuard, lockRun } from "./load.js";
import { touchRun } from "./machine.js";
import { openForEdit, SIGNING_STATES, tooLate } from "./review.js";

const KILO_FIELDS = new Set(["gross_kg", "tare_kg", "net_kg", "mc_less_kg", "payable_kg"]);
const TERMINAL_RUNS: PayRunState[] = ["CANCELLED", "DENIED", "HALTED", "CLOSED"];
const MONEY_MOVING: PayRunState[] = ["POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"];

/** The typed text, normalised by code, or a located 400. */
export function normaliseEntry(field: string, raw: string): { text: string; grams: number | null } {
  const value = raw.trim();
  const bad = (expected: string) =>
    problem.validation(`Type the ${field.replace("_", " ")} as written on the slip (${expected}).`, [
      { path: "body.value", message: expected, code: "invalid_entry" },
    ]);
  if (KILO_FIELDS.has(field)) {
    const g = normalise.kgGrams(value);
    if (g === null || !validate.kgText(value)) throw bad("kilos with up to two decimals, e.g. 64.80");
    return { text: format.slipKg(g), grams: g };
  }
  switch (field) {
    case "mc_pct": {
      const t = normalise.mcPctTenths(value);
      if (t === null || !validate.mcPctTenths(t)) throw bad("a moisture percentage, e.g. 6.5");
      return { text: `${Math.floor(t / 10)}.${t % 10}`, grams: null };
    }
    case "serial": {
      const s = normalise.serial(value);
      if (s === null) throw bad("a four-digit serial");
      return { text: s, grams: null };
    }
    case "member_no": {
      const m = normalise.memberNo(value);
      if (m === null) throw bad("a member number, e.g. M-014");
      return { text: m, grams: null };
    }
    case "grade": {
      const g = normalise.grade(value);
      if (g === null) throw bad("G1, G2 or OFF");
      return { text: g, grams: null };
    }
    case "date": {
      const d = normalise.date(value);
      if (d === null) throw bad("a date, e.g. 7/4/26");
      return { text: d, grams: null };
    }
    case "plot_no": {
      const p = normalise.plotNo(value);
      if (!validate.plotNo(p)) throw bad("a plot number, e.g. P-060-A");
      return { text: p, grams: null };
    }
    case "sacks": {
      const s = normalise.sacks(value);
      if (s === null) throw bad("sacks as written, e.g. 1 PP");
      return { text: s, grams: null };
    }
    default:
      if (value.length === 0) throw bad("a value");
      return { text: value, grams: null };
  }
}

function readText(v: unknown): string | null {
  return v && typeof v === "object" && typeof (v as { valueText?: unknown }).valueText === "string"
    ? (v as { valueText: string }).valueText
    : null;
}

type KiloName = "gross_kg" | "tare_kg" | "net_kg";

export const enterFieldHandler: CommandHandler<"enterField"> = async (ctx) => {
  allow(ctx.credential, CAN.enterField, "Entering a field by hand");
  const { deps, scope } = ctx;
  const at = ctx.now();
  const actorId = personaId(ctx.credential);
  const enteredBy = initialsOf(actorId);
  return casGuard(() =>
    withWorkspaceTx(deps.db, scope, async (tx) => {
      const F = schema.slipFields;
      const [field] = await tx
        .select()
        .from(F)
        .where(and(eq(F.workspaceId, scope.workspaceId), eq(F.id, ctx.params.fieldId)))
        .for("update");
      if (!field) throw problem.notFound("No such field in this workspace.");
      const [row] = await tx
        .select()
        .from(schema.slipRows)
        .where(
          and(eq(schema.slipRows.workspaceId, scope.workspaceId), eq(schema.slipRows.id, field.slipRowId)),
        )
        .for("update");
      if (!row) throw problem.notFound("No such slip in this workspace.");
      const entry = normaliseEntry(field.field, ctx.input.value);

      // The run this slip feeds (the season's latest live run): open it for an edit, or refuse.
      const [latest] = await tx
        .select({ id: schema.payRuns.id })
        .from(schema.payRuns)
        .where(
          and(
            eq(schema.payRuns.workspaceId, scope.workspaceId),
            eq(schema.payRuns.seasonId, row.seasonId),
            notInArray(schema.payRuns.state, TERMINAL_RUNS),
          ),
        )
        .orderBy(desc(schema.payRuns.runSeq))
        .limit(1);
      let run = latest ? await lockRun(tx, scope, latest.id) : null;
      if (run && MONEY_MOVING.includes(run.state as PayRunState)) throw tooLate(run, "a by-hand entry");
      if (run && (run.state === "IN_REVIEW" || SIGNING_STATES.includes(run.state as PayRunState))) {
        ({ run } = await openForEdit(tx, scope, run, { at, provenance: "live", what: "a by-hand entry" }));
      }

      // The entry, then what code derives from it (never overwriting a value read by agreement).
      const siblings = await tx
        .select()
        .from(F)
        .where(and(eq(F.workspaceId, scope.workspaceId), eq(F.slipRowId, row.id)));
      const byName = new Map(siblings.map((f) => [f.field, f]));
      const stored: Record<KiloName, number | null> = {
        gross_kg: toIntOrNull(row.grossG),
        tare_kg: toIntOrNull(row.tareG),
        net_kg: toIntOrNull(row.netG),
      };
      const known = (name: KiloName): number | null => {
        const f = byName.get(name);
        if (!f) return stored[name];
        return f.finalValue === null ? null : normalise.kgGrams(f.finalValue);
      };
      const decide = { decidedBy: "person" as const, decidedByActor: actorId, decidedAt: at };
      await tx
        .update(F)
        .set({ finalValue: entry.text, ...decide })
        .where(eq(F.id, field.id));

      const derived: Record<string, string> = {};
      const kilos: Partial<Record<KiloName, number>> = {};
      if (field.field === "gross_kg" || field.field === "tare_kg" || field.field === "net_kg") {
        const typed = entry.grams as number;
        kilos[field.field] = typed;
        const d =
          field.field === "gross_kg"
            ? deriveKilos({ grossG: typed, tareG: known("tare_kg") })
            : field.field === "tare_kg"
              ? deriveKilos({ grossG: known("gross_kg"), tareG: typed })
              : deriveKilos({ tareG: known("tare_kg"), netG: typed });
        if (d) {
          for (const [name, grams] of [
            ["gross_kg", d.grossG],
            ["tare_kg", d.tareG],
            ["net_kg", d.netG],
          ] as const) {
            if (name === field.field || grams < 0) continue;
            const f = byName.get(name);
            if (f?.decidedBy === "agreement") continue;
            const text = format.slipKg(grams);
            kilos[name] = grams;
            derived[name] = text;
            if (f && f.finalValue !== text)
              await tx
                .update(F)
                .set({ finalValue: text, ...decide })
                .where(eq(F.id, f.id));
          }
        }
      }
      const rowPatch: Partial<typeof schema.slipRows.$inferInsert> = {};
      if (kilos.gross_kg !== undefined) rowPatch.grossG = BigInt(kilos.gross_kg);
      if (kilos.tare_kg !== undefined) rowPatch.tareG = BigInt(kilos.tare_kg);
      if (kilos.net_kg !== undefined) rowPatch.netG = BigInt(kilos.net_kg);
      const after = await tx
        .select({ field: F.field, finalValue: F.finalValue })
        .from(F)
        .where(and(eq(F.workspaceId, scope.workspaceId), eq(F.slipRowId, row.id)));
      const blocking = new Set<string>(BLOCKING_SLIP_FIELDS);
      if (row.state === "NEEDS_HUMAN" && !after.some((f) => blocking.has(f.field) && f.finalValue === null)) {
        rowPatch.state = "CONFIRMED";
      }
      if (Object.keys(rowPatch).length > 0) {
        await tx.update(schema.slipRows).set(rowPatch).where(eq(schema.slipRows.id, row.id));
      }

      // The witness: the bodega logbook line for this serial (the seeded logbook).
      const netText = field.field === "net_kg" ? entry.text : (derived.net_kg ?? null);
      const witness = getLogbook()
        .flatMap((p) => p.lines)
        .find((l) => l.serial === row.serial);
      const logbookMatch = netText === null || !witness ? null : witness.netKgText === netText;
      const pattern = merge(readText(field.readA), readText(field.readB));
      const matchesReadPattern = pattern.length === 0 || fitsPattern(entry.text, pattern);

      await emit(
        tx,
        scope,
        "field.entered",
        {
          fieldId: field.id,
          docId: row.documentId,
          serial: row.serial,
          field: field.field as SlipFieldName,
          value: entry.text,
          derived,
          enteredBy,
        },
        { runId: run?.id ?? null, provenance: "live" },
      );
      await factLedger(
        tx,
        scope,
        "field.entered",
        {
          fieldId: field.id,
          slipRowId: row.id,
          serial: row.serial,
          field: field.field,
          grams: entry.grams,
          logbookMatch,
        },
        { runId: run?.id ?? null, at },
      );

      let runVersion = run?.version ?? 0;
      if (run && run.state === "IN_REVIEW") {
        await recomputeRun(tx, scope, run, { at, actor: scope.actor, provenance: "live" });
        runVersion = (await touchRun(tx, scope, { id: run.id, state: "IN_REVIEW" })).version;
      }
      const [entered] = await tx.select().from(F).where(eq(F.id, field.id));
      return { field: fieldDto(entered ?? field), derived, logbookMatch, matchesReadPattern, runVersion };
    }),
  );
};
