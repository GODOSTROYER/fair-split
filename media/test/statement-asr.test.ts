import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ASR_MODEL } from "../src/tts/asr.js";
import { KeyPool } from "../src/tts/keys.js";
import { QuotaLedger } from "../src/tts/quota.js";
import { listen } from "../src/tts/statement-asr.js";
import { REPO_ROOT } from "../src/util/env.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("transcribes final AAC independently through the pool and caches by audio, mode and model", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-"));
  roots.push(root);
  const calls: Record<string, unknown>[] = [];
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json")),
    makeClient: () => ({
      models: {
        generateContent: async (p: Record<string, unknown>) => {
          calls.push(p);
          return { text: '{"words":[{"text":"Hello","start":0.1,"end":0.5}]}' };
        },
      },
    }),
  });
  const deps = { asrPool: pool, cacheDir: root, asrModels: [ASR_MODEL] };
  const a = await listen(deps, Buffer.from("aac-fixture"), "audio/mp4", "en", true);
  expect(a.words).toEqual([{ text: "Hello", start: 0.1, end: 0.5 }]);
  expect(calls[0]?.model).toBe(ASR_MODEL);
  expect(calls[0]?.config).toMatchObject({ httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } } });
  expect(JSON.stringify(calls[0])).toContain('"mimeType":"audio/mp4"');
  expect(JSON.stringify(calls[0])).not.toContain("expected");
  expect(await listen(deps, Buffer.from("aac-fixture"), "audio/mp4", "en", true)).toEqual(a);
  expect(calls).toHaveLength(1);
});
it("treats malformed timestamp JSON as an unusable alignment instead of aborting recovery", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-invalid-"));
  roots.push(root);
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json")),
    makeClient: () => ({ models: { generateContent: async () => ({ text: "No timestamps available" }) } }),
  });
  expect(
    (
      await listen(
        { asrPool: pool, cacheDir: root, asrModels: [ASR_MODEL] },
        Buffer.from("invalid-fixture"),
        "audio/wav",
        "ceb",
        true,
      )
    ).words,
  ).toEqual([]);
});
it("counts a bounded transient 503 retry through the next pool key with SDK retries disabled", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-busy-"));
  roots.push(root);
  let calls = 0;
  const ledger = new QuotaLedger(join(root, "quota.json"));
  const pool = new KeyPool(
    [1, 2].map((n) => `offline-${n}-${"standin".repeat(5)}`),
    {
      ledger,
      makeClient: () => ({
        models: {
          generateContent: async () => {
            calls++;
            if (calls === 1) throw Object.assign(new Error("Service busy"), { status: 503 });
            return { text: "Hello" };
          },
        },
      }),
    },
  );
  expect(
    (
      await listen(
        { asrPool: pool, cacheDir: root, asrModels: [ASR_MODEL] },
        Buffer.from("busy-fixture"),
        "audio/mp4",
        "en",
      )
    ).text,
  ).toBe("Hello");
  expect(calls).toBe(2);
  expect((await ledger.today(ASR_MODEL)).requests).toBe(2);
});

it("inv.i8.asr-outage: backs off and stops the run before repeated 503s drain the daily pool", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-outage-"));
  roots.push(root);
  let time = Date.now();
  let calls = 0;
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
    time += ms;
  };
  const ledger = new QuotaLedger(join(root, "quota.json"), () => new Date(time));
  const pool = new KeyPool(
    Array.from({ length: 12 }, (_, n) => `offline-${n}-${"standin".repeat(5)}`),
    {
      ledger,
      now: () => new Date(time),
      sleep,
      makeClient: () => ({
        models: {
          generateContent: async () => {
            calls++;
            throw Object.assign(new Error("Service busy"), { status: 503 });
          },
        },
      }),
    },
  );
  const deps = { asrPool: pool, cacheDir: root, asrModels: [ASR_MODEL], asrSleep: sleep };
  for (let n = 0; n < 4; n++)
    await expect(listen(deps, Buffer.from(`outage-${n}`), "audio/mp4", "ceb")).rejects.toThrow();
  expect(waits).toEqual([5_000, 15_000, 5_000, 15_000]);
  expect(calls).toBe(6);
  expect((await ledger.today(ASR_MODEL)).requests).toBe(6);
});

it("inv.i8.asr-recovery: successful recognition resets an outage streak across the plan", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-recovery-"));
  roots.push(root);
  let time = Date.now();
  let calls = 0;
  const sleep = async (ms: number) => {
    time += ms;
  };
  const pool = new KeyPool(
    Array.from({ length: 12 }, (_, n) => `offline-${n}-${"standin".repeat(5)}`),
    {
      ledger: new QuotaLedger(join(root, "quota.json"), () => new Date(time)),
      now: () => new Date(time),
      sleep,
      makeClient: () => ({
        models: {
          generateContent: async () => {
            calls++;
            if (calls % 2) throw Object.assign(new Error("Service busy"), { status: 503 });
            return { text: "Hello" };
          },
        },
      }),
    },
  );
  const deps = { asrPool: pool, cacheDir: root, asrModels: [ASR_MODEL], asrSleep: sleep };
  for (let n = 0; n < 7; n++)
    expect((await listen(deps, Buffer.from(`recovered-${n}`), "audio/mp4", "en")).text).toBe("Hello");
  expect(calls).toBe(14);
});

it("inv.i8.asr-fallback: transient failure uses the next free audio model and caches its provenance", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-fallback-"));
  roots.push(root);
  const calls: string[] = [];
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json")),
    makeClient: () => ({
      models: {
        generateContent: async (p: Record<string, unknown>) => {
          calls.push(String(p.model));
          if (p.model === ASR_MODEL) throw new Error("UNAVAILABLE: model overloaded");
          return { text: '{"words":[{"text":"Hello","start":0.1,"end":0.5}]}' };
        },
      },
    }),
  });
  const deps = { asrPool: pool, cacheDir: root };
  const result = await listen(deps, Buffer.from("fallback-fixture"), "audio/mp4", "en", true);
  expect(calls).toEqual([ASR_MODEL, "gemini-3.6-flash"]);
  expect(result).toMatchObject({
    text: "Hello",
    model: "gemini-3.6-flash",
    words: [{ text: "Hello", start: 0.1, end: 0.5 }],
  });
  expect(await listen(deps, Buffer.from("fallback-fixture"), "audio/mp4", "en", true)).toEqual(result);
  expect(calls).toHaveLength(2);
});
it("inv.i8.asr-fallback-refusal: a non-transient error never switches models", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-refusal-"));
  roots.push(root);
  const calls: string[] = [];
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json")),
    makeClient: () => ({
      models: {
        generateContent: async (p: Record<string, unknown>) => {
          calls.push(String(p.model));
          throw Object.assign(new Error("invalid request"), { status: 400 });
        },
      },
    }),
  });
  await expect(
    listen({ asrPool: pool, cacheDir: root }, Buffer.from("refusal"), "audio/mp4", "en"),
  ).rejects.toThrow("invalid request");
  expect(calls).toEqual([ASR_MODEL]);
});

it("inv.i8.asr-fallback-order: tries 2.5 only after both higher free models fail", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-third-"));
  roots.push(root);
  const calls: string[] = [];
  const ledger = new QuotaLedger(join(root, "quota.json"));
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger,
    makeClient: () => ({
      models: {
        generateContent: async (p: Record<string, unknown>) => {
          const model = String(p.model);
          calls.push(model);
          if (model !== "gemini-2.5-flash") throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
          return { text: "Hello" };
        },
      },
    }),
  });
  const result = await listen({ asrPool: pool, cacheDir: root }, Buffer.from("third"), "audio/mp4", "en");
  expect(calls).toEqual([ASR_MODEL, "gemini-3.6-flash", "gemini-2.5-flash"]);
  expect(result.model).toBe("gemini-2.5-flash");
  for (const model of calls) expect((await ledger.today(model)).requests).toBe(1);
});

it("inv.i8.asr-retired-fallback: a listed model refused on one account does not prevent higher transient models recovering", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-retired-"));
  roots.push(root);
  let time = Date.now();
  const calls: string[] = [];
  const pool = new KeyPool([`offline-${"standin".repeat(5)}`], {
    ledger: new QuotaLedger(join(root, "quota.json"), () => new Date(time)),
    now: () => new Date(time),
    sleep: async (ms) => {
      time += ms;
    },
    makeClient: () => ({
      models: {
        generateContent: async (p: Record<string, unknown>) => {
          const model = String(p.model);
          calls.push(model);
          if (model === "gemini-2.5-flash")
            throw Object.assign(new Error("This model is no longer available to new users"), { status: 404 });
          if (calls.length <= 3) throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
          return { text: "Hello" };
        },
      },
    }),
  });
  const result = await listen(
    {
      asrPool: pool,
      cacheDir: root,
      asrSleep: async (ms) => {
        time += ms;
      },
    },
    Buffer.from("retired"),
    "audio/mp4",
    "en",
  );
  expect(result.model).toBe(ASR_MODEL);
  expect(calls).toEqual([ASR_MODEL, "gemini-3.6-flash", "gemini-2.5-flash", ASR_MODEL]);
});

it("inv.i8.asr-account-availability: a 404 on one pooled key does not exclude a model for other keys", async () => {
  mkdirSync(join(REPO_ROOT, ".codex-scratch"), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, ".codex-scratch", "asr-account-"));
  roots.push(root);
  let time = Date.now();
  let lower = 0;
  const pool = new KeyPool(
    Array.from({ length: 12 }, (_, i) => `offline-${i}-${"standin".repeat(5)}`),
    {
      ledger: new QuotaLedger(join(root, "quota.json"), () => new Date(time)),
      now: () => new Date(time),
      sleep: async (ms) => {
        time += ms;
      },
      makeClient: () => ({
        models: {
          generateContent: async (p: Record<string, unknown>) => {
            if (p.model !== "gemini-2.5-flash")
              throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
            if (++lower === 1)
              throw Object.assign(new Error("This model is no longer available to new users"), {
                status: 404,
              });
            expect(JSON.stringify(p)).toContain("Write numbers and currency amounts as spoken words");
            return { text: '{"words":[{"text":"Hello","start":0.1,"end":0.5}]}' };
          },
        },
      }),
    },
  );
  const result = await listen(
    {
      asrPool: pool,
      cacheDir: root,
      asrSleep: async (ms) => {
        time += ms;
      },
    },
    Buffer.from("accounts"),
    "audio/mp4",
    "en",
    true,
  );
  expect(result.model).toBe("gemini-2.5-flash");
  expect(lower).toBe(2);
});
