import { describe, expect, it } from "vitest";
import { linesDigest } from "../../_shims/domain";
import { checkLines } from "../../lib/signing";
import { buildDemoCosign } from "../../services/demo-fixtures";

const dto = buildDemoCosign({ now: new Date(), treasurerSigned: true });
const flat = dto.lines.map(({ memberNo, rail, netCents, lineSha256 }) => ({
  source: "fs-api-lines" as const,
  memberNo,
  rail,
  netCents,
  lineSha256,
  batchLineSha256: lineSha256,
}));
describe("option B line-root check", () => {
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
