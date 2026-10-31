// Boot steps of the in-process simulator (PP_MODE=simulator, ADR-0010). Its state lives in this process only, so a
// restart or a redeploy forgets every invoice, batch and item it held:
//
//   1. END THE JUDGE SESSIONS of the previous process: every claimed judge workspace's claim is cleared and its tokens
//      revoked, as a Reset does (judge/session.ts `resetJudgeSession`), with a `judge.session.reset` ledger entry
//      saying why. Their runs name PayPal ids the new simulator never issued, so the judge's next press starts a fresh
//      workspace; the hourly purge removes the old ones once their 24 h expiry passes (the database never moves an
//      expiry earlier). The judge folder's own boot hook then retires stale pool workspaces and refills the pool.
//   2. READ THE BALANCE: one searchBalances call (GET /v1/reporting/balances, through the rail: limiter, recorder)
//      recorded as the judge quota ledger's balance reading on the simulated rail, so the quota counts from the
//      simulator's real (simulated) balance instead of the US$100,000 opening, and repeated every 12 h, well inside
//      the reading's 26 h freshness (judge/quota.ts).
import { appendLedger, schema, systemScope } from "@fairsplit/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revokeWorkspaceTokens, sessionOfWorkspace } from "../credentials/issue/tokens.js";
import { recordBalanceReading } from "../judge/quota.js";
import type { AppDeps } from "../lib/context.js";

const BOOT_ACTOR = { kind: "system", id: "system:paypal-sim-boot", impersonatedBy: null } as const;
/** How often the simulated balance is read again (a reading counts for 26 h). */
export const BALANCE_READING_EVERY_MS = 12 * 3_600_000;

type BootDeps = Pick<AppDeps, "db" | "clock" | "paypal" | "logger">;

/** Ends every claimed judge session (step 1 above). Returns the workspaces it ended. */
export async function endJudgeSessionsAtBoot(deps: BootDeps): Promise<string[]> {
  const w = schema.workspaces;
  const claimed = await deps.db
    .select({ id: w.id })
    .from(w)
    .where(and(eq(w.kind, "judge"), isNotNull(w.claimedAt)));
  const ended: string[] = [];
  for (const { id } of claimed) {
    const now = deps.clock.now();
    const sessionId = await sessionOfWorkspace(deps.db, id);
    const done = await deps.db.transaction(async (tx) => {
      // lock order (db/tx.ts): the workspace lock before its rows
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${id}`}, 0))`);
      const rows = await tx
        .update(w)
        .set({ claimedAt: null })
        .where(and(eq(w.id, id), eq(w.kind, "judge"), isNotNull(w.claimedAt)))
        .returning({ id: w.id });
      if (rows.length === 0) return false;
      const revokedTokens = await revokeWorkspaceTokens(tx, id, now);
      await appendLedger(tx, systemScope(id, BOOT_ACTOR), {
        kind: "judge.session.reset",
        payload: { sessionId, revokedTokens, trigger: "simulator_restarted" },
        at: now,
      });
      return true;
    });
    if (done) ended.push(id);
  }
  return ended;
}

interface BalancesBody {
  balances?: { currency?: string; primary?: boolean; available_balance?: { value?: string } }[];
}

/** One searchBalances reading of the business account's USD, recorded in the judge quota ledger (step 2 above). */
export async function recordSimulatorBalance(deps: BootDeps): Promise<number> {
  const r = await deps.paypal.core.http.request<BalancesBody>({
    method: "GET",
    path: "/v1/reporting/balances",
    query: { currency_code: "USD" },
    purpose: "reporting.balances",
    priority: "background",
  });
  if (!r.ok) throw new Error(`searchBalances: ${r.kind} ${r.status} ${r.name}`);
  const usd = r.body.balances?.find((b) => b.currency === "USD");
  const value = usd?.available_balance?.value;
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("searchBalances: no USD available balance");
  const [whole, frac = ""] = value.split(".");
  const availableCents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  await recordBalanceReading(deps.db, {
    rail: deps.paypal.label,
    availableCents,
    asOf: deps.clock.now(),
    source: "searchBalances",
  });
  return availableCents;
}

/**
 * Both boot steps, then the balance reading every 12 h. Failures are logged and never stop the server (without a
 * reading the quota falls back to the simulator's opening balance, labelled). Returns a stop for the timer.
 */
export async function bootInProcessSimulator(deps: BootDeps): Promise<() => void> {
  const log = deps.logger.child({ component: "paypal-sim" });
  try {
    const ended = await endJudgeSessionsAtBoot(deps);
    if (ended.length > 0) log.info({ ended: ended.length }, "judge sessions of the previous simulator ended");
  } catch (err) {
    log.warn({ err }, "ending the previous judge sessions failed");
  }
  const read = async () => {
    try {
      const cents = await recordSimulatorBalance(deps);
      log.info({ availableCents: cents }, "simulated balance read (searchBalances)");
    } catch (err) {
      log.warn({ err }, "reading the simulated balance failed");
    }
  };
  await read();
  const timer = setInterval(() => void read(), BALANCE_READING_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
