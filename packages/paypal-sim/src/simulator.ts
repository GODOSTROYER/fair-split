// The simulator core: state, clock, scheduler, contract validator, signing material, ledger and the
// fetch-compatible handler. Domain modules (invoicing, payouts, webhooks, reporting) operate on it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { SimulatorOptions } from "./config.js";
import { Contract, defaultSpecDir } from "./contract/openapi.js";
import { loadSigningMaterial, type SigningMaterial } from "./crypto/keys.js";
import { InvoicingEngine } from "./domain/invoicing.js";
import { PayoutEngine } from "./domain/payouts.js";
import { ReportingEngine } from "./domain/reporting.js";
import { WebhookEngine } from "./domain/webhooks.js";
import { buildApp } from "./http/app.js";
import { RateLimiter } from "./http/ratelimit.js";
import {
  type Account,
  type App,
  emptyState,
  type JsonObject,
  type LedgerEntry,
  loadRegistry,
  type Registry,
  type SimState,
  type TransactionRecord,
} from "./state.js";
import { toCents } from "./util/money.js";
import { type Clock, createClock, DAY_MS, Scheduler } from "./util/time.js";

const contractCache = new Map<string, Contract>();

/** One Contract per spec directory and process (loading and compiling the specs is the slow part). */
export function getContract(specDir: string = defaultSpecDir()): Contract {
  let c = contractCache.get(specDir);
  if (!c) {
    c = new Contract({ specDir });
    contractCache.set(specDir, c);
  }
  return c;
}

export interface EffectiveOptions {
  publicBaseUrl: string;
  apiBaseUrl: string;
  basePath: string;
  speed: number;
  dataDir: string | null;
  persist: boolean;
  rateLimit: SimulatorOptions["rateLimit"];
  latencyMs: number | [number, number];
  strict: boolean;
  deliveryFetch: (url: string, init: RequestInit) => Promise<Response>;
  maxAttempts: number;
  deliveryTimeoutMs: number;
  timing: { batchProcessingS: number; itemS: number; batchCompleteS: number };
  payoutFeeCents: number;
  invoiceFee: { percentBps: number; fixedCents: number };
  reportingLagSeconds: number;
  unclaimedReturnDays: number;
  adminToken: string | null;
  initialDelivery: { outOfOrder: boolean; duplicate: boolean };
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export class Simulator {
  readonly options: EffectiveOptions;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly contract: Contract;
  readonly registry: Registry;
  readonly signing: SigningMaterial;
  readonly rateLimiter: RateLimiter;
  readonly webhooks: WebhookEngine;
  readonly payouts: PayoutEngine;
  readonly invoicing: InvoicingEngine;
  readonly reporting: ReportingEngine;
  readonly app: Hono;
  state: SimState;
  private readonly log: (message: string) => void;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(opts: SimulatorOptions = {}) {
    const publicBaseUrl = trimSlash(opts.publicBaseUrl ?? "http://127.0.0.1:4010");
    const fetchImpl = opts.deliveryFetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init));
    this.options = {
      publicBaseUrl,
      apiBaseUrl: trimSlash(opts.apiBaseUrl ?? publicBaseUrl),
      basePath: opts.basePath ? `/${opts.basePath.replace(/^\/+|\/+$/g, "")}` : "",
      speed: opts.speed ?? 1,
      dataDir: opts.dataDir ?? null,
      persist: Boolean(opts.persist && opts.dataDir),
      rateLimit: opts.rateLimit === undefined ? { perMinute: 50, blockSeconds: 300 } : opts.rateLimit,
      latencyMs: opts.latencyMs ?? 0,
      strict: opts.strict ?? true,
      deliveryFetch: fetchImpl,
      maxAttempts: opts.delivery?.maxAttempts ?? 25,
      deliveryTimeoutMs: opts.delivery?.timeoutMs ?? 10_000,
      timing: {
        batchProcessingS: opts.timing?.batchProcessingS ?? 1.5,
        itemS: opts.timing?.itemS ?? 0.8,
        batchCompleteS: opts.timing?.batchCompleteS ?? 0.5,
      },
      payoutFeeCents: opts.payoutFeeCents ?? 25,
      invoiceFee: opts.invoiceFee ?? { percentBps: 0, fixedCents: 0 },
      reportingLagSeconds: opts.reportingLagSeconds ?? 0,
      unclaimedReturnDays: opts.unclaimedReturnDays ?? 30,
      adminToken: opts.adminToken ?? null,
      initialDelivery: {
        outOfOrder: opts.delivery?.outOfOrder ?? false,
        duplicate: opts.delivery?.duplicate ?? false,
      },
    };
    this.log = opts.logger ?? ((m) => console.log(`[paypal-sim] ${m}`));
    this.clock = createClock(opts.now);
    this.scheduler = new Scheduler(this.options.speed, (err) => this.log(`task failed: ${String(err)}`));
    this.contract = getContract(opts.specDir ?? defaultSpecDir());
    this.registry = opts.registry ?? loadRegistry(opts.accountsFile);
    this.signing = loadSigningMaterial(this.options.dataDir, new Date(this.clock.now()));
    this.rateLimiter = new RateLimiter(this.options.rateLimit ?? false, () => this.clock.now());
    this.state = this.seedState();
    this.webhooks = new WebhookEngine(this);
    this.payouts = new PayoutEngine(this);
    this.invoicing = new InvoicingEngine(this);
    this.reporting = new ReportingEngine(this);
    this.app = buildApp(this);
    if (this.options.persist) this.loadSnapshot();
    this.scheduler.onIdle(() => this.webhooks.releaseHeld());
    if (this.options.speed > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), 30_000);
      this.sweepTimer.unref();
    }
  }

  /** Fetch-compatible handler: give it a Request, get PayPal's Response. */
  readonly fetch = (request: Request, env?: unknown): Promise<Response> =>
    Promise.resolve(this.app.fetch(request, env as never));

  // ── identity ──────────────────────────────────────────────────────────────────────────────────────

  get certUrl(): string {
    return `${this.options.publicBaseUrl}${this.options.basePath}/sim/certs/${this.signing.certId}.pem`;
  }

  /** Allow-list pattern for `paypal-cert-url` in simulator mode (never matches PayPal's own hosts). */
  get certUrlPattern(): RegExp {
    const base = `${this.options.publicBaseUrl}${this.options.basePath}`.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    return new RegExp(`^${base}/sim/certs/SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}\\.pem$`);
  }

  logLine(message: string): void {
    this.log(message);
  }

  /** Every response or event that failed validation against the vendored spec (tests assert it stays empty). */
  readonly violations: string[] = [];

  recordViolation(message: string): void {
    this.violations.push(message);
    this.log(`CONTRACT VIOLATION ${message}`);
  }

  // ── registry lookups ─────────────────────────────────────────────────────────────────────────────

  accountByKey(key: string): Account | undefined {
    return this.registry.accounts.find((a) => a.key === key);
  }

  accountByEmail(email: string): Account | undefined {
    const e = email.trim().toLowerCase();
    return this.registry.accounts.find((a) => a.email.toLowerCase() === e);
  }

  accountByPayerId(id: string): Account | undefined {
    return this.registry.accounts.find((a) => a.payer_id === id);
  }

  appByClientId(clientId: string): App | undefined {
    return this.registry.apps.find((a) => a.client_id === clientId);
  }

  accountForClient(clientId: string): Account {
    const app = this.appByClientId(clientId);
    const account = app ? this.accountByKey(app.account) : undefined;
    if (!account) throw new Error(`no account for client ${clientId}`);
    return account;
  }

  // ── money ────────────────────────────────────────────────────────────────────────────────────────

  post(entry: Omit<LedgerEntry, "at"> & { at?: number }): void {
    this.state.ledger.push({ ...entry, at: entry.at ?? this.clock.now() });
    this.markDirty();
  }

  balance(accountKey: string, currency: string, asOf?: number): { available: number; withheld: number } {
    let available = 0;
    let withheld = 0;
    const limit = asOf ?? Number.POSITIVE_INFINITY;
    for (const e of this.state.ledger) {
      if (e.accountKey !== accountKey || e.currency !== currency || e.at > limit) continue;
      available += e.availableCents;
      withheld += e.withheldCents;
    }
    return { available, withheld };
  }

  currencies(accountKey: string): string[] {
    const set = new Set<string>();
    for (const e of this.state.ledger) if (e.accountKey === accountKey) set.add(e.currency);
    return [...set].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  }

  recordTransaction(t: TransactionRecord): void {
    this.state.transactions.push(t);
    this.markDirty();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────────

  private seedState(): SimState {
    const s = emptyState();
    s.delivery = { ...this.options.initialDelivery };
    for (const a of this.registry.accounts) {
      for (const [currency, value] of Object.entries(a.balances ?? {})) {
        s.ledger.push({
          accountKey: a.key,
          currency,
          at: 0,
          availableCents: toCents(value) ?? 0,
          withheldCents: 0,
          kind: "seed",
          ref: "registry",
        });
      }
    }
    return s;
  }

  /** Judge Mode reset: drop every object and pending task, restore the seeded balances. */
  reset(): void {
    this.scheduler.cancelAll();
    this.rateLimiter.clear();
    this.webhooks.clearHeld();
    this.state = this.seedState();
    this.markDirty();
  }

  /** Waits until queued processing and webhook deliveries have finished. */
  idle(timeoutMs?: number): Promise<void> {
    return this.scheduler.idle(timeoutMs);
  }

  /** Runs time-based transitions (AUTO_CANCEL dates, unclaimed returns) against the current clock. */
  sweep(): void {
    if (this.closed) return;
    try {
      this.invoicing.sweepAutoCancel();
      this.payouts.sweepUnclaimed();
    } catch (err) {
      this.log(`sweep failed: ${String(err)}`);
    }
  }

  snapshot(): SimState {
    return structuredClone(this.state);
  }

  restore(state: SimState): void {
    this.scheduler.cancelAll();
    this.state = structuredClone(state);
    this.payouts.resume();
    this.markDirty();
  }

  private get snapshotFile(): string | null {
    return this.options.dataDir ? join(this.options.dataDir, "state.json") : null;
  }

  private loadSnapshot(): void {
    const file = this.snapshotFile;
    if (!file || !existsSync(file)) return;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SimState;
      if (parsed.version === 1) {
        this.state = parsed;
        this.payouts.resume();
      }
    } catch (err) {
      this.log(`ignoring unreadable snapshot ${file}: ${String(err)}`);
    }
  }

  markDirty(): void {
    if (!this.options.persist || this.closed) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.flush();
    }, 250);
    this.persistTimer.unref();
  }

  /** Writes the snapshot now (atomic rename). */
  flush(): void {
    const file = this.snapshotFile;
    if (!this.options.persist || !file || !this.options.dataDir) return;
    mkdirSync(this.options.dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, file);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      this.flush();
    }
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.scheduler.cancelAll();
  }

  /** A small summary for /sim/admin/state and debugging (never includes secrets). */
  summary(): JsonObject {
    const balances: JsonObject = {};
    for (const a of this.registry.accounts) {
      const per: JsonObject = {};
      for (const c of this.currencies(a.key)) {
        const b = this.balance(a.key, c);
        per[c] = { available_cents: b.available, withheld_cents: b.withheld };
      }
      balances[a.key] = per;
    }
    return {
      simulated: true,
      cert_url: this.certUrl,
      invoices: Object.keys(this.state.invoices).length,
      batches: Object.keys(this.state.batches).length,
      webhooks: Object.keys(this.state.webhooks).length,
      events: this.state.eventOrder.length,
      deliveries: Object.keys(this.state.deliveries).length,
      delivery_toggles: { ...this.state.delivery },
      balances,
      pending_tasks: this.scheduler.size,
    };
  }

  /** Days after which an UNCLAIMED item returns automatically, in clock milliseconds. */
  get unclaimedReturnMs(): number {
    return this.options.unclaimedReturnDays * DAY_MS;
  }
}

/** Creates a simulator (see SimulatorOptions; `optionsFromEnv()` reads the SIM_* variables). */
export async function createSimulator(opts: SimulatorOptions = {}): Promise<Simulator> {
  return new Simulator(opts);
}
