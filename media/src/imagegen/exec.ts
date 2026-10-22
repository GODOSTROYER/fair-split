import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { sha256 } from "../util/hash.js";
import { type CodexRunOptions, type CodexRunResult, codexHome, type FoundImage } from "./codex.js";
import type { ExecBudget } from "./ledger.js";
import { mediaRelative } from "./manifest.js";
import { DEFAULT_EXPECTATION, type ImageExpectation, verifyImage } from "./verify.js";

/**
 * `imagegen exec`: the plain "prompt file in, image out" form of the Codex wrapper (AI-11, S4.10), for
 * prompt experiments and one-off images that have no content spec yet (mats, eval drafts). It follows the
 * same rules as `gen`: one `codex exec` per attempt with the prompt on stdin; the output found by thread
 * id and verified (exists, decodes, expected size, orientation and aspect, a sha256 no earlier attempt
 * produced); one retry by default, at most 3 execs. The prompt is logged byte for byte under
 * `media/prompts/exec/`, and every attempt is appended to `media/prompts/attempts.jsonl`.
 *
 * Outputs stay under the git-ignored `media/raw/`. An image that is committed always goes through an
 * asset spec and `gen`, so `media/manifest.json` labels it as synthetic (I8).
 */

export interface ExecDeps {
  mediaRoot: string;
  run: (opts: CodexRunOptions) => Promise<CodexRunResult>;
  find: (run: CodexRunResult, home: string) => Promise<FoundImage[]>;
  codexHome?: string;
  log?: (line: string) => void;
  /** Asked before every exec (the Codex ledger, 12 per 5 hours). */
  budget?: ExecBudget;
}

export interface ExecRequest {
  /** The prompt file, sent unchanged on stdin. */
  promptFile: string;
  /** Slug that groups the attempts and names the output folder. Defaults to the prompt file's name. */
  name?: string;
  expect?: Partial<ImageExpectation>;
  /** Input images for an edit (`--image`); Codex's image_gen accepts at most 5. */
  inputImages?: readonly string[];
  /** Total execs. The default, 2, is one try plus one retry; S4.10 allows at most 3. */
  maxAttempts?: number;
  /** Extra copy of the accepted image (png, jpg or webp by extension), resolved like every path argument (from the working directory); must be inside `media/raw/`. */
  out?: string;
  reasoningEffort?: CodexRunOptions["reasoningEffort"];
  timeoutMs?: number;
}

export interface ExecAttempt {
  exec: string;
  n: number;
  purpose: "exec";
  promptFile: string;
  promptSha256: string;
  inputImages: string[];
  threadId: string | null;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  outcome: "ok" | "rejected" | "no_output";
  reason?: string;
  raw?: string;
  output?: { sha256: string; width: number; height: number; bytes: number };
  usage: CodexRunResult["usage"];
}

export interface ExecResult {
  ok: boolean;
  name: string;
  /** The logged prompt, relative to the media root. */
  promptLog: string;
  attempts: ExecAttempt[];
  /** The accepted image under `raw/exec/{name}/`, relative to the media root. */
  raw?: string;
  /** The `out` copy, relative to the media root. */
  out?: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OUT_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export const MAX_INPUT_IMAGES = 5;

/** The default slug for a prompt file: its base name, lower-cased, with anything else turned into dashes. */
export function execNameFor(promptFile: string): string {
  const stem = basename(promptFile, extname(promptFile))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return stem || "exec";
}

/** Resolves `out` from the working directory and refuses anything outside `media/raw/` or with an unsupported extension. */
export function resolveExecOut(mediaRoot: string, out: string): string {
  const rawRoot = resolve(mediaRoot, "raw");
  const abs = resolve(out);
  const rel = relative(rawRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `--out must be inside media/raw/ (git-ignored); committed images go through an asset spec and \`gen\`, so the manifest labels them (I8). Got: ${out}`,
    );
  }
  if (!OUT_EXT.has(extname(abs).toLowerCase())) {
    throw new Error(`--out must end in .png, .jpg or .webp. Got: ${out}`);
  }
  return abs;
}

/** Output sha256s of every earlier exec with this name, so a repeated image counts as a failure. */
async function priorOutputs(attemptsLog: string, name: string): Promise<{ count: number; sha: Set<string> }> {
  const sha = new Set<string>();
  let count = 0;
  let text = "";
  try {
    text = await readFile(attemptsLog, "utf8");
  } catch {
    return { count, sha };
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(`"exec":`)) continue;
    try {
      const row = JSON.parse(line) as Partial<ExecAttempt>;
      if (row.exec !== name) continue;
      count += 1;
      if (row.output?.sha256) sha.add(row.output.sha256);
    } catch {
      /* a torn line from a crashed run is skipped */
    }
  }
  return { count, sha };
}

export async function execPrompt(req: ExecRequest, deps: ExecDeps): Promise<ExecResult> {
  const name = req.name ?? execNameFor(req.promptFile);
  if (!NAME.test(name)) throw new Error(`exec name must match ${NAME}: ${name}`);
  const maxAttempts = Math.min(Math.max(req.maxAttempts ?? 2, 1), 3);
  const inputs = (req.inputImages ?? []).map((p) => resolve(p));
  if (inputs.length > MAX_INPUT_IMAGES) {
    throw new Error(`at most ${MAX_INPUT_IMAGES} input images per edit, got ${inputs.length}`);
  }
  for (const p of inputs) if (!existsSync(p)) throw new Error(`input image not found: ${p}`);
  const out = req.out ? resolveExecOut(deps.mediaRoot, req.out) : undefined;
  const expectation: ImageExpectation = { ...DEFAULT_EXPECTATION, orientation: "any", ...req.expect };

  // The prompt goes to Codex exactly as it is on disk, and the logged copy is byte-identical to it.
  const prompt = await readFile(req.promptFile, "utf8");
  if (prompt.trim() === "") throw new Error(`prompt file is empty: ${req.promptFile}`);
  const promptSha256 = sha256(prompt);
  const promptLogAbs = join(deps.mediaRoot, "prompts", "exec", `${name}.${promptSha256.slice(0, 8)}.md`);
  await mkdir(dirname(promptLogAbs), { recursive: true });
  await writeFile(promptLogAbs, prompt, "utf8");
  const promptLog = mediaRelative(promptLogAbs, deps.mediaRoot);

  const attemptsLog = join(deps.mediaRoot, "prompts", "attempts.jsonl");
  const prior = await priorOutputs(attemptsLog, name);
  const workdir = join(deps.mediaRoot, "raw", "codex-work");
  await mkdir(workdir, { recursive: true });
  const log = deps.log ?? (() => undefined);
  const attempts: ExecAttempt[] = [];

  const finish = async (result: ExecResult): Promise<ExecResult> => {
    if (attempts.length) {
      await appendFile(attemptsLog, `${attempts.map((a) => JSON.stringify(a)).join("\n")}\n`, "utf8");
    }
    return result;
  };

  for (let i = 0; i < maxAttempts; i++) {
    const n = prior.count + i + 1;
    try {
      await deps.budget?.reserve(`exec:${name}#${n}`);
    } catch (e) {
      // Out of Codex budget: keep the attempts already spent on record, then stop.
      await finish({ ok: false, name, promptLog, attempts });
      throw e;
    }
    log(`[exec:${name}] attempt ${n}: codex exec`);
    const run = await deps.run({
      prompt,
      workdir,
      inputImages: inputs,
      ...(req.reasoningEffort ? { reasoningEffort: req.reasoningEffort } : {}),
      ...(req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}),
    });
    const base = {
      exec: name,
      n,
      purpose: "exec" as const,
      promptFile: promptLog,
      promptSha256,
      inputImages: inputs.map((p) => mediaRelative(p, deps.mediaRoot)),
      threadId: run.threadId,
      startedAt: run.startedAt.toISOString(),
      durationMs: run.durationMs,
      exitCode: run.exitCode,
      usage: run.usage,
    };
    const first = (await deps.find(run, deps.codexHome ?? codexHome()))[0];
    if (!first) {
      const reason = run.errors.length ? run.errors.join("; ").slice(0, 500) : "no image file after exec";
      attempts.push({ ...base, outcome: "no_output", reason });
      log(`[exec:${name}] attempt ${n}: no output (${reason})`);
      continue;
    }
    const verdict = await verifyImage(first.path, expectation, prior.sha);
    if (!verdict.ok) {
      const output = verdict.info
        ? {
            sha256: verdict.info.sha256,
            width: verdict.info.width,
            height: verdict.info.height,
            bytes: verdict.info.bytes,
          }
        : undefined;
      attempts.push({ ...base, outcome: "rejected", reason: verdict.reason, ...(output ? { output } : {}) });
      if (verdict.info) prior.sha.add(verdict.info.sha256);
      log(`[exec:${name}] attempt ${n}: rejected (${verdict.reason})`);
      continue;
    }
    const info = verdict.info;
    const stamp = run.startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15);
    const rawAbs = join(
      deps.mediaRoot,
      "raw",
      "exec",
      name,
      `${stamp}-${info.sha256.slice(0, 8)}${extname(first.path).toLowerCase() || ".png"}`,
    );
    await mkdir(dirname(rawAbs), { recursive: true });
    await copyFile(first.path, rawAbs);
    const raw = mediaRelative(rawAbs, deps.mediaRoot);
    attempts.push({
      ...base,
      outcome: "ok",
      raw,
      output: { sha256: info.sha256, width: info.width, height: info.height, bytes: info.bytes },
    });
    let outRel: string | undefined;
    if (out) {
      await mkdir(dirname(out), { recursive: true });
      if (extname(out).toLowerCase() === extname(rawAbs)) await copyFile(rawAbs, out);
      else await sharp(rawAbs).toFile(out);
      outRel = mediaRelative(out, deps.mediaRoot);
    }
    log(
      `[exec:${name}] attempt ${n}: ok ${info.width}x${info.height} in ${Math.round(run.durationMs / 1000)} s -> ${raw}`,
    );
    return finish({ ok: true, name, promptLog, attempts, raw, ...(outRel ? { out: outRel } : {}) });
  }
  return finish({ ok: false, name, promptLog, attempts });
}

/** Parses `--orientation`, `--min-long-edge`, `--aspect min-max|any` and `--size WxH` into an expectation. */
export function parseExpectation(v: {
  orientation?: string | undefined;
  minLongEdge?: string | undefined;
  aspect?: string | undefined;
  size?: string | undefined;
}): Partial<ImageExpectation> {
  const e: Partial<ImageExpectation> = {};
  if (v.orientation !== undefined) {
    if (v.orientation !== "portrait" && v.orientation !== "landscape" && v.orientation !== "any") {
      throw new Error(`--orientation must be portrait, landscape or any: ${v.orientation}`);
    }
    e.orientation = v.orientation;
  }
  if (v.minLongEdge !== undefined) {
    const n = Number(v.minLongEdge);
    if (!Number.isInteger(n) || n < 1024) {
      throw new Error(`--min-long-edge must be an integer of at least 1024 (S4.10): ${v.minLongEdge}`);
    }
    e.minLongEdge = n;
  }
  if (v.aspect !== undefined) {
    if (v.aspect === "any") e.aspect = { min: 1, max: Number.POSITIVE_INFINITY };
    else {
      const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(v.aspect);
      const min = Number(m?.[1]);
      const max = Number(m?.[2]);
      if (!m || min < 1 || max < min) {
        throw new Error(
          `--aspect must be "any" or "min-max" long/short edge ratios, e.g. 1.2-1.5: ${v.aspect}`,
        );
      }
      e.aspect = { min, max };
    }
  }
  if (v.size !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(v.size);
    if (!m) throw new Error(`--size must be WIDTHxHEIGHT, e.g. 1199x1312: ${v.size}`);
    e.exact = { width: Number(m[1]), height: Number(m[2]) };
  }
  return e;
}
