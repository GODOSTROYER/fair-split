import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetKind, AssetSpec } from "../content/types.js";
import { PROMPT_VERSION, renderPrompt } from "../prompts/render.js";
import { sha256 } from "../util/hash.js";
import { type CodexRunOptions, type CodexRunResult, codexHome, type FoundImage } from "./codex.js";
import type { ExecBudget } from "./ledger.js";
import {
  type AssetEntry,
  type Attempt,
  GENERATOR,
  type ManifestStore,
  mediaRelative,
  SYNTHETIC_LABEL,
} from "./manifest.js";
import {
  DEFAULT_EXPECTATION,
  type ImageExpectation,
  verifyImage,
  writeDisplay,
  writeMaster,
} from "./verify.js";

export interface PipelineDeps {
  mediaRoot: string;
  store: ManifestStore;
  codexCli: string;
  run: (opts: CodexRunOptions) => Promise<CodexRunResult>;
  find: (run: CodexRunResult, home: string) => Promise<FoundImage[]>;
  codexHome?: string;
  log?: (line: string) => void;
  /** Asked before every exec (the Codex ledger, 12 per 5 hours); tests that need no limit leave it out. */
  budget?: ExecBudget;
}

export interface GenerateOptions {
  /** Total execs per call. The default, 2, is one try plus one retry. S4.10 allows at most 3. */
  maxAttempts?: number;
  /** "accept" replaces the asset's master; "trial" only measures (reliability runs) and keeps the master. */
  purpose?: "accept" | "trial";
  reasoningEffort?: CodexRunOptions["reasoningEffort"];
  timeoutMs?: number;
}

export interface GenerateResult {
  id: string;
  ok: boolean;
  attempts: Attempt[];
  raw?: string;
}

export const DISPLAY_DIR: Record<AssetKind, string> = {
  slip_photo: "photos",
  slip_page: "slips",
  rate_card_page: "docs",
  logbook_page: "docs",
};

/** IC-11's photo ids: the replay set A–L and the archived P01–P54. */
export const IC11_PHOTO_ID = /^(?:[A-L]|P\d{2})$/;

/**
 * Where an asset's display WebP goes, relative to the media root. `photos/*.webp` is IC-11's photo set
 * (A–L, P01–P54) and a consumer may glob it, so any other four-slip photo (a spike) goes in `photos/spike/`.
 */
export function displayPath(asset: Pick<AssetSpec, "id" | "kind">): string {
  if (asset.kind === "slip_photo" && !IC11_PHOTO_ID.test(asset.id)) return `photos/spike/${asset.id}.webp`;
  return `${DISPLAY_DIR[asset.kind]}/${asset.id}.webp`;
}

export function expectationFor(asset: AssetSpec): ImageExpectation {
  return { ...DEFAULT_EXPECTATION, orientation: asset.orientation };
}

/** Writes the rendered prompt to media/prompts/{id}.md plus an immutable copy keyed by its hash. */
export async function logPrompt(mediaRoot: string, id: string, prompt: string) {
  const promptSha256 = sha256(prompt);
  const current = join(mediaRoot, "prompts", `${id}.md`);
  const history = join(mediaRoot, "prompts", "history", `${id}.${promptSha256.slice(0, 8)}.md`);
  await mkdir(join(mediaRoot, "prompts", "history"), { recursive: true });
  await writeFile(current, prompt, "utf8");
  await writeFile(history, prompt, "utf8");
  return { promptSha256, current, history };
}

function newEntry(
  asset: AssetSpec,
  deps: PipelineDeps,
  promptFile: string,
  promptSha256: string,
): AssetEntry {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    synthetic: true,
    label: SYNTHETIC_LABEL,
    pipeline: asset.kind === "slip_page" && asset.editOf ? "edit" : "direct",
    generator: GENERATOR,
    codexCli: deps.codexCli,
    promptVersion: PROMPT_VERSION,
    prompt: { file: promptFile, sha256: promptSha256 },
    source: asset.source,
    ...(asset.kind === "slip_page" && asset.editOf ? { editOf: asset.editOf } : {}),
    attempts: [],
    master: null,
    display: null,
    fixture: null,
    review: { status: "pending", reviewer: null, at: null, method: null, fieldMatch: null, deviations: [] },
    trials: [],
  };
}

/**
 * Generates one asset: one `codex exec` per attempt, output found by thread id, verified, copied out of
 * `$CODEX_HOME`, then turned into the committed master and display files. Every attempt is recorded,
 * accepted or not, so the manifest shows how many execs an image took.
 */
export async function generateAsset(
  asset: AssetSpec,
  deps: PipelineDeps,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const maxAttempts = Math.min(Math.max(opts.maxAttempts ?? 2, 1), 3);
  const purpose = opts.purpose ?? "accept";
  const log = deps.log ?? (() => undefined);
  const prompt = renderPrompt(asset);
  // prompts/{id}.md is the latest rendered prompt; the manifest only ever points at the immutable history
  // copy (prompts/history/{id}.{sha8}.md) of the prompt that made the master.
  const { promptSha256, history } = await logPrompt(deps.mediaRoot, asset.id, prompt);
  const promptFile = mediaRelative(history, deps.mediaRoot);

  const inputImages: string[] = [];
  if (asset.kind === "slip_page" && asset.editOf) {
    const base = (await deps.store.read()).assets[asset.editOf];
    if (!base?.master) throw new Error(`${asset.id} edits ${asset.editOf}, which has no accepted master yet`);
    inputImages.push(join(deps.mediaRoot, base.master.file));
  }

  const before = (await deps.store.read()).assets[asset.id];
  const prior = new Set<string>([
    ...(before?.attempts ?? []).flatMap((a) => (a.output ? [a.output.sha256] : [])),
    ...(before?.trials ?? []).map((t) => t.sha256),
  ]);
  // Attempt numbers are final only when recorded (under the manifest lock), so parallel processes
  // working on the same asset never reuse a number; until then `n` is a provisional label for logs.
  let n = before?.attempts.length ?? 0;
  const attempts: Attempt[] = [];
  const workdir = join(deps.mediaRoot, "raw", "codex-work");
  await mkdir(workdir, { recursive: true });

  for (let i = 0; i < maxAttempts; i++) {
    n += 1;
    try {
      await deps.budget?.reserve(`${asset.id}#${n} ${purpose}`);
    } catch (e) {
      // Out of Codex budget: keep what this call already spent on record, then stop.
      await record(asset, deps, history, promptSha256, attempts, () => undefined);
      throw e;
    }
    log(`[${asset.id}] attempt ${n}: codex exec (${purpose})`);
    const run = await deps.run({
      prompt,
      workdir,
      inputImages,
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
    const base: Omit<Attempt, "outcome"> = {
      n,
      purpose,
      promptFile,
      promptSha256,
      promptVersion: PROMPT_VERSION,
      inputImages: inputImages.map((p) => mediaRelative(p, deps.mediaRoot)),
      threadId: run.threadId,
      startedAt: run.startedAt.toISOString(),
      durationMs: run.durationMs,
      exitCode: run.exitCode,
      usage: run.usage,
    };
    const found = await deps.find(run, deps.codexHome ?? codexHome());
    const first = found[0];
    if (!first) {
      const reason = run.errors.length ? run.errors.join("; ").slice(0, 500) : "no image file after exec";
      attempts.push({ ...base, outcome: "no_output", reason });
      log(`[${asset.id}] attempt ${n}: no output (${reason})`);
      continue;
    }
    const verdict = await verifyImage(first.path, expectationFor(asset), prior);
    if (!verdict.ok) {
      attempts.push({
        ...base,
        outcome: "rejected",
        reason: verdict.reason,
        ...(verdict.info ? { output: pick(verdict.info) } : {}),
      });
      if (verdict.info) prior.add(verdict.info.sha256);
      log(`[${asset.id}] attempt ${n}: rejected (${verdict.reason})`);
      continue;
    }
    const info = verdict.info;
    prior.add(info.sha256);
    const stamp = run.startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15);
    const raw = join(
      deps.mediaRoot,
      "raw",
      asset.id,
      `${stamp}-${info.sha256.slice(0, 8)}.${extOf(first.path)}`,
    );
    await mkdir(join(deps.mediaRoot, "raw", asset.id), { recursive: true });
    await copyFile(first.path, raw);
    const rawRel = mediaRelative(raw, deps.mediaRoot);
    const attempt: Attempt = {
      ...base,
      outcome: purpose === "accept" ? "accepted" : "trial_ok",
      raw: rawRel,
      output: pick(info),
    };
    attempts.push(attempt);
    let master: Awaited<ReturnType<typeof writeMaster>> | null = null;
    let display: Awaited<ReturnType<typeof writeDisplay>> | null = null;
    if (purpose === "accept") {
      const bytes = await readFile(raw);
      master = await writeMaster(bytes, join(deps.mediaRoot, "masters", `${asset.id}.jpg`));
      display = await writeDisplay(bytes, join(deps.mediaRoot, displayPath(asset)));
    }
    await record(asset, deps, history, promptSha256, attempts, (e) => {
      if (purpose === "accept" && master && display) {
        e.master = { ...master, file: mediaRelative(master.file, deps.mediaRoot) };
        e.display = { ...display, file: mediaRelative(display.file, deps.mediaRoot) };
        e.review = {
          status: "pending",
          reviewer: null,
          at: null,
          method: null,
          fieldMatch: null,
          deviations: [],
        };
      } else {
        e.trials.push({ raw: rawRel, sha256: info.sha256, fieldMatch: null });
      }
    });
    log(
      `[${asset.id}] attempt ${n}: ${attempt.outcome} ${info.width}x${info.height} in ${Math.round(run.durationMs / 1000)} s`,
    );
    return { id: asset.id, ok: true, attempts, raw: rawRel };
  }
  await record(asset, deps, history, promptSha256, attempts, () => undefined);
  return { id: asset.id, ok: false, attempts };
}

/**
 * Re-verifies an earlier attempt's own output (found again through its thread folder) under the current
 * acceptance rules, and adopts it as the master or as a trial without another exec. Used when a check was
 * too strict: the attempt keeps its number and the manifest notes why its outcome changed.
 */
export async function adoptAttempt(
  asset: AssetSpec,
  deps: PipelineDeps,
  attemptN: number,
  as: "accept" | "trial",
): Promise<GenerateResult> {
  const entry = (await deps.store.read()).assets[asset.id];
  const attempt = entry?.attempts.find((a) => a.n === attemptN);
  if (!entry || !attempt) throw new Error(`${asset.id} has no attempt ${attemptN}`);
  if (attempt.outcome === "accepted" || attempt.outcome === "trial_ok") {
    throw new Error(`${asset.id} attempt ${attemptN} is already ${attempt.outcome}`);
  }
  const found = await deps.find(
    {
      threadId: attempt.threadId,
      savedPaths: [],
      startedAt: new Date(attempt.startedAt),
      exitCode: attempt.exitCode,
      timedOut: false,
      usage: attempt.usage,
      agentMessages: [],
      errors: [],
      durationMs: attempt.durationMs,
    },
    deps.codexHome ?? codexHome(),
  );
  const first = found[0];
  if (!first) throw new Error(`${asset.id} attempt ${attemptN}: its output is no longer in $CODEX_HOME`);
  const others = new Set(
    entry.attempts.filter((a) => a.n !== attemptN && a.output).map((a) => a.output?.sha256 as string),
  );
  const verdict = await verifyImage(first.path, expectationFor(asset), others);
  if (!verdict.ok) throw new Error(`${asset.id} attempt ${attemptN} still fails: ${verdict.reason}`);
  const info = verdict.info;
  const raw = join(
    deps.mediaRoot,
    "raw",
    asset.id,
    `${attemptN}-${info.sha256.slice(0, 8)}.${extOf(first.path)}`,
  );
  await mkdir(join(deps.mediaRoot, "raw", asset.id), { recursive: true });
  await copyFile(first.path, raw);
  const rawRel = mediaRelative(raw, deps.mediaRoot);
  let master: Awaited<ReturnType<typeof writeMaster>> | null = null;
  let display: Awaited<ReturnType<typeof writeDisplay>> | null = null;
  if (as === "accept") {
    const bytes = await readFile(raw);
    master = await writeMaster(bytes, join(deps.mediaRoot, "masters", `${asset.id}.jpg`));
    display = await writeDisplay(bytes, join(deps.mediaRoot, displayPath(asset)));
  }
  const note = `re-verified under current checks (was: ${attempt.reason ?? attempt.outcome})`;
  await deps.store.update((m) => {
    const e = m.assets[asset.id];
    const a = e?.attempts.find((x) => x.n === attemptN);
    if (!e || !a) return;
    a.outcome = as === "accept" ? "accepted" : "trial_ok";
    a.reason = note;
    a.raw = rawRel;
    a.output = pick(info);
    if (master && display) {
      e.master = { ...master, file: mediaRelative(master.file, deps.mediaRoot) };
      e.display = { ...display, file: mediaRelative(display.file, deps.mediaRoot) };
      describeMaster(
        e,
        asset,
        { codexCli: e.codexCli },
        a.promptFile,
        a.promptSha256,
        a.promptVersion ?? e.promptVersion,
      );
      e.review = {
        status: "pending",
        reviewer: null,
        at: null,
        method: null,
        fieldMatch: null,
        deviations: [],
      };
    } else {
      e.trials.push({ raw: rawRel, sha256: info.sha256, fieldMatch: null });
    }
  });
  await appendFile(
    join(deps.mediaRoot, "prompts", "attempts.jsonl"),
    `${JSON.stringify({ asset: asset.id, n: attemptN, adopted: as, note, sha256: info.sha256 })}\n`,
    "utf8",
  );
  (deps.log ?? (() => undefined))(
    `[${asset.id}] attempt ${attemptN} adopted as ${as} (${info.width}x${info.height})`,
  );
  return { id: asset.id, ok: true, attempts: [], raw: rawRel };
}

/**
 * Makes a successful trial the asset's master (for example when a later prompt version fixed a design
 * failure in the first accepted image). The previous master's attempt becomes a trial; nothing is deleted.
 */
export async function promoteAttempt(asset: AssetSpec, deps: PipelineDeps, attemptN: number, why: string) {
  const entry = (await deps.store.read()).assets[asset.id];
  const attempt = entry?.attempts.find((a) => a.n === attemptN);
  if (!entry || !attempt?.raw || attempt.outcome !== "trial_ok") {
    throw new Error(`${asset.id} attempt ${attemptN} is not a successful trial with a raw file`);
  }
  const bytes = await readFile(join(deps.mediaRoot, attempt.raw));
  const master = await writeMaster(bytes, join(deps.mediaRoot, "masters", `${asset.id}.jpg`));
  const display = await writeDisplay(bytes, join(deps.mediaRoot, displayPath(asset)));
  await deps.store.update((m) => {
    const e = m.assets[asset.id];
    if (!e) return;
    for (const a of e.attempts) {
      if (a.outcome === "accepted" && a.n !== attemptN) {
        a.outcome = "trial_ok";
        a.reason = `superseded by attempt ${attemptN}: ${why}`;
        if (a.raw && a.output && !e.trials.some((t) => t.sha256 === a.output?.sha256)) {
          e.trials.push({ raw: a.raw, sha256: a.output.sha256, fieldMatch: null });
        }
      }
    }
    const a = e.attempts.find((x) => x.n === attemptN);
    if (a) {
      a.outcome = "accepted";
      a.reason = `promoted from trial: ${why}`;
    }
    e.trials = e.trials.filter((t) => t.sha256 !== attempt.output?.sha256);
    e.master = { ...master, file: mediaRelative(master.file, deps.mediaRoot) };
    e.display = { ...display, file: mediaRelative(display.file, deps.mediaRoot) };
    describeMaster(
      e,
      asset,
      { codexCli: e.codexCli },
      attempt.promptFile,
      attempt.promptSha256,
      attempt.promptVersion ?? e.promptVersion,
    );
    e.review = {
      status: "pending",
      reviewer: null,
      at: null,
      method: null,
      fieldMatch: null,
      deviations: [],
    };
  });
  (deps.log ?? (() => undefined))(`[${asset.id}] attempt ${attemptN} promoted to master`);
}

/**
 * Appends attempts to the manifest entry. The entry's provenance (prompt, prompt version, content source,
 * Codex version) describes its master, so it is rewritten here only while there is no master yet; once a
 * master exists, only `mutate` (a new master) changes it, and trials leave it alone.
 */
async function record(
  asset: AssetSpec,
  deps: PipelineDeps,
  promptHistory: string,
  promptSha256: string,
  attempts: Attempt[],
  mutate: (e: AssetEntry) => void,
): Promise<void> {
  await deps.store.update((m) => {
    const promptFile = mediaRelative(promptHistory, deps.mediaRoot);
    const e = m.assets[asset.id] ?? newEntry(asset, deps, promptFile, promptSha256);
    e.title = asset.title;
    const hadMaster = e.master?.sha256 ?? null;
    if (!hadMaster) describeMaster(e, asset, deps, promptFile, promptSha256);
    for (const a of attempts) a.n = e.attempts.length + attempts.indexOf(a) + 1;
    e.attempts.push(...attempts);
    mutate(e);
    if (e.master && e.master.sha256 !== hadMaster) describeMaster(e, asset, deps, promptFile, promptSha256);
    m.assets[asset.id] = e;
  });
  const logLine = attempts.map((a) => JSON.stringify({ asset: asset.id, ...a })).join("\n");
  if (logLine) {
    await appendFile(join(deps.mediaRoot, "prompts", "attempts.jsonl"), `${logLine}\n`, "utf8");
  }
}

/** Points the entry's provenance at what made its current master (or, before any master, the last try). */
function describeMaster(
  e: AssetEntry,
  asset: AssetSpec,
  deps: Pick<PipelineDeps, "codexCli">,
  promptFile: string,
  promptSha256: string,
  promptVersion: string = PROMPT_VERSION,
): void {
  e.prompt = { file: promptFile, sha256: promptSha256 };
  e.promptVersion = promptVersion;
  e.source = asset.source;
  e.codexCli = deps.codexCli;
}

function pick(info: { sha256: string; width: number; height: number; bytes: number }) {
  return { sha256: info.sha256, width: info.width, height: info.height, bytes: info.bytes };
}

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m?.[1] ?? "png").toLowerCase();
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}
