import { readFile } from "node:fs/promises";
import { readJsonOr, writeJson } from "../util/json.js";
import { withFileLock } from "./manifest.js";

/**
 * The Codex budget (plan, "Synthetic assets": at most 12 execs per 5 hours; S4.10 `media/.codex-ledger.json`).
 * Built-in image_gen spends Codex limits 3–5× faster than a text turn and the quota is the user's, so every
 * exec — `gen`, `trial` and `exec` alike — reserves a slot here before it starts. A reservation is never
 * handed back: an exec that produced nothing still spent quota. The ledger is per machine (git-ignored);
 * on first use it is seeded from `media/prompts/attempts.jsonl`, the committed record of every exec.
 */

export const CODEX_WINDOW_MS = 5 * 60 * 60 * 1000;
export const CODEX_EXECS_PER_WINDOW = 12;

export interface LedgerExec {
  at: string;
  label: string;
}

export interface LedgerFile {
  v: 1;
  execs: LedgerExec[];
}

export interface BudgetStatus {
  used: number;
  cap: number;
  windowMs: number;
  /** When the oldest exec in the window leaves it (a slot frees up); null while slots are free. */
  nextFreeAt: Date | null;
}

export class CodexBudgetError extends Error {
  constructor(readonly status: BudgetStatus) {
    super(
      `Codex budget reached: ${status.used} of ${status.cap} execs in the last ${status.windowMs / 3_600_000} h` +
        (status.nextFreeAt ? `; the next slot frees at ${status.nextFreeAt.toISOString()}` : ""),
    );
    this.name = "CodexBudgetError";
  }
}

/** Something that must be asked before each `codex exec` (the pipeline's view of the ledger). */
export interface ExecBudget {
  reserve(label: string): Promise<void>;
}

/** Exec start times recorded in `attempts.jsonl` (rows with a `startedAt`; adoptions have none). */
export async function execTimesFromAttemptsLog(path: string): Promise<LedgerExec[]> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: LedgerExec[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { startedAt?: unknown; asset?: unknown; exec?: unknown; n?: unknown };
      if (typeof row.startedAt !== "string" || Number.isNaN(Date.parse(row.startedAt))) continue;
      const name =
        typeof row.asset === "string" ? row.asset : typeof row.exec === "string" ? `exec:${row.exec}` : "?";
      out.push({ at: row.startedAt, label: `${name}#${String(row.n ?? "?")}` });
    } catch {
      /* a torn line from a crashed run is skipped */
    }
  }
  return out;
}

export interface LedgerOptions {
  cap?: number;
  windowMs?: number;
  now?: () => Date;
  /** Seeds a missing ledger file (by default from nothing). */
  seed?: () => Promise<LedgerExec[]>;
}

export class CodexLedger implements ExecBudget {
  readonly cap: number;
  readonly windowMs: number;
  private readonly now: () => Date;
  private readonly seed: () => Promise<LedgerExec[]>;

  constructor(
    readonly path: string,
    opts: LedgerOptions = {},
  ) {
    this.cap = opts.cap ?? CODEX_EXECS_PER_WINDOW;
    this.windowMs = opts.windowMs ?? CODEX_WINDOW_MS;
    this.now = opts.now ?? (() => new Date());
    this.seed = opts.seed ?? (async () => []);
    if (!Number.isInteger(this.cap) || this.cap < 1)
      throw new Error(`Codex cap must be a positive integer: ${this.cap}`);
  }

  private async load(): Promise<LedgerFile> {
    const missing = Symbol("missing");
    const raw = await readJsonOr<LedgerFile | typeof missing>(this.path, missing);
    if (raw === missing) return { v: 1, execs: await this.seed() };
    return { v: 1, execs: Array.isArray(raw.execs) ? raw.execs : [] };
  }

  private inWindow(f: LedgerFile): LedgerExec[] {
    const since = this.now().getTime() - this.windowMs;
    return f.execs
      .filter((e) => Date.parse(e.at) > since)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  private statusOf(recent: readonly LedgerExec[]): BudgetStatus {
    const used = recent.length;
    const oldest = recent[used - this.cap];
    return {
      used,
      cap: this.cap,
      windowMs: this.windowMs,
      nextFreeAt: used >= this.cap && oldest ? new Date(Date.parse(oldest.at) + this.windowMs) : null,
    };
  }

  async status(): Promise<BudgetStatus> {
    return this.statusOf(this.inWindow(await this.load()));
  }

  /** Counts one exec before it starts, or throws {@link CodexBudgetError} when the window is full. */
  async reserve(label: string): Promise<void> {
    await withFileLock(this.path, async () => {
      const recent = this.inWindow(await this.load());
      const status = this.statusOf(recent);
      if (status.used >= this.cap) throw new CodexBudgetError(status);
      recent.push({ at: this.now().toISOString(), label });
      await writeJson(this.path, { v: 1, execs: recent } satisfies LedgerFile);
    });
  }
}
