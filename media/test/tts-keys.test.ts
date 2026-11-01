import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASR_MODEL } from "../src/tts/asr.js";
import { main } from "../src/tts/cli.js";
import {
  type InteractionsClient,
  MODEL_CHOICE,
  synthesize,
  TTS_DRAFT_MODEL,
  TTS_MODEL,
  TtsError,
} from "../src/tts/gemini.js";
import {
  checkKeys,
  classifyGeminiError,
  formatPoolStatus,
  GeminiCallError,
  KeyPool,
  keyId,
  keysFromEnv,
  nextPacificMidnight,
  PoolExhaustedError,
  parseKeyList,
  poolDisclosure,
  scrubSecrets,
} from "../src/tts/keys.js";
import { requestPlan } from "../src/tts/plan.js";
import {
  DEFAULT_MIN_INTERVAL_MS,
  pacificDay,
  QuotaLedger,
  SELF_IMPOSED_DAILY_CAP,
} from "../src/tts/quota.js";
import { MEDIA_ROOT, REPO_ROOT } from "../src/util/env.js";

// Planted stand-ins for real keys: built at run time so no file holds anything shaped like a Google key.
const planted = (n: number) =>
  ["planted", "gemini", "key", String(n).padStart(2, "0"), "x".repeat(24)].join("-");
const KEYS = Array.from({ length: 12 }, (_, i) => planted(i));
const IDS = KEYS.map(keyId);
const T0 = Date.parse("2026-11-01T17:00:00.000Z"); // 09:00 Pacific (PST from today)
const NEXT_MIDNIGHT = "2026-11-02T08:00:00.000Z";

/** A fake clock shared by the ledger and the pool; sleeping moves it forward. */
function clock(start = T0) {
  const c = {
    t: start,
    slept: [] as number[],
    now: () => new Date(c.t),
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

type Behaviour = (call: number) => unknown;
interface FakeClient {
  id: string;
}

/** A pool over planted keys with a fake client: each key id answers from its own script (default: ok). */
function harness(n: number, opts: { maxWaitMs?: number; dir?: string } = {}) {
  const c = clock();
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "fs-keypool-"));
  const ledger = new QuotaLedger(join(dir, ".quota.json"), c.now, c.sleep);
  const logs: string[] = [];
  const pool = new KeyPool<FakeClient>(KEYS.slice(0, n), {
    ledger,
    makeClient: (apiKey) => ({ id: keyId(apiKey) }),
    now: c.now,
    sleep: c.sleep,
    log: (l) => logs.push(l),
    ...(opts.maxWaitMs === undefined ? {} : { maxWaitMs: opts.maxWaitMs }),
  });
  const script = new Map<string, Behaviour>();
  const used: { id: string; at: number }[] = [];
  const request = (model: string = TTS_MODEL) =>
    pool.run(
      model,
      async (client, id) => {
        expect(client.id).toBe(id);
        const calls = used.filter((u) => u.id === id).length;
        used.push({ id, at: c.t });
        const b = script.get(id);
        const out = b ? b(calls) : { latencyMs: 5_000 };
        if (out instanceof Error) throw out;
        return out as { latencyMs: number };
      },
      { latencyMs: (r) => r.latencyMs },
    );
  return { c, dir, ledger, logs, pool, script, used, request };
}

const rpm429 = (extra = "") =>
  new TtsError(
    `TTS request failed (429): 429 Rate limit exceeded for model gemini-3.8-flash-tts (limit: 3 requests per minute on Free Tier). Please retry in 30s or upgrade your tier at https://ai.dev/rate-limit.${extra}`,
    429,
    true,
  );
const daily429 = () =>
  new TtsError(
    'TTS request failed (429): {"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 10","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"14s"}]}}',
    429,
    true,
  );

describe("key list from .env (ADR-0014)", () => {
  it("takes GEMINI_API_KEY first, then every comma-separated fallback, trimmed, deduped, without empties", () => {
    expect(parseKeyList("k-one", " k-two , ,k-one,k-three,k-two ,")).toEqual(["k-one", "k-two", "k-three"]);
    expect(parseKeyList(undefined, "a-key,b-key")).toEqual(["a-key", "b-key"]);
    expect(parseKeyList("  ", undefined)).toEqual([]);
    expect(
      keysFromEnv({ GEMINI_API_KEY: KEYS[0], GEMINI_API_KEYS_FALLBACK: KEYS.slice(1).join(",") }),
    ).toEqual(KEYS);
  });

  it("refuses an empty pool naming the variables, never a value", () => {
    expect(() => keysFromEnv({ GEMINI_API_KEY: "", GEMINI_API_KEYS_FALLBACK: " , " })).toThrow(
      /Missing GEMINI_API_KEY/,
    );
  });

  it("identifies a key only by the first 8 hex of its sha256", () => {
    expect(keyId("abc")).toBe("ba7816bf");
    expect(new Set(IDS).size).toBe(12);
    for (const id of IDS) expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("describes the pool honestly", () => {
    expect(poolDisclosure(12)).toBe(
      "the user's 12 Gemini keys, round robin, each within its own free-tier limits (user decision, 1 Nov; ADR-0014)",
    );
  });
});

describe("models: the highest-end free-tier ones (pricing page, 1 Nov)", () => {
  it("puts drafts on the same top free TTS model as finals, and the speech check on the top free audio-input text model", () => {
    expect(TTS_MODEL).toBe("gemini-3.8-flash-tts");
    expect(TTS_DRAFT_MODEL).toBe(TTS_MODEL);
    expect(ASR_MODEL).toBe("gemini-3.8-flash");
    expect(MODEL_CHOICE.source).toBe("https://ai.google.dev/gemini-api/docs/pricing");
    expect(MODEL_CHOICE.read).toBe("2026-11-01");
    expect(MODEL_CHOICE.notFree).toContain("gemini-2.5-pro-preview-tts");
  });

  it("keeps the request plan coherent: one pool of per-key caps shared by drafts and finals", () => {
    const p = requestPlan({ value: 10, source: "AI Studio" }, 10, { keys: 12 });
    expect(p.pool).toMatchObject({ keys: 12, perKeyDailyLimit: 10, poolDailyLimit: 120 });
    expect(p.pool.draftsShareCaps).toMatch(/drafts and finals/);
    expect(p.days.approvedPlanStatements).toBe(1);
    expect(p.daysAtSelfImposedCap).toMatchObject({
      approvedPlanStatements: 1,
      registerFullPlanStatements: 1,
    });
    expect(p.verdict).toMatch(/^FITS: 11 statement requests at 120 a day \(12 keys × 10 each\) take 1 day/);
    // One key behaves exactly as before.
    expect(requestPlan({ value: 10, source: "AI Studio" }, 10).verdict).toMatch(
      /^FITS: 11 statement requests at 10 a day take 2 day/,
    );
  });

  it("says nothing in media/src/tts about one key or never rotating", async () => {
    const dir = join(MEDIA_ROOT, "src", "tts");
    for (const f of await readdir(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/never rotat|one key|one Google project|never switches keys/i);
    }
  });
});

describe("round robin with per-key limits", () => {
  it("hands out all 12 keys in turn: 12 requests, 12 keys, no waiting", async () => {
    const h = harness(12);
    for (let i = 0; i < 12; i++) await h.request();
    expect(h.used.map((u) => u.id)).toEqual(IDS);
    expect(h.c.slept).toEqual([]);
    expect(h.pool.size).toBe(12);
    expect(h.pool.ids()).toEqual(IDS);
  });

  it("keeps the rotation order and spaces each key so no key sends more than 3 a minute", async () => {
    const h = harness(3);
    for (let i = 0; i < 10; i++) await h.request();
    expect(h.used.map((u) => u.id)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0].map((i) => IDS[i]));
    for (const id of IDS.slice(0, 3)) {
      const at = h.used.filter((u) => u.id === id).map((u) => u.at);
      for (let i = 1; i < at.length; i++)
        expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(DEFAULT_MIN_INTERVAL_MS);
      for (let i = 3; i < at.length; i++)
        expect((at[i] as number) - (at[i - 3] as number)).toBeGreaterThan(60_000);
    }
  });

  it("caps each key per model per Pacific day; the pool's capacity is the sum", async () => {
    const h = harness(3);
    await h.ledger.setDailyLimit(TTS_MODEL, 2, "test figure");
    for (let i = 0; i < 6; i++) await h.request();
    expect(h.used.map((u) => u.id)).toEqual([0, 1, 2, 0, 1, 2].map((i) => IDS[i]));
    const err = await h.request().catch((e) => e);
    expect(err).toBeInstanceOf(PoolExhaustedError);
    expect((err as PoolExhaustedError).readyAt?.toISOString()).toBe(NEXT_MIDNIGHT);
    expect((err as Error).message).toContain(NEXT_MIDNIGHT);
    expect((err as Error).message).toMatch(/device voice/);
    expect(h.used).toHaveLength(6);
    const q = await h.ledger.read();
    const day = pacificDay(h.c.now());
    for (const id of IDS.slice(0, 3)) expect(q.keyDays?.[day]?.[id]?.[TTS_MODEL]?.requests).toBe(2);
    expect(q.days[day]?.[TTS_MODEL]?.requests).toBe(6);
    // Another model has its own caps on the same keys.
    await h.request(ASR_MODEL);
    expect(h.used.at(-1)?.id).toBe(IDS[0]);
  });
});

describe("failover", () => {
  it("cools a key on a per-minute 429 (using the retry delay) and moves the request to the next key", async () => {
    const h = harness(3);
    h.script.set(IDS[0] as string, (n) => (n === 0 ? rpm429() : { latencyMs: 4_000 }));
    const r = await h.request();
    expect(r).toEqual({ latencyMs: 5_000 });
    expect(h.used.map((u) => u.id)).toEqual([IDS[0], IDS[1]]);
    const q = await h.ledger.read();
    expect(q.keys?.[IDS[0] as string]?.cooling[TTS_MODEL]).toMatchObject({
      scope: "minute",
      until: new Date(T0 + 31_000).toISOString(),
    });
    expect(q.observed[TTS_MODEL]?.rpm).toBe(3);
    const day = pacificDay(h.c.now());
    expect(q.keyDays?.[day]?.[IDS[0] as string]?.[TTS_MODEL]).toMatchObject({
      requests: 1,
      failed: 1,
      rateLimited: 1,
    });
    expect(h.logs.join("\n")).toMatch(new RegExp(`key ${IDS[0]} rate-limited .*cooling until`));
    // The rotation goes on: key 2, then key 1 once its spacing has passed (key 0 still cools).
    await h.request();
    await h.request();
    expect(h.used.map((u) => u.id)).toEqual([IDS[0], IDS[1], IDS[2], IDS[1]]);
    // Once the cooling is over, key 0 takes requests again.
    await h.request();
    expect(h.used.at(-1)?.id).toBe(IDS[2]);
    await h.request();
    expect(h.used.at(-1)?.id).toBe(IDS[0]);
  });

  it("cools a key until Pacific midnight on a daily 429", async () => {
    const h = harness(2);
    h.script.set(IDS[0] as string, () => daily429());
    await h.request();
    const q = await h.ledger.read();
    expect(q.keys?.[IDS[0] as string]?.cooling[TTS_MODEL]).toMatchObject({
      scope: "day",
      until: NEXT_MIDNIGHT,
    });
    for (let i = 0; i < 3; i++) await h.request();
    expect(h.used.slice(1).every((u) => u.id === IDS[1])).toBe(true);
  });

  it("drops a refused key (401/403/PERMISSION_DENIED/API_KEY_INVALID) for the run and reports it by id", async () => {
    const h = harness(4);
    h.script.set(IDS[1] as string, () =>
      Object.assign(
        new Error(`[403 Forbidden] PERMISSION_DENIED: Method doesn't allow unregistered callers ${KEYS[1]}`),
        {
          status: 403,
        },
      ),
    );
    h.script.set(IDS[2] as string, () =>
      Object.assign(
        new Error(
          `{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}`,
        ),
        { status: 400 },
      ),
    );
    for (let i = 0; i < 4; i++) await h.request();
    expect(h.pool.dropped().map((d) => d.id)).toEqual([IDS[1], IDS[2]]);
    expect(h.pool.dropped()[0]?.reason).toMatch(/403/);
    expect(h.logs.join("\n")).toContain(`key ${IDS[1]} dropped for this run`);
    // Later requests never go to a dropped key.
    for (let i = 0; i < 4; i++) await h.request();
    const after = h.used.slice(4).map((u) => u.id);
    expect(after).not.toContain(IDS[1]);
    expect(after).not.toContain(IDS[2]);
  });

  it("does not move other errors to another key: it settles the request as failed and throws, scrubbed", async () => {
    const h = harness(2);
    h.script.set(IDS[0] as string, () =>
      Object.assign(
        new Error(`503 UNAVAILABLE at https://generativelanguage.googleapis.com/v1beta?key=${KEYS[0]}`),
        {
          status: 503,
        },
      ),
    );
    const err = await h.request().catch((e) => e);
    expect(err).toBeInstanceOf(GeminiCallError);
    expect(err).toMatchObject({ status: 503, kind: "other", keyId: IDS[0] });
    expect((err as Error).message).not.toContain(KEYS[0]);
    expect(h.used).toHaveLength(1);
  });

  it("waits for the next ready key when that is within a few minutes", async () => {
    const h = harness(2);
    h.script.set(IDS[0] as string, (n) => (n === 0 ? rpm429() : { latencyMs: 1 }));
    h.script.set(IDS[1] as string, (n) => (n === 0 ? rpm429() : { latencyMs: 1 }));
    const r = await h.request();
    expect(r).toEqual({ latencyMs: 1 });
    // Both cooled for 31 s; the pool slept until key 0 was ready again, and logged that it waited.
    expect(h.c.slept.reduce((s, x) => s + x, 0)).toBe(31_000);
    expect(h.used.map((u) => u.id)).toEqual([IDS[0], IDS[1], IDS[0]]);
    expect(h.logs.join("\n")).toMatch(/waiting 31 s/);
  });

  it("stops cleanly, naming the reset time, when every key is exhausted for longer than that", async () => {
    const h = harness(2, { maxWaitMs: 5 * 60_000 });
    h.script.set(IDS[0] as string, () => daily429());
    h.script.set(IDS[1] as string, () => daily429());
    const err = await h.request().catch((e) => e);
    expect(err).toBeInstanceOf(PoolExhaustedError);
    expect((err as PoolExhaustedError).readyAt?.toISOString()).toBe(NEXT_MIDNIGHT);
    expect((err as Error).message).toMatch(/00:00 Pacific/);
    expect(h.c.slept).toEqual([]);
    // A fresh request does not touch the network at all.
    await h.request().catch(() => undefined);
    expect(h.used).toHaveLength(2);
  });

  it("stops when every key was refused", async () => {
    const h = harness(2);
    const refuse = () => Object.assign(new Error("401 UNAUTHENTICATED"), { status: 401 });
    h.script.set(IDS[0] as string, refuse);
    h.script.set(IDS[1] as string, refuse);
    const err = await h.request().catch((e) => e);
    expect(err).toBeInstanceOf(PoolExhaustedError);
    expect((err as Error).message).toMatch(/refused/);
    expect((err as Error).message).toContain(IDS[0]);
  });

  it("escalates a key that keeps hitting an unexplained 429 to the rest of the day", async () => {
    const h = harness(1);
    h.script.set(
      IDS[0] as string,
      () => new TtsError("TTS request failed (429): Resource has been exhausted", 429, true),
    );
    const err = await h.request().catch((e) => e);
    expect(err).toBeInstanceOf(PoolExhaustedError);
    expect(h.used).toHaveLength(3);
    const q = await h.ledger.read();
    expect(q.keys?.[IDS[0] as string]?.cooling[TTS_MODEL]?.scope).toBe("day");
  });

  it("classifies Gemini errors", () => {
    expect(classifyGeminiError(rpm429())).toMatchObject({
      kind: "rate",
      scope: "minute",
      retryDelayMs: 30_000,
    });
    expect(classifyGeminiError(daily429())).toMatchObject({
      kind: "rate",
      scope: "day",
      retryDelayMs: 14_000,
    });
    expect(classifyGeminiError(Object.assign(new Error("x"), { status: 401 }))).toMatchObject({
      kind: "auth",
    });
    expect(classifyGeminiError(new Error("API_KEY_INVALID"))).toMatchObject({ kind: "auth" });
    expect(classifyGeminiError(new TtsError("TTS response carried no audio", null, false))).toMatchObject({
      kind: "other",
      status: null,
    });
  });
});

describe("Pacific day turnover", () => {
  it("finds the next Pacific midnight, across the end of daylight saving", () => {
    expect(nextPacificMidnight(new Date(T0)).toISOString()).toBe(NEXT_MIDNIGHT);
    expect(nextPacificMidnight(new Date("2026-11-01T06:00:00Z")).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(nextPacificMidnight(new Date("2026-11-01T07:00:00Z")).toISOString()).toBe(NEXT_MIDNIGHT);
  });
});

describe("ledger per key", () => {
  it("loads the old single-key file and attributes its requests to GEMINI_API_KEY (the first key)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-keypool-old-"));
    const day = pacificDay(new Date(T0));
    const old = {
      v: 1,
      timeZone: "America/Los_Angeles",
      caps: {},
      capsSource: "self-imposed",
      minIntervalMs: {},
      observed: {},
      days: {
        [day]: {
          [TTS_MODEL]: {
            requests: 3,
            ok: 2,
            failed: 1,
            rateLimited: 1,
            latencyMs: [9_000, 8_000],
            lastAt: new Date(T0 - 10_000).toISOString(),
          },
        },
      },
    };
    writeFileSync(join(dir, ".quota.json"), JSON.stringify(old));
    const h = harness(2, { dir });
    expect((await h.ledger.read()).days[day]?.[TTS_MODEL]?.requests).toBe(3);
    await h.request();
    // The first key sent a request 10 s ago, so its spacing holds and key 2 takes this one.
    expect(h.used.map((u) => u.id)).toEqual([IDS[1]]);
    const q = await h.ledger.read();
    expect(q.legacyKey).toBe(IDS[0]);
    expect(q.keyDays?.[day]?.[IDS[0] as string]?.[TTS_MODEL]).toEqual({
      requests: 3,
      ok: 2,
      failed: 1,
      rateLimited: 1,
    });
    expect(q.keyDays?.[day]?.[IDS[1] as string]?.[TTS_MODEL]).toEqual({
      requests: 1,
      ok: 1,
      failed: 0,
      rateLimited: 0,
    });
    expect(q.days[day]?.[TTS_MODEL]).toMatchObject({ requests: 4, ok: 3, latencyMs: [9_000, 8_000, 5_000] });
    // Attribution happens once.
    await h.request();
    expect((await h.ledger.read()).keyDays?.[day]?.[IDS[0] as string]?.[TTS_MODEL]?.requests).toBe(4);
  });

  it("shows each key id's used and remaining per model, and the pool total", async () => {
    const h = harness(3);
    await h.request();
    await h.request();
    await h.request(ASR_MODEL);
    const s = await h.pool.status([TTS_MODEL, ASR_MODEL]);
    expect(s.keys.map((k) => k.id)).toEqual(IDS.slice(0, 3));
    expect(s.keys[0]?.models[TTS_MODEL]).toMatchObject({
      used: 1,
      cap: SELF_IMPOSED_DAILY_CAP,
      remaining: 9,
    });
    expect(s.keys[2]?.models[ASR_MODEL]).toMatchObject({ used: 1, remaining: 9 });
    expect(s.total[TTS_MODEL]).toEqual({ used: 2, cap: 30, remaining: 28 });
    const text = formatPoolStatus(s);
    for (const id of IDS.slice(0, 3)) expect(text).toContain(id);
    expect(text).toMatch(/pool total\s+2 used, 28 remaining of 30/);
    expect(text).toContain(poolDisclosure(3));
  });
});

describe("no key value leaves memory", () => {
  let out: string[] = [];
  beforeEach(() => {
    out = [];
    const keep = (...a: unknown[]) =>
      void out.push(a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" "));
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
  });
  afterEach(() => vi.restoreAllMocks());

  it("scrubs every planted key from logs, errors, the ledger, the status output and the pool itself", async () => {
    const h = harness(4);
    const shaped = ["AI", "za", "S".repeat(35)].join(""); // a Google-shaped key that is not in the pool
    h.script.set(IDS[0] as string, () => rpm429(` key=${KEYS[0]} ${shaped}`));
    h.script.set(IDS[1] as string, () =>
      Object.assign(new Error(`403 PERMISSION_DENIED for ${KEYS[1]} (also ${KEYS[3]})`), { status: 403 }),
    );
    h.script.set(IDS[2] as string, () =>
      Object.assign(
        new Error(`500 INTERNAL https://generativelanguage.googleapis.com/v1beta/models?key=${KEYS[2]}`),
        {
          status: 500,
          request: { headers: { "x-goog-api-key": KEYS[2] } },
        },
      ),
    );
    const errors: unknown[] = [];
    for (let i = 0; i < 3; i++) await h.request().catch((e) => errors.push(e));
    const status = await h.pool.status([TTS_MODEL]);
    const texts = [
      ...h.logs,
      ...errors.flatMap((e) => [
        String(e),
        (e as Error).stack ?? "",
        JSON.stringify(e),
        inspect(e, { depth: 8 }),
      ]),
      readFileSync(join(h.dir, ".quota.json"), "utf8"),
      formatPoolStatus(status),
      JSON.stringify(status),
      JSON.stringify(h.pool),
      inspect(h.pool, { depth: 8, showHidden: true }),
      String(h.pool),
    ];
    expect(errors.length).toBeGreaterThan(0);
    const all = texts.join("\n");
    for (const k of KEYS) expect(all).not.toContain(k);
    expect(all).not.toContain(shaped);
    expect(scrubSecrets(`a ${KEYS[0]} b ${shaped} c ?key=abcdefgh123`, [KEYS[0] as string])).toBe(
      `a key:${IDS[0]} b [redacted key] c ?key=[redacted]`,
    );
  });

  it("tts quota prints per-key ids and the pool total, never a value", async () => {
    const media = mkdtempSync(join(tmpdir(), "fs-tts-cli-"));
    mkdirSync(join(media, "audio"), { recursive: true });
    expect(await main(["quota"], media, { keys: KEYS })).toBe(0);
    const text = out.join("\n");
    for (const id of IDS) expect(text).toContain(id);
    expect(text).toContain(poolDisclosure(12));
    expect(text).toMatch(/pool total/);
    for (const k of KEYS) expect(text).not.toContain(k);
  });

  it("tts keys checks every key with the free models.list call (key in the x-goog-api-key header) and prints ids", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("x-goog-api-key");
      seen.push({ url: String(url), key });
      if (key === KEYS[1]) {
        return new Response(
          JSON.stringify({
            error: { code: 400, status: "INVALID_ARGUMENT", message: `API key not valid ${key}` },
          }),
          {
            status: 400,
          },
        );
      }
      if (key === KEYS[2]) throw new Error(`connect ECONNRESET ${key}`);
      return new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-3.8-flash-tts" }, { name: "models/gemini-3.8-flash" }],
        }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const results = await checkKeys(KEYS.slice(0, 3), fakeFetch);
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      [IDS[0], true],
      [IDS[1], false],
      [IDS[2], false],
    ]);
    expect(results[0]).toMatchObject({ status: 200, tts: true, asr: true });
    expect(results[1]?.detail).toMatch(/400/);
    for (const s of seen) {
      expect(s.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
      for (const k of KEYS) expect(s.url).not.toContain(k);
    }
    expect(seen.map((s) => s.key)).toEqual(KEYS.slice(0, 3));
    expect(JSON.stringify(results)).not.toMatch(/planted-gemini-key/);
    const media = mkdtempSync(join(tmpdir(), "fs-tts-cli-"));
    expect(await main(["keys"], media, { keys: KEYS.slice(0, 3), fetch: fakeFetch })).toBe(2);
    const text = out.join("\n");
    for (const id of IDS.slice(0, 3)) expect(text).toContain(id);
    for (const k of KEYS) expect(text).not.toContain(k);
  });
});

describe("no key value leaves memory: tts models, the entry point, truncation and odd keys", () => {
  let out: string[] = [];
  beforeEach(() => {
    out = [];
    const keep = (...a: unknown[]) =>
      void out.push(a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" "));
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Built at run time: a planted Google-shaped key (the AQ. form) that is not real.
  const shapedKey = (word: string) => ["AQ", ".", word.repeat(8)].join("");
  /** Every 16-character piece of a key: a truncated message must not keep part of one either. */
  const expectNoKey = (text: string, keys: readonly string[]) => {
    for (const k of keys)
      for (let i = 0; i + 16 <= k.length; i++) expect(text).not.toContain(k.slice(i, i + 16));
  };
  /** A suspended key's answer: Google's CONSUMER_SUSPENDED message names the key. */
  const suspended = (key: string | null) =>
    new Response(
      JSON.stringify({
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message: `Permission denied: Consumer 'api_key:${key}' has been suspended.`,
          details: [{ reason: "CONSUMER_SUSPENDED" }],
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

  it("tts models lists with the key in the x-goog-api-key header; a refused key's echo never reaches the output", async () => {
    const google = shapedKey("Pl4nted");
    const seen: { url: string; key: string | null }[] = [];
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const key = new Headers(init?.headers ?? req?.headers).get("x-goog-api-key");
      seen.push({ url: req ? req.url : String(input), key });
      if (key === google) return suspended(key);
      if (key === KEYS[1])
        throw new TypeError(`fetch failed for x-goog-api-key ${key}`, {
          cause: new Error(`getaddrinfo ENOTFOUND generativelanguage.googleapis.com ${key}`),
        });
      return new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-3.8-flash-tts", displayName: "Gemini 3.8 Flash TTS" },
            { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    // Stub the global too, so no path (the SDK's own fetch included) can reach the network.
    vi.stubGlobal("fetch", fake);
    const media = mkdtempSync(join(tmpdir(), "fs-tts-models-"));
    expect(await main(["models"], media, { keys: [google, KEYS[0] as string], fetch: fake })).toBe(2);
    expect(await main(["models"], media, { keys: [KEYS[1] as string, KEYS[0] as string], fetch: fake })).toBe(
      2,
    );
    const failed = out.join("\n");
    expect(failed).toContain(keyId(google));
    expect(failed).toContain(IDS[1]);
    expect(failed).toMatch(/403/);
    expectNoKey(failed, [google, ...KEYS]);
    out = [];
    expect(await main(["models"], media, { keys: [KEYS[0] as string], fetch: fake })).toBe(0);
    expect(out.join("\n")).toBe(
      "tts: SDK debug logging is off because it prints keys\nmodels/gemini-3.8-flash-tts  Gemini 3.8 Flash TTS",
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const s of seen) {
      expect(s.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
      for (const k of [google, ...KEYS]) expect(s.url).not.toContain(k);
      expect(s.key).not.toBeNull();
    }
  });

  it("main never rethrows: an unexpected failure prints one scrubbed line and returns 1", async () => {
    // A media root whose path holds a key, and a file where audio/ belongs: the file-system error names the
    // path, so it names the key.
    const media = join(mkdtempSync(join(tmpdir(), "fs-tts-fatal-")), KEYS[0] as string);
    mkdirSync(media);
    writeFileSync(join(media, "audio"), "a file where the audio directory belongs");
    expect(
      await main(["set-limit", TTS_MODEL, "5", "--source", "AI Studio"], media, {
        keys: [KEYS[0] as string],
      }),
    ).toBe(1);
    const text = out.join("\n");
    expect(text).toContain(`key:${IDS[0]}`);
    expectNoKey(text, KEYS);
  });

  it("tts set-limit never writes a key into the ledger, even one pasted into --source", async () => {
    const media = mkdtempSync(join(tmpdir(), "fs-tts-limit-"));
    mkdirSync(join(media, "audio"));
    const source = `AI Studio rate-limit page, 1 Nov, project of ${KEYS[2]}`;
    expect(await main(["set-limit", TTS_MODEL, "50", "--source", source], media, { keys: KEYS })).toBe(0);
    const ledger = readFileSync(join(media, "audio", ".quota.json"), "utf8");
    expect(ledger).toContain(`key:${IDS[2]}`);
    expectNoKey(`${ledger}\n${out.join("\n")}`, KEYS);
  });

  it("scrubs a key before any truncation: an SDK error with the key on the 400-character boundary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-keypool-trunc-"));
    const logs: string[] = [];
    const client: InteractionsClient = {
      interactions: {
        create: async () => {
          throw Object.assign(new Error(`${"y".repeat(371)}${KEYS[5]} internal`), { status: 500 });
        },
      },
    };
    const pool = new KeyPool<InteractionsClient>([KEYS[5] as string], {
      ledger: new QuotaLedger(join(dir, ".quota.json")),
      makeClient: () => client,
      log: (l) => logs.push(l),
    });
    const err = await pool
      .run(TTS_MODEL, (c) =>
        synthesize(c, { model: TTS_MODEL, voice: "Sulafat", style: "calm", text: "hello" }),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiCallError);
    const texts = [
      String(err),
      (err as Error).stack ?? "",
      inspect(err, { depth: 8 }),
      ...logs,
      readFileSync(join(dir, ".quota.json"), "utf8"),
    ].join("\n");
    expect(texts).toContain(`key:${IDS[5]}`);
    expectNoKey(texts, KEYS);
  });

  it("scrubs short keys, a key inside a longer one, and escaped, encoded or split forms", () => {
    const short = "zq12ab";
    expect(scrubSecrets(`API key not valid: ${short}`, [short])).toBe(
      `API key not valid: key:${keyId(short)}`,
    );
    const outer = `XX${KEYS[0]}YY`;
    expect(scrubSecrets(`a ${outer} b ${KEYS[0]}`, [KEYS[0] as string, outer])).toBe(
      `a key:${keyId(outer)} b key:${IDS[0]}`,
    );
    const split = `${KEYS[3]}\n${KEYS[4]}`; // a key with a line break pasted inside it
    const spaced = `planted key/${"z".repeat(20)}`;
    const text = [
      JSON.stringify({ message: `bad ${split}` }),
      `header ${split}`,
      `wrapped ${KEYS[3]} ... ${KEYS[4]}`,
      `?q=${encodeURIComponent(spaced)}`,
      `x ${spaced}`,
    ].join("\n");
    const scrubbed = scrubSecrets(text, [split, spaced]);
    expect(scrubbed).toContain(`key:${keyId(split)}`);
    expectNoKey(scrubbed, [KEYS[3] as string, KEYS[4] as string]);
    expect(scrubbed).not.toContain("z".repeat(16));
  });

  it("tools/tts.ts exits nonzero with a scrubbed line when Google echoes the key (fetch stubbed, no network)", () => {
    const google = shapedKey("Ch1ldK3y");
    const dir = mkdtempSync(join(tmpdir(), "fs-tts-entry-"));
    const stub = join(dir, "stub-fetch.mjs");
    // The stub holds no key: it echoes whichever key the request carries, as a suspended key's 403 does.
    writeFileSync(
      stub,
      [
        "globalThis.fetch = async (input, init) => {",
        '  const key = new Headers(init?.headers ?? input?.headers).get("x-goog-api-key");',
        '  const message = "Permission denied: Consumer \'api_key:" + key + "\' has been suspended.";',
        "  const body = { error: { code: 403, status: 'PERMISSION_DENIED', message } };",
        "  return new Response(JSON.stringify(body), { status: 403, headers: { 'content-type': 'application/json' } });",
        "};",
        "",
      ].join("\n"),
    );
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "--import", pathToFileURL(stub).href, join(REPO_ROOT, "tools", "tts.ts"), "models"],
      {
        cwd: MEDIA_ROOT,
        encoding: "utf8",
        timeout: 60_000,
        // Both Gemini variables are set, so the repo-root .env (which never overrides) adds no real key.
        env: { ...process.env, GEMINI_API_KEY: google, GEMINI_API_KEYS_FALLBACK: KEYS[6] as string },
      },
    );
    const text = `${r.stdout}\n${r.stderr}`;
    expect(r.status).toBe(2);
    expect(text).toContain(keyId(google));
    expectNoKey(text, [google, ...KEYS]);
  });
});
