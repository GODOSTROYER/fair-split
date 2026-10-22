import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GatewayError } from "./errors.js";
import { microsFromUsd, usd } from "./pricing.js";
import { ensureSelfIgnoringDir } from "./store.js";
import type { BudgetKind } from "./types.js";

/** S4.1 step 4 caps, in US$. `daily` comes from AI_DAILY_CAP_USD (8 on fs-judge, 25 in dev). */
export const DEFAULT_CAPS_USD: Record<BudgetKind, number> = { daily: 8, eval: 3, session: 0.75 };

/** Reads the daily cap from the environment; AI_DAILY_SPEND_CAP_USD is the .env.example spelling. */
export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<BudgetKind, number> {
  const raw = env.AI_DAILY_CAP_USD ?? env.AI_DAILY_SPEND_CAP_USD;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return {
    ...DEFAULT_CAPS_USD,
    daily: Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CAPS_USD.daily,
  };
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * The budget key: today's (UTC) spend for `daily`; the whole run for `eval`; the whole session for
 * `session`.
 */
export function budgetKey(kind: BudgetKind, scope: string | undefined, at: Date): string {
  if (kind === "daily") return `daily:${scope ?? "-"}:${utcDay(at)}`;
  if (!scope) throw new GatewayError("AI_BAD_CALL", `budget "${kind}" needs a budgetScope`);
  return `${kind}:${scope}`;
}

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

export { microsFromUsd };
