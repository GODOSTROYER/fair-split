// W-TR-03 the reading room: dashed beds before the reading, then MM-2 "Paper prints itself" for every live
// `extract.row` of the recorded run (full and reduced motion reach the same phases), the bench following the
// photo being read, the quarantined instruction as a notice, slip 0462 sent to a person, the zoom's read
// confirmed with one tap, a blurred photo sent back to the clerk, J/K/Space/Enter, the 58/42 room, the
// mock-only replay of the recording, and axe on every state. The mock emits no rows yet, so the recorded run's
// rows (and the two states it never reaches) are fed into the run's stream.

import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TREASURER } from "../../data/mock/driver.js";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  momentPhase,
  seedSnapshot,
  tracedPhases,
} from "../../test/index.js";
import { renderSeason, rowsFor, type SeasonRender } from "../season/testing.js";
import { REPLAY_GAP_MS, replayTiming } from "./replay.js";
import { replayRows } from "./replay-fixture.js";
import { illegibleRows, rowEvents, zoomAgreedRow } from "./state-fixtures.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

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

describe("W-TR-03 reading room", { timeout: 60_000 }, () => {
  afterEach(() => {
    replayTiming.gapMs = REPLAY_GAP_MS;
  });

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
    await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 10_000 });
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
    await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 10_000 });
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

  it("lays the room out 58/42: the photo and its filmstrip on the left, the status, beds and keys on the right", async () => {
    const r = await renderSeason({ path: `${READING}?photo=B` });
    await screen.findByTestId("W-TR-03");
    const desk = screen.getByTestId("W-TR-03.desk");
    const side = screen.getByTestId("W-TR-03.side");
    expect(desk.contains(screen.getByTestId("W-TR-03.bench"))).toBe(true);
    expect(desk.contains(screen.getByTestId("W-TR-03.film"))).toBe(true);
    expect(side.contains(screen.getByTestId("W-TR-03.film"))).toBe(false);
    expect(side.contains(screen.getByTestId("W-TR-03.status"))).toBe(true);
    expect(side.contains(screen.getByTestId("W-TR-03.beds"))).toBe(true);
    // The filmstrip sits under the photo, in reading order too.
    const bench = screen.getByTestId("W-TR-03.bench");
    expect(bench.compareDocumentPosition(screen.getByTestId("W-TR-03.film"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    r.unmount();
  });

  it("confirm-one: the zoom's read agrees with one reading; one tap confirms it in Analyn's ink", async () => {
    const r = await renderSeason({ path: `${READING}?photo=J` });
    await r.startSession();
    act(() => {
      r.world.markPaid();
    });
    await waitFor(() => expect(screen.getByTestId("W-TR-03").dataset.state).toBe("low-confidence"));
    const snapshot = seedSnapshot();
    const rest = replayRows(snapshot).filter((row) => row.photoId === "J" && row.serial !== "0462");
    act(() => r.stream.inject(rowEvents([...rest, zoomAgreedRow(snapshot)])));
    await waitFor(() => expect(screen.getByTestId("W-TR-03").dataset.state).toBe("confirm-one"));
    expect(screen.getByTestId("W-TR-03.status").textContent).toMatch(
      /Slip 0462: Claude's zoom read agrees with one of the two readings\./,
    );
    expect(screen.getByTestId("W-TR-03.beds.zoom.0462").dataset.amountState).toBe("you");
    const slab = screen.getByTestId("W-TR-03.confirm.confirm");
    expect(slab.textContent).toMatch(/Confirm 64\.80/);
    expect(slab.dataset.state).toBe("rest");
    expect(screen.getByTestId("W-TR-03").querySelectorAll(".fs-slab").length).toBeLessThanOrEqual(2);
    await expectNoAxeViolations(r.container);
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("W-TR-03.confirm.confirm.face"), { key: "Enter" });
    });
    const confirmed = await screen.findByTestId("W-TR-03.beds.confirmed.0462");
    expect(confirmed.dataset.amountState).toBe("ink");
    expect(confirmed.textContent).toMatch(/AS/);
    expect(confirmed.textContent).toMatch(/64\.50/);
    expect(r.world.holds().find((h) => h.kind === "LOW_CONFIDENCE")?.resolution?.kind).toBe(
      "CONFIRM_AS_READ",
    );
    await waitFor(() => expect(screen.queryByTestId("W-TR-03.confirm")).toBeNull());
    await expectNoAxeViolations(r.container);
    r.unmount();
  });

  it("blurred: photo E is too blurred to read; 'Request rescan' says it can't reach Jessie yet", async () => {
    const r = await readingRun("full", `${READING}?photo=E`);
    act(() => r.stream.inject(rowEvents(illegibleRows(seedSnapshot(), "E"))));
    await waitFor(() => expect(screen.getByTestId("W-TR-03").dataset.state).toBe("blurred"));
    expect(screen.getByTestId("W-TR-03.status").textContent).toBe(
      "Photo E is too blurred to read. Ask Jessie to rescan.",
    );
    for (const row of illegibleRows(seedSnapshot(), "E")) {
      expect(screen.getByTestId(`W-TR-03.beds.illegible.${row.serial}`).textContent).toBe(
        "Too blurred to read",
      );
    }
    const slab = screen.getByTestId("W-TR-03.rescan.rescan");
    expect(slab.textContent).toMatch(/Request rescan/);
    expect(slab.dataset.state).toBe("unavailable");
    expect(screen.getByTestId("W-TR-03.rescan").textContent).toMatch(
      /Rescan requests reach Jessie's phone once the server has a route for them\. Nothing was sent\./,
    );
    await expectNoAxeViolations(r.container);
    r.unmount();
  });

  it("on the mock, replays the recorded reading through the live handler: MM-2 plays, labelled mock data", async () => {
    // Slower than the recording's 240 ms, so the first row's act completes before the next row replaces it.
    replayTiming.gapMs = 2500;
    const r = await renderSeason({ path: READING });
    await screen.findByTestId("W-TR-03");
    const replay = screen.getByTestId("W-TR-03.replay");
    expect(replay.dataset.state).toBe("idle");
    expect(replay.textContent).toMatch(/Mock data: the mock API sends no rows/);
    clearMomentTrace();
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-03.replay.toggle"));
    });
    expect(screen.getByTestId("W-TR-03.replay").dataset.state).toBe("running");
    expect(screen.getByTestId("W-TR-03").dataset.state).toBe("reading");
    await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 10_000 });
    expect(tracedPhases("MM-2").slice(0, 7)).toEqual([
      "band",
      "lift",
      "flight",
      "resolve",
      "print",
      "ring",
      "landed",
    ]);
    expect(screen.getByTestId("W-TR-03.beds.row.0425").dataset.state).not.toBe("waiting");
    expect(screen.getByTestId("W-TR-03.replay").textContent).toMatch(
      /Replaying the \d+ \w{3} recording here: \d+ of 48 rows\. Mock data\./,
    );
    await expectNoAxeViolations(r.container);
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-03.replay.toggle"));
    });
    expect(screen.getByTestId("W-TR-03.replay").dataset.state).toBe("idle");
    expect(screen.getByTestId("W-TR-03").dataset.state).toBe("loading");
    r.unmount();
  });

  it("never offers the replay against fs-api", async () => {
    const r = await renderSeason({ path: READING, source: "http" });
    await screen.findByTestId("W-TR-03");
    expect(screen.queryByTestId("W-TR-03.replay")).toBeNull();
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
