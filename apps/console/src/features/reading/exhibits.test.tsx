import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../../test/world.js";
import { Bench, bandFrac, FIT, zoomOnSlip } from "./Bench.js";
import { heroExhibits, photoExhibit } from "./exhibits.js";
import { HeroExhibits } from "./HeroExhibits.js";
import { photoById, slipsOf } from "./model.js";

describe("recorded hero-slip exhibits", () => {
  it("inv.i8.recording: displays ten real recordings beside the labelled seed and provisional labels", () => {
    const tiles = heroExhibits(seedSnapshot());
    expect(tiles).toHaveLength(10);
    expect(new Set(tiles.map((t) => t.id)).size).toBe(10);
    expect(
      tiles.find((tile) => tile.id === "spike-0462")?.reading.find((field) => field.field === "net_kg")
        ?.standIn,
    ).toBe("6?.50");
    render(<HeroExhibits snapshot={seedSnapshot()} />);
    expect(screen.getByTestId("W-TR-03.heroes").textContent).toContain(
      "The hold cards and the pay run use the seed stand-in, not these readings.",
    );
    expect(tiles.every((tile) => !tile.title.startsWith("Spike:"))).toBe(true);
    for (const tile of tiles) {
      const exhibit = screen.getByTestId(`W-TR-03.hero.${tile.id}`);
      expect(within(exhibit).getByRole("img").getAttribute("src")).toBe(`/media/${tile.image}`);
      expect(exhibit.textContent).toContain("Claude's real reading of this slip, recorded 1 Nov 2026");
      expect(exhibit.textContent).toContain("Seed stand-in, not a Claude recording");
      expect(exhibit.textContent).toContain("Provisional: agent-checked labels");
      expect(exhibit.textContent).toContain("AI-generated, synthetic");
      expect(exhibit.textContent).toContain(tile.reading[0]?.a ?? "");
    }
  });

  it("inv.i8.recording-absent: hides the real-reading exhibit when no matching recording exists", () => {
    expect(heroExhibits(seedSnapshot(), { cases: [], recordings: [] })).toEqual([]);
  });

  it("inv.i8.photos: A–L use the committed composition files and manifest labels", () => {
    for (const id of "ABCDEFGHIJKL") {
      expect(photoExhibit(id)).toMatchObject({
        image: `photos/${id}.webp`,
        label: "Code-composed · synthetic",
      });
    }
    expect(photoExhibit("P01")).toBeNull();
  });

  it("inv.i8.photo-crops: bands and zoom follow the composed raster's projected field, at its true aspect ratio", () => {
    const snapshot = seedSnapshot();
    const photo = photoById(snapshot, "A");
    if (!photo) throw new Error("A is required");
    const slips = slipsOf(snapshot, photo);
    const first = slips[0];
    if (!first) throw new Error("TL slip is required");
    const field = __FS_EXHIBIT_MEDIA__.compositions.A?.slips[0]?.fields.net_kg;
    const slip = __FS_EXHIBIT_MEDIA__.compositions.A?.slips[0]?.rect;
    if (!field || !slip) throw new Error("Projected crop is required");
    expect(field.x1).toBeCloseTo(0.207219, 6);
    expect(field.y1).toBeCloseTo(0.260708, 6);
    expect(slip.x1).toBe(0.0635);
    const zoom = zoomOnSlip(first.position, "A", first.slip.serial);
    expect(zoom.fx).toBeCloseTo((field.x1 + field.x2) / 2);
    expect(zoom.fy).toBeCloseTo((field.y1 + field.y2) / 2);
    expect(bandFrac(first.position, "A", first.slip.serial)).toEqual({
      left: slip.x1,
      top: field.y1,
      width: slip.x2 - slip.x1,
      height: field.y2 - field.y1,
    });
    render(
      <Bench
        photo={photo}
        slips={slips}
        band={first.slip.serial}
        outline={null}
        zoom={FIT}
        onZoom={() => {}}
        mode="reduced"
        testId="crop-bench"
      />,
    );
    const image = screen.getByAltText(/Four synthetic weigh slips, composition A/);
    expect(image.parentElement?.style.aspectRatio).toBe("1200 / 1600");
    const anchor = screen
      .getByTestId("crop-bench")
      .querySelector<HTMLElement>(`[data-anchor="${first.slip.serial}"]`);
    expect(Number.parseFloat(anchor?.style.left ?? "")).toBeCloseTo(field.x1 * 100, 3);
  });
});
