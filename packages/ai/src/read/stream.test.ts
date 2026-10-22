import { describe, expect, it } from "vitest";
import { chunks } from "../gateway/test-helpers.js";
import { ExtractionStreamTracker } from "./stream.js";
import { extraction, field, json, row } from "./test-fixtures.js";

describe("ExtractionStreamTracker (MM-2 streaming)", () => {
  const doc = extraction([
    row({}, { deductions: [field("Hauling P96.75", { x1: 100, y1: 1180, x2: 900, y2: 1220 })] }),
    row({ serial: field("0902", { x1: 500, y1: 100, x2: 900, y2: 150 }) }),
  ]);
  const text = json(doc);

  function feed(t: ExtractionStreamTracker, size = 5) {
    let acc = "";
    for (const c of chunks(text, size)) {
      acc += c;
      t.push(acc);
    }
  }

  it("signals each field once, in schema order, after its box and before the next field", () => {
    const seen: string[] = [];
    const rows: number[] = [];
    const t = new ExtractionStreamTracker({
      onField: (r, f, _box, slipBox, j) => {
        expect(slipBox).not.toBeNull();
        seen.push(`${r}:${f}${j === undefined ? "" : `#${j}`}`);
      },
      onRow: (r, data) => {
        rows.push(r);
        expect(data.signature).toBe("SIGNED");
      },
    });
    feed(t, 3);
    expect(seen.slice(0, 3)).toEqual(["0:serial", "0:line_no", "0:date"]);
    expect(seen).toContain("0:deductions#0");
    expect(seen.filter((s) => s === "1:serial")).toHaveLength(1);
    expect(seen).toHaveLength(2 * 15 + 1);
    expect(rows).toEqual([0, 1]);
  });

  it("reports the page header before any row and resets on an empty snapshot", () => {
    const pages: string[] = [];
    let resets = 0;
    let fields = 0;
    const t = new ExtractionStreamTracker({
      onPage: (p) => pages.push(p.rotation),
      onReset: () => resets++,
      onField: () => fields++,
    });
    feed(t);
    t.push("");
    feed(t);
    expect(pages).toEqual(["0", "0"]);
    expect(resets).toBe(1);
    expect(fields).toBe(2 * (2 * 15 + 1));
  });

  it("ignores unparseable snapshots (a continuation after a fallback)", () => {
    const t = new ExtractionStreamTracker({ onField: () => expect.fail("no field expected") });
    t.push('"rows":[{"serial"');
    t.push("}}]");
  });
});
