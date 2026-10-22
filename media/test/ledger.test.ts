import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_EXECS_PER_WINDOW,
  CODEX_WINDOW_MS,
  CodexBudgetError,
  CodexLedger,
  execTimesFromAttemptsLog,
} from "../src/imagegen/ledger.js";

const HOUR = 3_600_000;

function dir(): string {
  return mkdtempSync(join(tmpdir(), "fs-ledger-"));
}

describe("Codex ledger (plan: at most 12 execs per 5 hours)", () => {
  it("defaults to 12 execs per 5-hour window", () => {
    expect(CODEX_EXECS_PER_WINDOW).toBe(12);
    expect(CODEX_WINDOW_MS).toBe(5 * HOUR);
  });

  it("reserves up to the cap, then refuses and says when the next slot frees", async () => {
    let t = Date.parse("2026-10-22T12:00:00Z");
    const ledger = new CodexLedger(join(dir(), ".codex-ledger.json"), { cap: 3, now: () => new Date(t) });
    for (let i = 0; i < 3; i++) {
      await ledger.reserve(`a#${i}`);
      t += 60_000;
    }
    const err = await ledger.reserve("a#3").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexBudgetError);
    expect((err as CodexBudgetError).status).toMatchObject({ used: 3, cap: 3 });
    expect((err as CodexBudgetError).status.nextFreeAt?.toISOString()).toBe("2026-10-22T17:00:00.000Z");
    expect((err as Error).message).toMatch(/3 of 3 execs in the last 5 h/);
    // Once the first exec leaves the window, one slot is free again.
    t = Date.parse("2026-10-22T17:00:01Z");
    await ledger.reserve("a#4");
    expect((await ledger.status()).used).toBe(3);
  });

  it("never hands a slot back: a failed exec still spent quota", async () => {
    const ledger = new CodexLedger(join(dir(), "l.json"), { cap: 1 });
    await ledger.reserve("x#1");
    await expect(ledger.reserve("x#2")).rejects.toBeInstanceOf(CodexBudgetError);
  });

  it("seeds a missing ledger from attempts.jsonl, ignoring adoptions and torn lines", async () => {
    const d = dir();
    const log = join(d, "attempts.jsonl");
    const now = Date.parse("2026-10-22T13:00:00Z");
    writeFileSync(
      log,
      [
        JSON.stringify({ asset: "spike-0403", n: 1, startedAt: "2026-10-22T12:10:00Z" }),
        JSON.stringify({ exec: "mat-1", n: 1, startedAt: "2026-10-22T12:20:00Z" }),
        JSON.stringify({ asset: "spike-0403", n: 1, adopted: "accept" }),
        JSON.stringify({ asset: "old", n: 1, startedAt: "2026-10-21T01:00:00Z" }),
        '{"asset":"torn"',
        "",
      ].join("\n"),
    );
    const times = await execTimesFromAttemptsLog(log);
    expect(times.map((t) => t.label)).toEqual(["spike-0403#1", "exec:mat-1#1", "old#1"]);
    const path = join(d, ".codex-ledger.json");
    const ledger = new CodexLedger(path, {
      cap: 3,
      now: () => new Date(now),
      seed: () => execTimesFromAttemptsLog(log),
    });
    expect((await ledger.status()).used).toBe(2);
    await ledger.reserve("next#1");
    await expect(ledger.reserve("next#2")).rejects.toBeInstanceOf(CodexBudgetError);
    const saved = JSON.parse(readFileSync(path, "utf8")) as { execs: { label: string }[] };
    expect(saved.execs.map((e) => e.label)).toEqual(["spike-0403#1", "exec:mat-1#1", "next#1"]);
    expect(await execTimesFromAttemptsLog(join(d, "missing.jsonl"))).toEqual([]);
  });

  it("holds the cap when many processes reserve at once", async () => {
    const path = join(dir(), "l.json");
    const ledgers = Array.from({ length: 4 }, () => new CodexLedger(path, { cap: 5 }));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => (ledgers[i % 4] as CodexLedger).reserve(`p#${i}`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("refuses a nonsensical cap", () => {
    expect(() => new CodexLedger("x", { cap: 0 })).toThrow(/positive integer/);
  });
});
