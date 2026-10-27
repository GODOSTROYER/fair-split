// IC-03 freshness and the accessor API. The committed snapshot must be exactly what the generator
// produces today (run `corepack pnpm --filter @fairsplit/seed run generate` after any change).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { penalty, tuneBackground } from "./background.js";
import { buildSnapshot } from "./build.js";
import {
  getComputation,
  getFigures,
  getHolds,
  getLine,
  getLines,
  getLogbook,
  getMember,
  getMembers,
  getPhotos,
  getProof,
  getRateCard,
  getRun,
  getSeason,
  getSlips,
  getSnapshot,
} from "./index.js";
import { slipDate } from "./world.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("generator", () => {
  it("is deterministic and the committed snapshot is current", () => {
    const committed = JSON.parse(readFileSync(resolve(here, "../snapshot/season-2026A.json"), "utf8"));
    const { snapshot } = buildSnapshot();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(committed);
  }, 60_000);

  it("tunes the 55 background members until every named share comes out exactly", () => {
    const r = tuneBackground({ premiumCents: 288_750, bonusCents: 138_600 });
    expect(r.background).toHaveLength(55);
    expect(penalty(r.background, { premiumCents: 288_750, bonusCents: 138_600 })).toBe(0);
    expect(r.background.reduce((t, b) => t + b.kgD, 0)).toBe(86_200);
    expect(r.background.reduce((t, b) => t + b.kgD - b.g2D, 0)).toBe(82_779);
  });

  it("dates slips through the season and keeps logbook page 14 in July", () => {
    expect(slipDate(301)).toBe("2026-04-02");
    expect(slipDate(563)).toBe("2026-08-31");
    expect(slipDate(456).startsWith("2026-07")).toBe(true);
    expect(slipDate(467).startsWith("2026-07")).toBe(true);
    expect(() => slipDate(564)).toThrow(RangeError);
  });
});

describe("accessor API", () => {
  it("serves the season, members, slips, photos, rate card and run", () => {
    expect(getSeason()).toMatchObject({
      code: "2026A",
      label: "2026-A",
      coop: { name: "Bulawanon Kakaw Growers MPC" },
    });
    expect(getMembers()).toHaveLength(64);
    expect(getMember("M-014")?.addressAs.ceb).toBe("Nang Celing");
    expect(getMember("M-999")).toBeUndefined();
    expect(
      getSlips({ memberNo: "M-014" })
        .map((x) => x.serial)
        .sort(),
    ).toEqual(["0403", "0419", "0436", "0467"]);
    expect(getSlips({ photoId: "B" })).toHaveLength(4);
    expect(getPhotos("REPLAY")).toHaveLength(12);
    expect(getPhotos("EARLIER")).toHaveLength(54);
    expect(getRateCard().canonical.resolutionNo).toBe("BR 2026-04");
    expect(getRun().runSlug).toBe("2026A-r37");
    expect(getLines()).toHaveLength(64);
    expect(getLine("M-014", "read")?.state).toBe("READY");
    expect(getComputation("read").massBalance.status).toBe("PENDING");
    expect(getHolds()).toHaveLength(5);
    expect(getLogbook()[0]?.page).toBe(14);
    expect(getFigures().netCents).toBe(421_817);
    expect(getProof().runSlug).toBe("2026A-r37");
    expect(getSnapshot()).toBe(getSnapshot());
  });

  it("gives every member a statement name, a slip name and their own slips", () => {
    for (const m of getMembers()) {
      expect(m.addressAs.ceb.length).toBeGreaterThan(0);
      expect(m.nameOnSlip).toBe(m.nameOnSlip.toUpperCase());
      expect(m.slipSerials.length).toBeGreaterThanOrEqual(2);
      const total = getSlips({ memberNo: m.memberNo })
        .filter((x) => x.copy === "WHITE_ORIGINAL")
        .reduce((t, x) => t + x.payableG, 0);
      expect(total).toBe(getLine(m.memberNo)?.verifiedG);
      const trees = m.plots.filter((p) => p.registered).reduce((t, p) => t + p.trees, 0);
      if (m.memberNo !== "M-053") expect(total).toBeLessThanOrEqual(trees * 1_600);
    }
  });

  it("never stores a sandbox receiver: aliases only, masked for the brand view", () => {
    for (const m of getMembers()) {
      if (m.rail === "PAYPAL") {
        expect(m.receiverAlias).toMatch(/@[a-z.]+\.example$/);
        expect(m.receiverMasked).toMatch(/^m\*\*\*@/);
      } else {
        expect(m.receiverAlias).toBeNull();
      }
    }
  });
});
