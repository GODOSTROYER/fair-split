// W-TR-03 the reading room: dashed beds before the reading, then MM-2 "Paper prints itself" for every live
// `extract.row` of the recorded run (full and reduced motion reach the same phases), the bench following the
// photo being read, the quarantined instruction as a notice, slip 0462 sent to a person, the zoom's read
// confirmed with one tap, a blurred photo sent back to the clerk, J/K/Space/Enter, the 58/42 room, the
// mock-only replay of the recording, and axe on every state. The mock emits no rows yet, so the recorded run's
// rows (and the two states it never reaches) are fed into the run's stream.

import type { RunEvent } from "@fairsplit/contracts";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TREASURER } from "../../data/mock/driver.js";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  momentPhase,
  seedSnapshot,
  tracedPhases,
} from "../../test/index.js";
import { illegibleRows, rowEvents, zoomAgreedRow } from "../../test/reading-fixtures.js";
import { renderSeason, rowsFor, type SeasonRender } from "../../test/season.js";
import { REPLAY_GAP_MS, replayTiming } from "./replay.js";
import { replayRows } from "./replay-fixture.js";

// These render the whole console over the mock world and run axe on it: on a busy machine that is slow, so they
// wait longer than the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

const READING = "/season/2026-A/reading";

/** Rows as a judge workspace streams them: the same serials and positions under the clone's own document id. */
function clonedRows(rows: Parameters<typeof rowEvents>[0], docId: string) {
  return (stamp: Parameters<ReturnType<typeof rowEvents>>[0]): RunEvent[] =>
    rowEvents(rows)(stamp).map((event) =>
      event.type === "extract.row" ? { ...event, payload: { ...event.payload, docId } } : event,
    );
}

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
  it("states the stand-in provenance once by the beds and opens the real exhibit from above them", async () => {
    const r = await readingRun();
    act(() => r.stream.inject(rowsFor(["A"])));
    const side = screen.getByTestId("W-TR-03.side");
    expect(side.textContent?.match(/Seed stand-in, not a Claude recording/g)).toHaveLength(1);
    const link = within(side).getByRole("link", { name: /Claude's real readings of 10 hero slips/ });
    expect(
      link.compareDocumentPosition(screen.getByTestId("W-TR-03.beds")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(link);
    expect(document.activeElement?.id).toBe("fsc-heroes-title");
    for (const row of side.querySelectorAll(".fsc-beds__row"))
      expect(row.getAttribute("aria-describedby")).toBe("fsc-reading-provenance");
    expect(side.querySelector(".fsc-ring")).toBeNull();
    r.unmount();
  });

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
    // One stand-in tag, its canonical phrase whole (the tail for screen readers), no sentence beside it.
    expect(screen.getByTestId("W-TR-03.footer").textContent).toBe("Seed stand-in, not a Claude recording");
    expect(screen.getByTestId("W-TR-03.footer").classList.contains("fs-honesty")).toBe(true);
    // The instrument: slips read in dot-matrix, the words for screen readers.
    expect(
      screen.getByTestId("W-TR-03.film.progress").querySelector("svg.fsr-dm")?.getAttribute("data-value"),
    ).toBe("0/48");
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

  it.each(["full", "reduced"] as const)(
    "a cloned document's live row reaches landed in %s motion",
    async (motion) => {
      const r = await readingRun(motion);
      clearMomentTrace();
      act(() =>
        r.stream.inject((stamp) =>
          rowsFor(["D"])(stamp).map((event) =>
            event.type === "extract.row"
              ? { ...event, payload: { ...event.payload, docId: "019f4b41-5280-7944-961e-000000000001" } }
              : event,
          ),
        ),
      );
      await waitFor(() => expect(screen.getByTestId("W-TR-03.bench").dataset.photo).toBe("D"));
      await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 10_000 });
      expect(tracedPhases("MM-2")).toContain("band");
      expect(screen.getByTestId("W-TR-03.beds.row.0457").dataset.state).toBe("printed");
      expect(screen.getByTestId("W-TR-03.status").textContent).toMatch(/pink/);
      if (motion === "reduced") expect(r.container.querySelector(".fsc-flight")).toBeNull();
      r.unmount();
    },
  );

  it.each(["full", "reduced"] as const)(
    "prints a cloned run row by row in %s motion: the counter keeps up with the ribbon, the bench follows, photos tick",
    async (motion) => {
      const r = await readingRun(motion);
      clearMomentTrace();
      const photoRows = (id: string) => replayRows(seedSnapshot()).filter((row) => row.photoId === id);
      const progress = () => screen.getByTestId("W-TR-03.film.progress").textContent;
      const ribbon = (serial: string) =>
        waitFor(() =>
          expect(screen.getByTestId("W-JG-01.ribbon.machine").textContent).toMatch(`Read slip ${serial}`),
        );
      expect(progress()).toBe("0 of 48 slips read");
      // Photo B's rows one at a time: each prints as it arrives, never waiting for COMPUTED.
      const b = photoRows("B");
      expect(b).toHaveLength(4);
      for (const [i, row] of b.entries()) {
        act(() => r.stream.inject(clonedRows([row], "019f4b41-5280-7944-961e-00000000000b")));
        expect(screen.getByTestId(`W-TR-03.beds.row.${row.serial}`).dataset.state).not.toBe("waiting");
        await ribbon(row.serial);
        expect(progress()).toBe(`${i + 1} of 48 slips read`);
        expect(screen.getByTestId("W-TR-03.film.B").dataset.read).toBe(i === 3 ? "" : undefined);
      }
      expect(screen.getByTestId("W-TR-03.bench").dataset.photo).toBe("B");
      await waitFor(() => expect(momentPhase(r.container, "MM-2")).toBe("landed"), { timeout: 10_000 });
      expect(tracedPhases("MM-2").filter((phase) => phase === "band")).toHaveLength(4);
      // fs-api writes a photo's four rows in one step: the director still starts their prints 180 ms apart. The
      // clock holds still while the burst arrives, so each delay is the director's slot alone.
      const c = photoRows("C");
      const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now());
      try {
        act(() => r.stream.inject(clonedRows(c, "019f4b41-5280-7944-961e-00000000000c")));
      } finally {
        clock.mockRestore();
      }
      const printAt = c.map((row) =>
        Number.parseFloat(
          screen.getByTestId(`W-TR-03.beds.row.${row.serial}`).style.getPropertyValue("--fsc-print-at"),
        ),
      );
      for (let i = 1; i < printAt.length; i++)
        expect((printAt[i] ?? 0) - (printAt[i - 1] ?? 0)).toBeGreaterThanOrEqual(180);
      if (motion === "reduced") {
        // Reduced motion never flies a crop: the pencil outline and its 1 px connector stand in.
        await waitFor(() => expect(r.container.querySelector(".fsc-flights__connector")).not.toBeNull());
        expect(r.container.querySelector(".fsc-flight")).toBeNull();
      }
      await ribbon(c[3]?.serial ?? "");
      expect(progress()).toBe("8 of 48 slips read");
      await waitFor(() => expect(screen.getByTestId("W-TR-03.bench").dataset.photo).toBe("C"));
      expect(screen.getByTestId("W-TR-03.film.C").dataset.read).toBe("");
      for (const row of c)
        await waitFor(
          () => expect(screen.getByTestId(`W-TR-03.beds.row.${row.serial}`).dataset.state).toBe("printed"),
          { timeout: 4000 },
        );
      r.unmount();
    },
  );

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
      /Slip 0462: the stand-in's zoom value agrees with one of its two readings\./,
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

  it("on the mock, plays the seed's stand-in through the live handler: MM-2 plays, labelled mock data", async () => {
    // Slower than the recording's 240 ms, so the first row's act completes before the next row replaces it.
    replayTiming.gapMs = 2500;
    const r = await renderSeason({ path: READING });
    await screen.findByTestId("W-TR-03");
    const replay = screen.getByTestId("W-TR-03.replay");
    expect(replay.dataset.state).toBe("idle");
    expect(replay.textContent).toMatch(/Mock data: the mock API sends no rows/);
    // A stand-in built from the seed, never "the recording": no model read it, so it shows no scores.
    expect(replay.textContent).toMatch(/seed stand-in, not a Claude recording/);
    // The button names what plays (I8): the seed's stand-in, never "the recorded reading".
    const toggle = () => screen.getByTestId("W-TR-03.replay.toggle").textContent ?? "";
    expect(toggle()).toBe("Play the seed's stand-in");
    expect(replay.textContent).not.toMatch(/recorded reading|Replay/);
    clearMomentTrace();
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-TR-03.replay.toggle"));
    });
    expect(screen.getByTestId("W-TR-03.replay").dataset.state).toBe("running");
    expect(toggle()).toBe("Stop the stand-in");
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
    expect(screen.getByTestId("W-TR-03.beds.row.0425").textContent).not.toMatch(/\d+%/);
    expect(screen.getByTestId("W-TR-03.replay").textContent).toMatch(
      /Playing the seed's stand-in here: \d+ of 48 rows\. Mock data\./,
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
