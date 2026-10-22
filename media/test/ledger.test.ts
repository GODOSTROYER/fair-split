import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_EXECS_PER_WINDOW,
  CODEX_LEDGER_ENV,
  CODEX_LEDGER_FILE,
  CODEX_WINDOW_MS,
  CodexBudgetError,
  CodexLedger,
  codexLedgerFor,
  codexLedgerPath,
  execsFromLedgerFile,
  execTimesFromAttemptsLog,
  LEGACY_LEDGER_FILE,
  mergeExecs,
} from "../src/imagegen/ledger.js";

const HOUR = 3_600_000;

function dir(): string {
  return mkdtempSync(join(tmpdir(), "fs-ledger-"));
}

/** A checkout's media root (an empty one: no ledger, no attempts log). */
function checkout(): string {
  return mkdtempSync(join(tmpdir(), "fs-checkout-media-"));
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

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

  it("counts the execs of attempts.jsonl it does not hold yet, ignoring adoptions and torn lines", async () => {
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
      alsoCount: () => execTimesFromAttemptsLog(log),
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

describe("one Codex ledger per machine: every checkout spends the user's single quota", () => {
  it("lives at $CODEX_HOME/fairsplit-codex-ledger.json, or an absolute $FAIRSPLIT_CODEX_LEDGER", () => {
    const home = dir();
    expect(codexLedgerPath({ CODEX_HOME: home })).toBe(join(home, CODEX_LEDGER_FILE));
    expect(codexLedgerPath({})).toBe(join(homedir(), ".codex", CODEX_LEDGER_FILE));
    const shared = join(dir(), "shared-ledger.json");
    expect(codexLedgerPath({ CODEX_HOME: home, [CODEX_LEDGER_ENV]: shared })).toBe(shared);
    expect(codexLedgerPath({ CODEX_HOME: home, [CODEX_LEDGER_ENV]: "  " })).toBe(
      join(home, CODEX_LEDGER_FILE),
    );
    // A relative override would resolve per checkout (per working directory): refused.
    expect(() => codexLedgerPath({ [CODEX_LEDGER_ENV]: "media/.codex-ledger.json" })).toThrow(
      /absolute path/,
    );
  });

  it("two checkouts with different media roots share one count and one cap", async () => {
    // CODEX_HOME need not exist yet: the first reservation creates its folder (the lock sits beside the file).
    const env = { CODEX_HOME: join(dir(), "codex-home") };
    const a = checkout();
    const b = checkout();
    const la = codexLedgerFor(a, { env, cap: 3 });
    const lb = codexLedgerFor(b, { env, cap: 3 });
    expect(la.path).toBe(lb.path);
    expect(inside(a, la.path) || inside(b, la.path)).toBe(false);

    await la.reserve("spike-0403#1 accept");
    await lb.reserve("exec:mat-1#1");
    await la.reserve("spike-0419#1 accept");
    const err = await lb.reserve("exec:mat-1#2").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexBudgetError);
    expect((err as CodexBudgetError).status).toMatchObject({ used: 3, cap: 3 });
    expect((await la.status()).used).toBe(3);
    expect((await lb.status()).used).toBe(3);
    // Nothing is kept inside either checkout any more.
    expect(readdirSync(a)).toEqual([]);
    expect(readdirSync(b)).toEqual([]);
  });

  it("holds the cap when checkouts reserve at the same moment", async () => {
    const env = { CODEX_HOME: dir() };
    const ledgers = [checkout(), checkout(), checkout()].map((root) => codexLedgerFor(root, { env, cap: 5 }));
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) => (ledgers[i % 3] as CodexLedger).reserve(`p#${i}`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(CodexBudgetError);
    expect(existsSync(`${codexLedgerPath(env)}.lock`)).toBe(false);
  });

  it("counts every checkout's own records (old ledger, attempts.jsonl) on each read, each exec once", async () => {
    const now = () => new Date("2026-10-22T13:00:00Z");
    const root = checkout();
    writeFileSync(
      join(root, LEGACY_LEDGER_FILE),
      JSON.stringify({
        v: 1,
        execs: [
          { at: "2026-10-22T12:15:24.987Z", label: "spike-0436#1 accept" },
          { at: "2026-10-22T12:20:00.000Z", label: "exec:mat-1#1" },
          { at: "2026-10-22T06:00:00.000Z", label: "spike-0462#3" },
        ],
      }),
    );
    mkdirSync(join(root, "prompts"));
    writeFileSync(
      join(root, "prompts", "attempts.jsonl"),
      [
        // The same exec as the ledger's first entry (its row starts a few ms after the reservation).
        JSON.stringify({ asset: "spike-0436", n: 1, startedAt: "2026-10-22T12:15:24.998Z" }),
        // An exec only the log knows.
        JSON.stringify({ asset: "spike-0471", n: 1, startedAt: "2026-10-22T12:16:26.783Z" }),
        JSON.stringify({ asset: "spike-0436", n: 1, adopted: "accept" }),
      ].join("\n"),
    );
    const env = { CODEX_HOME: dir() };
    const ledger = codexLedgerFor(root, { env, now });
    expect((await ledger.status()).used).toBe(3);
    await ledger.reserve("spike-0403#2 accept");
    const saved = JSON.parse(readFileSync(ledger.path, "utf8")) as { execs: { label: string }[] };
    expect(saved.execs.map((e) => e.label)).toEqual([
      "spike-0436#1 accept",
      "spike-0471#1",
      "exec:mat-1#1",
      "spike-0403#2 accept",
    ]);
    // Reading again counts nothing twice: the merged entries are the same execs.
    expect((await ledger.status()).used).toBe(4);
    // A second checkout that spent quota before the shared file existed (its own old ledger) still counts:
    // the shared file does not know that exec, so ignoring it would hand that checkout 12 more.
    const other = checkout();
    writeFileSync(
      join(other, LEGACY_LEDGER_FILE),
      JSON.stringify({
        v: 1,
        execs: [
          { at: "2026-10-22T12:59:00.000Z", label: "x#1" },
          // The same exec the first checkout's records already brought in: counted once.
          { at: "2026-10-22T12:15:24.987Z", label: "spike-0436#1 accept" },
        ],
      }),
    );
    const second = codexLedgerFor(other, { env, now, cap: 5 });
    expect((await second.status()).used).toBe(5);
    await expect(second.reserve("y#1")).rejects.toBeInstanceOf(CodexBudgetError);
  });

  it("joins two records without losing a repeated exec or counting one exec twice", () => {
    const ledger = [
      { at: "2026-10-22T07:22:08.597Z", label: "spike-0462#3" },
      { at: "2026-10-22T07:22:13.178Z", label: "spike-0462#3" },
    ];
    const log = [
      { at: "2026-10-22T07:22:08.632Z", label: "spike-0462#3" },
      { at: "2026-10-22T07:22:13.201Z", label: "spike-0462#3" },
      { at: "2026-10-22T07:40:00.000Z", label: "spike-0462#3" },
    ];
    expect(mergeExecs(ledger, log).map((e) => e.at)).toEqual([
      "2026-10-22T07:22:08.597Z",
      "2026-10-22T07:22:13.178Z",
      "2026-10-22T07:40:00.000Z",
    ]);
    expect(mergeExecs([], log)).toHaveLength(3);
    expect(mergeExecs(ledger, [])).toHaveLength(2);
  });

  it("reads a seed ledger defensively: missing, malformed or partly bad files give what is usable", async () => {
    const d = dir();
    expect(await execsFromLedgerFile(join(d, "missing.json"))).toEqual([]);
    writeFileSync(join(d, "torn.json"), '{"v":1,"execs":[');
    expect(await execsFromLedgerFile(join(d, "torn.json"))).toEqual([]);
    writeFileSync(
      join(d, "mixed.json"),
      JSON.stringify({
        execs: [{ at: "2026-10-22T12:00:00Z", label: "ok#1" }, { at: "nope", label: "x" }, 7],
      }),
    );
    expect(await execsFromLedgerFile(join(d, "mixed.json"))).toEqual([
      { at: "2026-10-22T12:00:00Z", label: "ok#1" },
    ]);
  });
});
