import * as client from "@fairsplit/api-client";
import { type EngineLine, LineCanonical } from "@fairsplit/contracts";
import { jcsSha256, lineCanonical } from "@fairsplit/domain";
import { getLines, getRateCard } from "@fairsplit/seed";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as dto from "./dto.js";
import type { LineRow } from "./machine.js";
import { LineList } from "./reads.js";

const card = getRateCard().sha256;
const uuid = "019ca6b1-dc00-7c73-8b2b-9661129af6b4";
function stored(line: EngineLine): LineRow {
  return {
    id: uuid,
    workspaceId: uuid,
    runId: uuid,
    memberId: uuid,
    state: "READY",
    rail: line.rail === "PAYPAL" ? "ON" : "OFF",
    verifiedG: BigInt(line.verifiedG),
    grade1G: BigInt(line.grade1G),
    premiumCents: BigInt(line.premiumCents),
    bonusCents: BigInt(line.bonusCents),
    creditsCents: BigInt(line.creditsCents),
    netCents: BigInt(line.netCents),
    deductions: line.deductions,
    lineSha256: line.lineSha256,
    trace: { canonical: lineCanonical(line, card) },
    provenance: "seeded",
  } as LineRow;
}

describe("inv.i4.line-preimages: additive /lines content", () => {
  it("mirrors the additive response in api-client without changing MemberLineDTO", () => {
    expect(client).toHaveProperty("RunLineList");
    expect(z.toJSONSchema(client.RunLineList)).toEqual(z.toJSONSchema(LineList));
  });
  it("serves the exact domain preimage for cash, carried loans, and workspace credit marks", () => {
    expect(dto).toHaveProperty("lineWithCanonicalDto");
    for (const line of getLines()) {
      const value = dto.lineWithCanonicalDto(stored(line), line.memberNo, card);
      expect(LineCanonical.safeParse(value.canonical).success).toBe(true);
      expect(value.canonical).toEqual(lineCanonical(line, card));
      expect(jcsSha256(value.canonical), line.memberNo).toBe(value.lineSha256);
      expect(LineList.safeParse({ runSlug: "2026A-r37", lines: [value] }).success).toBe(true);
    }
  });
});
