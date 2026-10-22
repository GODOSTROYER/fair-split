import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GatewayError } from "./errors.js";
import { microsFromUsd, usd } from "./pricing.js";
import { ensureSelfIgnoringDir } from "./store.js";
import { LANES, type Lane } from "./types.js";

/**
 * S4.9 lane caps, in US$: per UTC day, except `eval`, which is per run. On `fs-judge` the three judge
 * lanes add up to US$8 a day, under the Anthropic Console limit.
 */
export const LANE_CAPS_USD: Readonly<Record<Lane, number>> = {
  dev: 25,
  judge_invoice: 5,
  judge_read: 1.5,
  judge_ask: 1.5,
  eval: 3,
  offline: 5,
};

/** Lanes capped per run rather than per day. */
const PER_RUN: ReadonlySet<Lane> = new Set<Lane>(["eval"]);

const config = (msg: string) => new GatewayError("AI_CONFIG", msg);

function parseUsd(name: string, raw: string): number {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0)
    throw config(`${name}: "${raw}" is not a US$ amount`);
  return n;
}

/**
 * Lane caps: S4.9's defaults, overridden per lane by `AI_LANE_CAPS_USD` ("judge_read=10,dev=25"; the
 * film day raises judge_read, S5.6.3). A malformed entry fails construction rather than guessing.
 */
export function laneCapsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<Lane, number> {
  const caps: Record<Lane, number> = { ...LANE_CAPS_USD };
  const raw = env.AI_LANE_CAPS_USD?.trim();
  if (!raw) return caps;
  for (const entry of raw.split(",")) {
    const [name, value, ...rest] = entry.split("=").map((s) => s.trim());
    if (!name || value === undefined || rest.length > 0 || !(LANES as readonly string[]).includes(name)) {
      throw config(`AI_LANE_CAPS_USD: "${entry.trim()}" is not lane=amount (lanes: ${LANES.join(", ")})`);
    }
    caps[name as Lane] = parseUsd(`AI_LANE_CAPS_USD ${name}`, value);
  }
  return caps;
}

/**
 * The register §9 daily spend cap over every lane together, from `AI_DAILY_SPEND_CAP_USD` (the
 * `.env.example` name; `AI_DAILY_CAP_USD` also works). null: only the lane caps apply.
 */
export function totalDailyCapFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.AI_DAILY_SPEND_CAP_USD ?? env.AI_DAILY_CAP_USD;
  return raw === undefined || raw.trim() === "" ? null : parseUsd("AI_DAILY_SPEND_CAP_USD", raw);
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/** The budget key of a lane: `{lane}:{UTC day}`, or `eval:{run id}` for the per-run eval lane. */
export function budgetKey(lane: Lane, scope: string | undefined, at: Date): string {
  if (!PER_RUN.has(lane)) return `${lane}:${utcDay(at)}`;
  if (!scope) throw new GatewayError("AI_BAD_CALL", `lane "${lane}" is capped per run and needs a laneScope`);
  return `${lane}:${scope}`;
}

/** The key of today's spend over every lane (the overall daily cap). */
export const totalKey = (at: Date): string => `total:${utcDay(at)}`;

export interface SpendReservation {
  /** Replace the reservation with the actual cost of the call. */
  settle(actualMicros: number): Promise<void>;
  /** Drop the reservation (the call failed before it was billed). */
  release(): Promise<void>;
}

/**
 * Meters spend per budget key. A reservation holds the estimate while a call is in flight, so six
 * concurrent calls cannot each pass the check against the same headroom.
 *
 * Production (fs-api plus fs-tasks) needs one meter shared by every process and surviving restarts:
 * WS-DATA's `llm_calls`-backed meter, reserving and settling inside a transaction. The in-process
 * meters below are for tests, one eval run and the dev machine; the gateway refuses them when
 * NODE_ENV is production.
 */
export interface SpendMeter {
  reserve(key: string, estimateMicros: number, capMicros: number): Promise<SpendReservation>;
  spent(key: string): Promise<number>;
  /** True when spend is kept by this process or machine only (it resets on a restart or a new instance). */
  readonly processLocal?: boolean;
}

abstract class ReservingMeter implements SpendMeter {
  private readonly held = new Map<string, number>();

  protected abstract settledMicros(key: string): Promise<number>;
  protected abstract addSettled(key: string, micros: number): Promise<void>;

  async spent(key: string): Promise<number> {
    return this.settledMicros(key);
  }

  async reserve(key: string, estimateMicros: number, capMicros: number): Promise<SpendReservation> {
    const settled = await this.settledMicros(key);
    const held = this.held.get(key) ?? 0;
    if (settled + held + estimateMicros > capMicros) {
      throw new GatewayError(
        "AI_BUDGET",
        `budget ${key}: spent US$${usd(settled + held).toFixed(4)} + estimate US$${usd(estimateMicros).toFixed(4)} exceeds cap US$${usd(capMicros).toFixed(2)}`,
        { estimateMicros, capMicros, spentMicros: settled + held },
      );
    }
    this.held.set(key, held + estimateMicros);
    let open = true;
    const drop = () => {
      if (!open) return;
      open = false;
      const left = (this.held.get(key) ?? 0) - estimateMicros;
      if (left > 0) this.held.set(key, left);
      else this.held.delete(key);
    };
    return {
      settle: async (actualMicros: number) => {
        drop();
        if (actualMicros > 0) await this.addSettled(key, actualMicros);
      },
      release: async () => drop(),
    };
  }
}

/** In-process meter (tests, one eval run). */
export class MemorySpendMeter extends ReservingMeter {
  readonly processLocal = true;
  private readonly totals = new Map<string, number>();
  protected async settledMicros(key: string): Promise<number> {
    return this.totals.get(key) ?? 0;
  }
  protected async addSettled(key: string, micros: number): Promise<void> {
    this.totals.set(key, (this.totals.get(key) ?? 0) + micros);
  }
}

/**
 * Append-only JSONL meter that survives restarts (dev machine live runs). Each line is
 * `{"at", "key", "micros"}`. The file is re-read on every reservation, so spend is always fresh.
 */
export class FileSpendMeter extends ReservingMeter {
  readonly processLocal = true;
  constructor(private readonly path: string) {
    super();
  }
  protected async settledMicros(key: string): Promise<number> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
    let total = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { key: string; micros: number };
      if (row.key === key) total += row.micros;
    }
    return total;
  }
  protected async addSettled(key: string, micros: number): Promise<void> {
    await ensureSelfIgnoringDir(dirname(this.path));
    await appendFile(this.path, `${JSON.stringify({ at: new Date().toISOString(), key, micros })}\n`, "utf8");
  }
}

/**
 * Reserves one estimate against several (key, cap) pairs, all or nothing: the lane cap, then the
 * overall daily cap. A refusal releases what was already held.
 */
export async function reserveAll(
  meter: SpendMeter,
  estimateMicros: number,
  limits: ReadonlyArray<{ key: string; capMicros: number }>,
): Promise<SpendReservation> {
  const held: SpendReservation[] = [];
  try {
    for (const l of limits) held.push(await meter.reserve(l.key, estimateMicros, l.capMicros));
  } catch (err) {
    await Promise.all(held.map((h) => h.release()));
    throw err;
  }
  return {
    settle: async (actual) => {
      for (const h of held) await h.settle(actual);
    },
    release: async () => {
      await Promise.all(held.map((h) => h.release()));
    },
  };
}

export { microsFromUsd };
