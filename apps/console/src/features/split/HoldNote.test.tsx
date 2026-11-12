// The inline hold note under H1 (ADR-0016): its serial, copies and field count come from the line's own slips and
// the seed's sheets, and it carries no decision slab.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyRunEvents, sessionView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { duplicateSerial, HoldNoteView, holdNote } from "./HoldNote.js";
import { splitRows } from "./model.js";

const snapshot = seedSnapshot();
const slip = (serial: string, copy: string) =>
  snapshot.slips.find((s) => s.serial === serial && s.copy === copy);

function heldRows() {
  const world = createTestWorld();
  world.markPaid();
  const view = applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
  return { world, rows: splitRows(snapshot, view) };
}

describe("the inline hold note", () => {
  it("finds a serial on one line twice", () => {
    expect(
      duplicateSerial([
        { serial: "0457", copy: "WHITE_ORIGINAL", photoId: "B" },
        { serial: "0403", copy: "WHITE_ORIGINAL", photoId: "A" },
        { serial: "0457", copy: "PINK_DUPLICATE", photoId: "D" },
      ]),
    ).toBe("0457");
    expect(duplicateSerial([{ serial: "0403", copy: "WHITE_ORIGINAL", photoId: "A" }])).toBeNull();
  });

  it("sits under H1 while it is open: slip 0457, the white original and the pink duplicate, 4 of 4 fields", () => {
    const { rows } = heldRows();
    const note = holdNote(rows, (serial, copy) => slip(serial, copy) as never);
    expect(note).toMatchObject({ label: "H1", serial: "0457", forMember: "M-007", matched: 4, fields: 4 });
    expect(note?.white.copy).toBe("WHITE_ORIGINAL");
    expect(note?.pink.copy).toBe("PINK_DUPLICATE");
  });

  it("reads as one line with one quiet way into the drawer, and no slab", () => {
    const { rows } = heldRows();
    const note = holdNote(rows, (serial, copy) => slip(serial, copy) as never);
    if (!note) throw new Error("no note");
    const onOpen = vi.fn();
    const { container } = render(<HoldNoteView note={note} onOpen={onOpen} />);
    expect(note.netKg).toBe(slip("0457", "WHITE_ORIGINAL")?.boxes["8"]);
    expect(screen.getByTestId("W-TR-05.note.H1").textContent).toContain(
      `Slip 0457 ×2 4/4 fields match · ${note.netKg} kg`,
    );
    expect(container.querySelector(".fs-slab")).toBeNull();
    fireEvent.click(screen.getByTestId("W-TR-05.note.H1.open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
