import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composePhoto, projectSlipFixture } from "../src/compose/photos.js";
import { Placement } from "../src/compose/schema.js";
import { apply, type Mat3, projectBox } from "../src/fixtures/geometry.js";
import { SlipImageFixture, slipFieldEntries } from "../src/fixtures/schema.js";
import { Manifest } from "../src/imagegen/manifest.js";
import { MEDIA_ROOT } from "../src/util/env.js";
import { sha256 } from "../src/util/hash.js";

const json = (file: string) => JSON.parse(readFileSync(join(MEDIA_ROOT, file), "utf8"));
const seed = JSON.parse(
  readFileSync(join(MEDIA_ROOT, "../packages/seed/snapshot/season-2026A.json"), "utf8"),
);

describe("code-composed replay photos", () => {
  it("projects existing crop fixtures through the exact recorded transform", () => {
    const source = SlipImageFixture.parse(json("fixtures/spike-0403.json")).slips[0];
    if (!source) throw new Error("missing hero fixture");
    const matrix: Mat3 = [0.4, 0.02, 0.1, -0.01, 0.4, 0.1, 0, 0, 1];
    const projected = projectSlipFixture(source, matrix, "TL");
    expect(projected.quad).toEqual(source.quad.map((p) => apply(matrix, p)));
    const originalFields = slipFieldEntries(source);
    slipFieldEntries(projected).forEach(({ path, field }, i) => {
      const original = originalFields[i]?.field;
      if (!original) throw new Error(path);
      expect(field).toMatchObject(projectBox(matrix, original));
      expect(field.visible).toBe(original.visible);
      expect(field.checkedBy).toBe(original.checkedBy);
    });
  });

  it("inv.i8.compositions: A-L contain exactly the seed slips, honest provenance and transform crops", async () => {
    const manifest = Manifest.parse(json("manifest.json"));
    expect(Object.keys(manifest.compositions)).toEqual([..."ABCDEFGHIJKL"]);
    let heroCount = 0;
    for (const photo of seed.photos.filter((p: { set: string }) => p.set === "REPLAY")) {
      const composition = manifest.compositions[photo.photoId];
      expect(composition, photo.photoId).toBeDefined();
      if (!composition) throw new Error(photo.photoId);
      expect(composition.label).toBe("Code-composed · synthetic");
      expect(
        composition.placements.map(({ slot, serial, copy }) => ({ position: slot, serial, copy })),
      ).toEqual(photo.slips);
      const bytes = readFileSync(join(MEDIA_ROOT, composition.image.file));
      expect(bytes.length).toBeLessThanOrEqual(250_000);
      expect(sha256(bytes)).toBe(composition.image.sha256);
      const meta = await sharp(bytes).metadata();
      expect([meta.width, meta.height]).toEqual([composition.image.width, composition.image.height]);
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
      const fixture = SlipImageFixture.parse(json(composition.fixture));
      expect(sha256(readFileSync(join(MEDIA_ROOT, composition.fixture)))).toBe(composition.fixtureSha256);
      expect(fixture.image.sha256).toBe(composition.image.sha256);
      for (const [i, placement] of composition.placements.entries()) {
        expect(placement.synthetic).toBe(true);
        expect(placement.label).toBe(
          placement.kind === "hero-flat" ? "Codex-made · synthetic" : "code-drawn · synthetic",
        );
        expect(placement.transform).toHaveLength(9);
        expect(fixture.slips[i]?.quad).toEqual(placement.targetQuad);
        expect(sha256(readFileSync(join(MEDIA_ROOT, placement.sourceFile)))).toBe(placement.sourceSha256);
        expect(sha256(readFileSync(join(MEDIA_ROOT, placement.sourceFixture)))).toBe(
          placement.sourceFixtureSha256,
        );
        if (placement.kind === "hero-flat") {
          heroCount++;
          const source = SlipImageFixture.parse(json(placement.sourceFixture)).slips[0];
          if (!source) throw new Error(placement.serial);
          const projected = projectSlipFixture(source, placement.transform, placement.slot);
          expect(fixture.slips[i]?.fields).toEqual(projected.fields);
          // Inherited trap claims must never pretend the new composition had a model read.
          expect(fixture.slips[i]?.trapChecks.every((t) => t.status === "UNVERIFIED")).toBe(true);
        }
      }
    }
    expect(heroCount).toBe(8); // 0403 and 0419 belong to earlier photos, outside A-L.
  });

  it("reproduces a committed photo byte for byte without a model or network", async () => {
    const result = await composePhoto("E", MEDIA_ROOT);
    const manifest = Manifest.parse(json("manifest.json"));
    expect(sha256(result.bytes)).toBe(manifest.compositions.E?.image.sha256);
    expect(result.entry).toEqual(manifest.compositions.E);
  });

  it("lays the slips on a cool light laminate, not the v1 walnut desk (desk-photo-v2, ADR-0016)", async () => {
    const manifest = Manifest.parse(json("manifest.json"));
    for (const [id, composition] of Object.entries(manifest.compositions)) {
      expect(composition.renderer, id).toBe("desk-photo-v2");
      // The desk shows at the top right corner of every photo, outside the paper and its caption.
      const { data } = await sharp(readFileSync(join(MEDIA_ROOT, composition.image.file)))
        .extract({ left: 1100, top: 8, width: 60, height: 40 })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const mean = [0, 1, 2].map((c) => {
        let sum = 0;
        for (let i = c; i < data.length; i += 3) sum += data[i] as number;
        return sum / (data.length / 3);
      });
      const [r = 0, g = 0, b = 0] = mean;
      expect(Math.min(r, g, b), `${id} is light`).toBeGreaterThan(170);
      expect(b, `${id} is cool (blue over red)`).toBeGreaterThan(r);
    }
  });

  it("inv.i8.composition-labels: rejects a model label on a code-drawn source", () => {
    const manifest = Manifest.parse(json("manifest.json"));
    const drawn = manifest.compositions.A?.placements[0];
    expect(drawn?.kind).toBe("code-drawn");
    expect(Placement.safeParse({ ...drawn, label: "Codex-made · synthetic" }).success).toBe(false);
  });

  it("pins caption rasters so reconstruction never uses system fonts", () => {
    const manifest = json("manifest.json");
    for (const entry of Object.values(manifest.compositions) as {
      caption?: { file: string; sha256: string };
    }[]) {
      expect(entry.caption).toBeDefined();
      if (!entry.caption) throw new Error("missing pinned caption layer");
      expect(sha256(readFileSync(join(MEDIA_ROOT, entry.caption.file)))).toBe(entry.caption.sha256);
    }
  });
});
