import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { findAsset } from "../src/content/spike.js";
import type { SlipPageAsset, SlipPhotoAsset } from "../src/content/types.js";
import { buildSlipFixture, checkSlipLayout, gridFieldCorners } from "../src/fixtures/build.js";
import { findPaperQuads, pointsToImage, rectify } from "../src/fixtures/detect.js";
import {
  apply,
  type Box,
  homography,
  invert,
  iou,
  normaliseBox,
  projectBox,
  type Quad,
  UNIT_SQUARE,
} from "../src/fixtures/geometry.js";
import { detectSlipGrid } from "../src/fixtures/grid.js";
import { loadRgb } from "../src/fixtures/raster.js";
import {
  Fixture,
  fixtureJsonSchema,
  type SlipFixture,
  SlipImageFixture,
  slipFieldEntries,
} from "../src/fixtures/schema.js";
import { Manifest } from "../src/imagegen/manifest.js";
import { reviewProof } from "../src/review/session.js";
import { SLIP_FIELDS, type SlipField } from "../src/template/slip-template.js";
import { MEDIA_ROOT } from "../src/util/env.js";

describe("geometry", () => {
  const quad: Quad = [
    [100, 50],
    [900, 80],
    [880, 1150],
    [90, 1100],
  ];

  it("maps the unit square exactly onto a quad, and back", () => {
    const h = homography(UNIT_SQUARE, quad);
    UNIT_SQUARE.forEach((p, i) => {
      const [x, y] = apply(h, p);
      expect(x).toBeCloseTo((quad[i] as readonly number[])[0] as number, 6);
      expect(y).toBeCloseTo((quad[i] as readonly number[])[1] as number, 6);
    });
    const back = apply(invert(h), [500, 600]);
    const there = apply(h, back);
    expect(there[0]).toBeCloseTo(500, 6);
    expect(there[1]).toBeCloseTo(600, 6);
  });

  it("projects boxes and scores overlap", () => {
    const h = homography(UNIT_SQUARE, [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]);
    expect(projectBox(h, { x1: 0.25, y1: 0.5, x2: 0.75, y2: 1 })).toEqual({
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 100,
    });
    expect(iou({ x1: 0, y1: 0, x2: 2, y2: 2 }, { x1: 1, y1: 1, x2: 3, y2: 3 })).toBeCloseTo(1 / 7, 6);
    expect(normaliseBox({ x1: -5, y1: 10, x2: 210, y2: 50 }, 200, 100)).toEqual({
      x1: 0,
      y1: 0.1,
      x2: 1,
      y2: 0.5,
    });
  });
});

/** Renders a synthetic slip with a known ruled table on a mat, rotated by `deg`. */
async function syntheticSlipPhoto(deg: number) {
  const W = 700;
  const H = 1000;
  const top = 200;
  const row = 42;
  const rows = [...Array.from({ length: 13 }, (_, i) => top + i * row), top + 12 * row + 2 * row];
  const cols = [40, 95, 290, 660];
  const box = { top: (rows[13] as number) + 18, bottom: (rows[13] as number) + 128 };
  const lines = [
    ...rows.map(
      (y) => `<line x1="${cols[0]}" y1="${y}" x2="${cols[3]}" y2="${y}" stroke="#111" stroke-width="3"/>`,
    ),
    `<line x1="${cols[2]}" y1="${(rows[12] as number) + row}" x2="${cols[3]}" y2="${(rows[12] as number) + row}" stroke="#111" stroke-width="2"/>`,
    ...cols.map(
      (x) => `<line x1="${x}" y1="${rows[0]}" x2="${x}" y2="${rows[13]}" stroke="#111" stroke-width="3"/>`,
    ),
    `<rect x="40" y="${box.top}" width="400" height="110" fill="none" stroke="#111" stroke-width="3"/>`,
    `<rect x="470" y="${box.top}" width="190" height="110" fill="none" stroke="#111" stroke-width="3"/>`,
    `<rect x="520" y="60" width="130" height="40" fill="#c0202a"/>`,
    `<text x="80" y="92" font-family="Arial" font-size="26" font-weight="bold" fill="#222">BULAWANON KAKAW GROWERS</text>`,
    ...rows
      .slice(0, 12)
      .map(
        (y, i) =>
          `<text x="${310 + (i % 3) * 20}" y="${y + 31}" font-family="Arial" font-size="24" fill="#1f2fa0">${["05/21/2026", "M-014", "CONSOLACION BACUS", "P-014-A", "1 PP", "38.75", "0.30", "38.45", "6.8", "0.00", "38.45", "G1"][i]}</text>`,
      ),
  ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#eef0f2"/>${lines}</svg>`;
  const slip = await sharp(Buffer.from(svg)).png().toBuffer();
  const mat = { r: 176, g: 136, b: 86 };
  const rotated = await sharp(slip)
    .rotate(deg, { background: mat })
    .png()
    .toBuffer({ resolveWithObject: true });
  const CW = 1100;
  const CH = 1300;
  const ox = Math.round((CW - rotated.info.width) / 2);
  const oy = Math.round((CH - rotated.info.height) / 2);
  const photo = await sharp({ create: { width: CW, height: CH, channels: 3, background: mat } })
    .composite([{ input: rotated.data, left: ox, top: oy }])
    .png()
    .toBuffer();
  // Ground truth: rotate slip coordinates about the slip centre (clockwise for positive degrees, y down).
  const t = (deg * Math.PI) / 180;
  const toPhoto = (x: number, y: number): [number, number] => {
    const dx = x - W / 2;
    const dy = y - H / 2;
    return [
      dx * Math.cos(t) - dy * Math.sin(t) + rotated.info.width / 2 + ox,
      dx * Math.sin(t) + dy * Math.cos(t) + rotated.info.height / 2 + oy,
    ];
  };
  const cellCentre = (r: number): [number, number] =>
    toPhoto(
      ((cols[2] as number) + (cols[3] as number)) / 2,
      ((rows[r] as number) + (rows[r + 1] as number)) / 2,
    );
  return { photo, cellCentre, size: { w: CW, h: CH } };
}

describe("grid detection on a synthetic slip with known geometry", () => {
  it.each([0, 2.5, -3])("finds every value cell of a slip rotated %s degrees", async (deg) => {
    const { photo, cellCentre } = await syntheticSlipPhoto(deg);
    const rgb = await loadRgb(photo);
    const [q] = findPaperQuads(rgb, 1);
    expect(q).toBeDefined();
    const slip = rectify(rgb, (q as { quad: Quad }).quad);
    const grid = detectSlipGrid(slip);
    expect(grid.rows).toHaveLength(14);
    expect(grid.kaltas).toHaveLength(1);
    expect(grid.signature).not.toBeNull();
    expect(grid.serial).not.toBeNull();
    const corners = gridFieldCorners(grid);
    const fields: SlipField[] = [
      "date",
      "member_no",
      "member_name",
      "plot_no",
      "sacks",
      "gross_kg",
      "tare_kg",
      "net_kg",
      "mc_pct",
      "mc_less_kg",
      "payable_kg",
      "grade",
    ];
    fields.forEach((f, r) => {
      const box = pointsToImage(slip, corners[f] as never);
      const [cx, cy] = cellCentre(r);
      expect(Math.abs((box.x1 + box.x2) / 2 - cx)).toBeLessThan(8);
      expect(Math.abs((box.y1 + box.y2) / 2 - cy)).toBeLessThan(5);
    });
  });
});

describe("layout check", () => {
  it("refuses rows out of order or of the wrong height", () => {
    const rects = Object.fromEntries(
      SLIP_FIELDS.map((f, i) => [f, { x1: 0.4, y1: 0.1 + i * 0.04, x2: 0.9, y2: 0.135 + i * 0.04 }]),
    ) as Record<SlipField, Box>;
    rects.serial = { x1: 0.7, y1: 0.02, x2: 0.9, y2: 0.06 };
    rects.signature = { x1: 0.05, y1: 0.85, x2: 0.5, y2: 0.95 };
    rects.clerk_initials = { x1: 0.55, y1: 0.85, x2: 0.9, y2: 0.95 };
    expect(checkSlipLayout(rects)).toEqual([]);
    const swapped = { ...rects, gross_kg: rects.net_kg, net_kg: rects.gross_kg };
    expect(checkSlipLayout(swapped).join(" ")).toMatch(/not below/);
    const tall = { ...rects, date: { x1: 0.4, y1: 0.05, x2: 0.9, y2: 0.3 } };
    expect(checkSlipLayout(tall).join(" ")).toMatch(/date: height/);
  });
});

describe("committed fixtures (IC-11)", () => {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "manifest.json"), "utf8")));
  const files = readdirSync(join(MEDIA_ROOT, "fixtures")).filter(
    (f) => f.endsWith(".json") && f !== "fixture.schema.json",
  );
  const read = (id: string) =>
    SlipImageFixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", `${id}.json`), "utf8")));

  it("parse against the schema, have every field checked and sit inside their slip", () => {
    expect(files.length).toBe(Object.values(manifest.assets).filter((e) => e.fixture).length);
    for (const f of files) {
      const fx = Fixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", f), "utf8")));
      expect(fx.review.status, f).not.toBe("draft");
      if (fx.kind !== "slip_photo" && fx.kind !== "slip_page") continue;
      for (const s of (fx as SlipImageFixture).slips) {
        const xs = s.quad.map((p) => p[0]);
        const ys = s.quad.map((p) => p[1]);
        for (const { path, field } of slipFieldEntries(s)) {
          expect(field.legibility, `${f} ${s.slot} ${path}`).not.toBe("UNVERIFIED");
          if (path.startsWith("anomalies")) continue;
          const cx = (field.x1 + field.x2) / 2;
          const cy = (field.y1 + field.y2) / 2;
          expect(cx).toBeGreaterThan(Math.min(...xs) - 0.01);
          expect(cx).toBeLessThan(Math.max(...xs) + 0.01);
          expect(cy).toBeGreaterThan(Math.min(...ys) - 0.01);
          expect(cy).toBeLessThan(Math.max(...ys) + 0.01);
        }
      }
    }
  });

  it("that say human-reviewed name a confirmed review session of their own image, by their reviewer, with their readings", async () => {
    for (const f of files) {
      const fx = Fixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", f), "utf8")));
      // No fixture is person-reviewed yet (the user's review is pending); this holds the line once one is.
      expect(await reviewProof(MEDIA_ROOT, fx), f).toEqual([]);
      if (fx.review.status === "human-reviewed") expect(fx.review.session, f).toMatch(/^review\/sessions\//);
    }
  });

  it("record what is visibly written: 0462's stain on the flat, and its leak on the four-slip photo", () => {
    const flat = read("spike-0462").slips[0];
    expect(flat?.fields.gross_kg).toMatchObject({
      value: "64.80",
      requested: "6?.80",
      visible: "6?.80",
      expect: "HUMAN",
    });
    expect(flat?.fields.net_kg).toMatchObject({
      value: "64.50",
      requested: "6?.50",
      visible: "6?.50",
      expect: "HUMAN",
    });
    // The trap renders on the flat, but only a recorded Claude read can show that it holds.
    expect(flat?.trapChecks).toEqual([
      expect.objectContaining({ trap: "WATER_STAIN", status: "UNVERIFIED", by: null }),
    ]);

    const photo = read("spike-4up");
    expect(photo.slips.map((s) => `${s.slot}:${s.serial}:${s.copy}`)).toEqual([
      "TL:0403:WHITE_ORIGINAL",
      "TR:0457:WHITE_ORIGINAL",
      "BL:0458:WHITE_ORIGINAL",
      "BR:0462:WHITE_ORIGINAL",
    ]);
    const br = photo.slips[3];
    // A faint ghost of the 4 stays readable: the label is what is visible (C-24), and the trap failed.
    expect(br?.fields.gross_kg).toMatchObject({ requested: "6?.80", visible: "64.80", checkedBy: "agent" });
    expect(br?.fields.net_kg).toMatchObject({ requested: "6?.50", visible: "64.50", checkedBy: "agent" });
    expect(br?.trapChecks).toEqual([
      expect.objectContaining({ trap: "WATER_STAIN", status: "FAILED", by: "agent" }),
    ]);
  });

  it("mark only the pink copy as a duplicate, of the white original in its own group (inv.i8.duplicates)", () => {
    const pink = read("spike-0457-pink").slips[0];
    expect(pink).toMatchObject({ copy: "PINK_DUPLICATE", duplicateOf: "spike-0457-white#ONLY" });
    for (const f of files) {
      const fx = Fixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", f), "utf8")));
      if (fx.kind !== "slip_photo" && fx.kind !== "slip_page") continue;
      for (const s of (fx as SlipImageFixture).slips) {
        if (s.copy === "WHITE_ORIGINAL") expect(s.duplicateOf, `${f} ${s.slot}`).toBeNull();
      }
    }
    // The four-slip spike re-renders S3 flats in its own group, so none of its slips points at a flat.
    expect(read("spike-4up").slips.map((s) => s.duplicateOf)).toEqual([null, null, null, null]);
  });

  it("reject malformed fixtures", () => {
    const fx = JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", "spike-0403.json"), "utf8"));
    const missing = structuredClone(fx);
    delete missing.slips[0].fields.net_kg;
    expect(SlipImageFixture.safeParse(missing).success).toBe(false);
    const inverted = structuredClone(fx);
    Object.assign(inverted.slips[0].fields.date, { x1: 0.5, x2: 0.4 });
    expect(SlipImageFixture.safeParse(inverted).success).toBe(false);
    const unlabelled = structuredClone(fx);
    unlabelled.synthetic = false;
    expect(SlipImageFixture.safeParse(unlabelled).success).toBe(false);
    const whiteDuplicate = structuredClone(fx);
    whiteDuplicate.slips[0].duplicateOf = "spike-0457-white#ONLY";
    expect(SlipImageFixture.safeParse(whiteDuplicate).success).toBe(false);
    const unchecked = structuredClone(fx);
    Object.assign(unchecked.slips[0].fields.gross_kg, {
      legibility: "UNVERIFIED",
      checkedBy: null,
      visible: unchecked.slips[0].fields.gross_kg.requested,
    });
    expect(SlipImageFixture.safeParse(unchecked).success).toBe(false);
    unchecked.review.status = "draft";
    expect(SlipImageFixture.safeParse(unchecked).success).toBe(true);
    const stamped = structuredClone(fx);
    stamped.review.status = "human-reviewed";
    expect(SlipImageFixture.safeParse(stamped).success).toBe(false);
  });

  it("are reproduced by the detector from the committed masters (golden check)", async () => {
    for (const id of ["spike-0403", "spike-4up"]) {
      const committed = read(id);
      const entry = manifest.assets[id];
      if (!entry) throw new Error(`no manifest entry for ${id}`);
      const fresh = await buildSlipFixture(findAsset(id) as SlipPageAsset | SlipPhotoAsset, entry, {
        mediaRoot: MEDIA_ROOT,
      });
      fresh.slips.forEach((s, i) => {
        const before = new Map(
          slipFieldEntries(committed.slips[i] as SlipFixture).map((e) => [e.path, e.field]),
        );
        for (const { path, field } of slipFieldEntries(s)) {
          expect(iou(field, before.get(path) as Box), `${id} ${s.slot} ${path}`).toBeGreaterThan(0.9);
        }
      });
    }
  });

  it("publish a JSON Schema for non-TypeScript consumers", () => {
    const committed = JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", "fixture.schema.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(fixtureJsonSchema())));
  });
});
