import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { LlmCallRow, Recording } from "./types.js";

/**
 * Where replay recordings live, keyed by `cache_key`. The database implementation (`llm_calls`) is
 * WS-DATA's; in CI the committed recordings under `packages/eval/recordings/` are read with
 * `FsReplayStore`. `put` is insert-if-absent: a recording, once made, is never replaced by a later
 * live call with the same key (the Judge live lane must not overwrite the recorded run).
 */
export interface ReplayStore {
  get(cacheKey: string): Promise<Recording | undefined>;
  put(rec: Recording): Promise<"inserted" | "exists">;
}

/** One row per live call, failed calls included (S4.1 step 8). */
export interface CallLedger {
  append(row: LlmCallRow): Promise<void>;
}

const KEY_RE = /^[0-9a-f]{64}$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new TypeError(`not a cache key: ${key}`);
}

export class MemoryReplayStore implements ReplayStore {
  readonly records = new Map<string, Recording>();
  async get(cacheKey: string): Promise<Recording | undefined> {
    return this.records.get(cacheKey);
  }
  async put(rec: Recording): Promise<"inserted" | "exists"> {
    if (this.records.has(rec.cache_key)) return "exists";
    this.records.set(rec.cache_key, rec);
    return "inserted";
  }
}

/**
 * Creates `dir` and, when it or one of its three nearest ancestors is a dot directory (".cache"),
 * drops a `.gitignore` containing `*` inside that directory, so a cache never needs an entry in a
 * shared ignore file.
 */
export async function ensureSelfIgnoringDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  let probe = dir;
  for (let depth = 0; depth < 4; depth++) {
    const name = basename(probe);
    if (name.startsWith(".") && name !== "." && name !== "..") {
      try {
        await writeFile(join(probe, ".gitignore"), "# created by @fairsplit/ai: never committed\n*\n", {
          flag: "wx",
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      return;
    }
    const parent = dirname(probe);
    if (parent === probe) return;
    probe = parent;
  }
}

/** One pretty-printed JSON file per recording: `{dir}/{cache_key}.json`. */
export class FsReplayStore implements ReplayStore {
  constructor(readonly dir: string) {}

  async get(cacheKey: string): Promise<Recording | undefined> {
    assertKey(cacheKey);
    try {
      return JSON.parse(await readFile(join(this.dir, `${cacheKey}.json`), "utf8")) as Recording;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async put(rec: Recording): Promise<"inserted" | "exists"> {
    assertKey(rec.cache_key);
    if (await this.get(rec.cache_key)) return "exists";
    await ensureSelfIgnoringDir(this.dir);
    const target = join(this.dir, `${rec.cache_key}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
    await rename(tmp, target);
    return "inserted";
  }
}

/** Reads from each store in order; writes go to `writeTo` (the first store by default). */
export class LayeredReplayStore implements ReplayStore {
  private readonly writeTo: ReplayStore | undefined;
  constructor(
    private readonly layers: ReplayStore[],
    writeTo?: ReplayStore | null,
  ) {
    this.writeTo = writeTo === null ? undefined : (writeTo ?? layers[0]);
  }
  async get(cacheKey: string): Promise<Recording | undefined> {
    for (const layer of this.layers) {
      const hit = await layer.get(cacheKey);
      if (hit) return hit;
    }
    return undefined;
  }
  async put(rec: Recording): Promise<"inserted" | "exists"> {
    if (await this.get(rec.cache_key)) return "exists";
    return this.writeTo ? this.writeTo.put(rec) : "exists";
  }
}

export class MemoryCallLedger implements CallLedger {
  readonly rows: LlmCallRow[] = [];
  async append(row: LlmCallRow): Promise<void> {
    this.rows.push(row);
  }
}

/** Append-only JSONL ledger (dev machine). The raw message is not repeated here; it is in the recording. */
export class JsonlCallLedger implements CallLedger {
  constructor(private readonly path: string) {}
  async append(row: LlmCallRow): Promise<void> {
    await ensureSelfIgnoringDir(dirname(this.path));
    await appendFile(this.path, `${JSON.stringify(row)}\n`, "utf8");
  }
}
