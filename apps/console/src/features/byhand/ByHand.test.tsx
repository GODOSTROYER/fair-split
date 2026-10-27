// W-TR-04 by hand: slip 0462's stained digit. Before the reading the field waits; after it, one keystroke fills
// the mask, the live line checks the logbook, Enter commits, and the value prints in the treasurer's ink when
// the server's field.entered arrives (MM-2 by-hand → entered → done). "Use logbook line 7", a mismatch with its
// reason, skipping, and a slip that needs nothing by hand. Axe on every state.

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  momentPhase,
  renderConsole,
  tracedPhases,
} from "../../test/index.js";

const BY_HAND = "/season/2026-A/by-hand/0462";

async function readRun(motion: "full" | "reduced" = "full") {
  const view = await renderConsole({ path: BY_HAND, motion });
  await view.startSession();
  act(() => {
    view.world.markPaid();
  });
  await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("W-TR-04.input").disabled).toBe(false));
  return view;
}

function typeDigit(digit: string) {
  fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: digit });
}

describe("W-TR-04 by hand", () => {
  it("waits for the reading: the crop and the logbook show, the field and the slab do not take a value yet", async () => {
    const view = await renderConsole({ path: BY_HAND });
    const root = await screen.findByTestId("W-TR-04");
    expect(root.dataset.state).toBe("empty");
    expect(screen.getByTestId("W-TR-04.prompt").textContent).toBe(
      "Slip 0462, Arnel Sumampao. A water stain covers one digit of the gross weight. Claude read 6?.80 (0.40).",
    );
    expect(screen.getByTestId<HTMLInputElement>("W-TR-04.input").value).toBe("6▢.80");
    expect(screen.getByTestId<HTMLInputElement>("W-TR-04.input").disabled).toBe(true);
    expect(screen.getByTestId("W-TR-04.commit").dataset.state).toBe("unavailable");
    expect(screen.getByTestId("W-TR-04.crop")).toBeTruthy();
    expect(screen.getByTestId("W-TR-04.logbook")).toBeTruthy();
    await expectNoAxeViolations(view.container);
  });

  it("one keystroke fills the hidden digit; the logbook agrees; Enter commits it in Analyn's ink (MM-2)", async () => {
    const view = await readRun();
    clearMomentTrace();
    typeDigit("4");
    expect(screen.getByTestId<HTMLInputElement>("W-TR-04.input").value).toBe("64.80");
    expect(screen.getByTestId("W-TR-04").dataset.state).toBe("match");
    expect(screen.getByTestId("W-TR-04.live").textContent).toBe(
      "64.80 − 0.30 tare = 64.50 net. Matches logbook page 14, line 7.",
    );
    expect(screen.getByTestId("W-TR-04.commit").dataset.state).toBe("rest");
    await expectNoAxeViolations(view.container);
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: "Enter" });
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-04").dataset.state).toBe("committed"));
    await waitFor(() => expect(momentPhase(view.container, "MM-2")).toBe("done"));
    expect(tracedPhases("MM-2")).toEqual(["by-hand", "entered", "done"]);
    expect(screen.getByTestId("W-TR-04.provenance").textContent).toBe("Entered by Analyn");
    expect(screen.getByTestId("W-TR-04.net").textContent).toBe(
      "Net 64.50 kg. Matches logbook page 14, line 7.",
    );
    expect(screen.getByTestId("W-TR-04.stamp").textContent).toBe("AS");
    expect(view.world.fields().find((f) => f.field === "gross_kg")?.finalValue).toBe("64.80");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("holds"));
    await expectNoAxeViolations(view.container);
  });

  it("'Use logbook line 7' fills the digit from the logbook's net plus the tare, and says so in ink", async () => {
    await readRun("reduced");
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-04.useLogbook"));
    });
    expect(screen.getByTestId<HTMLInputElement>("W-TR-04.input").value).toBe("64.80");
    expect(screen.getByTestId("W-TR-04.useLogbook").dataset.used).toBe("");
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-04.commit.face"), { key: "Enter" });
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-04").dataset.state).toBe("committed"));
    expect(screen.getByTestId("W-TR-04.provenance").textContent).toBe(
      "Entered by Analyn, from logbook line 7",
    );
  });

  it("a digit the logbook disagrees with is a person's question: the slab waits for a reason", async () => {
    const view = await readRun();
    typeDigit("5");
    expect(screen.getByTestId("W-TR-04").dataset.state).toBe("mismatch");
    expect(screen.getByTestId("W-TR-04.live").textContent).toBe(
      "65.80 − 0.30 tare = 65.50 net. 65.50 doesn't match logbook line 7 (64.50). Check both.",
    );
    expect(screen.getByTestId("W-TR-04.commit").dataset.state).toBe("unavailable");
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-04.anyway"));
    });
    fireEvent.change(screen.getByTestId("W-TR-04.reason"), {
      target: { value: "The slip was rewritten at the scale." },
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-04.commit").dataset.state).toBe("rest"));
    expect(screen.getByTestId("W-TR-04.commit").textContent).toMatch(/Enter 65\.80 anyway/);
    await expectNoAxeViolations(view.container);
  });

  it("skipping keeps approval waiting for the slip", async () => {
    await readRun();
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-04.skip"));
    });
    expect(screen.getByTestId("W-TR-04").dataset.state).toBe("skipped");
    expect(screen.getByTestId("W-TR-04.skipped").textContent).toMatch(
      /^Skipped\. Approval waits for slip 0462\./,
    );
  });

  it("a slip Claude read cleanly needs nothing by hand", async () => {
    await renderConsole({ path: "/season/2026-A/by-hand/0457" });
    expect((await screen.findByTestId("W-TR-04")).dataset.state).toBe("empty");
    expect(screen.getByTestId("W-TR-04.prompt").textContent).toMatch(/needs nothing by hand/);
  });
});
