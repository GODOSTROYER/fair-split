import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/tts/cli.js";
import { synthesize, TTS_MODEL } from "../src/tts/gemini.js";
import {
  classifyGeminiError,
  describeError,
  KeyPool,
  keyId,
  keysFromEnv,
  listModels,
  PoolExhaustedError,
  scrubSecrets,
} from "../src/tts/keys.js";
import { QuotaLedger } from "../src/tts/quota.js";
import { REPO_ROOT } from "../src/util/env.js";

// Never read the real .env or require an installed encoder for these offline CLI checks.
vi.mock("../src/util/env.js", async (original) => ({
  ...(await original<typeof import("../src/util/env.js")>()),
  loadEnv: vi.fn(),
}));
vi.mock("../src/tts/ffmpeg.js", async (original) => ({
  ...(await original<typeof import("../src/tts/ffmpeg.js")>()),
  hasFfmpeg: () => true,
}));

const fakeKey = (n: number) => ["offline", "regression", n, "standin".repeat(6)].join("-");
const keys = [fakeKey(1), fakeKey(2)];
const root = () => mkdtempSync(join(tmpdir(), "fs-tts-hardening-"));

// Assert booleans so a failure cannot make the test runner print a planted value.
function noFragments(text: string, secrets: readonly string[]) {
  for (const secret of secrets)
    for (let i = 0; i + 16 <= secret.length; i++) expect(text.includes(secret.slice(i, i + 16))).toBe(false);
}

describe("TTS reviewer regressions (offline)", () => {
  let output: string[];
  beforeEach(() => {
    output = [];
    const capture = (...args: unknown[]) => void output.push(args.map((x) => inspect(x)).join(" "));
    for (const method of ["log", "error", "warn", "debug", "info"] as const)
      vi.spyOn(console, method).mockImplementation(capture);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("disables shell SDK debugging before a real SDK client sends to a stubbed fetch", async () => {
    vi.stubEnv("GOOGLE_GENAI_DEBUG", "1");
    const fakeFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fakeFetch);
    const code = await main(["spike", "--langs", "en", "--draft-langs", ""], root(), { keys });
    expect(code).toBe(2); // Valid JSON with no audio, no encoder or real generation.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const text = output.join("\n");
    noFragments(text, keys);
    expect(process.env.GOOGLE_GENAI_DEBUG).toBeUndefined();
    expect(text).toContain("SDK debug logging is off because it prints keys");
  });

  it("removes debugging loaded from .env before returning keys", async () => {
    const { loadEnv } = await import("../src/util/env.js");
    vi.mocked(loadEnv).mockImplementationOnce(() => {
      process.env.GOOGLE_GENAI_DEBUG = "1";
    });
    vi.stubEnv("GOOGLE_GENAI_DEBUG", undefined);
    vi.stubEnv("GEMINI_API_KEY", keys[0]);
    vi.stubEnv("GEMINI_API_KEYS_FALLBACK", "");
    expect(keysFromEnv().length).toBe(1);
    expect(process.env.GOOGLE_GENAI_DEBUG).toBeUndefined();
  });

  it("keeps debugging off when .env enables it during a CLI spike with a malformed SDK response", async () => {
    const { loadEnv } = await import("../src/util/env.js");
    vi.mocked(loadEnv).mockImplementationOnce(() => {
      process.env.GOOGLE_GENAI_DEBUG = "1";
    });
    vi.stubEnv("GOOGLE_GENAI_DEBUG", undefined);
    vi.stubEnv("GEMINI_API_KEY", keys[0]);
    vi.stubEnv("GEMINI_API_KEYS_FALLBACK", keys[1]);
    const fragment = (keys[0] as string).slice(0, 10);
    const fakeFetch = vi.fn(
      async () =>
        new Response(fragment, {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fakeFetch);
    expect(await main(["spike", "--langs", "en", "--draft-langs", ""], root())).toBe(2);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const text = output.join("\n");
    noFragments(text, keys);
    expect(text.includes(fragment)).toBe(false);
    expect(text).toContain("unparseable response body");
    expect(text.match(/SDK debug logging is off/g)?.length).toBe(1);
    expect(process.env.GOOGLE_GENAI_DEBUG).toBeUndefined();
  });

  it("never echoes an unknown command containing a planted key", async () => {
    expect(await main([`unknown-${keys[0]}`], root(), { keys })).toBe(1);
    noFragments(output.join("\n"), keys);
    expect(output.join("\n")).toContain("unknown command");
  });

  it("drops malformed pool keys by id before constructing clients or sending requests", async () => {
    const malformed = ["\u0100", "\n", "\u007f", " "].map((c) => `${keys[0]}${c}${keys[1]}`);
    const made: string[] = [];
    const pool = new KeyPool([...malformed, keys[1] as string], {
      ledger: new QuotaLedger(join(root(), "quota.json")),
      makeClient: (key) => {
        made.push(keyId(key));
        return {};
      },
      log: (line) => output.push(line),
    });
    await pool.run(TTS_MODEL, async () => true);
    expect(made).toEqual([keyId(keys[1] as string)]);
    for (const key of malformed) {
      expect(pool.dropped().some((d) => d.id === keyId(key))).toBe(true);
      expect(output.join("\n")).toContain(keyId(key));
    }
    noFragments(output.join("\n"), [...keys, ...malformed]);
    const fetchStub = vi.fn(async () => new Response("{}"));
    const result = await listModels(malformed[0] as string, malformed, fetchStub);
    expect(result.ok).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it.each([
    "Cannot convert argument to a ByteString because the character has a value greater than 255",
    "Headers.append: invalid header value",
    "Invalid character in header content [x-goog-api-key]",
  ])("classifies a header TypeError as auth and drops that key: %s", async (message) => {
    expect(classifyGeminiError(new TypeError(message)).kind).toBe("auth");
    const pool = new KeyPool(keys, {
      ledger: new QuotaLedger(join(root(), "quota.json")),
      makeClient: () => ({}),
    });
    const result = await pool.run(TTS_MODEL, async (_client, id) => {
      if (id === keyId(keys[0] as string)) throw new TypeError(message);
      return true;
    });
    expect(result).toBe(true);
    expect(pool.dropped().map((d) => d.id)).toEqual([keyId(keys[0] as string)]);
    expect(classifyGeminiError(new TypeError("fetch failed")).kind).toBe("other");
  });

  it("replaces JSON parser snippets, including errors wrapped by TTS, before reporting", async () => {
    const fragment = (keys[0] as string).slice(0, 10);
    const error = new SyntaxError(`Unexpected token 'o', "${fragment}" is not valid JSON`);
    const described = describeError(new Error("request failed", { cause: error }), keys);
    expect(described.includes(fragment)).toBe(false);
    expect(described).toContain("unparseable response body");
    const pool = new KeyPool(keys, {
      ledger: new QuotaLedger(join(root(), "quota.json")),
      makeClient: () => ({
        interactions: {
          create: async () => {
            throw error;
          },
        },
      }),
    });
    const reported = await pool
      .run(TTS_MODEL, (client) =>
        synthesize(client, {
          model: TTS_MODEL,
          voice: "Sulafat",
          style: "calm",
          text: "hello",
        }),
      )
      .catch((e: unknown) => describeError(e, keys));
    expect(String(reported).includes(fragment)).toBe(false);
    expect(String(reported)).toContain("unparseable response body");
  });

  it("redacts short Google key shape prefixes", () => {
    const prefixes = [["AQ", ".", "abc123"].join(""), ["AI", "za", "xyz789"].join("")];
    const text = scrubSecrets(prefixes.join(" "), []);
    for (const prefix of prefixes) expect(text.includes(prefix)).toBe(false);
  });

  it("fails models.list on HTTP 200 with an unparseable body", async () => {
    const result = await listModels(keys[0] as string, keys, async () => new Response("broken"));
    expect(result).toMatchObject({ ok: false, status: 200, detail: "unparseable models.list body" });
  });

  it("ignores atomic JSON temp files in media/audio", () => {
    const result = spawnSync("git", ["check-ignore", "media/audio/spike-s10.json.123.tmp"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("plans without configured keys and without fetching, using an explicit capacity", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("network forbidden");
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEYS_FALLBACK", "");
    const media = root();
    expect(await main(["plan", "--keys", "12"], media)).toBe(0);
    const plan = JSON.parse(readFileSync(join(media, "audio", "spike-s10.json"), "utf8"));
    expect(plan.requestPlan.byModel[TTS_MODEL].pool.keys).toBe(12);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("plans without credentials or a count, disclosing its one-key assumption", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEYS_FALLBACK", "");
    const media = root();
    expect(await main(["plan"], media)).toBe(0);
    const plan = JSON.parse(readFileSync(join(media, "audio", "spike-s10.json"), "utf8"));
    expect(plan.requestPlan.byModel[TTS_MODEL].pool.keys).toBe(1);
    expect(output.join("\n")).toContain("assuming 1 key; use --keys <count>");
  });

  it("refuses concurrent reuse within spacing and recovers the mutex after exhaustion", async () => {
    let time = Date.parse("2026-11-01T17:00:00Z");
    const now = () => new Date(time);
    const ledger = new QuotaLedger(join(root(), "quota.json"), now);
    const pool = new KeyPool(keys.slice(0, 1), { ledger, now, maxWaitMs: 0, makeClient: () => ({}) });
    const results = await Promise.allSettled([
      pool.run(TTS_MODEL, async () => true),
      pool.run(TTS_MODEL, async () => true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason instanceof PoolExhaustedError).toBe(true);
    time += 21_000;
    expect(await pool.run(TTS_MODEL, async () => true)).toBe(true);
    expect(await ledger.today(TTS_MODEL)).toMatchObject({ requests: 2, ok: 2 });
  });

  it("reserves concurrent requests on distinct keys and conserves the ledger", async () => {
    const now = () => new Date("2026-11-01T17:00:00Z");
    const ledger = new QuotaLedger(join(root(), "quota.json"), now);
    const pool = new KeyPool(keys, { ledger, now, maxWaitMs: 0, makeClient: () => ({}) });
    const seen: string[] = [];
    let release = () => {};
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = () =>
      pool.run(TTS_MODEL, async (_client, id) => {
        seen.push(id);
        if (seen.length === 2) release();
        await bothStarted;
        return true;
      });
    await Promise.all([request(), request()]);
    expect(new Set(seen).size).toBe(2);
    expect(await ledger.today(TTS_MODEL)).toMatchObject({ requests: 2, ok: 2 });
    for (const key of keys)
      expect(await ledger.keyToday(TTS_MODEL, keyId(key))).toMatchObject({ requests: 1, ok: 1 });
  });

  it("returns PoolExhaustedError for a concurrent caller when the sole key hits its cap", async () => {
    const now = () => new Date("2026-11-01T17:00:00Z");
    const ledger = new QuotaLedger(join(root(), "quota.json"), now, async () => {});
    await ledger.setDailyLimit(TTS_MODEL, 1, "offline fixture");
    const pool = new KeyPool(keys.slice(0, 1), { ledger, now, maxWaitMs: 0, makeClient: () => ({}) });
    const results = await Promise.allSettled([
      pool.run(TTS_MODEL, async () => true),
      pool.run(TTS_MODEL, async () => true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason instanceof PoolExhaustedError).toBe(true);
  });
});
