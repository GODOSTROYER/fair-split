import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LockTimeoutError, withFileLock } from "../src/util/lock.js";

/**
 * The cross-process lock behind the manifest and the machine-wide Codex ledger (one file shared by every
 * worktree). A waiter may remove only a lock it has shown to be abandoned, and only one waiter at a time
 * may do so, so two runs never both hold it.
 */

function target(): string {
  return join(mkdtempSync(join(tmpdir(), "fs-lock-")), "ledger.json");
}

/** A process id that has exited (spawned and waited for). */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (!r.pid) throw new Error("could not spawn a short-lived process");
  return r.pid;
}

function writeLock(path: string, owner: object | string, ageMs = 0): void {
  writeFileSync(`${path}.lock`, typeof owner === "string" ? owner : JSON.stringify(owner));
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(`${path}.lock`, t, t);
  }
}

/** Runs `n` holders at once and returns the most that were ever inside together. */
async function contend(path: string, n: number, opts?: Parameters<typeof withFileLock>[2]): Promise<number> {
  let inside = 0;
  let most = 0;
  await Promise.all(
    Array.from({ length: n }, () =>
      withFileLock(
        path,
        async () => {
          inside++;
          most = Math.max(most, inside);
          await new Promise((r) => setTimeout(r, 2));
          inside--;
        },
        opts,
      ),
    ),
  );
  return most;
}

const leftovers = (path: string) =>
  readdirSync(join(path, "..")).filter((f) => f.endsWith(".lock") || f.endsWith(".steal"));

describe("file lock (manifest, machine-wide Codex ledger)", () => {
  it("lets one holder in at a time and leaves no lock files behind", async () => {
    const path = target();
    expect(await contend(path, 20)).toBe(1);
    expect(leftovers(path)).toEqual([]);
  });

  it("takes over at once a lock whose holder has exited, and records who holds it now", async () => {
    const path = target();
    writeLock(path, { pid: deadPid(), host: hostname(), nonce: "dead", at: new Date().toISOString() });
    let owner: { pid?: number; host?: string } = {};
    await withFileLock(
      path,
      async () => {
        owner = JSON.parse(readFileSync(`${path}.lock`, "utf8")) as typeof owner;
      },
      { waitMs: 2_000 },
    );
    expect(owner).toMatchObject({ pid: process.pid, host: hostname() });
    expect(leftovers(path)).toEqual([]);
  });

  it("many waiters finding one abandoned lock still let one holder in at a time", async () => {
    for (let round = 0; round < 5; round++) {
      const path = target();
      writeLock(
        path,
        { pid: deadPid(), host: hostname(), nonce: "dead", at: "2026-10-22T00:00:00Z" },
        120_000,
      );
      expect(await contend(path, 16, { waitMs: 10_000 })).toBe(1);
      expect(leftovers(path)).toEqual([]);
    }
  });

  it("never takes the lock of a live holder: it waits, then names the holder", async () => {
    const path = target();
    writeLock(path, { pid: process.pid, host: hostname(), nonce: "live", at: "2026-10-22T12:00:00Z" });
    let ran = false;
    const err = await withFileLock(
      path,
      async () => {
        ran = true;
      },
      { waitMs: 300 },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(new RegExp(`held by pid ${process.pid} on ${hostname()}`));
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(`${path}.lock`, "utf8"))).toMatchObject({ nonce: "live" });
  });

  it("takes over a live holder's lock only once it is older than hungMs", async () => {
    const path = target();
    writeLock(path, { pid: process.pid, host: hostname(), nonce: "hung", at: "2026-10-22T12:00:00Z" }, 5_000);
    await withFileLock(path, async () => undefined, { hungMs: 1_000, waitMs: 2_000 });
    expect(leftovers(path)).toEqual([]);
  });

  it("judges another host's lock by age only (its pid means nothing here)", async () => {
    const path = target();
    writeLock(path, {
      pid: deadPid(),
      host: `${hostname()}-elsewhere`,
      nonce: "x",
      at: "2026-10-22T12:00:00Z",
    });
    await expect(withFileLock(path, async () => undefined, { waitMs: 300 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
  });

  it("removes an unreadable lock (an older version's empty file) only after staleMs", async () => {
    const path = target();
    writeLock(path, "");
    await expect(
      withFileLock(path, async () => undefined, { staleMs: 60_000, waitMs: 300 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    writeLock(path, "", 61_000);
    await withFileLock(path, async () => undefined, { staleMs: 60_000, waitMs: 2_000 });
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("a holder whose lock was taken over never deletes the new holder's lock", async () => {
    const path = target();
    const other = { pid: process.pid, host: hostname(), nonce: "newer", at: new Date().toISOString() };
    await withFileLock(path, async () => {
      // Another run judged this holder hung and took the lock over.
      writeFileSync(`${path}.lock`, JSON.stringify(other));
    });
    expect(JSON.parse(readFileSync(`${path}.lock`, "utf8"))).toEqual(other);
  });

  it("still accepts the older (target, fn, staleMs) form", async () => {
    const path = target();
    expect(await withFileLock(path, async () => 42, 60_000)).toBe(42);
  });
});
