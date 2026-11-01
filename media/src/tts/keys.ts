/**
 * The Gemini key pool (ADR-0014): the user's Gemini keys, round robin, each within its own free-tier
 * limits (user decision, 1 Nov: "it's allowed for this, do it use all 12 keys round robin").
 *
 * - Keys come from the gitignored repo-root `.env` only: GEMINI_API_KEY first, then every comma-separated
 *   value of GEMINI_API_KEYS_FALLBACK (trimmed, deduped, empties dropped). They stay in memory, in private
 *   fields; everything outside this module (logs, errors, the ledger, status output) names a key only by
 *   its id, the first 8 hex of its sha256.
 * - Each request takes the next ready key in turn. Google applies free-tier limits per project, so the
 *   ledger (quota.ts) holds every limit per key: a minimum spacing per key per model (3 requests a minute,
 *   measured) and a daily cap per key per model per Pacific day. The pool's capacity is the sum of the
 *   keys' own limits; no single key goes over its own.
 * - A 429 or RESOURCE_EXHAUSTED cools that key for the minute (per-minute limit) or until Pacific midnight
 *   (daily limit), using any retry delay the error gives, and the request moves to the next ready key. A
 *   401, 403, PERMISSION_DENIED or API_KEY_INVALID drops that key for the run and reports its id. When
 *   every key is spaced, cooling, capped or dropped, the pool waits for the next ready key if that is
 *   within a few minutes, and otherwise stops with a message naming the reset time (statements without a
 *   clip fall back to the labelled device voice).
 * - Free tier only: the pool never enables or relies on billing.
 */

import { loadEnv } from "../util/env.js";
import { sha256 } from "../util/hash.js";
import { ASR_MODEL } from "./asr.js";
import { TTS_MODEL } from "./gemini.js";
import { capFor, intervalFor, keyCounts, pacificDay, type QuotaFile, type QuotaLedger } from "./quota.js";

/** How long the pool waits for the next ready key before it stops instead. */
export const DEFAULT_MAX_WAIT_MS = 5 * 60_000;
/** Cooling after a per-minute 429 that gives no retry delay. */
export const MINUTE_COOLING_MS = 60_000;
/** Added to every cooling, so a key is never retried on the boundary. */
export const COOLING_MARGIN_MS = 1_000;
/** Consecutive 429s on the same key and model before it is held for the rest of the Pacific day. */
export const RATE_LIMIT_STREAK_FOR_DAY = 3;

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** A key's only public name: the first 8 hex of its sha256. */
export function keyId(value: string): string {
  return sha256(value).slice(0, 8);
}

/** GEMINI_API_KEY first, then each comma-separated fallback; trimmed, deduped, without empties. */
export function parseKeyList(primary: string | undefined, fallback: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of [primary ?? "", ...(fallback ?? "").split(",")]) {
    const k = raw.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The pool's keys from the repo-root `.env` (or the given variables). The error names variables only. */
export function keysFromEnv(env?: Readonly<Record<string, string | undefined>>): string[] {
  if (!env) loadEnv();
  // loadEnv can reintroduce the flag from .env after main cleared the shell's value.
  delete process.env.GOOGLE_GENAI_DEBUG;
  const e = env ?? process.env;
  const keys = parseKeyList(e.GEMINI_API_KEY, e.GEMINI_API_KEYS_FALLBACK);
  if (!keys.length)
    throw new Error(
      "Missing GEMINI_API_KEY (and GEMINI_API_KEYS_FALLBACK): add them to the repo-root .env (never commit it).",
    );
  return keys;
}

/** The honest one-line description of where Gemini requests go. */
export function poolDisclosure(n: number): string {
  return `the user's ${n} Gemini key${n === 1 ? "" : "s"}, round robin, each within its own free-tier limits (user decision, 1 Nov; ADR-0014)`;
}

/** The pool's keys for scrubbing output, or none when `.env` has none (the shape patterns still apply). */
export function keysForScrubbing(): string[] {
  try {
    return keysFromEnv();
  } catch {
    return [];
  }
}

const GOOGLE_KEY_SHAPES = [/AIza[0-9A-Za-z_-]{3,}/g, /AQ\.[A-Za-z0-9_-]{3,}/g];

function validKey(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value);
}

/**
 * The ways a key can appear in text: as is, JSON-escaped, URL-encoded, and, for a key with whitespace or a
 * control character inside it (a paste error), each piece of 8 or more characters between them.
 */
function secretForms(s: string): string[] {
  const forms = new Set([s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s)]);
  for (const piece of s.split(/[\s\p{Cc}]+/u)) if (piece.length >= 8) forms.add(piece);
  return [...forms];
}

/**
 * Replaces each known key, of any length and in any of its forms, with `key:<id>`; anything shaped like a
 * Google key with `[redacted key]`; and any `key=` query value or `x-goog-api-key` header value with
 * `[redacted]`. Scrub before shortening a message: a cut key no longer matches.
 */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  // Longest first, so a key that holds another key is replaced whole, not around the shorter one.
  const forms = secrets
    .filter((s) => s.length > 0)
    .flatMap((s) => {
      const label = `key:${keyId(s)}`;
      return secretForms(s).map((form) => ({ form, label }));
    })
    .sort((a, b) => b.form.length - a.form.length);
  // V8 quotes a slice of a malformed JSON body; it can be too short to match a known key.
  let out = text.replace(/Unexpected token[^\r\n]*?is not valid JSON/g, "unparseable response body");
  for (const { form, label } of forms) out = out.split(form).join(label);
  for (const p of GOOGLE_KEY_SHAPES) out = out.replace(p, "[redacted key]");
  out = out.replace(/([?&]key=)[^&\s"'<>]+/gi, "$1[redacted]");
  out = out.replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]");
  return out;
}

function plain(v: unknown): string {
  try {
    return String(v);
  } catch {
    return typeof v;
  }
}

/** An error's name and message, then its causes', on one line. Raw: scrub it before it goes anywhere. */
function errorText(e: unknown): string {
  const parts: string[] = [];
  let c: unknown = e;
  for (let i = 0; i < 4 && c !== undefined && c !== null; i++) {
    parts.push(
      c instanceof SyntaxError
        ? "SyntaxError: unparseable response body"
        : c instanceof Error
          ? `${c.name}: ${plain(c.message)}`
          : plain(c),
    );
    c = c instanceof Error ? c.cause : undefined;
  }
  return parts.join("; cause: ");
}

/** An error for printing: name, message and causes, scrubbed of every key, and never the stack. */
export function describeError(e: unknown, secrets: readonly string[]): string {
  return scrubSecrets(errorText(e), secrets);
}

export interface GeminiErrorInfo {
  status: number | null;
  /** rate: 429 / RESOURCE_EXHAUSTED; auth: the key was refused; other: anything else. */
  kind: "rate" | "auth" | "other";
  /** For a rate limit: which one the error names, if it names one. */
  scope: "minute" | "day" | null;
  retryDelayMs: number | null;
  /** The raw message: scrub it before it goes anywhere. */
  message: string;
}

function whole(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export function classifyGeminiError(e: unknown): GeminiErrorInfo {
  const err = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
  const message = e instanceof SyntaxError ? "unparseable response body" : String(err.message ?? e);
  const inBody = /"code"\s*:\s*(\d{3})/.exec(message)?.[1];
  const status =
    whole(err.status) ?? whole(err.statusCode) ?? whole(err.code) ?? (inBody ? Number(inBody) : null);
  const retry =
    /retry in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(message) ??
    /"?retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)(s)"/i.exec(message);
  const retryDelayMs = retry
    ? Math.ceil(Number(retry[1]) * (retry[2]?.toLowerCase() === "ms" ? 1 : 1_000))
    : null;
  if (status === 429 || err.rateLimited === true || /RESOURCE_EXHAUSTED/i.test(message)) {
    const scope = /per[_\s-]?day|daily/i.test(message)
      ? "day"
      : /per[_\s-]?minute/i.test(message)
        ? "minute"
        : null;
    return { status, kind: "rate", scope, retryDelayMs, message };
  }
  if (
    status === 401 ||
    status === 403 ||
    /PERMISSION_DENIED|UNAUTHENTICATED|API_KEY_INVALID|API key not valid|API key expired/i.test(message) ||
    /ByteString|invalid[^\r\n]*header|header[^\r\n]*invalid/i.test(message)
  )
    return { status, kind: "auth", scope: null, retryDelayMs, message };
  return { status, kind: "other", scope: null, retryDelayMs, message };
}

/** The first instant after `d` that falls on the next Pacific calendar day (handles 23- and 25-hour days). */
export function nextPacificMidnight(d: Date): Date {
  const day = pacificDay(d);
  let lo = d.getTime();
  let hi = lo + 27 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDay(new Date(mid)) === day) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

const PACIFIC_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-11-02 00:00 Pacific" */
export function pacificClock(d: Date): string {
  return `${pacificDay(d)} ${PACIFIC_CLOCK.format(d)} Pacific`;
}

/** A Gemini call that failed on a key for a reason another key would not fix. The message is scrubbed. */
export class GeminiCallError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: "rate" | "auth" | "other",
    readonly keyId: string,
  ) {
    super(message);
    this.name = "GeminiCallError";
  }
}

/** Every key is spaced, cooling, capped or dropped for longer than the pool will wait. */
export class PoolExhaustedError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly readyAt: Date | null,
  ) {
    super(message);
    this.name = "PoolExhaustedError";
  }
}

export interface KeyPoolOptions<C> {
  ledger: QuotaLedger;
  makeClient: (apiKey: string) => C;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  log?: (line: string) => void;
}

export interface KeyModelStatus {
  used: number;
  cap: number;
  remaining: number;
  cooling: { until: string; scope: "minute" | "day" } | null;
}

export interface PoolStatus {
  day: string;
  resetsAt: string;
  disclosure: string;
  models: string[];
  keys: { id: string; dropped: string | null; models: Record<string, KeyModelStatus> }[];
  total: Record<string, { used: number; cap: number; remaining: number }>;
  legacyKey: string | null;
}

interface Slot {
  readonly id: string;
  readonly value: string;
}

export class KeyPool<C> {
  readonly #slots: readonly Slot[];
  readonly #clients = new Map<string, C>();
  readonly #dropped = new Map<string, string>();
  readonly #streak = new Map<string, number>();
  readonly #ledger: QuotaLedger;
  readonly #makeClient: (apiKey: string) => C;
  readonly #now: () => Date;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxWaitMs: number;
  readonly #log: (line: string) => void;
  #cursor = 0;
  #legacyDone = false;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(values: readonly string[], opts: KeyPoolOptions<C>) {
    const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
    if (!unique.length)
      throw new Error("The key pool needs at least one Gemini key (GEMINI_API_KEY in .env).");
    this.#slots = unique.map((value) => ({ id: keyId(value), value }));
    this.#ledger = opts.ledger;
    this.#makeClient = opts.makeClient;
    this.#now = opts.now ?? (() => new Date());
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.#log = opts.log ?? (() => undefined);
    for (const slot of this.#slots) {
      if (validKey(slot.value)) continue;
      const reason = "malformed key: expected printable ASCII without whitespace";
      this.#dropped.set(slot.id, reason);
      this.#log(`[pool] key ${slot.id} dropped for this run (${reason})`);
    }
  }

  get size(): number {
    return this.#slots.length;
  }

  ids(): string[] {
    return this.#slots.map((s) => s.id);
  }

  /** Keys refused this run (401/403/PERMISSION_DENIED/API_KEY_INVALID), by id. */
  dropped(): { id: string; reason: string }[] {
    return [...this.#dropped].map(([id, reason]) => ({ id, reason }));
  }

  /** Scrubs every key of the pool, and anything shaped like a Google key, out of a string. */
  scrub(text: string): string {
    return scrubSecrets(
      text,
      this.#slots.map((s) => s.value),
    );
  }

  toJSON(): { size: number; ids: string[]; dropped: { id: string; reason: string }[] } {
    return { size: this.size, ids: this.ids(), dropped: this.dropped() };
  }

  toString(): string {
    return `KeyPool(${this.size} keys: ${this.ids().join(", ")})`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }

  /**
   * Runs one Gemini request on the next ready key: counts it on that key before it is sent, settles it
   * after, and moves it to another key on a 429 or a refused key. Other failures are thrown, scrubbed.
   */
  async run<T>(
    model: string,
    fn: (client: C, keyId: string) => Promise<T>,
    opts: { latencyMs?: (result: T) => number | undefined } = {},
  ): Promise<T> {
    for (;;) {
      const slot = await this.#exclusive(async () => {
        await this.#ensureLegacy();
        const acquired = await this.#acquire(model);
        await this.#ledger.reserve(model, acquired.id);
        return acquired;
      });
      let result: T;
      try {
        result = await fn(this.#client(slot), slot.id);
      } catch (e) {
        await this.#exclusive(() => this.#failed(model, slot, e));
        continue;
      }
      const latencyMs = opts.latencyMs?.(result);
      await this.#exclusive(async () => {
        this.#streak.delete(`${slot.id} ${model}`);
        await this.#ledger.settle(model, slot.id, {
          ok: true,
          ...(latencyMs === undefined ? {} : { latencyMs }),
        });
      });
      return result;
    }
  }

  /** Each key id's used and remaining requests per model today, and the pool total. */
  async status(models: readonly string[]): Promise<PoolStatus> {
    const q = await this.#exclusive(async () => {
      await this.#ensureLegacy();
      return this.#ledger.read();
    });
    const now = this.#now();
    const day = pacificDay(now);
    const unique = [...new Set(models)];
    const total: PoolStatus["total"] = {};
    const keys = this.#slots.map((s) => {
      const dropped = this.#dropped.get(s.id) ?? null;
      const byModel: Record<string, KeyModelStatus> = {};
      for (const m of unique) {
        const cap = capFor(q, m);
        const used = keyCounts(q, day, s.id, m).requests;
        const c = q.keys?.[s.id]?.cooling[m];
        const cooling = c && Date.parse(c.until) > now.getTime() ? { until: c.until, scope: c.scope } : null;
        const remaining = dropped ? 0 : Math.max(0, cap - used);
        byModel[m] = { used, cap, remaining, cooling };
        total[m] ??= { used: 0, cap: 0, remaining: 0 };
        const t = total[m];
        t.used += used;
        if (!dropped) t.cap += cap;
        t.remaining += remaining;
      }
      return { id: s.id, dropped, models: byModel };
    });
    return {
      day,
      resetsAt: nextPacificMidnight(now).toISOString(),
      disclosure: poolDisclosure(this.size),
      models: unique,
      keys,
      total,
      legacyKey: q.legacyKey ?? null,
    };
  }

  /** Keep selection + reservation and all ledger mutations atomic within this pool. Requests run outside. */
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(fn);
    // A refused acquisition must not poison the queue for subsequent callers.
    this.#pending = next.catch(() => undefined);
    return next;
  }

  #client(slot: Slot): C {
    let c = this.#clients.get(slot.id);
    if (c === undefined) {
      c = this.#makeClient(slot.value);
      this.#clients.set(slot.id, c);
    }
    return c;
  }

  async #ensureLegacy(): Promise<void> {
    if (this.#legacyDone) return;
    await this.#ledger.attributeLegacy((this.#slots[0] as Slot).id);
    this.#legacyDone = true;
  }

  /** When this key may next send to the model: spacing, cooling and the daily cap. */
  #readyAt(q: QuotaFile, slot: Slot, model: string, now: number): number {
    let t = now;
    const st = q.keys?.[slot.id];
    const last = st?.lastAt[model];
    if (last) t = Math.max(t, Date.parse(last) + intervalFor(q, model));
    const cool = st?.cooling[model];
    if (cool) t = Math.max(t, Date.parse(cool.until));
    const at = new Date(now);
    if (keyCounts(q, pacificDay(at), slot.id, model).requests >= capFor(q, model))
      t = Math.max(t, nextPacificMidnight(at).getTime());
    return t;
  }

  async #acquire(model: string): Promise<Slot> {
    const n = this.#slots.length;
    for (;;) {
      const order = Array.from({ length: n }, (_, i) => (this.#cursor + i) % n).filter(
        (i) => !this.#dropped.has((this.#slots[i] as Slot).id),
      );
      if (!order.length) {
        throw new PoolExhaustedError(
          `Every Gemini key was refused this run (dropped: ${this.dropped()
            .map((d) => d.id)
            .join(
              ", ",
            )}); check them with tts keys. Statements without a clip fall back to the labelled device voice.`,
          model,
          null,
        );
      }
      const q = await this.#ledger.read();
      const now = this.#now().getTime();
      let best = order[0] as number;
      let bestAt = Number.POSITIVE_INFINITY;
      for (const i of order) {
        const at = this.#readyAt(q, this.#slots[i] as Slot, model, now);
        if (at < bestAt) {
          best = i;
          bestAt = at;
        }
        if (at <= now) break;
      }
      const wait = bestAt - now;
      if (wait <= 0) {
        this.#cursor = (best + 1) % n;
        return this.#slots[best] as Slot;
      }
      if (wait > this.#maxWaitMs) throw this.#exhausted(model, q, now, new Date(bestAt));
      this.#log(
        `[pool] every key is spaced, cooling or capped for ${model}; waiting ${Math.ceil(wait / 1000)} s for key ${(this.#slots[best] as Slot).id}`,
      );
      await this.#sleep(wait);
    }
  }

  #exhausted(model: string, q: QuotaFile, now: number, readyAt: Date): PoolExhaustedError {
    const day = pacificDay(new Date(now));
    let capped = 0;
    let cooling = 0;
    for (const s of this.#slots) {
      if (this.#dropped.has(s.id)) continue;
      if (keyCounts(q, day, s.id, model).requests >= capFor(q, model)) capped += 1;
      else if (Date.parse(q.keys?.[s.id]?.cooling[model]?.until ?? "") > now) cooling += 1;
    }
    const parts = [
      capped ? `${capped} at the daily cap` : "",
      cooling ? `${cooling} cooling after a 429` : "",
      this.#dropped.size ? `${this.#dropped.size} dropped` : "",
    ].filter(Boolean);
    return new PoolExhaustedError(
      `No Gemini key is ready for ${model} until ${readyAt.toISOString()} (${pacificClock(readyAt)}); ${this.size} keys: ${parts.join(", ") || "all spaced"}. Stopping rather than waiting more than ${Math.round(this.#maxWaitMs / 60_000)} min; statements without a clip fall back to the labelled device voice.`,
      model,
      readyAt,
    );
  }

  async #failed(model: string, slot: Slot, e: unknown): Promise<void> {
    const info = classifyGeminiError(e);
    // Scrubbed whole, then shortened.
    const message = this.scrub(info.message).slice(0, 1_000);
    const now = this.#now();
    if (info.kind === "rate") {
      await this.#ledger.settle(model, slot.id, { ok: false, rateLimited: true, message });
      const k = `${slot.id} ${model}`;
      const streak = (this.#streak.get(k) ?? 0) + 1;
      this.#streak.set(k, streak);
      const scope = info.scope === "day" || streak >= RATE_LIMIT_STREAK_FOR_DAY ? "day" : "minute";
      const until =
        scope === "day"
          ? Math.max(
              nextPacificMidnight(now).getTime(),
              now.getTime() + (info.retryDelayMs ?? 0) + COOLING_MARGIN_MS,
            )
          : now.getTime() + (info.retryDelayMs ?? MINUTE_COOLING_MS) + COOLING_MARGIN_MS;
      const untilIso = new Date(until).toISOString();
      await this.#ledger.cool(slot.id, model, { until: untilIso, scope, message, at: now.toISOString() });
      this.#log(
        `[pool] key ${slot.id} rate-limited on ${model} (${scope === "day" ? "daily limit" : "per-minute limit"}); cooling until ${untilIso}; moving to the next key`,
      );
      return;
    }
    if (info.kind === "auth") {
      await this.#ledger.settle(model, slot.id, { ok: false });
      const reason = `HTTP ${info.status ?? "?"}: ${message.slice(0, 200)}`;
      this.#dropped.set(slot.id, reason);
      this.#log(`[pool] key ${slot.id} dropped for this run (${reason}); moving to the next key`);
      return;
    }
    await this.#ledger.settle(model, slot.id, { ok: false, message });
    throw new GeminiCallError(message, info.status, "other", slot.id);
  }
}

export function formatPoolStatus(s: PoolStatus): string {
  const lines = [
    `Pacific day ${s.day}; per-key daily caps reset at ${s.resetsAt} (${pacificClock(new Date(s.resetsAt))})`,
    `Key pool: ${s.disclosure}`,
  ];
  if (s.legacyKey)
    lines.push(`requests counted before the key pool are attributed to key ${s.legacyKey} (GEMINI_API_KEY)`);
  for (const m of s.models) {
    const cap = s.keys[0]?.models[m]?.cap ?? 0;
    lines.push(`${m} (cap ${cap} per key per Pacific day)`);
    for (const k of s.keys) {
      const st = k.models[m];
      if (!st) continue;
      const notes = [
        k.dropped ? `dropped this run (${k.dropped})` : "",
        st.cooling ? `cooling (${st.cooling.scope}) until ${st.cooling.until}` : "",
      ].filter(Boolean);
      lines.push(
        `  ${k.id}  ${st.used} used, ${st.remaining} remaining${notes.length ? `  ${notes.join("; ")}` : ""}`,
      );
    }
    const t = s.total[m];
    if (t) lines.push(`  pool total  ${t.used} used, ${t.remaining} remaining of ${t.cap}`);
  }
  return lines.join("\n");
}

export interface KeyCheck {
  id: string;
  ok: boolean;
  status: number | null;
  models: number;
  tts: boolean;
  asr: boolean;
  detail: string;
}

/**
 * The free live check: models.list for every key (key in the x-goog-api-key header, never in the URL).
 * It sends no generation request, so it spends no generation quota.
 */
export async function checkKeys(
  values: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck[]> {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const out: KeyCheck[] = [];
  for (const value of unique) out.push(await checkOne(value, unique, fetchImpl));
  return out;
}

export interface ListedModel {
  name: string;
  displayName: string;
}

export type ModelList =
  | { ok: true; status: number | null; models: ListedModel[] }
  | { ok: false; status: number | null; detail: string };

/**
 * models.list for a single key, every page, with the key in the x-goog-api-key header (never in the URL). It
 * sends no generation request, so it is free. A failure comes back as a scrubbed detail; it never throws,
 * since Google's error for a refused key can name the key (CONSUMER_SUSPENDED does).
 */
export async function listModels(
  value: string,
  secrets: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ModelList> {
  const failed = (status: number | null, why: string): ModelList => ({
    ok: false,
    status,
    detail: scrubSecrets(why, [value, ...secrets]).slice(0, 200),
  });
  const models: ListedModel[] = [];
  let status: number | null = null;
  if (!validKey(value))
    return failed(null, `malformed key ${keyId(value)}: expected printable ASCII without whitespace`);
  try {
    let page: string | undefined;
    for (let i = 0; i < 5; i++) {
      const url = `${MODELS_URL}?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`;
      const res = await fetchImpl(url, {
        headers: { "x-goog-api-key": value },
        signal: AbortSignal.timeout(20_000),
      });
      status = res.status;
      const body = (await res.json().catch(() => null)) as {
        models?: { name?: string; displayName?: string }[];
        nextPageToken?: string;
        error?: { status?: string; message?: string };
      } | null;
      if (body === null) return failed(status, "unparseable models.list body");
      if (!res.ok)
        return failed(
          status,
          `HTTP ${res.status}${body.error?.status ? ` ${body.error.status}` : ""}: ${body.error?.message ?? ""}`,
        );
      for (const m of body.models ?? [])
        if (m.name) models.push({ name: m.name, displayName: m.displayName ?? "" });
      page = body.nextPageToken;
      if (!page) break;
    }
  } catch (e) {
    return failed(status, `request failed: ${errorText(e)}`);
  }
  return { ok: true, status, models };
}

async function checkOne(
  value: string,
  secrets: readonly string[],
  fetchImpl: typeof fetch,
): Promise<KeyCheck> {
  const id = keyId(value);
  const r = await listModels(value, secrets, fetchImpl);
  if (!r.ok) return { id, ok: false, status: r.status, models: 0, tts: false, asr: false, detail: r.detail };
  const { status } = r;
  const names = r.models.map((m) => m.name);
  const tts = names.includes(`models/${TTS_MODEL}`);
  const asr = names.includes(`models/${ASR_MODEL}`);
  return {
    id,
    ok: true,
    status,
    models: names.length,
    tts,
    asr,
    detail: `HTTP ${status}, ${names.length} models; ${TTS_MODEL} ${tts ? "listed" : "NOT listed"}, ${ASR_MODEL} ${asr ? "listed" : "NOT listed"}`,
  };
}

export function formatKeyChecks(results: readonly KeyCheck[]): string {
  const ok = results.filter((r) => r.ok).length;
  return [
    ...results.map((r) => `${r.id}  ${r.ok ? "ok" : "FAILED"}  ${r.detail}`),
    `${ok} of ${results.length} keys answered models.list (no generation request sent)`,
  ].join("\n");
}
