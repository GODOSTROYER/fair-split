import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { budgetKey, capsFromEnv, FileSpendMeter, MemorySpendMeter } from "./budget.js";
import { envFlagSource } from "./flags.js";
import { cacheKey, jcs } from "./key.js";
import { costMicros, estimateMicros, visualTokens } from "./pricing.js";
import { assertWireCompliant } from "./request.js";
import { scrubString } from "./scrub.js";
import { Semaphore } from "./semaphore.js";
import { coerceEnumCase, jsonSchemaOf, parseStructured, structuredText } from "./structured.js";
import { fakeMessage } from "./test-helpers.js";
import { replayTimeline } from "./timeline.js";

describe("key", () => {
  it("is JCS: key order does not matter", () => {
    expect(jcs({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const parts = {
      imageSha: "a".repeat(64),
      variant: "A",
      promptV: "a.v1",
      schemaV: "x.v1",
      model: "claude-opus-5-5",
      effort: "low",
    } as const;
    expect(cacheKey(parts)).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ ...parts })).toBe(cacheKey(parts));
  });
});

describe("pricing", () => {
  it("prices per model and per fallback iteration", () => {
    const usage = {
      input_tokens: 2000,
      output_tokens: 1000,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
      thinking_tokens: null,
      iterations: null,
    };
    expect(costMicros(usage, "claude-opus-5-5")).toBe(2000 * 4 + 1000 * 20 + 1000 * 0.2);
    expect(costMicros(usage, "claude-haiku-5-5")).toBe(Math.ceil(2000 * 0.1 + 1000 * 0.5 + 1000 * 0.01));
    expect(costMicros(usage, "claude-unknown")).toBe(Math.ceil(2000 * 5 + 1000 * 25 + 1000 * 0.5));
  });
  it("estimates per S4.1 step 4 and counts 28px patches", () => {
    expect(visualTokens(1536, 1024)).toBe(2035);
    expect(visualTokens(2212, 1659)).toBe(4740);
    expect(estimateMicros("claude-opus-5-5", { visualTokens: 1000, characters: 400 }, 3000)).toBe(
      (1000 + 100) * 4 + 3000 * 20,
    );
  });
});

describe("budget", () => {
  it("reservations count against the cap until settled or released", async () => {
    const m = new MemorySpendMeter();
    const r1 = await m.reserve("k", 600, 1000);
    await expect(m.reserve("k", 600, 1000)).rejects.toMatchObject({ code: "AI_BUDGET" });
    await r1.release();
    const r2 = await m.reserve("k", 600, 1000);
    await r2.settle(300);
    expect(await m.spent("k")).toBe(300);
    await (await m.reserve("k", 700, 1000)).settle(700);
    await expect(m.reserve("k", 1, 1000)).rejects.toMatchObject({ code: "AI_BUDGET" });
  });

  it("the file meter survives a new instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-spend-"));
    try {
      const path = join(dir, ".cache", "spend.jsonl");
      await (await new FileSpendMeter(path).reserve("daily:-:2026-10-23", 10, 100)).settle(40);
      expect(await new FileSpendMeter(path).spent("daily:-:2026-10-23")).toBe(40);
      await expect(new FileSpendMeter(path).reserve("daily:-:2026-10-23", 61, 100)).rejects.toMatchObject({
        code: "AI_BUDGET",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keys daily spend by UTC day and eval/session by scope", () => {
    const at = new Date("2026-10-23T23:30:00-07:00");
    expect(budgetKey("daily", undefined, at)).toBe("daily:-:2026-10-24");
    expect(budgetKey("eval", "run-7", at)).toBe("eval:run-7");
    expect(() => budgetKey("session", undefined, at)).toThrow(/budgetScope/);
  });

  it("reads AI_DAILY_CAP_USD, then the .env.example spelling, then defaults to 8", () => {
    expect(capsFromEnv({ AI_DAILY_CAP_USD: "25" }).daily).toBe(25);
    expect(capsFromEnv({ AI_DAILY_SPEND_CAP_USD: "5" }).daily).toBe(5);
    expect(capsFromEnv({}).daily).toBe(8);
    expect(capsFromEnv({ AI_DAILY_CAP_USD: "nope" })).toEqual({ daily: 8, eval: 3, session: 0.75 });
  });
});

describe("flags", () => {
  it("reads KILL_AI_LIVE and FS_KILL fresh on every call", () => {
    const env: NodeJS.ProcessEnv = {};
    const flags = envFlagSource(env);
    expect(flags.isOn("kill_ai_live")).toBe(false);
    env.FS_KILL = "kill_payouts, kill_ai_live";
    expect(flags.isOn("kill_ai_live")).toBe(true);
    env.FS_KILL = "";
    env.KILL_AI_LIVE = "TRUE";
    expect(flags.isOn("kill_ai_live")).toBe(true);
  });
});

describe("semaphore", () => {
  it("never lets more than max holders in", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 7 }, async () => {
        const release = await sem.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
    expect(sem.inFlight).toBe(0);
  });

  it("an aborted waiter leaves the queue", async () => {
    const sem = new Semaphore(1);
    const hold = await sem.acquire();
    const ac = new AbortController();
    const waiting = sem.acquire(ac.signal);
    ac.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
    expect(sem.queued).toBe(0);
    hold();
    expect(sem.inFlight).toBe(0);
  });
});

describe("request rules", () => {
  it.each([
    [{ output_config: {} }, /effort/],
    [{ output_config: { effort: "high" } }, /effort/],
    [{ output_config: { effort: "low" }, top_p: 0.9 }, /sampling/],
    [{ output_config: { effort: "low" }, thinking: { type: "enabled", budget_tokens: 2048 } }, /thinking/],
    [{ output_config: { effort: "low" }, thinking: { type: "disabled" } }, /thinking/],
    [{ output_config: { effort: "low" }, tool_choice: { type: "any" } }, /tool_choice/],
  ])("refuses %j", (params, msg) => {
    expect(() => assertWireCompliant(params as Record<string, unknown>)).toThrow(msg);
  });
  it("accepts adaptive thinking and auto tool choice", () => {
    expect(() =>
      assertWireCompliant({
        output_config: { effort: "medium" },
        thinking: { type: "adaptive" },
        tool_choice: { type: "auto" },
      }),
    ).not.toThrow();
  });
});

describe("structured outputs", () => {
  const S = z.strictObject({
    kind: z.enum(["CLEAR", "SMUDGED"]),
    n: z.int(),
    items: z.array(z.strictObject({ k: z.enum(["A", "B"]) })),
  });

  it("keeps enum constraints (the SDK helper drops them) and drops safe-int bounds", () => {
    const schema = jsonSchemaOf(S);
    const text = JSON.stringify(schema);
    expect(text).toContain('"enum":["CLEAR","SMUDGED"]');
    expect(text).not.toContain("9007199254740991");
    expect(text).not.toContain("$schema");
    expect(schema.additionalProperties).toBe(false);
  });

  it("snaps enum capitalisation before validating", () => {
    const schema = jsonSchemaOf(S);
    expect(coerceEnumCase(schema, { kind: "smudged", n: 1, items: [{ k: "b" }] })).toEqual({
      kind: "SMUDGED",
      n: 1,
      items: [{ k: "B" }],
    });
    expect(parseStructured(fakeMessage({ text: '{"kind":"Clear","n":2,"items":[]}' }), S)).toEqual({
      kind: "CLEAR",
      n: 2,
      items: [],
    });
  });

  it("reports schema failures as AI_SCHEMA", () => {
    expect(() => parseStructured(fakeMessage({ text: '{"kind":"BLUE","n":2,"items":[]}' }), S)).toThrow(
      /AI_SCHEMA/,
    );
    expect(() => parseStructured(fakeMessage({ text: "{not json" }), S)).toThrow(/AI_SCHEMA/);
  });

  it("reads the text after the last fallback block, ignoring thinking blocks", () => {
    const m = fakeMessage({
      text: '{"kind":"CLEAR","n":1,"items":[]}',
      leadingBlocks: [
        { type: "thinking", thinking: "", signature: "x" },
        { type: "text", text: '{"kind":"CL' },
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      ],
    });
    expect(structuredText(m)).toBe('{"kind":"CLEAR","n":1,"items":[]}');
  });
});

describe("timeline", () => {
  it("re-emits snapshots and resets", async () => {
    const seen: string[] = [];
    let resets = 0;
    await replayTimeline(
      [
        { ms: 1, d: "ab" },
        { ms: 2, reset: true },
        { ms: 3, d: "c" },
        { ms: 4, d: "d" },
      ],
      { onSnapshot: (s) => seen.push(s), onReset: () => resets++ },
    );
    expect(seen).toEqual(["ab", "", "c", "cd"]);
    expect(resets).toBe(1);
  });
});

describe("scrub", () => {
  it("redacts secrets and emails", () => {
    expect(
      scrubString(
        `key ${["sk", "ant", "api03", "a".repeat(28)].join("-")} and Bearer abcdefghijklmnopqrstuv x@y.com`,
      ),
    ).toBe("key REDACTED and REDACTED redacted@example.invalid");
  });
});
