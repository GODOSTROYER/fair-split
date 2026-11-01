import { describe, expect, it } from "vitest";
import { linesDigest } from "../../_shims/domain";
import { checkLines } from "../../lib/signing";
import { buildDemoCosign } from "../../services/demo-fixtures";

const dto = buildDemoCosign({ now: new Date(), treasurerSigned: true });
const flat = dto.lines.map(({ memberNo, rail, netCents, lineSha256, canonical }) => ({
  source: "fs-api-lines" as const,
  memberNo,
  rail,
  netCents,
  lineSha256,
  canonical,
  batchLineSha256: lineSha256,
}));
describe("option B line-root check", () => {
  it.each(["netCents", "rail"] as const)(
    "inv.i4.cash-%s-tampering: unchanged hashes cannot cover altered display fields",
    (field) => {
      const cash = flat.find((line) => line.rail === "CASH");
      if (!cash) throw new Error("No cash fixture");
      const tampered = { ...cash, [field]: field === "netCents" ? cash.netCents + 1 : "PAYPAL" };
      expect(
        checkLines(
          flat.map((line) => (line === cash ? tampered : line)),
          dto.rateCardSha256,
        ).ok,
      ).toBe(false);
    },
  );

  it("inv.i4.missing-preimage: old flat hashes alone are insufficient", () => {
    expect(
      checkLines(
        flat.map(({ canonical: _, ...line }) => line),
        dto.rateCardSha256,
      ).ok,
    ).toBe(false);
  });
  it.each(["netCents", "rail"] as const)(
    "inv.i4.legacy-cash-%s: refuses altered amounts even when no preimage was sent",
    (field) => {
      const legacy = flat.map(({ canonical: _, ...line }) => line);
      const cash = legacy.find((line) => line.rail === "CASH");
      if (!cash) throw new Error("No cash fixture");
      expect(
        checkLines(
          legacy.map((line) =>
            line === cash ? { ...line, [field]: field === "netCents" ? line.netCents + 1 : "PAYPAL" } : line,
          ),
          dto.rateCardSha256,
        ).ok,
      ).toBe(false);
    },
  );
  it("inv.i4.flat-root: binds every line including cash with the domain digest", () => {
    expect(checkLines(flat, dto.rateCardSha256)).toMatchObject({
      ok: true,
      linesDigest: linesDigest(dto.lines),
      summary: { count: dto.lines.length },
    });
  });
  it("inv.i4.flat-refusal: missing, duplicate, or unequal hashes never pass", () => {
    const first = flat[0];
    if (!first) throw new Error("No fixture lines");
    for (const lines of [
      [],
      [first, first],
      [{ ...first, batchLineSha256: null }],
      [{ ...first, lineSha256: "f".repeat(64) }],
    ]) {
      expect(checkLines(lines, dto.rateCardSha256).ok).toBe(false);
    }
  });
});
