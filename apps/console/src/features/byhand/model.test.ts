// W-TR-04's model: slip 0462's mask, the kilos preview against the logbook's second witness, "Use logbook line
// 7", and the field ID the console resolves for the entry (the session run's own, or none).

import { getSnapshot } from "@fairsplit/api-client/seed";
import type { RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { applyRunEvents, sessionView } from "../../data/run-view.js";
import { createTestWorld } from "../../test/index.js";
import { resolveFieldId } from "./field-id.js";
import {
  byHandField,
  byHandState,
  fillMask,
  gramsOf,
  grossFromLogbook,
  insertedDigit,
  isComplete,
  logbookWitness,
  maskOf,
  preview,
  SLOT,
} from "./model.js";

const snapshot = getSnapshot();

describe("slip 0462 by hand", () => {
  it("is the stained gross weight, read as 6?.80 with the score the reading reported", () => {
    const field = byHandField(snapshot, "0462");
    expect(field?.field).toBe("gross_kg");
    expect(field?.reading).toBe("6?.80");
    expect(field?.score).toBe(0.4);
    expect(byHandField(snapshot, "0457")).toBeNull();
  });

  it("masks the hidden digit, and one keystroke fills it", () => {
    const mask = maskOf("6?.80");
    expect(mask).toEqual({ template: `6${SLOT}.80`, slot: 1 });
    expect(fillMask(mask?.template ?? "", "4")).toBe("64.80");
    expect(insertedDigit(`6${SLOT}.80`, "64.80")).toBe("4");
    expect(insertedDigit(`6${SLOT}.80`, `6${SLOT}.804`)).toBe("4");
    expect(insertedDigit(`6${SLOT}.80`, `6${SLOT}.80`)).toBeNull();
  });

  it("previews kilos in integer grams: 64.80 − 0.30 tare = 64.50 net, matching logbook page 14, line 7", () => {
    const witness = logbookWitness(snapshot, "0462");
    expect(witness?.page.page).toBe(14);
    expect(witness?.lineNo).toBe(7);
    const p = preview("64.80", "0.30", witness);
    expect(p).toEqual({ gross: "64.80", tare: "0.30", net: "64.50", matches: true });
    expect(preview("65.80", "0.30", witness)?.matches).toBe(false);
    expect(preview(`6${SLOT}.80`, "0.30", witness)).toBeNull();
  });

  it("fills the digit from the logbook: its net plus the tare", () => {
    const witness = logbookWitness(snapshot, "0462");
    expect(witness && grossFromLogbook(witness, "0.30")).toBe("64.80");
  });

  it("reads kilos only as written, with two decimals", () => {
    expect(gramsOf("64.80")).toBe(64800);
    expect(gramsOf("64.8")).toBeNull();
    expect(isComplete("64.80")).toBe(true);
    expect(isComplete(`6${SLOT}.80`)).toBe(false);
  });

  it("moves through empty, typing, match and mismatch, then committed or skipped", () => {
    const witness = logbookWitness(snapshot, "0462");
    const state = (value: string, extra: { committed?: boolean; skipped?: boolean } = {}) =>
      byHandState({
        committed: extra.committed ?? false,
        skipped: extra.skipped ?? false,
        value,
        preview: preview(value, "0.30", witness),
      });
    expect(state(`6${SLOT}.80`)).toBe("empty");
    expect(state("")).toBe("empty");
    expect(state("64.")).toBe("typing");
    expect(state("64.80")).toBe("match");
    expect(state("65.80")).toBe("mismatch");
    expect(state("64.80", { committed: true })).toBe("committed");
    expect(state(`6${SLOT}.80`, { skipped: true })).toBe("skipped");
  });
});

describe("the entry's field ID", () => {
  const base = { view: undefined, snapshot, serial: "0462", field: "gross_kg" as const };
  const showcaseIds = (): string[] => {
    const ids: string[] = [];
    for (const hold of Object.values(snapshot.checkpoints).flatMap((c) => c.holds)) {
      const fields = hold.params.fields;
      if (!Array.isArray(fields)) continue;
      for (const f of fields) {
        const id = (f as { fieldId?: unknown } | null)?.fieldId;
        if (typeof id === "string") ids.push(id);
      }
    }
    return ids;
  };

  it("takes the session run's own field from a read of its fields", () => {
    const world = createTestWorld();
    const id = resolveFieldId({ ...base, fields: world.fields() });
    expect(id).toBe(world.fieldId("gross_kg"));
    expect(resolveFieldId({ ...base, field: "net_kg", fields: world.fields() })).toBe(
      world.fieldId("net_kg"),
    );
  });

  it("prefers a field.entered the run already streamed for the slip", () => {
    const view = applyRunEvents(
      sessionView(snapshot, { runSlug: snapshot.run.runSlug, runId: snapshot.run.id }),
      [
        {
          id: "900",
          ws: "ws",
          runId: snapshot.run.id,
          at: "2026-10-29T02:00:00.000Z",
          actor: { kind: "human", id: "AS", impersonatedBy: null },
          provenance: "live",
          type: "field.entered",
          payload: {
            fieldId: "the-session-field",
            docId: "doc",
            serial: "0462",
            field: "gross_kg",
            value: "64.80",
            derived: { net_kg: "64.50" },
            enteredBy: "AS",
          },
        } as RunEvent,
      ],
    );
    expect(resolveFieldId({ ...base, view, fields: null })).toBe("the-session-field");
  });

  it("names no field when nothing has said which one, and never one of the showcase's", () => {
    const showcase = showcaseIds();
    expect(showcase.length).toBeGreaterThan(0);
    expect(resolveFieldId({ ...base, fields: null })).toBeNull();
    expect(resolveFieldId({ ...base, fields: [] })).toBeNull();
    const fromRead = resolveFieldId({ ...base, fields: createTestWorld().fields() });
    expect(fromRead).not.toBeNull();
    expect(showcase).not.toContain(fromRead);
  });
});

it("resolves a server field by its session slip serial even when row IDs differ from the showcase", () => {
  expect(
    resolveFieldId({
      view: undefined,
      snapshot,
      serial: "0462",
      field: "gross_kg",
      fields: [{ id: "session-field", slipRowId: "session-row", serial: "0462", field: "gross_kg" }],
    }),
  ).toBe("session-field");
});
