import { readJsonOr, writeJson } from "../util/json.js";

/**
 * Daily request ledger and pacer for Gemini TTS (S4.6): one Google project and one key, never rotated;
 * limits are per project, and requests per day reset at midnight Pacific (ai.google.dev rate-limits page).
 *
 * Measured on 22 Oct 2026: the free tier allows 3 requests per minute for gemini-3.8-flash-tts (the 429
 * body says so); the daily limit is not published and was not reached. So every request is paced at
 * least `minIntervalMs` after the previous one for the same model, and `caps` is a self-imposed daily
 * ceiling until someone reads the AI Studio rate-limit page (https://aistudio.google.com/rate-limit).
 * The ledger never retries and never switches keys.
 */
export interface DayCounts {
  requests: number;
  ok: number;
  failed: number;
  rateLimited: number;
  latencyMs: number[];
  lastAt: string | null;
}

export interface ObservedLimit {
  rpm: number | null;
  message: string;
  at: string;
}

export interface QuotaFile {
  v: 1;
  timeZone: "America/Los_Angeles";
  /** Requests per Pacific day per model that this tool will send at most. */
  caps: Record<string, number>;
  capsSource: string;
  /** Minimum spacing between two requests to the same model. */
  minIntervalMs: Record<string, number>;
  /** Limits read from 429 responses. */
  observed: Record<string, ObservedLimit>;
  days: Record<string, Record<string, DayCounts>>;
}

export const DEFAULT_DAILY_CAP = 15;
/** 3 requests per minute (measured) plus a margin. */
export const DEFAULT_MIN_INTERVAL_MS = 21_000;

export function emptyQuota(): QuotaFile {
  return {
    v: 1,
    timeZone: "America/Los_Angeles",
    caps: {},
    capsSource: `self-imposed default of ${DEFAULT_DAILY_CAP} per model per Pacific day; replace with the AI Studio figure`,
    minIntervalMs: {},
    observed: {},
    days: {},
  };
}

/** The Pacific calendar day (YYYY-MM-DD) that a timestamp falls on. */
export function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Reads "limit: 3 requests per minute" out of a 429 message. */
export function parseRpm(message: string): number | null {
  const m = /limit:\s*(\d+)\s*requests?\s*per\s*minute/i.exec(message);
  return m?.[1] ? Number(m[1]) : null;
}

export class QuotaExceededError extends Error {
  constructor(model: string, cap: number, day: string) {
    super(
      `Daily TTS cap reached for ${model}: ${cap} requests on ${day} (Pacific). Try after Pacific midnight.`,
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

  /**
   * Waits until the model's minimum interval has passed, then counts the request before it is sent.
   * Refuses once the day's cap is reached. Returns how long it waited, in milliseconds.
   */
  async reserve(model: string): Promise<number> {
    const before = await this.read();
    const interval = before.minIntervalMs[model] ?? DEFAULT_MIN_INTERVAL_MS;
    const last = this.counts(before, model, pacificDay(this.now())).lastAt;
    const wait = last ? Date.parse(last) + interval - this.now().getTime() : 0;
    if (wait > 0) await this.sleep(wait);
    const q = await this.read();
    const day = pacificDay(this.now());
    const cap = q.caps[model] ?? DEFAULT_DAILY_CAP;
    const c = this.counts(q, model, day);
    if (c.requests >= cap) throw new QuotaExceededError(model, cap, day);
    c.requests += 1;
    c.lastAt = this.now().toISOString();
    await writeJson(this.path, q);
    return Math.max(0, wait);
  }

  async settle(
    model: string,
    outcome: { ok: boolean; rateLimited?: boolean; latencyMs?: number; message?: string },
  ): Promise<void> {
    const q = await this.read();
    const c = this.counts(q, model, pacificDay(this.now()));
    if (outcome.ok) c.ok += 1;
    else c.failed += 1;
    if (outcome.rateLimited) {
      c.rateLimited += 1;
      if (outcome.message) {
        q.observed[model] = {
          rpm: parseRpm(outcome.message),
          message: outcome.message.slice(0, 300),
          at: this.now().toISOString(),
        };
      }
    }
    if (outcome.latencyMs !== undefined) c.latencyMs.push(outcome.latencyMs);
    await writeJson(this.path, q);
  }

  async today(model: string): Promise<DayCounts> {
    const q = await this.read();
    return this.counts(q, model, pacificDay(this.now()));
  }
}
