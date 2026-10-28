// W-TR-04 by hand: slip 0462's stained digit. Before the reading the field waits; after it, one keystroke fills
// the mask, the live line checks the logbook's lines 5 to 9, Enter commits, and the value prints in the
// treasurer's ink when the server's live field.entered arrives, which plays MM-2's by-hand act (by-hand →
// entered → done) in full and reduced motion. The entry goes to the session run's own field: the mock names it
// (as its browser build does, through window.__fsMock); with nothing to name it, the slab says why and nothing
// is posted. "Use logbook line 7", a mismatch with its reason, skipping, and a slip that needs nothing by hand.
// Axe on every state.

import { act, configure, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  momentPhase,
  type RenderedConsole,
  renderConsole,
  tracedPhases,
} from "../../test/index.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

const BY_HAND = "/season/2026-A/by-hand/0462";

/** What the mock's browser build hands the page (src/data/mock/browser.ts): its world, the session run. */
function exposeMockWorld(view: RenderedConsole) {
  window.__fsMock = {
    mock: view.world.mock,
    transport: "memory",
    driver: view.world,
    cosign: () => undefined,
  };
}

async function readRun(motion: "full" | "reduced" = "full", { mock = true } = {}) {
  const view = await renderConsole({ path: BY_HAND, motion });
  if (mock) exposeMockWorld(view);
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

describe("W-TR-04 by hand", { timeout: 60_000 }, () => {
  afterEach(() => {
    delete window.__fsMock;
    vi.restoreAllMocks();
  });

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

  it("crops the logbook to lines 5 to 9 under the slip: line 7 carries the band, as the second witness", async () => {
    await renderConsole({ path: BY_HAND });
    const logbook = await screen.findByTestId("W-TR-04.logbook");
    const svg = logbook.querySelector("svg");
    expect(svg?.dataset.lines).toBe("5-9");
    const lines = [...logbook.querySelectorAll<SVGGElement>("[data-line]")].map((g) => g.dataset.line);
    expect(lines).toEqual(["5", "6", "7", "8", "9"]);
    expect(logbook.querySelector("[data-band]")?.getAttribute("data-line")).toBe("7");
    expect(screen.getByText("Logbook page 14, lines 5 to 9: the second witness")).toBeTruthy();
    // The crop sits above the logbook; the prompt, the field and the slab beside them.
    const evidence = screen.getByTestId("W-TR-04.evidence");
    expect(evidence.contains(screen.getByTestId("W-TR-04.crop"))).toBe(true);
    expect(evidence.contains(logbook)).toBe(true);
    const entry = screen.getByTestId("W-TR-04.entry");
    expect(entry.contains(screen.getByTestId("W-TR-04.prompt"))).toBe(true);
    expect(entry.contains(screen.getByTestId("W-TR-04.commit"))).toBe(true);
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

  it("reduced motion plays the same by-hand act on the live field.entered, every phase kept", async () => {
    const view = await readRun("reduced");
    clearMomentTrace();
    typeDigit("4");
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: "Enter" });
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-04").dataset.state).toBe("committed"));
    await waitFor(() => expect(momentPhase(view.container, "MM-2")).toBe("done"));
    expect(tracedPhases("MM-2")).toEqual(["by-hand", "entered", "done"]);
  });

  it("the press alone moves no phase: the act waits for the server's event", async () => {
    const view = await readRun();
    clearMomentTrace();
    typeDigit("4");
    const enter = vi.spyOn(view.adapter, "call").mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: "Enter" });
    });
    expect(enter).toHaveBeenCalledWith("enterField", {
      params: { fieldId: view.world.fieldId("gross_kg") },
      body: { value: "64.80" },
    });
    expect(momentPhase(view.container, "MM-2")).toBe("idle");
    expect(tracedPhases("MM-2")).toEqual([]);
  });

  it("an entry made before the page opened is history: done, still, no act", async () => {
    const view = await renderConsole({ path: "/judge" });
    exposeMockWorld(view);
    await view.startSession();
    act(() => {
      view.world.markPaid();
      view.world.enterByHand("64.80");
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("holds"));
    clearMomentTrace();
    await view.navigate(BY_HAND);
    await waitFor(() => expect(screen.getByTestId("W-TR-04").dataset.state).toBe("committed"));
    await waitFor(() => expect(momentPhase(view.container, "MM-2")).toBe("done"));
    expect(tracedPhases("MM-2")).toEqual(["done"]);
  });

  it("a committed value the logbook disagrees with never reads 'Matches logbook'", async () => {
    const view = await renderConsole({ path: "/judge" });
    exposeMockWorld(view);
    await view.startSession();
    act(() => {
      view.world.markPaid();
      view.world.enterByHand("64.90"); // entered elsewhere (another console, the API), not through this page
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("holds"));
    await view.navigate(BY_HAND);
    await waitFor(() => expect(screen.getByTestId("W-TR-04").dataset.state).toBe("committed"));
    const net = screen.getByTestId("W-TR-04.net").textContent ?? "";
    expect(net).not.toMatch(/Matches logbook/);
    expect(net).toMatch(/Logbook line 7 says 64\.50: they don't match\./);
  });

  it("with nothing to name the session's field (fs-api today), the slab says why and nothing is posted", async () => {
    const view = await readRun("full", { mock: false });
    const call = vi.spyOn(view.adapter, "call");
    typeDigit("4");
    expect(screen.getByTestId("W-TR-04").dataset.state).toBe("match");
    const slab = screen.getByTestId("W-TR-04.commit");
    expect(slab.dataset.state).toBe("unavailable");
    expect(screen.getByTestId("W-TR-04.entry").textContent).toMatch(
      /This step isn't wired on the server yet: it doesn't say which field on slip 0462 takes the entry\./,
    );
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: "Enter" });
    });
    expect(call.mock.calls.some(([name]) => name === "enterField")).toBe(false);
    expect(view.world.fields().find((f) => f.field === "gross_kg")?.finalValue).toBeNull();
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

  it("a digit the logbook disagrees with is a person's question, and this console cannot take it: the split would not follow", async () => {
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
    // The engine's checkpoint here is the logbook's 64.80: 65.80 would leave the split, the lines root the keys
    // sign and every amount where they are (I1), so the entry says why it waits instead of going through.
    expect(screen.getByTestId("W-TR-04.offPath").textContent).toMatch(/can't take a different one yet/);
    expect(screen.getByTestId("W-TR-04.commit").dataset.state).toBe("unavailable");
    fireEvent.keyDown(screen.getByTestId("W-TR-04.input"), { key: "Enter" });
    expect(screen.queryByTestId("W-TR-04.committed")).toBeNull();
    expect(screen.getByTestId("W-TR-04").dataset.state).toBe("mismatch");
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
