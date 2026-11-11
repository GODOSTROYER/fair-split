import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layout } from "../_shims/tokens.native";
import { navFadeBands, topFadeBands } from "../ui/nav-fade";
import { rowSnapCover, SNAP_REST_MS } from "./row-snap";

const src = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("UI gate round 4 on the phone: rows never end under the tab bar", () => {
  const rows = [
    { top: 0, bottom: 56 },
    { top: 56, bottom: 112 },
    { top: 112, bottom: 168 },
    { top: 168, bottom: 224 },
  ];

  it("covers the row the bottom edge cuts, from its top", () => {
    // A 140 px view at rest at the top: row 3 (112-168) is cut at 140; the cover starts at 112.
    expect(rowSnapCover(rows, 0, 140)).toBe(112);
    // Scrolled 30 px: the edge is at 170, cutting row 4 (168-224), whose top is 138 px down the view.
    expect(rowSnapCover(rows, 30, 140)).toBe(138);
  });

  it("covers nothing when the edge falls between rows, or before the view has a size", () => {
    expect(rowSnapCover(rows, 0, 168)).toBeNull();
    expect(rowSnapCover(rows, 56, 112)).toBeNull();
    expect(rowSnapCover(rows, 0, 0)).toBeNull();
    expect(rowSnapCover([], 0, 140)).toBeNull();
  });

  it("never hides a row that starts at or above the view's top (a row taller than the view)", () => {
    expect(rowSnapCover([{ top: 0, bottom: 400 }], 10, 140)).toBeNull();
  });

  it("waits for the list to rest before placing the cover", () => {
    expect(SNAP_REST_MS).toBeGreaterThanOrEqual(100);
    expect(SNAP_REST_MS).toBeLessThanOrEqual(250);
  });
});

describe("UI gate round 4 on the phone: a top fade under the status inset", () => {
  it("fades 24 px from the surface to clear, the bottom fade's bands upside down", () => {
    expect(layout.fade).toBe(24);
    const top = topFadeBands(layout.fade);
    expect(top.reduce((h, b) => h + b.height, 0)).toBe(24);
    const bottom = navFadeBands(layout.fade);
    expect(top.map((b) => b.opacity)).toEqual(bottom.map((b) => b.opacity).reverse());
    expect(top[0]?.opacity).toBeGreaterThan(top.at(-1)?.opacity ?? 1);
  });
});

describe("UI gate round 4 on the phone: one look with the console", () => {
  it("the selected tab is the console nav's selected look: the pod wash under an ink icon and label", () => {
    const chrome = src("ui/chrome.tsx");
    expect(chrome).toMatch(/backgroundColor: focused \? t\.color\.podWash : "transparent"/);
    expect(chrome).not.toMatch(/backgroundColor: focused \? t\.color\.ink\b/);
  });

  it("the status pill is 32 px on the label step (15/520), never a slab", () => {
    const primitives = src("ui/primitives.tsx");
    expect(primitives).toMatch(/minHeight: layout\.statusChip/);
    const capsule = src("features/statement/capsule.tsx");
    expect(capsule).toMatch(/const FACE_MIN = layout\.statusChip;/);
    expect(capsule).not.toMatch(/kind="statementStatus"/);
  });

  it("a person's initials are white with an ink-2 ring, never an indigo tile", () => {
    const primitives = src("ui/primitives.tsx");
    const stamp = primitives.slice(primitives.indexOf("export function InkStamp"));
    expect(stamp.slice(0, stamp.indexOf("\n}\n"))).not.toMatch(/slab\.chalk/);
  });

  it("receipt chips are data: the serial in the mono at ink 3, the kilos in ink, flat on a 1 px rule", () => {
    // The code, without its comments (which name the evidence colours it never uses).
    const chip = src("ui/receipt-chip.tsx").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(chip).toMatch(/kind="hash"/);
    expect(chip).toMatch(/color="ink3"/);
    expect(chip).not.toMatch(/ballpoint|\.red\b|shadow/i);
    expect(src("features/statement/slip-tiles.tsx")).toMatch(/<ReceiptChip/);
  });

  it("the Chair's co-sign card draws the seal at 140 so it ends above its sticky button", () => {
    expect(layout.cosignSeal).toBe(140);
    expect(src("features/board/cosign-screen.tsx")).toMatch(/layout\.cosignSeal/);
  });
});
