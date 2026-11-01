import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TTS_MODEL, TtsError } from "../src/tts/gemini.js";
import { GeminiCallError, KeyPool, keyId } from "../src/tts/keys.js";
import { QuotaLedger } from "../src/tts/quota.js";
import { REPO_ROOT } from "../src/util/env.js";

function harness() {
  const keys = [1, 2, 3].map((n) => ["offline", "attempt", n, "standin".repeat(4)].join("-"));
  const now = () => new Date("2026-11-01T17:00:00.000Z");
  const scratch = join(REPO_ROOT, ".codex-scratch");
  mkdirSync(scratch, { recursive: true });
  const ledger = new QuotaLedger(join(mkdtempSync(join(scratch, "tts-attempt-")), "quota.json"), now);
  const logs: string[] = [];
  const pool = new KeyPool(keys, {
    ledger,
    now,
    makeClient: (key) => ({ id: keyId(key) }),
    log: (line) => logs.push(line),
  });
  return { keys, ids: keys.map(keyId), ledger, pool, logs };
}

describe("KeyPool physical attempt budget", () => {
  it("settles and cools a first 429, then stops without reserving the next key", async () => {
    const h = harness();
    const called: string[] = [];
    const error = await h.pool
      .run(
        TTS_MODEL,
        async (client) => {
          called.push(client.id);
          if (called.length === 1)
            throw new TtsError(`429 per-minute quota; retry in 30s; ${h.keys[0]}`, 429, true);
          return "unexpected retry";
        },
        { maxAttempts: 1 },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiCallError);
    expect(error).toMatchObject({ kind: "rate", status: 429, keyId: h.ids[0] });
    expect(called).toEqual([h.ids[0]]);
    const status = await h.pool.status([TTS_MODEL]);
    expect(status.total[TTS_MODEL]?.used).toBe(1);
    expect(status.keys[0]?.models[TTS_MODEL]).toMatchObject({
      used: 1,
      cooling: { until: "2026-11-01T17:00:31.000Z", scope: "minute" },
    });
    expect(status.keys.slice(1).map((key) => key.models[TTS_MODEL]?.used)).toEqual([0, 0]);
    expect((await h.ledger.today(TTS_MODEL)).rateLimited).toBe(1);
    const output = `${String(error)}\n${h.logs.join("\n")}`;
    for (const key of h.keys) expect(output.includes(key)).toBe(false);
  });

  it("drops a refused key before stopping with an auth error", async () => {
    const h = harness();
    let calls = 0;
    const error = await h.pool
      .run(
        TTS_MODEL,
        async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("PERMISSION_DENIED"), { status: 403 });
          return "unexpected retry";
        },
        { maxAttempts: 1 },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiCallError);
    expect(error).toMatchObject({ kind: "auth", status: 403, keyId: h.ids[0] });
    expect(calls).toBe(1);
    expect(h.pool.dropped().map((key) => key.id)).toEqual([h.ids[0]]);
    expect((await h.ledger.today(TTS_MODEL)).requests).toBe(1);
  });

  it("allows a second physical call to succeed within a budget of two", async () => {
    const h = harness();
    let calls = 0;
    const result = await h.pool.run(
      TTS_MODEL,
      async () => {
        calls += 1;
        if (calls === 1) throw new TtsError("429 quota", 429, true);
        return "ok";
      },
      { maxAttempts: 2 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect((await h.ledger.today(TTS_MODEL)).requests).toBe(2);
  });

  it("rejects an invalid budget before reserving any quota", async () => {
    const h = harness();
    let calls = 0;
    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        h.pool.run(
          TTS_MODEL,
          async () => {
            calls += 1;
            return "unexpected call";
          },
          { maxAttempts },
        ),
      ).rejects.toThrow(/maxAttempts/);
    }
    expect(calls).toBe(0);
    expect((await h.ledger.today(TTS_MODEL)).requests).toBe(0);
  });
});
