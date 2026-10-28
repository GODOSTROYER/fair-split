import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readJsonOr, writeJson } from "../util/json.js";
import { withFileLock } from "../util/lock.js";
import { codexHome } from "./codex.js";

/**
 * The Codex budget (plan, "Synthetic assets": at most 12 execs per 5 hours). Built-in image_gen spends Codex
 * limits 3–5× faster than a text turn and the quota is the user's, so every exec — `gen`, `trial` and `exec`
 * alike — reserves a slot here before it starts. A reservation is never handed back: an exec that produced
 * nothing still spent quota.
 *
 * The quota belongs to the Codex login, not to a checkout, so there is ONE ledger per machine and Codex home
 * ({@link codexLedgerPath}): every worktree and clone that runs imagegen counts against the same file, under
 * the same cross-process lock. A ledger kept inside each checkout (S4.10's `media/.codex-ledger.json`) would
 * let N parallel worktrees spend N × 12 execs of the one quota. Every read also counts the checkout's own
 * records — the per-checkout ledger the shared file replaces and `media/prompts/attempts.jsonl`, the
 * committed record of every exec — joined so that one exec seen in two records counts once. So an exec only
 * a checkout's own records know (spent before the shared file existed) still counts, whichever checkout
 * created the shared file first.
 */

export const CODEX_WINDOW_MS = 5 * 60 * 60 * 1000;
export const CODEX_EXECS_PER_WINDOW = 12;

/** Overrides where the machine-wide ledger lives (an absolute path). */
export const CODEX_LEDGER_ENV = "FAIRSPLIT_CODEX_LEDGER";
/** The ledger's file name inside `$CODEX_HOME`. */
export const CODEX_LEDGER_FILE = "fairsplit-codex-ledger.json";
/** The per-checkout ledger of earlier versions (git-ignored): still counted on every read, never written. */
export const LEGACY_LEDGER_FILE = ".codex-ledger.json";
/** One exec seen in two records (a ledger reservation and its attempts.jsonl row) is at most this far apart. */
export const SAME_EXEC_MS = 60_000;

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

/**
 * The machine-wide ledger file: `$FAIRSPLIT_CODEX_LEDGER` when set (it must be absolute, so every checkout
 * resolves the same file), otherwise `$CODEX_HOME/fairsplit-codex-ledger.json` (`~/.codex` by default), next
 * to the Codex state whose quota it guards. Never a path inside a checkout.
 */
export function codexLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CODEX_LEDGER_ENV]?.trim();
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(
        `${CODEX_LEDGER_ENV} must be an absolute path, so every checkout on this machine shares one Codex ledger`,
      );
    }
    return resolve(override);
  }
  return resolve(codexHome(env), CODEX_LEDGER_FILE);
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

/** The execs of a ledger file (a missing or unreadable file has none: it is only ever read alongside). */
export async function execsFromLedgerFile(path: string): Promise<LedgerExec[]> {
  let raw: unknown;
  try {
    raw = await readJsonOr<unknown>(path, null);
  } catch {
    return [];
  }
  const execs = typeof raw === "object" && raw !== null ? (raw as { execs?: unknown }).execs : undefined;
  if (!Array.isArray(execs)) return [];
  return execs.flatMap((e: unknown) => {
    if (typeof e !== "object" || e === null) return [];
    const { at, label } = e as { at?: unknown; label?: unknown };
    return typeof at === "string" && typeof label === "string" && !Number.isNaN(Date.parse(at))
      ? [{ at, label }]
      : [];
  });
}

/** `spike-0436#1 accept` and `spike-0436#1` name the same exec: the asset (or exec name) and attempt. */
const execKey = (label: string): string => label.split(" ")[0] ?? label;

/**
 * Joins two records of execs: every entry of `primary`, plus each entry of `secondary` that no entry of
 * `primary` already accounts for (same asset and attempt, at most {@link SAME_EXEC_MS} apart; each primary
 * entry accounts for one secondary entry at most). When in doubt an exec is counted twice, never zero times.
 */
export function mergeExecs(primary: readonly LedgerExec[], secondary: readonly LedgerExec[]): LedgerExec[] {
  const unmatched = [...primary];
  const out: LedgerExec[] = [...primary];
  for (const e of secondary) {
    const t = Date.parse(e.at);
    const i = unmatched.findIndex(
      (p) => execKey(p.label) === execKey(e.label) && Math.abs(Date.parse(p.at) - t) <= SAME_EXEC_MS,
    );
    if (i >= 0) unmatched.splice(i, 1);
    else out.push(e);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export interface LedgerOptions {
  cap?: number;
  windowMs?: number;
  now?: () => Date;
  /**
   * Execs recorded elsewhere that this ledger counts too, read on every load and joined with the file's own
   * entries ({@link mergeExecs}): an exec in both counts once, an exec only they know still counts, and a
   * reservation writes them into the file. By default none.
   */
  alsoCount?: () => Promise<LedgerExec[]>;
}

export class CodexLedger implements ExecBudget {
  readonly cap: number;
  readonly windowMs: number;
  private readonly now: () => Date;
  private readonly alsoCount: () => Promise<LedgerExec[]>;

  constructor(
    readonly path: string,
    opts: LedgerOptions = {},
  ) {
    this.cap = opts.cap ?? CODEX_EXECS_PER_WINDOW;
    this.windowMs = opts.windowMs ?? CODEX_WINDOW_MS;
    this.now = opts.now ?? (() => new Date());
    this.alsoCount = opts.alsoCount ?? (async () => []);
    if (!Number.isInteger(this.cap) || this.cap < 1)
      throw new Error(`Codex cap must be a positive integer: ${this.cap}`);
  }

  private async load(): Promise<LedgerFile> {
    const raw = await readJsonOr<Partial<LedgerFile> | null>(this.path, null);
    const own = raw && Array.isArray(raw.execs) ? raw.execs : [];
    return { v: 1, execs: mergeExecs(own, await this.alsoCount()) };
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
    // The lock file sits beside the ledger, so its folder (for example a fresh $CODEX_HOME) must exist.
    await mkdir(dirname(this.path), { recursive: true });
    await withFileLock(this.path, async () => {
      const recent = this.inWindow(await this.load());
      const status = this.statusOf(recent);
      if (status.used >= this.cap) throw new CodexBudgetError(status);
      recent.push({ at: this.now().toISOString(), label });
      await writeJson(this.path, { v: 1, execs: recent } satisfies LedgerFile);
    });
  }
}

export interface MachineLedgerOptions extends Omit<LedgerOptions, "alsoCount"> {
  /** Where `FAIRSPLIT_CODEX_LEDGER` and `CODEX_HOME` are read (tests pass their own). */
  env?: NodeJS.ProcessEnv;
}

/**
 * The Codex ledger every imagegen command uses: the machine-wide file ({@link codexLedgerPath}), whatever
 * checkout `mediaRoot` belongs to, plus this checkout's own records on every read: its per-checkout ledger
 * ({@link LEGACY_LEDGER_FILE}) and `prompts/attempts.jsonl`, joined so that one exec in both counts once.
 */
export function codexLedgerFor(mediaRoot: string, opts: MachineLedgerOptions = {}): CodexLedger {
  const { env, ...rest } = opts;
  return new CodexLedger(codexLedgerPath(env), {
    ...rest,
    alsoCount: async () =>
      mergeExecs(
        await execsFromLedgerFile(join(mediaRoot, LEGACY_LEDGER_FILE)),
        await execTimesFromAttemptsLog(join(mediaRoot, "prompts", "attempts.jsonl")),
      ),
  });
}
