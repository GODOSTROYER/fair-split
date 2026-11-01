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

/** Final playback, explicit drafts and immutable retired takes each retain their synthetic labels. */
function audioRegistries() {
  const load = (file: string) =>
    AudioManifest.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "audio", file), "utf8")));
  return {
    final: load("manifest.json"),
    drafts: load("drafts/manifest.json"),
    archive: load("archive/manifest.json"),
  };
}

/**
 * I8: nothing simulated goes unlabelled. Every committed image, fixture and audio clip is synthetic and
 * says so in its manifest; every image prompt asks for the printed specimen line.
 */
describe("inv.i8.labels: synthetic media is always labelled", () => {
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "manifest.json"), "utf8")));

  it("inv.i8.media-manifest: every image-model asset is synthetic, labelled and made by the one generator", () => {
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
      const composition = manifest.compositions[fx.id];
      expect(e?.master?.sha256 ?? composition?.image.sha256).toBe(fx.image.sha256);
    }
  });

  it("inv.i8.media-files: every image file in media/ is hashed in an asset or composition, byte for byte", () => {
    const listed = new Map<string, string>();
    for (const e of Object.values(manifest.assets)) {
      if (e.master) listed.set(e.master.file, e.master.sha256);
      if (e.display) listed.set(e.display.file, e.display.sha256);
    }
    for (const e of Object.values(manifest.compositions)) {
      expect(e.synthetic).toBe(true);
      expect(e.label).toBe("Code-composed · synthetic");
      listed.set(e.image.file, e.image.sha256);
      listed.set(e.caption.file, e.caption.sha256);
      for (const p of e.placements) {
        expect(p.synthetic).toBe(true);
        expect(p.label).toBe(p.kind === "hero-flat" ? "Codex-made · synthetic" : "code-drawn · synthetic");
        listed.set(p.sourceFile, p.sourceSha256);
      }
    }
    const images = mediaFiles(/.(png|jpe?g|webp|gif|avif|tiff?)$/i);
    expect(images.length).toBeGreaterThan(0);
    for (const f of images) {
      expect(listed.has(f), `${f} is not in media/manifest.json, so nothing labels it synthetic`).toBe(true);
      expect(sha256(readFileSync(join(MEDIA_ROOT, f)))).toBe(listed.get(f));
    }
  });

  it("inv.i8.media-audio-files: every audio file has an exact labelled final, draft or archive registry entry", () => {
    const registries = audioRegistries();
    const listed = new Set<string>();
    for (const [kind, registry] of Object.entries(registries)) {
      expect(registry.notice).toMatch(/synthetic/i);
      for (const entry of registry.entries) {
        expect(listed.has(entry.file), `${entry.file} occurs in more than one registry entry`).toBe(false);
        listed.add(entry.file);
        expect(entry.draft, `${kind}: ${entry.file}`).toBe(kind === "drafts");
        const prefix = kind === "drafts" ? "audio/drafts/" : "audio/";
        expect(entry.file).toMatch(
          new RegExp(`^${prefix}${entry.member_no}/${entry.lang}/[A-Za-z0-9_-]{1,64}\\.m4a$`),
        );
        // Archived takes keep their immutable historical paths, but can never share an active file.
        expect(sha256(entry.text), `${kind}: ${entry.file} exact spoken text hash`).toBe(entry.text_sha256);
        expect(readFileSync(join(MEDIA_ROOT, entry.file)).length, entry.file).toBeGreaterThan(0);
      }
    }
    const clips = mediaFiles(/.(m4a|aac|mp3|wav|ogg|opus|flac)$/i);
    expect(clips.length).toBeGreaterThan(0);
    for (const f of clips) expect(listed.has(f), `${f} has no labelled manifest entry`).toBe(true);
    expect([...listed].sort()).toEqual(clips);
  });

  it("inv.i8.media-audio: every clip is a synthetic voice labelled in its own language", () => {
    for (const audio of Object.values(audioRegistries())) {
      expect(audio.synthetic).toBe(true);
      for (const c of audio.entries) {
        expect(c.synthetic).toBe(true);
        expect(c.label).toBe(VOICE_LABELS[c.lang]);
      }
    }
  });
});
