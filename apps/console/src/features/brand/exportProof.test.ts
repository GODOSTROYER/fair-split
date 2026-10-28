// The brand's export (W-BR-01): exact decimals from integer cents and grams, RFC 4180 cells guarded against
// formula injection, one row per member line with its hash and PayPal item, and the whole bundle in the JSON.

import { getSnapshot } from "@fairsplit/api-client/seed";
import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  centsDecimal,
  csvCell,
  EXPORT_KIND,
  exportFileName,
  gramsDecimal,
  membersOf,
  proofCsv,
  proofJson,
} from "./exportProof.js";
import { linkFingerprint } from "./useBrandProof.js";

const snapshot = getSnapshot();
const members = membersOf(snapshot);

describe("exact decimals", () => {
  it("prints cents and grams without floats", () => {
    expect(centsDecimal(6445)).toBe("64.45");
    expect(centsDecimal(5)).toBe("0.05");
    expect(centsDecimal(-109)).toBe("-1.09");
    expect(centsDecimal(433350)).toBe("4333.50");
    expect(gramsDecimal(148000)).toBe("148.000");
    expect(gramsDecimal(38450)).toBe("38.450");
    expect(() => centsDecimal(0.5)).toThrow();
  });
});

describe("CSV cells", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("guards a text cell a spreadsheet would run as a formula, and leaves numbers alone", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1.09")).toBe("-1.09");
  });
});

describe("the proof CSV", () => {
  const csv = proofCsv(snapshot.proof, members, { rail: "simulated", provenance: "Seeded sample" });
  const rows = csv.trimEnd().split("\r\n");

  it("has a header and one row per line", () => {
    expect(rows[0]).toBe(CSV_COLUMNS.join(","));
    expect(rows).toHaveLength(1 + snapshot.proof.lines.length);
  });

  it("carries Nang Celing's line, its hash, her slips and the PayPal item that paid her", () => {
    const line = snapshot.proof.lines.find((l) => l.memberNo === "M-014");
    const row = rows.find((r) => r.startsWith("M-014,"));
    expect(row).toBeDefined();
    expect(row).toContain("Consolacion Bacus");
    expect(row).toContain("64.45");
    expect(row).toContain(line?.lineSha256);
    expect(row).toContain("0403 0419 0436 0467");
    expect(row).toContain("r37-M-014");
    expect(row).toContain("SUCCESS");
    // The complete receiver is in the export only (C-23).
    expect(row).toContain("m014@members.fairsplit.example");
  });

  it("inv.i8: every row carries the PayPal rail it ran on and its provenance, so SUCCESS never reads as real", () => {
    expect(CSV_COLUMNS).toEqual(expect.arrayContaining(["paypal_rail", "provenance"]));
    const rail = CSV_COLUMNS.indexOf("paypal_rail");
    const provenance = CSV_COLUMNS.indexOf("provenance");
    for (const row of rows.slice(1)) {
      const cells = row.split(",");
      expect(cells[rail]).toBe("simulated");
      expect(cells[provenance]).toBe("Seeded sample");
    }
  });

  it("sums back to the season's net to the cent", () => {
    const netColumn = CSV_COLUMNS.indexOf("net_usd");
    const total = rows.slice(1).reduce((sum, row) => {
      const cell = row.split(",")[netColumn] ?? "0";
      const [whole, frac] = cell.split(".");
      return sum + Number(whole) * 100 + Number(frac);
    }, 0);
    expect(total).toBe(snapshot.figures.netCents);
  });
});

describe("the proof JSON", () => {
  it("holds the whole bundle beside names, receivers and plots, labelled with its rail", () => {
    const doc = JSON.parse(
      proofJson(snapshot.proof, members, {
        generatedAt: "2026-10-30T02:00:00.000Z",
        rail: "simulated",
        provenance: "Seeded sample",
      }),
    ) as {
      kind: string;
      paypalRail: string;
      bundle: typeof snapshot.proof;
      members: { memberNo: string; name: string | null; receiver: string | null; plots: unknown[] }[];
    };
    expect(doc.kind).toBe(EXPORT_KIND);
    expect(doc.paypalRail).toBe("simulated");
    expect(doc.bundle.batch.batchSha256).toBe(snapshot.proof.batch.batchSha256);
    expect(doc.bundle.ledger).toHaveLength(snapshot.proof.ledger.length);
    const celing = doc.members.find((m) => m.memberNo === "M-014");
    expect(celing).toMatchObject({ name: "Consolacion Bacus", receiver: "m014@members.fairsplit.example" });
    expect(celing?.plots.length).toBeGreaterThan(0);
  });

  it("names files by run, with nothing a path could misuse", () => {
    expect(exportFileName("2026A-r37", "csv")).toBe("fairsplit-proof-2026A-r37.csv");
    expect(exportFileName("../x", "json")).toBe("fairsplit-proof-x.json");
  });
});

describe("the brand link", () => {
  it("is keyed by a one-way fingerprint, never by the token", () => {
    const token = "brand-token-sample-0001";
    const fp = linkFingerprint(token);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp).not.toContain(token);
    expect(linkFingerprint(token)).toBe(fp);
    expect(linkFingerprint(`${token}x`)).not.toBe(fp);
  });
});
