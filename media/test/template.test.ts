import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  nominalFieldRects,
  printedFormSpec,
  SLIP_BOXES,
  SLIP_FIELDS,
  SLIP_GEOMETRY,
  SLIP_PRINTED,
  templateDocument,
} from "../src/template/slip-template.js";
import { MEDIA_ROOT } from "../src/util/env.js";

describe("slip template v1", () => {
  it("numbers boxes 1 to 13 in order, with box 13 holding two deduction lines", () => {
    expect(SLIP_BOXES.map((b) => b.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(SLIP_BOXES.at(-1)?.fields).toEqual(["deduction_1", "deduction_2"]);
    expect(SLIP_BOXES.filter((b) => b.lines === 2)).toHaveLength(1);
  });

  it("names fields as the extraction Row schema does (S4.2), and every field has a rectangle", () => {
    const rowSchemaFields = [
      "serial",
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
      "clerk_initials",
    ];
    for (const f of rowSchemaFields) expect(SLIP_FIELDS).toContain(f);
    const rects = nominalFieldRects();
    for (const f of SLIP_FIELDS) {
      const r = rects[f];
      expect(r.x1).toBeGreaterThanOrEqual(0);
      expect(r.y1).toBeGreaterThanOrEqual(0);
      expect(r.x2).toBeLessThanOrEqual(1);
      expect(r.y2).toBeLessThanOrEqual(1);
      expect(r.x2).toBeGreaterThan(r.x1);
      expect(r.y2).toBeGreaterThan(r.y1);
    }
  });

  it("keeps the nominal rows ordered, twelve near-equal rows and a double-height row 13", () => {
    const rows = SLIP_GEOMETRY.rows;
    const iv = rows.slice(1).map((y, i) => y - (rows[i] as number));
    expect(iv.every((d) => d > 0)).toBe(true);
    const regular = iv.slice(0, 12);
    const mean = regular.reduce((s, d) => s + d, 0) / regular.length;
    for (const d of regular) expect(Math.abs(d - mean) / mean).toBeLessThan(0.12);
    expect((iv[12] as number) / mean).toBeGreaterThan(1.6);
  });

  it("quotes every printed label, the specimen line and no price or amount box", () => {
    const spec = printedFormSpec("WHITE_ORIGINAL").join("\n");
    for (const b of SLIP_BOXES) expect(spec).toContain(`"${b.no} ${b.label}"`);
    expect(spec).toContain(SLIP_PRINTED.specimen);
    expect(spec).toContain(SLIP_PRINTED.copyFooter.WHITE_ORIGINAL);
    expect(spec).toMatch(/no prices and no money boxes/i);
    expect(printedFormSpec("PINK_DUPLICATE").join("\n")).toContain("DUPLICATE – OFFICE");
  });

  it("is committed as media/template/slip-v1.json exactly as generated (no drift)", () => {
    const committed = JSON.parse(readFileSync(join(MEDIA_ROOT, "template", "slip-v1.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(templateDocument())));
  });
});
