import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Fixture } from "../src/fixtures/schema.js";
import { GENERATOR, Manifest, SYNTHETIC_LABEL } from "../src/imagegen/manifest.js";
import { AudioManifest, VOICE_LABELS } from "../src/tts/manifest.js";
import { MEDIA_ROOT } from "../src/util/env.js";
import { sha256 } from "../src/util/hash.js";

/** Media files under media/, outside the git-ignored raw/ and .cache/ and the package's own code. */
function mediaFiles(ext: RegExp): string[] {
  const skip = new Set(["raw", ".cache", "node_modules", "src", "test"]);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) {
        if (!skip.has(d.name)) walk(join(dir, d.name));
      } else if (ext.test(d.name)) {
        out.push(relative(MEDIA_ROOT, join(dir, d.name)).split("\\").join("/"));
      }
    }
  };
  walk(MEDIA_ROOT);
  return out.sort();
}

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

  it("inv.i8.media-files: every image file in media/ is a manifest master or display, byte for byte", () => {
    const listed = new Map<string, string>();
    for (const e of Object.values(manifest.assets)) {
      if (e.master) listed.set(e.master.file, e.master.sha256);
      if (e.display) listed.set(e.display.file, e.display.sha256);
    }
    const images = mediaFiles(/.(png|jpe?g|webp|gif|avif|tiff?)$/i);
    expect(images.length).toBeGreaterThan(0);
    for (const f of images) {
      expect(listed.has(f), `${f} is not in media/manifest.json, so nothing labels it synthetic`).toBe(true);
      expect(sha256(readFileSync(join(MEDIA_ROOT, f)))).toBe(listed.get(f));
    }
  });

  it("inv.i8.media-audio-files: every audio file in media/ is a clip in media/audio/manifest.json", () => {
    const audio = AudioManifest.parse(
      JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "manifest.json"), "utf8")),
    );
    const listed = new Set(audio.entries.map((e) => e.file));
    const clips = mediaFiles(/.(m4a|aac|mp3|wav|ogg|opus|flac)$/i);
    expect(clips.length).toBeGreaterThan(0);
    for (const f of clips) expect(listed.has(f), `${f} has no labelled manifest entry`).toBe(true);
  });

  it("inv.i8.media-audio: every clip is a synthetic voice labelled in its own language", () => {
    const audio = AudioManifest.parse(
      JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", "manifest.json"), "utf8")),
    );
    expect(audio.synthetic).toBe(true);
    for (const c of audio.entries) {
      expect(c.synthetic).toBe(true);
      expect(c.label).toBe(VOICE_LABELS[c.lang]);
    }
  });
});
