import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROUP_S3_HERO,
  GROUP_SPIKE_4UP,
  SLIP_0403,
  SLIP_0457,
  SLIP_0457_PINK,
  SLIP_0462,
  SPIKE_ASSETS,
} from "../src/content/spike.js";
import type { AssetSpec, SlipPageAsset } from "../src/content/types.js";
import { carryOver, duplicateResolver } from "../src/fixtures/build.js";
import { Fixture, SlipImageFixture } from "../src/fixtures/schema.js";
import { emptyManifest, ManifestStore } from "../src/imagegen/manifest.js";
import { applyObservations, applyReview, fixtureFields, ReviewFile } from "../src/imagegen/review.js";
import { entry, logbookFixture, SHA_A, SHA_B, slipPageFixture } from "./support.js";

const AT = "2026-10-22T12:00:00.000Z";

function flat(id: string, slip = SLIP_0403, group = GROUP_S3_HERO): SlipPageAsset {
  return {
    id,
    kind: "slip_page",
    title: id,
    source: { kind: "provisional", note: "t" },
    orientation: "portrait",
    group,
    slip,
  };
}

describe("duplicateOf: only the copy points at its original, inside one group (S4.10 duplicate_of)", () => {
  const assets: AssetSpec[] = [
    flat("white", SLIP_0457),
    flat("pink", SLIP_0457_PINK),
    flat("other-render", SLIP_0457, GROUP_SPIKE_4UP),
    flat("solo-pink", SLIP_0457_PINK, "elsewhere"),
  ];
  const dup = duplicateResolver(assets);

  it("never marks a WHITE_ORIGINAL, even when another render of the same slip exists", () => {
    expect(dup("white", SLIP_0457)).toBeNull();
    expect(dup("other-render", SLIP_0457)).toBeNull();
  });

  it("points the pink copy at the white original of its own group, never across groups", () => {
    expect(dup("pink", SLIP_0457_PINK)).toBe("white#ONLY");
    expect(dup("solo-pink", SLIP_0457_PINK)).toBeNull();
  });

  it("refuses a group that holds two white originals of one serial", () => {
    expect(() => duplicateResolver([flat("a", SLIP_0457), flat("b", SLIP_0457)])).toThrow(
      /two white originals/,
    );
  });

  it("holds for the spike content: only the pink 0457 is a duplicate", () => {
    const real = duplicateResolver(SPIKE_ASSETS);
    const marked = SPIKE_ASSETS.flatMap((a) =>
      a.kind === "slip_page"
        ? [[a.id, real(a.id, a.slip)] as const]
        : a.kind === "slip_photo"
          ? Object.values(a.slips).map((s) => [a.id, real(a.id, s)] as const)
          : [],
    ).filter(([, d]) => d !== null);
    expect(marked).toEqual([["spike-0457-pink", "spike-0457-white#ONLY"]]);
  });

  it("the schema rejects a WHITE_ORIGINAL that carries duplicateOf", () => {
    const f = slipPageFixture("white", SLIP_0457, { duplicateOf: "x#ONLY" });
    expect(SlipImageFixture.safeParse(f).success).toBe(false);
    expect(
      SlipImageFixture.safeParse(slipPageFixture("pink", SLIP_0457_PINK, { duplicateOf: "white#ONLY" }))
        .success,
    ).toBe(true);
  });

  it("the schema lets only a recorded read say a trap holds", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const check = f.slips[0]?.trapChecks[0];
    if (!check) throw new Error("0462 has a WATER_STAIN check");
    Object.assign(check, { status: "HOLDS", by: "agent", at: AT, evidence: "looks unreadable" });
    expect(SlipImageFixture.safeParse(f).success).toBe(false);
    Object.assign(check, { by: "human" });
    expect(SlipImageFixture.safeParse(f).success).toBe(false);
    Object.assign(check, {
      by: "read",
      evidence: "packages/eval/report/latest.json sha256:0123456789abcdef",
    });
    expect(SlipImageFixture.safeParse(f).success).toBe(true);
    Object.assign(check, { status: "FAILED", by: "agent" });
    expect(SlipImageFixture.safeParse(f).success).toBe(true);
  });
});

describe("drafted fixtures record what was asked, not what is visible (C-24)", () => {
  it("every field starts UNVERIFIED with visible = requested, and the stain's '?' asks for a person", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const fields = fixtureFields(f);
    expect([...fields.values()].every((x) => x.legibility === "UNVERIFIED" && x.checkedBy === null)).toBe(
      true,
    );
    expect(fields.get("fields.gross_kg")).toMatchObject({
      value: "64.80",
      requested: "6?.80",
      visible: "6?.80",
      expect: "HUMAN",
    });
    expect(Fixture.safeParse(f).success).toBe(true);
    // A draft can never be passed off as checked.
    expect(Fixture.safeParse({ ...f, review: { ...f.review, status: "agent-checked" } }).success).toBe(false);
  });
});

describe("applyObservations writes what is visible into the fixture", () => {
  it("relabels a mismatch to what is visible, fills the rest with the request, and records a failed trap", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const out = applyObservations(
      f,
      {
        allFieldsChecked: true,
        observed: [],
        mismatches: [{ where: "fields.gross_kg", expected: "6?.80", visible: "64.80", cause: "ghost 4" }],
        traps: [{ slot: "ONLY", trap: "WATER_STAIN", status: "FAILED", evidence: "the 4 is readable" }],
      },
      AT,
    );
    expect(out).toEqual({ unplaced: [], keptHuman: [] });
    const fields = fixtureFields(f);
    expect(fields.get("fields.gross_kg")).toMatchObject({
      visible: "64.80",
      legibility: "CLEAR",
      expect: "EITHER",
      checkedBy: "agent",
    });
    expect(fields.get("fields.net_kg")).toMatchObject({
      visible: "6?.50",
      legibility: "SMUDGED",
      expect: "HUMAN",
      checkedBy: "agent",
    });
    expect(fields.get("deductions.0")).toMatchObject({ visible: "", legibility: "ABSENT", expect: "AUTO" });
    expect(f.slips[0]?.trapChecks[0]).toMatchObject({ status: "FAILED", by: "agent", at: AT });
  });

  it("never overwrites a person's reading or a recorded read's verdict with an agent's look", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const gross = fixtureFields(f).get("fields.gross_kg");
    Object.assign(gross ?? {}, {
      visible: "6?.80",
      legibility: "ILLEGIBLE",
      expect: "HUMAN",
      checkedBy: "human",
    });
    Object.assign(f.slips[0]?.trapChecks[0] ?? {}, {
      status: "HOLDS",
      by: "read",
      at: AT,
      evidence: "rec sha256:00",
    });
    const out = applyObservations(
      f,
      {
        allFieldsChecked: false,
        observed: [{ where: "fields.gross_kg", visible: "64.80", legibility: "SMUDGED" }],
        mismatches: [],
        traps: [{ slot: "ONLY", trap: "WATER_STAIN", status: "FAILED", evidence: "look" }],
      },
      AT,
    );
    expect(out.keptHuman).toEqual(["fields.gross_kg"]);
    expect(fixtureFields(f).get("fields.gross_kg")).toMatchObject({ visible: "6?.80", checkedBy: "human" });
    expect(f.slips[0]?.trapChecks[0]).toMatchObject({ status: "HOLDS", by: "read" });
  });

  it("reports paths that match no field", () => {
    const f = slipPageFixture("spike-0403", SLIP_0403);
    const out = applyObservations(
      f,
      {
        allFieldsChecked: false,
        observed: [{ where: "fields.nope", visible: "x", legibility: "CLEAR" }],
        mismatches: [],
        traps: [],
      },
      AT,
    );
    expect(out.unplaced).toEqual(["fields.nope"]);
  });

  it("addresses logbook cells as `line N.column`", () => {
    const f = logbookFixture("logbook-p14", [
      { line: 7, serial: "0462", values: { net_kg: "64.50", serial: "0462", line: "7" } },
    ]);
    applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    expect(fixtureFields(f).get("line 7.net_kg")).toMatchObject({
      visible: "64.50",
      legibility: "CLEAR",
      checkedBy: "agent",
    });
    expect(fixtureFields(f).get("line 7.remarks")).toMatchObject({ visible: "", legibility: "ABSENT" });
  });
});

describe("applyReview", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "fs-review-"));
    const store = new ManifestStore(join(dir, "manifest.json"));
    const fixtures = new Map<string, Fixture>();
    return {
      store,
      fixtures,
      io: {
        readFixture: async (id: string) => structuredClone(fixtures.get(id) ?? null),
        writeFixture: async (f: Fixture) => {
          fixtures.set(f.id, Fixture.parse(f));
        },
      },
    };
  }
  const file = (images: unknown[], v: 1 | 2 = 2) =>
    ({ v, reviewer: "Claude (agent)", method: "visual check", reviewedAt: AT, images }) as ReviewFile;

  it("makes a fixture agent-checked only when every field and every crop was checked", async () => {
    const { store, fixtures, io } = setup();
    await store.update((m) => {
      m.assets["spike-0403"] = entry("spike-0403", { outputSha: "d".repeat(64) });
      m.assets["spike-0458"] = entry("spike-0458", { outputSha: "e".repeat(64) });
    });
    fixtures.set("spike-0403", slipPageFixture("spike-0403", SLIP_0403));
    fixtures.set("spike-0458", slipPageFixture("spike-0458", SLIP_0403));
    const r = await applyReview(
      store,
      file([
        {
          asset: "spike-0403",
          sha256Prefix: "dddddddd",
          promptVersion: "p2",
          checked: 17,
          mismatches: [],
          allFieldsChecked: true,
          cropsChecked: true,
        },
        {
          asset: "spike-0458",
          sha256Prefix: "eeeeeeee",
          promptVersion: "p2",
          checked: 17,
          mismatches: [],
          allFieldsChecked: true,
        },
      ]),
      io,
    );
    expect(r.agentChecked).toEqual(["spike-0403"]);
    expect(fixtures.get("spike-0403")?.review).toMatchObject({
      status: "agent-checked",
      reviewer: "Claude (agent)",
    });
    // Values checked but crops not looked at: still a draft.
    expect(fixtures.get("spike-0458")?.review.status).toBe("draft");
    const m = await store.read();
    expect(m.assets["spike-0403"]?.review).toMatchObject({
      status: "agent-checked",
      fieldMatch: { matched: 17, total: 17 },
    });
  });

  it("keeps a fixture with a wrong crop a draft and records the crop", async () => {
    const { store, fixtures, io } = setup();
    await store.update((m) => {
      m.assets["spike-0403"] = entry("spike-0403", { outputSha: "d".repeat(64) });
    });
    fixtures.set("spike-0403", slipPageFixture("spike-0403", SLIP_0403));
    await applyReview(
      store,
      file([
        {
          asset: "spike-0403",
          sha256Prefix: "dddddddd",
          promptVersion: "p2",
          checked: 17,
          mismatches: [],
          allFieldsChecked: true,
          cropsChecked: true,
          cropIssues: ["fields.date"],
        },
      ]),
      io,
    );
    expect(fixtures.get("spike-0403")?.review).toMatchObject({
      status: "draft",
      cropIssues: ["fields.date"],
    });
  });

  it("leaves a fixture drawn on another master alone", async () => {
    const { store, fixtures, io } = setup();
    await store.update((m) => {
      m.assets["spike-0403"] = entry("spike-0403", { outputSha: "d".repeat(64), masterSha: SHA_B });
    });
    fixtures.set("spike-0403", slipPageFixture("spike-0403", SLIP_0403, { sha: SHA_A }));
    const r = await applyReview(
      store,
      file([
        {
          asset: "spike-0403",
          sha256Prefix: "dddddddd",
          promptVersion: "p2",
          checked: 17,
          mismatches: [],
          allFieldsChecked: true,
          cropsChecked: true,
        },
      ]),
      io,
    );
    expect(r.skippedFixtures).toEqual(["spike-0403"]);
    expect(fixtures.get("spike-0403")?.review.status).toBe("draft");
  });

  it("reads a version-1 file as counts only, and refuses observations in one", async () => {
    const { store, fixtures, io } = setup();
    await store.update((m) => {
      m.assets["spike-0403"] = entry("spike-0403", { outputSha: "d".repeat(64) });
    });
    fixtures.set("spike-0403", slipPageFixture("spike-0403", SLIP_0403));
    const r = await applyReview(
      store,
      file(
        [{ asset: "spike-0403", sha256Prefix: "dddddddd", promptVersion: "p1", checked: 17, mismatches: [] }],
        1,
      ),
      io,
    );
    expect(r.images).toBe(1);
    expect(r.fixtures).toEqual([]);
    expect(fixtures.get("spike-0403")?.review.status).toBe("draft");
    expect(
      ReviewFile.safeParse(
        file(
          [
            {
              asset: "x",
              sha256Prefix: "dddddddd",
              promptVersion: "p1",
              checked: 1,
              mismatches: [],
              allFieldsChecked: true,
            },
          ],
          1,
        ),
      ).success,
    ).toBe(false);
  });

  it("parses the committed review files", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { MEDIA_ROOT } = await import("../src/util/env.js");
    const dir = join(MEDIA_ROOT, "review");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files)
      expect(ReviewFile.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8"))).success, f).toBe(true);
  });
});

describe("carryOver keeps recorded readings across a redraft of the same image", () => {
  it("copies checked fields whose request is unchanged, except crops marked wrong", () => {
    const prev = slipPageFixture("spike-0403", SLIP_0403);
    applyObservations(prev, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    prev.review.cropIssues = ["fields.date"];
    const next = carryOver(prev, slipPageFixture("spike-0403", SLIP_0403));
    const fields = fixtureFields(next);
    expect(fields.get("fields.gross_kg")?.checkedBy).toBe("agent");
    expect(fields.get("fields.date")?.checkedBy).toBeNull();
    expect(next.review.status).toBe("draft");
    expect(next.review.notes.join(" ")).toMatch(/carried over/);
  });

  it("carries nothing from a fixture of other pixels or an unparseable file", () => {
    const prev = slipPageFixture("spike-0403", SLIP_0403);
    applyObservations(prev, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    const other = carryOver(prev, slipPageFixture("spike-0403", SLIP_0403, { sha: SHA_B }));
    expect([...fixtureFields(other).values()].every((x) => x.checkedBy === null)).toBe(true);
    const junk = carryOver({ v: 1, slips: [] }, slipPageFixture("spike-0403", SLIP_0403));
    expect([...fixtureFields(junk).values()].every((x) => x.checkedBy === null)).toBe(true);
  });
});

describe("manifest helpers used above", () => {
  it("an empty manifest is labelled synthetic", () => {
    expect(emptyManifest().synthetic).toBe(true);
  });
});
