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
  const deps = { asrPool: pool, cacheDir: root };
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
        { asrPool: pool, cacheDir: root },
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
    (await listen({ asrPool: pool, cacheDir: root }, Buffer.from("busy-fixture"), "audio/mp4", "en")).text,
  ).toBe("Hello");
  expect(calls).toBe(2);
  expect((await ledger.today(ASR_MODEL)).requests).toBe(2);
});
