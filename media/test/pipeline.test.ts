import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { findAsset } from "../src/content/spike.js";
import type { CodexRunOptions, CodexRunResult, FoundImage } from "../src/imagegen/codex.js";
import { loadManifest, ManifestStore } from "../src/imagegen/manifest.js";
import {
  adoptAttempt,
  generateAsset,
  mapLimit,
  type PipelineDeps,
  promoteAttempt,
} from "../src/imagegen/pipeline.js";
import { verifyImage, writeDisplay, writeMaster } from "../src/imagegen/verify.js";
import { renderPrompt } from "../src/prompts/render.js";

/** A smooth synthetic test image (gradients compress like photos); the seed makes each one unique. */
async function png(path: string, width: number, height: number, seed = 0): Promise<string> {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      px[i] = (x * 255) / width;
      px[i + 1] = (y * 255) / height;
      px[i + 2] = (seed * 37) % 256;
    }
  }
  await sharp(px, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(path);
  return path;
}

function tempMedia(): string {
  return mkdtempSync(join(tmpdir(), "fs-media-"));
}

describe("verifyImage (S4.10 acceptance)", () => {
  it("accepts a decodable portrait image with a long edge of 1,024 px or more", async () => {
    const dir = tempMedia();
    const p = await png(join(dir, "ok.png"), 1199, 1312);
    const r = await verifyImage(p, {
      orientation: "portrait",
      minLongEdge: 1024,
      aspect: { min: 1, max: 2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info).toMatchObject({ width: 1199, height: 1312, format: "png" });
  });

  it("rejects the wrong orientation, small images, repeats, non-images and missing files", async () => {
    const dir = tempMedia();
    const land = await png(join(dir, "land.png"), 1448, 1086);
    const small = await png(join(dir, "small.png"), 600, 800);
    const expect1 = { orientation: "portrait" as const, minLongEdge: 1024 };
    expect((await verifyImage(land, expect1)).ok).toBe(false);
    expect((await verifyImage(small, expect1)).ok).toBe(false);
    const first = await verifyImage(land, { orientation: "landscape", minLongEdge: 1024 });
    expect(first.ok).toBe(true);
    const sha = first.ok ? first.info.sha256 : "";
    const again = await verifyImage(land, { orientation: "landscape", minLongEdge: 1024 }, new Set([sha]));
    expect(again).toMatchObject({ ok: false, reason: "identical to an earlier attempt" });
    writeFileSync(join(dir, "text.png"), "not an image");
    expect((await verifyImage(join(dir, "text.png"), expect1)).ok).toBe(false);
    expect((await verifyImage(join(dir, "missing.png"), expect1)).ok).toBe(false);
  });

  it("writes a JPEG master at native size and a display WebP of at most 1,600 px and 250 KB", async () => {
    const dir = tempMedia();
    const p = await png(join(dir, "big.png"), 2000, 1500);
    const m = await writeMaster(p, join(dir, "m.jpg"));
    expect(m).toMatchObject({ width: 2000, height: 1500 });
    const d = await writeDisplay(p, join(dir, "d.webp"));
    expect(Math.max(d.width, d.height)).toBe(1600);
    expect(d.bytes).toBeLessThanOrEqual(250_000);
    expect((await sharp(join(dir, "d.webp")).metadata()).format).toBe("webp");
  });
});

/** A fake codex: each exec "generates" the next queued image (or nothing) into a thread folder. */
function fakeCodex(home: string, outputs: (null | { w: number; h: number })[]) {
  let n = 0;
  const seen: CodexRunOptions[] = [];
  const run = async (opts: CodexRunOptions): Promise<CodexRunResult> => {
    seen.push(opts);
    const i = n++;
    const threadId = `thread-${i}`;
    const startedAt = new Date(Date.now() - 1000);
    const out = outputs[i];
    if (out) {
      const dir = join(home, "generated_images", threadId);
      mkdirSync(dir, { recursive: true });
      await png(join(dir, `exec-${i}.png`), out.w, out.h, i);
    }
    return {
      exitCode: 0,
      timedOut: false,
      threadId,
      usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      agentMessages: ["DONE"],
      errors: [],
      savedPaths: [],
      startedAt,
      durationMs: 1000,
    };
  };
  const find = async (r: CodexRunResult, h: string): Promise<FoundImage[]> => {
    const { findGeneratedImages } = await import("../src/imagegen/codex.js");
    return findGeneratedImages(r, h);
  };
  return { run, find, seen };
}

function deps(mediaRoot: string, home: string, outputs: (null | { w: number; h: number })[]) {
  const codex = fakeCodex(home, outputs);
  const d: PipelineDeps = {
    mediaRoot,
    store: new ManifestStore(join(mediaRoot, "manifest.json")),
    codexCli: "codex-cli test",
    run: codex.run,
    find: codex.find,
    codexHome: home,
  };
  return { d, codex };
}

describe("generateAsset (one image per codex exec)", () => {
  it("retries once after an exec with no image, then masters the image and logs the prompt", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d, codex } = deps(media, home, [null, { w: 1199, h: 1312 }]);
    const asset = findAsset("spike-0403");
    const r = await generateAsset(asset, d);
    expect(r.ok).toBe(true);
    expect(r.attempts.map((a) => a.outcome)).toEqual(["no_output", "accepted"]);
    expect(codex.seen).toHaveLength(2);
    expect(codex.seen[0]?.prompt).toBe(renderPrompt(asset));
    expect(readFileSync(join(media, "prompts", "spike-0403.md"), "utf8")).toBe(renderPrompt(asset));
    const m = await loadManifest(join(media, "manifest.json"));
    const e = m.assets["spike-0403"];
    expect(e?.attempts.map((a) => a.n)).toEqual([1, 2]);
    expect(e?.master?.file).toBe("masters/spike-0403.jpg");
    expect(e?.display?.file).toBe("slips/spike-0403.webp");
    expect(existsSync(join(media, "masters", "spike-0403.jpg"))).toBe(true);
    expect(
      readFileSync(join(media, "prompts", "attempts.jsonl"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(2);
  });

  it("gives up after its attempts and records why, without a master", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d } = deps(media, home, [{ w: 1448, h: 1086 }, null]);
    const r = await generateAsset(findAsset("spike-0403"), d);
    expect(r.ok).toBe(false);
    expect(r.attempts[0]?.reason).toMatch(/expected portrait/);
    expect(r.attempts[1]?.outcome).toBe("no_output");
    const e = (await loadManifest(join(media, "manifest.json"))).assets["spike-0403"];
    expect(e?.master).toBeNull();
  });

  it("measures with trials without replacing the master, then can promote a trial", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d } = deps(media, home, [
      { w: 1448, h: 1086 },
      { w: 1448, h: 1086 },
    ]);
    const asset = findAsset("spike-4up");
    await generateAsset(asset, d);
    const before = (await loadManifest(join(media, "manifest.json"))).assets["spike-4up"]?.master?.sha256;
    const t = await generateAsset(asset, d, { purpose: "trial" });
    expect(t.attempts[0]?.outcome).toBe("trial_ok");
    let e = (await loadManifest(join(media, "manifest.json"))).assets["spike-4up"];
    expect(e?.master?.sha256).toBe(before);
    expect(e?.trials).toHaveLength(1);
    await promoteAttempt(asset, d, 2, "test");
    e = (await loadManifest(join(media, "manifest.json"))).assets["spike-4up"];
    expect(e?.attempts.map((a) => a.outcome)).toEqual(["trial_ok", "accepted"]);
    expect(e?.master?.sha256).not.toBe(before);
    expect(e?.trials).toHaveLength(1);
  });

  it("re-verifies and adopts a rejected attempt from its thread folder without a new exec", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d, codex } = deps(media, home, [{ w: 1199, h: 1312 }]);
    // An over-strict check rejected it at generation time: simulate by recording a rejected attempt.
    const asset = findAsset("spike-0458");
    const strict: PipelineDeps = { ...d, find: async () => [] };
    await generateAsset(asset, strict, { maxAttempts: 1 });
    expect((await loadManifest(join(media, "manifest.json"))).assets["spike-0458"]?.master).toBeNull();
    await adoptAttempt(asset, d, 1, "accept");
    const e = (await loadManifest(join(media, "manifest.json"))).assets["spike-0458"];
    expect(e?.attempts[0]?.outcome).toBe("accepted");
    expect(e?.attempts[0]?.reason).toMatch(/re-verified/);
    expect(e?.master).not.toBeNull();
    expect(codex.seen).toHaveLength(1);
  });

  it("edits only from an accepted base master, attaching it as the input image", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d, codex } = deps(media, home, [
      { w: 1199, h: 1312 },
      { w: 1199, h: 1312 },
    ]);
    await expect(generateAsset(findAsset("spike-0457-pink"), d)).rejects.toThrow(/no accepted master/);
    await generateAsset(findAsset("spike-0457-white"), d);
    const r = await generateAsset(findAsset("spike-0457-pink"), d);
    expect(r.ok).toBe(true);
    expect(codex.seen.at(-1)?.inputImages?.[0]).toMatch(/masters[\\/]spike-0457-white\.jpg$/);
    const e = (await loadManifest(join(media, "manifest.json"))).assets["spike-0457-pink"];
    expect(e?.pipeline).toBe("edit");
    expect(e?.editOf).toBe("spike-0457-white");
  });

  it("keeps every manifest update when generations run in parallel", async () => {
    const media = tempMedia();
    const home = tempMedia();
    const { d } = deps(media, home, [
      { w: 1199, h: 1312 },
      { w: 1199, h: 1312 },
      { w: 1199, h: 1312 },
    ]);
    await mapLimit(["spike-0403", "spike-0458", "spike-0462"], 3, (id) => generateAsset(findAsset(id), d));
    const m = await loadManifest(join(media, "manifest.json"));
    expect(Object.keys(m.assets).sort()).toEqual(["spike-0403", "spike-0458", "spike-0462"]);
  });
});
