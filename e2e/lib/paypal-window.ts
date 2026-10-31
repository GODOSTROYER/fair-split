// PayPal's window as fs-api's limiter keeps it (packages/db limiter.ts, register §8): at most 40 calls in any sliding
// 60 s, at most 20 of them background, and a 429 opens a 6-minute circuit. On the stack it is the `paypal_calls`
// table of the stack's own database, which global setup passes to the specs as E2E_DATABASE_URL (never printed); the
// probe reads it through the limiter's own `state()`, so it counts exactly what fs-api counts.
//
// A judge run spends 10 live calls, 7 of them within a second of INVOICED. Meanwhile its settle checks take up to the 20
// background slots. Two runs inside one minute can therefore leave too little room, and the second run's Mark paid is
// QUEUED. So every press first waits until the earlier runs' live calls have aged out far enough (`roomFor`), and a
// step PayPal still paces is honoured, not failed (api.ts `honourQueued`). Against a hosted origin (E2E_BASE_URL set by
// hand) there is no database: the probe reads nothing and waits for nothing.
import { createDb, createLimiter, type Database, LIMITER_DEFAULTS } from "@fairsplit/db";
import { sleep } from "./api.js";

/** The purpose the pacing spec's filler rows carry: left out of every peak this harness reports. */
export const FILLER_PURPOSE = "e2e:pacing-filler";

/**
 * Live calls one judge run makes, measured on the stack (10: create_invoice, send_invoice, three get_invoice, the
 * conditional rules and record_payment, then payouts.create and Rhea's cancel, and the shared OAuth token) with a
 * margin of 2. Payouts.get, the item checks, the balance and the webhook certificate are background.
 */
export const RUN_LIVE_CALLS = 12;
/** Live calls from the first press to FUNDED: the 7 invoice calls and the OAuth token. */
export const PRESS_LIVE_CALLS = 8;

export interface WindowReading {
  /** Calls in the last 60 s, every priority. */
  inWindow: number;
  background: number;
  live: number;
  circuitOpen: boolean;
  perWindow: number;
  backgroundPerWindow: number;
  windowMs: number;
}

/** The most live calls of earlier runs the window may hold when a step that needs `need` live calls starts. */
export function liveRoom(need: number, limits = LIMITER_DEFAULTS): number {
  return limits.perWindow - limits.backgroundPerWindow - need;
}

let database: Database | null = null;

function stackDb(): Database | null {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return null;
  database ??= createDb(url, { max: 1, idleTimeout: 5, applicationName: "fs-e2e-window-probe" });
  return database;
}

/** Ends the probe's one connection (global teardown, before the database is dropped). */
export async function closeWindowProbe(): Promise<void> {
  const d = database;
  database = null;
  await d?.close();
}

/** PayPal's window now, as the limiter reads it; null with no stack database. */
export async function readWindow(): Promise<WindowReading | null> {
  const d = stackDb();
  if (!d) return null;
  const s = await createLimiter(d.db).state();
  return {
    inWindow: s.inWindow,
    background: s.backgroundInWindow,
    live: s.inWindow - s.backgroundInWindow,
    circuitOpen: s.circuitOpenUntil !== null && s.circuitOpenUntil.getTime() > Date.now(),
    perWindow: s.limits.perWindow,
    backgroundPerWindow: s.limits.backgroundPerWindow,
    windowMs: s.limits.windowMs,
  };
}

export interface Room {
  /** How long the press waited for room, in ms. */
  waitedMs: number;
  before: WindowReading;
  /** The window when the wait ended: what the press found. */
  after: WindowReading;
}

/**
 * Waits until PayPal's window has room for a step that makes `need` live calls even if the background share fills
 * meanwhile: at most `liveRoom(need)` live calls of earlier runs, and no open circuit. Null with no stack database
 * (nothing read, nothing waited). Throws after `maxMs`, naming the last reading.
 */
export async function roomFor(need: number, maxMs = 120_000): Promise<Room | null> {
  const before = await readWindow();
  if (!before) return null;
  const started = Date.now();
  let now = before;
  while (now.live > liveRoom(need) || now.circuitOpen) {
    if (Date.now() - started > maxMs) {
      throw new Error(
        `no room in PayPal's window for ${need} live calls after ${maxMs / 1000} s: ${describeWindow(now)}`,
      );
    }
    await sleep(500);
    now = (await readWindow()) ?? now;
  }
  const waitedMs = Date.now() - started;
  if (waitedMs > 0) {
    process.stdout.write(
      `[paypal-window] waited ${(waitedMs / 1000).toFixed(1)} s for room for ${need} live calls: live ${before.live} → ${now.live} of ${now.perWindow}\n`,
    );
  }
  return { waitedMs, before, after: now };
}

/**
 * Fills PayPal's window for the pacing spec: as many finished calls as the window holds, recorded through the
 * limiter's own `insertCompleted` (calls that took no slot here still count) with the filler purpose and dated so
 * they leave the window `freesInMs` from now. Nothing is sent anywhere; fs-api's next live step finds the window
 * full until then.
 */
export async function fillWindow(o: { freesInMs: number }): Promise<{ rows: number; freesAt: Date }> {
  const d = stackDb();
  if (!d) throw new Error("fillWindow needs the stack's own database (E2E_DATABASE_URL)");
  const [row] = await d.sql<{ now: Date }[]>`select clock_timestamp() as now`;
  const now = new Date(row?.now ?? Date.now());
  const at = new Date(now.getTime() - LIMITER_DEFAULTS.windowMs + o.freesInMs);
  const limiter = createLimiter(d.db);
  for (let i = 0; i < LIMITER_DEFAULTS.perWindow; i++) {
    await limiter.insertCompleted({
      at,
      purpose: FILLER_PURPOSE,
      priority: "live",
      method: "GET",
      path: "e2e:filler",
      status: 200,
      ms: 0,
    });
  }
  return { rows: LIMITER_DEFAULTS.perWindow, freesAt: new Date(at.getTime() + LIMITER_DEFAULTS.windowMs) };
}

export function describeWindow(w: WindowReading): string {
  return `${w.inWindow} of ${w.perWindow} calls in the last ${w.windowMs / 1000} s (live ${w.live}, background ${w.background} of ${w.backgroundPerWindow})${w.circuitOpen ? ", circuit open" : ""}`;
}

export interface Peak {
  /** The most calls the window ever held in [from, to] (at each grant: the calls in the 60 s up to it). */
  peak: number;
  live: number;
  background: number;
}

/** The window's peak over [from, to], the pacing spec's filler left out; null with no stack database. */
export async function peakWindow(from: Date, to: Date = new Date()): Promise<Peak | null> {
  const d = stackDb();
  if (!d) return null;
  const windowSec = LIMITER_DEFAULTS.windowMs / 1000;
  const rows = await d.sql<{ peak: number; live: number; background: number }[]>`
    select n.total::int as peak, n.live::int as live, n.background::int as background
      from paypal_calls p
      cross join lateral (
        select count(*) as total,
               count(*) filter (where q.priority = 'live') as live,
               count(*) filter (where q.priority = 'background') as background
          from paypal_calls q
         where q.at > p.at - make_interval(secs => ${windowSec}) and q.at <= p.at
           and q.purpose <> ${FILLER_PURPOSE}) n
     where p.at >= ${from.toISOString()}::timestamptz and p.at <= ${to.toISOString()}::timestamptz
       and p.purpose <> ${FILLER_PURPOSE}
     order by n.total desc, n.live desc
     limit 1`;
  return rows[0] ?? { peak: 0, live: 0, background: 0 };
}

export function describePeak(p: Peak, limits = LIMITER_DEFAULTS): string {
  return `${p.peak} of ${limits.perWindow} in any ${limits.windowMs / 1000} s (live ${p.live}, background ${p.background})`;
}
