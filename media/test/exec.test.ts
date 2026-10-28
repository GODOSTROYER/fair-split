import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  type CodexRunOptions,
  type CodexRunResult,
  type FoundImage,
  findGeneratedImages,
} from "../src/imagegen/codex.js";
import {
  type ExecDeps,
  execNameFor,
  execPrompt,
  parseExpectation,
  resolveExecOut,
} from "../src/imagegen/exec.js";
import { verifyImage } from "../src/imagegen/verify.js";
import { sha256 } from "../src/util/hash.js";

const temp = () => mkdtempSync(join(tmpdir(), "fs-exec-"));

/** A smooth test image; `seed` changes its bytes. */
async function png(path: string, width: number, height: number, seed: number): Promise<void> {
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
}

/** A fake `codex exec`: each call writes the next queued image (or nothing) into its own thread folder. */
function fakeCodex(home: string, outputs: (null | { w: number; h: number; seed?: number })[]) {
  let calls = 0;
  const seen: CodexRunOptions[] = [];
  const run = async (opts: CodexRunOptions): Promise<CodexRunResult> => {
    seen.push(opts);
    const i = calls++;
    const threadId = `thread-${home.length}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const out = outputs[i];
    if (out) {
      const dir = join(home, "generated_images", threadId);
      mkdirSync(dir, { recursive: true });
      await png(join(dir, `exec-${i}.png`), out.w, out.h, out.seed ?? i);
    }
    return {
      exitCode: 0,
      timedOut: false,
      threadId,
      usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      agentMessages: ["DONE"],
      errors: [],
      savedPaths: [],
      startedAt: new Date(Date.now() - 1000),
      durationMs: 1000,
    };
  };
  const find = (r: CodexRunResult, h: string): Promise<FoundImage[]> => findGeneratedImages(r, h);
  return { run, find, seen };
}

function setup(outputs: (null | { w: number; h: number; seed?: number })[]) {
  const media = temp();
  const home = temp();
  const codex = fakeCodex(home, outputs);
  const deps: ExecDeps = { mediaRoot: media, run: codex.run, find: codex.find, codexHome: home };
  // CRLF and non-ASCII on purpose: the prompt must reach Codex and the log exactly as written.
  const promptFile = join(media, "Bamboo Mat (empty).md");
  writeFileSync(
    promptFile,
    "Synthetic sample.\r\nAn empty bamboo mat, ₱ none.\r\nCall image_gen exactly once.\n",
  );
  return { media, home, codex, deps, promptFile };
}

const jsonl = (media: string) =>
  readFileSync(join(media, "prompts", "attempts.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("imagegen exec: prompt file in, verified image out (AI-11)", () => {
  it("sends the prompt file unchanged, retries once after an empty exec, and keeps the image in raw/", async () => {
    const { media, codex, deps, promptFile } = setup([null, { w: 1448, h: 1086 }]);
    const r = await execPrompt({ promptFile, expect: { orientation: "landscape" } }, deps);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("bamboo-mat-empty");
    expect(r.attempts.map((a) => a.outcome)).toEqual(["no_output", "ok"]);
    expect(codex.seen).toHaveLength(2);
    const sent = readFileSync(promptFile, "utf8");
    expect(codex.seen[0]?.prompt).toBe(sent);
    expect(r.promptLog).toBe(`prompts/exec/bamboo-mat-empty.${sha256(sent).slice(0, 8)}.md`);
    expect(readFileSync(join(media, r.promptLog), "utf8")).toBe(sent);
    expect(r.raw).toMatch(/^raw\/exec\/bamboo-mat-empty\/\d{8}T\d{6}-[0-9a-f]{8}\.png$/);
    const v = await verifyImage(join(media, r.raw as string), {
      orientation: "landscape",
      minLongEdge: 1024,
    });
    expect(v.ok && [v.info.width, v.info.height]).toEqual([1448, 1086]);
    const rows = jsonl(media);
    expect(rows.map((x) => [x.exec, x.n, x.outcome])).toEqual([
      ["bamboo-mat-empty", 1, "no_output"],
      ["bamboo-mat-empty", 2, "ok"],
    ]);
    expect(rows[1]).toMatchObject({ promptFile: r.promptLog, promptSha256: sha256(sent), purpose: "exec" });
  });

  it("rejects an image of the wrong size or orientation and gives up after the retry", async () => {
    const { media, codex, deps, promptFile } = setup([
      { w: 1199, h: 1312 },
      { w: 1448, h: 1086 },
      { w: 1448, h: 1086 },
    ]);
    const r = await execPrompt(
      {
        promptFile,
        name: "slip-flat",
        expect: { orientation: "portrait", exact: { width: 1024, height: 1536 } },
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(codex.seen).toHaveLength(2);
    expect(r.attempts.map((a) => a.reason)).toEqual([
      "expected 1024x1536, got 1199x1312",
      "expected 1024x1536, got 1448x1086",
    ]);
    expect(r.raw).toBeUndefined();
    expect(jsonl(media).map((x) => x.outcome)).toEqual(["rejected", "rejected"]);
  });

  it("counts an image that an earlier exec of the same name already produced as a failure", async () => {
    const { media, deps, promptFile } = setup([
      { w: 1448, h: 1086, seed: 7 },
      { w: 1448, h: 1086, seed: 7 },
      { w: 1448, h: 1086, seed: 8 },
    ]);
    const first = await execPrompt({ promptFile, name: "mat", maxAttempts: 1 }, deps);
    expect(first.ok).toBe(true);
    const second = await execPrompt({ promptFile, name: "mat" }, deps);
    expect(second.ok).toBe(true);
    expect(second.attempts.map((a) => [a.n, a.outcome, a.reason ?? ""])).toEqual([
      [2, "rejected", "identical to an earlier attempt"],
      [3, "ok", ""],
    ]);
    expect(jsonl(media).map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it("writes an --out copy inside media/raw/, converting by extension", async () => {
    const { media, deps, promptFile } = setup([{ w: 1199, h: 1312 }]);
    const out = join(media, "raw", "mats", "mat-a.webp");
    const r = await execPrompt({ promptFile, out }, deps);
    expect(r.out).toBe("raw/mats/mat-a.webp");
    expect((await sharp(out).metadata()).format).toBe("webp");
  });

  it("refuses, before any exec, an --out outside media/raw/, an empty prompt, a bad name or too many inputs", async () => {
    const { media, codex, deps, promptFile } = setup([{ w: 1199, h: 1312 }]);
    await expect(execPrompt({ promptFile, out: join(media, "photos", "A.webp") }, deps)).rejects.toThrow(
      /inside media\/raw\/.*manifest labels them \(I8\)/,
    );
    await expect(execPrompt({ promptFile, out: join(media, "raw", "x.gif") }, deps)).rejects.toThrow(
      /\.png, \.jpg or \.webp/,
    );
    const empty = join(media, "empty.md");
    writeFileSync(empty, "  \n");
    await expect(execPrompt({ promptFile: empty }, deps)).rejects.toThrow(/empty/);
    await expect(execPrompt({ promptFile, name: "../escape" }, deps)).rejects.toThrow(/exec name/);
    await expect(
      execPrompt({ promptFile, inputImages: Array.from({ length: 6 }, () => promptFile) }, deps),
    ).rejects.toThrow(/at most 5 input images/);
    await expect(execPrompt({ promptFile, inputImages: [join(media, "missing.png")] }, deps)).rejects.toThrow(
      /input image not found/,
    );
    expect(codex.seen).toHaveLength(0);
  });

  it("passes edit inputs to codex and records them relative to media/", async () => {
    const { media, codex, deps, promptFile } = setup([{ w: 1199, h: 1312 }]);
    const input = join(media, "masters", "base.png");
    mkdirSync(join(media, "masters"), { recursive: true });
    await png(input, 1199, 1312, 42);
    const r = await execPrompt({ promptFile, name: "pink-edit", inputImages: [input] }, deps);
    expect(codex.seen[0]?.inputImages).toEqual([input]);
    expect(r.attempts[0]?.inputImages).toEqual(["masters/base.png"]);
  });
});

describe("exec helpers", () => {
  it("derives a safe default name from the prompt file", () => {
    expect(execNameFor("prompts/experiments/E1 0403.p0.md")).toBe("e1-0403-p0");
    expect(execNameFor("___.md")).toBe("exec");
  });

  it("parses the size expectations of the command line", () => {
    expect(parseExpectation({})).toEqual({});
    expect(
      parseExpectation({
        orientation: "portrait",
        minLongEdge: "1400",
        aspect: "1.2-1.5",
        size: "1024x1536",
      }),
    ).toEqual({
      orientation: "portrait",
      minLongEdge: 1400,
      aspect: { min: 1.2, max: 1.5 },
      exact: { width: 1024, height: 1536 },
    });
    expect(parseExpectation({ aspect: "any" }).aspect?.max).toBe(Number.POSITIVE_INFINITY);
    expect(() => parseExpectation({ orientation: "square" })).toThrow(/orientation/);
    expect(() => parseExpectation({ minLongEdge: "800" })).toThrow(/at least 1024/);
    expect(() => parseExpectation({ aspect: "2-1" })).toThrow(/aspect/);
    expect(() => parseExpectation({ size: "1024*1536" })).toThrow(/WIDTHxHEIGHT/);
  });

  it("keeps --out inside media/raw/", () => {
    const media = temp();
    expect(resolveExecOut(media, join(media, "raw", "a", "b.png"))).toBe(join(media, "raw", "a", "b.png"));
    expect(() => resolveExecOut(media, join(media, "raw"))).toThrow(/inside media\/raw/);
    expect(() => resolveExecOut(media, join(media, "raw", "..", "slips", "x.png"))).toThrow(
      /inside media\/raw/,
    );
  });
});
