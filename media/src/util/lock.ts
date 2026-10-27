import { randomBytes } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";

/**
 * A cross-process lock: an exclusive-create `{target}.lock` file holding its owner (pid, host, a nonce).
 * It guards the manifest and the machine-wide Codex ledger, which every worktree on the machine shares.
 *
 * - **Only an abandoned lock is removed:** one whose holder process has exited (same host), one older than
 *   `hungMs` (a hung run), or one whose owner cannot be read (an older version's empty lock file, or a torn
 *   write) once it is older than `staleMs`.
 * - **One remover at a time:** a waiter removes an abandoned lock only while holding `{target}.lock.steal`,
 *   and checks again under it, so a waiter can never delete a lock another waiter has just created after
 *   removing the same abandoned one. (With a holder that has exited, nothing else can change the lock while
 *   it is checked; only a hung-but-alive holder releasing in that instant could, after `hungMs`.)
 * - **A holder releases only its own lock** (same nonce), never one that replaced it.
 * - On Windows a just-deleted file can refuse a new create for a moment (EPERM/EBUSY while a reader's handle
 *   closes); that is contention, so the waiter retries until `waitMs`.
 */

export interface LockOwner {
  pid: number;
  host: string;
  nonce: string;
  at: string;
}

export interface FileLockOptions {
  /** An unreadable lock (no owner) is abandoned once older than this. Default 60 s. */
  staleMs?: number;
  /** A live holder's lock is taken over only once older than this. Default 10 min. */
  hungMs?: number;
  /** How long to wait before giving up with {@link LockTimeoutError}. Default 60 s. */
  waitMs?: number;
}

export class LockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockTimeoutError";
  }
}

const DEFAULTS = { staleMs: 60_000, hungMs: 10 * 60_000, waitMs: 60_000 } as const;
/** The steal lock is held for a few file operations; one older than this was left by a crashed waiter. */
const STEAL_OPTS = { staleMs: 10_000, hungMs: 10_000 } as const;
/** Codes a create can fail with while another process is releasing or reading the lock. */
const BUSY = new Set(["EEXIST", "EPERM", "EBUSY", "EACCES"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates `path` holding `owner` (true), or returns why it could not: it exists or is being released. */
async function tryCreate(path: string, owner: LockOwner): Promise<true | string> {
  let h: Awaited<ReturnType<typeof open>>;
  try {
    h = await open(path, "wx");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (BUSY.has(code)) return code;
    throw e;
  }
  try {
    await h.writeFile(JSON.stringify(owner), "utf8");
  } finally {
    await h.close();
  }
  return true;
}

const RM = { force: true, maxRetries: 5, retryDelay: 10 } as const;

/** The lock's owner; null when it is gone or cannot be read (empty, torn, or not ours to parse). */
async function readOwner(path: string): Promise<LockOwner | null> {
  for (let attempt = 0; ; attempt++) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      // A Windows reader can collide with a release in progress for a moment; anything else is final.
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || attempt >= 4) return null;
      await sleep(10);
      continue;
    }
    try {
      const o = JSON.parse(text) as Partial<LockOwner>;
      return typeof o.pid === "number" && typeof o.host === "string" && typeof o.nonce === "string"
        ? (o as LockOwner)
        : null;
    } catch {
      return null;
    }
  }
}

/** Whether a process with this id exists on this machine (EPERM: it exists, we may not signal it). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface LockState {
  owner: LockOwner | null;
  ageMs: number;
  /** Why the lock is abandoned, or null while it is held (or gone). */
  abandoned: string | null;
}

async function inspect(path: string, o: { staleMs: number; hungMs: number }): Promise<LockState | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
  const ageMs = Date.now() - mtimeMs;
  const owner = await readOwner(path);
  let abandoned: string | null = null;
  if (!owner) {
    if (ageMs > o.staleMs) abandoned = `an unreadable lock ${Math.round(ageMs / 1000)} s old`;
  } else if (owner.host === hostname() && !isAlive(owner.pid)) {
    abandoned = `its holder (pid ${owner.pid}) has exited`;
  } else if (ageMs > o.hungMs) {
    abandoned = `held for ${Math.round(ageMs / 1000)} s by pid ${owner.pid} on ${owner.host}`;
  }
  return { owner, ageMs, abandoned };
}

/** Removes `path` if it still holds `nonce` (a holder or stealer releasing what it created). */
async function release(path: string, nonce: string): Promise<void> {
  const owner = await readOwner(path);
  if (owner?.nonce === nonce) await rm(path, RM);
}

/** Removes the lock if it is abandoned, as the only waiter doing so (see the module comment). */
async function removeIfAbandoned(lock: string, o: { staleMs: number; hungMs: number }): Promise<void> {
  if (!(await inspect(lock, o))?.abandoned) return;
  const steal = `${lock}.steal`;
  const me = owner();
  if ((await tryCreate(steal, me)) !== true) {
    // Another waiter is removing it; a steal lock left by a crashed waiter is removed the same way.
    if ((await inspect(steal, STEAL_OPTS))?.abandoned) await rm(steal, RM);
    return;
  }
  try {
    if ((await inspect(lock, o))?.abandoned) await rm(lock, RM);
  } finally {
    await release(steal, me.nonce);
  }
}

function owner(): LockOwner {
  return {
    pid: process.pid,
    host: hostname(),
    nonce: randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
  };
}

/**
 * Runs `fn` while holding `{target}.lock`. `opts` may be a number: the older `staleMs` argument.
 * Throws {@link LockTimeoutError}, naming the holder, after `waitMs`.
 */
export async function withFileLock<T>(
  target: string,
  fn: () => Promise<T>,
  opts: FileLockOptions | number = {},
): Promise<T> {
  const o = { ...DEFAULTS, ...(typeof opts === "number" ? { staleMs: opts } : opts) };
  const lock = `${target}.lock`;
  const deadline = Date.now() + o.waitMs;
  let me = owner();
  for (let r = await tryCreate(lock, me); r !== true; r = await tryCreate(lock, me)) {
    await removeIfAbandoned(lock, o);
    if (Date.now() > deadline) {
      const s = await inspect(lock, o);
      const by = s?.owner
        ? `held by pid ${s.owner.pid} on ${s.owner.host} since ${s.owner.at}`
        : s
          ? "its owner cannot be read"
          : `it could not be created: ${r}`;
      throw new LockTimeoutError(`timed out after ${o.waitMs} ms waiting for ${lock} (${by})`);
    }
    await sleep(15 + Math.random() * 40);
    me = owner();
  }
  try {
    return await fn();
  } finally {
    await release(lock, me.nonce);
  }
}
