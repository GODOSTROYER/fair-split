import { readJsonOr, writeJson } from "../util/json.js";

/**
 * Daily request ledger and pacer for Gemini (S4.6, ADR-0014). Requests go out on the user's Gemini keys,
 * round robin, each within its own free-tier limits (user decision, 1 Nov; ADR-0014). Google applies
 * limits per project and resets requests per day at midnight Pacific (ai.google.dev rate-limits page), so
 * every limit here is held per key: a minimum spacing per key per model, and a daily cap per key per
 * model per Pacific day. The pool's capacity is the sum; no single key goes over its own.
 *
 * Measured on 22 Oct 2026: the free tier allows 3 requests per minute for gemini-3.8-flash-tts (the 429
 * body says so). The daily limit is NOT known: Google does not publish it and the spike did not reach it.
 * Until a person reads it on the AI Studio rate-limit page (https://aistudio.google.com/rate-limit) and
 * records it with `tts set-limit`, each key is held to {@link SELF_IMPOSED_DAILY_CAP} per model, a guess
 * (S4.6's unverified third-party figure), never a measurement. The ledger never retries; the key pool
 * (`keys.ts`) moves a refused request to the next ready key.
 *
 * The file holds key ids only (first 8 hex of each key's sha256), never a key.
 */
export interface DayCounts {
  requests: number;
  ok: number;
  failed: number;
  rateLimited: number;
  latencyMs: number[];
  lastAt: string | null;
}

/** A key's requests to a model on a Pacific day. */
export interface KeyDayCounts {
  requests: number;
  ok: number;
  failed: number;
  rateLimited: number;
}

/** A key held back from one model after a 429: for the minute, or for the rest of the Pacific day. */
export interface KeyCooling {
  until: string;
  scope: "minute" | "day";
  /** The 429 message, scrubbed of every key. */
  message: string;
  at: string;
}

export interface KeyState {
  /** When this key last sent a request to each model (spacing holds across the Pacific day turnover). */
  lastAt: Record<string, string>;
  cooling: Record<string, KeyCooling>;
}

export interface ObservedLimit {
  rpm: number | null;
  message: string;
  at: string;
  keyId?: string;
}

export interface QuotaFile {
  v: 1;
  timeZone: "America/Los_Angeles";
  /** Requests per Pacific day per model that this tool will send at most, on each key. */
  caps: Record<string, number>;
  capsSource: string;
  /** The daily limit a person read in AI Studio, per model (absent while unknown). */
  dailyLimits?: Record<string, { value: number; source: string; at: string }>;
  /** Minimum spacing between two requests on the same key to the same model. */
  minIntervalMs: Record<string, number>;
  /** Limits read from 429 responses. */
  observed: Record<string, ObservedLimit>;
  /** Totals per Pacific day per model, over every key (the shape before the key pool). */
  days: Record<string, Record<string, DayCounts>>;
  /** Per Pacific day, per key id, per model (ADR-0014). Absent in files written before the key pool. */
  keyDays?: Record<string, Record<string, Record<string, KeyDayCounts>>>;
  /** Per key id: last request per model, and any cooling. */
  keys?: Record<string, KeyState>;
  /** The key id that requests counted before the key pool (1 Nov) are attributed to: GEMINI_API_KEY's. */
  legacyKey?: string;
}

/** A self-imposed ceiling while the real daily limit is unknown (S4.6: "≈10 requests a day, UNVERIFIED"). */
export const SELF_IMPOSED_DAILY_CAP = 10;
/** 3 requests per minute per key (measured) plus a margin. */
export const DEFAULT_MIN_INTERVAL_MS = 21_000;

export function emptyQuota(): QuotaFile {
  return {
    v: 1,
    timeZone: "America/Los_Angeles",
    caps: {},
    capsSource: `self-imposed ${SELF_IMPOSED_DAILY_CAP} per model per key per Pacific day (a guess, not a measured limit); a person reads the real figure in AI Studio and records it with tts set-limit`,
    minIntervalMs: {},
    observed: {},
    days: {},
  };
}

const PACIFIC = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific calendar day (YYYY-MM-DD) that a timestamp falls on. */
export function pacificDay(d: Date): string {
  return PACIFIC.format(d);
}

/** Reads "limit: 3 requests per minute" out of a 429 message. */
export function parseRpm(message: string): number | null {
  const m = /limit:\s*(\d+)\s*requests?\s*per\s*minute/i.exec(message);
  return m?.[1] ? Number(m[1]) : null;
}

/** Each key's daily cap for a model: the recorded AI Studio figure, or the self-imposed guess. */
export function capFor(q: QuotaFile, model: string): number {
  return q.caps[model] ?? SELF_IMPOSED_DAILY_CAP;
}

/** Minimum spacing between two requests on the same key to the same model. */
export function intervalFor(q: QuotaFile, model: string): number {
  return q.minIntervalMs[model] ?? DEFAULT_MIN_INTERVAL_MS;
}

export function keyCounts(q: QuotaFile, day: string, keyId: string, model: string): KeyDayCounts {
  return q.keyDays?.[day]?.[keyId]?.[model] ?? { requests: 0, ok: 0, failed: 0, rateLimited: 0 };
}

export class QuotaExceededError extends Error {
  constructor(model: string, cap: number, day: string, keyId?: string) {
    super(
      `Daily Gemini cap reached for ${model}${keyId ? ` on key ${keyId}` : ""}: ${cap} requests on ${day} (Pacific). Try after Pacific midnight.`,
    );
    this.name = "QuotaExceededError";
  }
}

export class QuotaLedger {
  constructor(
    readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async read(): Promise<QuotaFile> {
    return { ...emptyQuota(), ...(await readJsonOr<Partial<QuotaFile>>(this.path, {})) } as QuotaFile;
  }

  private counts(q: QuotaFile, model: string, day: string): DayCounts {
    q.days[day] ??= {};
    const byModel = q.days[day];
    byModel[model] ??= { requests: 0, ok: 0, failed: 0, rateLimited: 0, latencyMs: [], lastAt: null };
    return byModel[model];
  }

  private keyDay(q: QuotaFile, day: string, keyId: string, model: string): KeyDayCounts {
    q.keyDays ??= {};
    q.keyDays[day] ??= {};
    const byKey = q.keyDays[day];
    byKey[keyId] ??= {};
    const byModel = byKey[keyId];
    byModel[model] ??= { requests: 0, ok: 0, failed: 0, rateLimited: 0 };
    return byModel[model];
  }

  private keyState(q: QuotaFile, keyId: string): KeyState {
    q.keys ??= {};
    q.keys[keyId] ??= { lastAt: {}, cooling: {} };
    return q.keys[keyId];
  }

  /**
   * Files written before the key pool count requests per model only, all sent on GEMINI_API_KEY. This
   * attributes whatever the per-key counts do not cover to that key (once: afterwards they add up) and
   * carries the model's last request over as that key's, so its spacing and daily cap hold.
   */
  async attributeLegacy(keyId: string): Promise<void> {
    const q = await this.read();
    let changed = false;
    for (const [day, models] of Object.entries(q.days)) {
      for (const [model, totals] of Object.entries(models)) {
        const covered = { requests: 0, ok: 0, failed: 0, rateLimited: 0 };
        for (const byModel of Object.values(q.keyDays?.[day] ?? {})) {
          const c = byModel[model];
          if (!c) continue;
          covered.requests += c.requests;
          covered.ok += c.ok;
          covered.failed += c.failed;
          covered.rateLimited += c.rateLimited;
        }
        const rest = totals.requests - covered.requests;
        if (rest <= 0) continue;
        const k = this.keyDay(q, day, keyId, model);
        k.requests += rest;
        k.ok += Math.max(0, totals.ok - covered.ok);
        k.failed += Math.max(0, totals.failed - covered.failed);
        k.rateLimited += Math.max(0, totals.rateLimited - covered.rateLimited);
        const st = this.keyState(q, keyId);
        const last = st.lastAt[model];
        if (totals.lastAt && (!last || Date.parse(totals.lastAt) > Date.parse(last)))
          st.lastAt[model] = totals.lastAt;
        changed = true;
      }
    }
    if (changed) {
      q.legacyKey = keyId;
      await writeJson(this.path, q);
    }
  }

  /**
   * Waits until this key's minimum interval for the model has passed, then counts the request (on the key
   * and in the model's totals) before it is sent. Refuses once the key's daily cap for the model is
   * reached. Returns how long it waited, in milliseconds.
   */
  async reserve(model: string, keyId: string): Promise<number> {
    const before = await this.read();
    const last = before.keys?.[keyId]?.lastAt[model];
    const wait = last ? Date.parse(last) + intervalFor(before, model) - this.now().getTime() : 0;
    if (wait > 0) await this.sleep(wait);
    const q = await this.read();
    const day = pacificDay(this.now());
    const cap = capFor(q, model);
    const k = this.keyDay(q, day, keyId, model);
    if (k.requests >= cap) throw new QuotaExceededError(model, cap, day, keyId);
    const at = this.now().toISOString();
    k.requests += 1;
    this.keyState(q, keyId).lastAt[model] = at;
    const c = this.counts(q, model, day);
    c.requests += 1;
    c.lastAt = at;
    await writeJson(this.path, q);
    return Math.max(0, wait);
  }

  /** Records how a reserved request ended. `message` must already be scrubbed of every key. */
  async settle(
    model: string,
    keyId: string,
    outcome: { ok: boolean; rateLimited?: boolean; latencyMs?: number; message?: string },
  ): Promise<void> {
    const q = await this.read();
    const day = pacificDay(this.now());
    const c = this.counts(q, model, day);
    const k = this.keyDay(q, day, keyId, model);
    if (outcome.ok) {
      c.ok += 1;
      k.ok += 1;
    } else {
      c.failed += 1;
      k.failed += 1;
    }
    if (outcome.rateLimited) {
      c.rateLimited += 1;
      k.rateLimited += 1;
      if (outcome.message) {
        q.observed[model] = {
          rpm: parseRpm(outcome.message),
          message: outcome.message.slice(0, 300),
          at: this.now().toISOString(),
          keyId,
        };
      }
    }
    if (outcome.latencyMs !== undefined) c.latencyMs.push(outcome.latencyMs);
    await writeJson(this.path, q);
  }

  /** Holds a key back from a model until `cooling.until` (a 429 on that key). */
  async cool(keyId: string, model: string, cooling: KeyCooling): Promise<void> {
    const q = await this.read();
    this.keyState(q, keyId).cooling[model] = { ...cooling, message: cooling.message.slice(0, 300) };
    await writeJson(this.path, q);
  }

  /** Records the daily limit a person read in AI Studio and caps each key there for the model (never above it). */
  async setDailyLimit(model: string, value: number, source: string): Promise<void> {
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`a daily limit is a positive whole number: ${value}`);
    if (!source.trim())
      throw new Error("say where the figure was read (for example: AI Studio rate-limit page, 23 Oct)");
    const q = await this.read();
    q.dailyLimits = {
      ...(q.dailyLimits ?? {}),
      [model]: { value, source: source.trim(), at: this.now().toISOString() },
    };
    q.caps[model] = value;
    q.capsSource =
      "caps follow the daily limits a person read in AI Studio (dailyLimits), held on each key; models without one keep the self-imposed cap";
    await writeJson(this.path, q);
  }

  /** Today's totals for a model, over every key. */
  async today(model: string): Promise<DayCounts> {
    const q = await this.read();
    return this.counts(q, model, pacificDay(this.now()));
  }

  /** Today's counts for a key and model. */
  async keyToday(model: string, keyId: string): Promise<KeyDayCounts> {
    return keyCounts(await this.read(), pacificDay(this.now()), keyId, model);
  }
}
