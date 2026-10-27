// W-TR-03 the reading room: dashed beds before the reading, then MM-2 "Paper prints itself" for every live
// `extract.row` of the recorded run (full and reduced motion reach the same phases), the bench following the
// photo being read, the quarantined instruction as a notice, slip 0462 sent to a person, J/K/Space/Enter, and
// axe on every state. The mock emits no rows yet, so the recorded run's rows are fed into the run's stream.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TREASURER } from "../../data/mock/driver.js";
import { clearMomentTrace, expectNoAxeViolations, momentPhase, tracedPhases } from "../../test/index.js";
import { renderSeason, rowsFor, type SeasonRender } from "../season/testing.js";

const READING = "/season/2026-A/reading";

/** A session whose run is funded and reading (EXTRACTING), its rows not yet streamed. */
async function readingRun(motion: "full" | "reduced" = "full", path = READING): Promise<SeasonRender> {
  const r = await renderSeason({ path, motion });
  await r.startSession();
  act(() => {
    r.world.execute("markPaid", {
      params: { runSlug: r.world.runSlug },
      input: {},
      caller: TREASURER,
      headers: { idempotencyKey: null },
    });
    r.world.advance(1);
  });
  await waitFor(() => expect(screen.getByTestId("W-TR-03").dataset.state).toBe("reading"));
  return r;
}

describe("W-TR-03 reading room", () => {
  it("waits on the desk before the invoice is paid: dashed beds, photos A to L, no row", async () => {
    const r = await renderSeason({ path: READING });
    const root = await screen.findByTestId("W-TR-03");
    expect(root.dataset.state).toBe("loading");
    expect(screen.getByTestId("W-TR-03.status").textContent).toMatch(/waits on the desk/);
    expect(within(screen.getByTestId("W-TR-03.film")).getAllByRole("link")).toHaveLength(12);
    expect(screen.getByTestId("W-TR-03.beds.row.0425").dataset.state).toBe("waiting");
    expect(screen.getByTestId("W-TR-03.footer").textContent).toMatch(
      /^Read by Claude \(claude-opus-5-5\), replay of a recorded run from \d+ \w{3}\. Amounts are computed by the engine, never by the model\.$/,
    );
    await expectNoAxeViolations(r.container);
    r.unmount();
  });

  it("MM-2: each live extract.row prints its row in pencil, band to landed, and the photo ticks", async () => {
    const r = await readingRun();
    clearMomentTrace();
    act(() => r.stream.inject(rowsFor(["A"])));
    expect(screen.getByTestId("W-TR-03.beds.row.0425").dataset.state).toBe("landing");
    await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 6000 });
    const phases = tracedPhases("MM-2");
    expect(phases.slice(-7)).toEqual(["band", "lift", "flight", "resolve", "print", "ring", "landed"]);
    await waitFor(() => expect(screen.getByTestId("W-TR-03.beds.row.0428").dataset.state).toBe("printed"), {
      timeout: 4000,
    });
    const row = screen.getByTestId("W-TR-03.beds.row.0425");
    expect(row.querySelector('[data-amount-state="pencil"]')?.textContent).toMatch(/^\d+\.\d{2}$/);
    expect(screen.getByTestId("W-TR-03.film.A").dataset.read).toBe("");
    expect(screen.getByTestId("W-TR-03.film.progress").textContent).toBe("4 of 48 slips read");
    expect(screen.getByTestId("W-TR-03.bench.band").dataset.serial).toBe("0428");
    await expectNoAxeViolations(r.container);
    r.unmount();
  });

  it("reduced motion reaches the same phases, with no flight", async () => {
    const r = await readingRun("reduced");
    clearMomentTrace();
    act(() => r.stream.inject(rowsFor(["A"])));
    await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 6000 });
    expect(tracedPhases("MM-2").slice(-7)).toEqual([
      "band",
      "lift",
      "flight",
      "resolve",
      "print",
      "ring",
      "landed",
    ]);
    expect(r.container.querySelector(".fsc-flight")).toBeNull();
    r.unmount();
  });

  it("follows the reading to the photo being read; names the pink copy of 0457", async () => {
    const r = await readingRun();
    act(() => r.stream.inject(rowsFor(["B"])));
    await waitFor(() => expect(screen.getByTestId("W-TR-03.bench").dataset.photo).toBe("B"));
    expect(screen.getByTestId("W-TR-03.status").textContent).toMatch(
      /Slip 0457 also appears in photo D as the pink copy\./,
    );
    r.unmount();
  });

  it("shows slip 0449's margin note as a quarantine notice, never a hold", async () => {
    const r = await readingRun("full", `${READING}?photo=I`);
    act(() => r.stream.inject(rowsFor(["I"])));
    const notice = await screen.findByTestId("W-TR-03.beds.quarantine.0449");
    expect(notice.textContent).toBe(
      "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction.",
    );
    await waitFor(() => expect(screen.getByTestId("W-TR-03").dataset.state).toBe("quarantined"), {
      timeout: 4000,
    });
    r.unmount();
  });

  it("sends slip 0462 to a person: a You cell, and Enter on its row opens W-TR-04", async () => {
    const r = await readingRun("reduced", `${READING}?photo=J`);
    act(() => r.stream.inject(rowsFor(["J"])));
    const you = await screen.findByTestId("W-TR-03.beds.you.0462");
    expect(you.getAttribute("href")).toBe("/season/2026-A/by-hand/0462");
    expect(you.dataset.amountState).toBe("you");
    expect(you.textContent).toMatch(/6\?\.50/);
    expect(screen.getByTestId("W-TR-03.film.J").dataset.pending).toBe("");
    const row = screen.getByTestId("W-TR-03.beds.row.0462");
    await act(async () => {
      row.focus();
      fireEvent.keyDown(row, { key: "Enter" });
    });
    await screen.findByTestId("W-TR-04");
    r.unmount();
  });

  it("J and K move between rows; Space opens the slip on the bench; the zoom has buttons", async () => {
    const r = await renderSeason({ path: `${READING}?photo=A` });
    await screen.findByTestId("W-TR-03");
    const first = screen.getByTestId("W-TR-03.beds.row.0425");
    await act(async () => {
      first.focus();
    });
    await act(async () => {
      fireEvent.keyDown(first, { key: "j" });
    });
    expect(document.activeElement).toBe(screen.getByTestId("W-TR-03.beds.row.0426"));
    await act(async () => {
      fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    });
    expect(document.activeElement).toBe(first);
    await act(async () => {
      fireEvent.keyDown(first, { key: " " });
    });
    expect(screen.getByTestId("W-TR-03.bench.scale").textContent).toBe("2.4×");
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-03.bench.zoomFit"));
    });
    expect(screen.getByTestId("W-TR-03.bench.scale").textContent).toBe("1.0×");
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-03.bench.zoomIn"));
    });
    expect(screen.getByTestId("W-TR-03.bench.scale").textContent).toBe("1.6×");
    r.unmount();
  });

  it("opens a photo read earlier this season as read, with its date", async () => {
    const r = await renderSeason({ path: `${READING}?photo=P01` });
    const root = await screen.findByTestId("W-TR-03");
    expect(root.dataset.state).toBe("read");
    expect(screen.getByTestId("W-TR-03.status").textContent).toMatch(/^Photo P01 was read on/);
    expect(screen.getByTestId("W-TR-03.film.earlier")).toBeTruthy();
    await expectNoAxeViolations(r.container);
    r.unmount();
  });
});
