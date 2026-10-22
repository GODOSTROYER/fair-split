import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Fixture } from "../src/fixtures/schema.js";
import { GENERATOR, Manifest, SYNTHETIC_LABEL } from "../src/imagegen/manifest.js";
import { AudioManifest, VOICE_LABEL } from "../src/tts/manifest.js";
import { MEDIA_ROOT } from "../src/util/env.js";

/**
 * I8: nothing simulated goes unlabelled. Every committed image, fixture and audio clip is synthetic and
 * says so in its manifest; every image prompt asks for the printed specimen line.
 */
describe("inv.i8.labels: synthetic media is always labelled", () => {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "manifest.json"), "utf8")));

  it("inv.i8.media-manifest: every image asset is synthetic, labelled and made by the one generator", () => {
    expect(manifest.synthetic).toBe(true);
    expect(manifest.notice).toMatch(/synthetic/i);
    expect(Object.keys(manifest.assets).length).toBeGreaterThan(0);
    for (const e of Object.values(manifest.assets)) {
      expect(e.synthetic).toBe(true);
      expect(e.label).toBe(SYNTHETIC_LABEL);
      expect(e.generator).toBe(GENERATOR);
    }
  });

  it("inv.i8.media-prompts: every logged prompt asks for a specimen-marked synthetic image", () => {
    for (const e of Object.values(manifest.assets)) {
      const prompt = readFileSync(join(MEDIA_ROOT, e.prompt.file), "utf8");
      expect(prompt).toMatch(/synthetic/i);
      expect(prompt).toMatch(/SPECIMEN|DUPLICATE – OFFICE/);
    }
  });

  it("inv.i8.media-fixtures: every fixture is synthetic and points at its manifest master", () => {
    const files = readdirSync(join(MEDIA_ROOT, "fixtures")).filter(
      (f) => f.endsWith(".json") && f !== "fixture.schema.json",
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const fx = Fixture.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "fixtures", f), "utf8")));
      expect(fx.synthetic).toBe(true);
      const e = manifest.assets[fx.id];
      expect(e?.master?.sha256).toBe(fx.image.sha256);
    }
  });

  it("inv.i8.media-audio: every clip is a labelled synthetic voice", () => {
    const audio = AudioManifest.parse(
      JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "manifest.json"), "utf8")),
    );
    expect(audio.synthetic).toBe(true);
    for (const c of audio.entries) {
      expect(c.synthetic).toBe(true);
      expect(c.label).toBe(VOICE_LABEL);
    }
  });
});
