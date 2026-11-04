// Server-side samples for the judge-load soak, taken from outside fs-api: its resident memory and open file
// descriptors (/proc/<pid>, Linux), the host's load averages, and the stack's own database through `psql`
// (connections, the outbox and PayPal's limiter window). The database URL comes from the soak stack's state file and
// is never printed. Without /proc or psql the matching columns stay empty.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";

export interface ServerSample {
  at: string;
  elapsedS: number;
  load1: number;
  load5: number;
  load15: number;
  rssMb: number;
  fds: number;
  /** Connections to the stack's database (pg_stat_activity), all states, and the active ones. */
  dbConns: number;
  dbActive: number;
  dbIdleInTx: number;
  /** task_outbox: queued past its run_after by > 5 min; dispatched/running with no update for > 5 min; dead. */
  outboxStuck: number;
  outboxQueued: number;
  outboxDead: number;
  /** PayPal (simulated) calls recorded in the last 60 s (the limiter's window: 40 allowed) and 429s in the hour. */
  paypalWindow: number;
  paypal429h: number;
  runEvents: number;
}

const SQL = `select
  (select count(*) from pg_stat_activity where datname = current_database()),
  (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'),
  (select count(*) from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'),
  (select count(*) from task_outbox where (state = 'queued' and run_after < now() - interval '5 minutes')
     or (state in ('dispatched', 'running') and updated_at < now() - interval '5 minutes')),
  (select count(*) from task_outbox where state = 'queued'),
  (select count(*) from task_outbox where state = 'dead'),
  (select count(*) from paypal_calls where at > now() - interval '60 seconds'),
  (select count(*) from paypal_calls where status = 429 and at > now() - interval '1 hour'),
  (select count(*) from run_events)`;

function psql(url: string, sql: string): Promise<string | null> {
  const bin = process.env.FS_SOAK_PSQL ?? "psql";
  return new Promise((resolve) => {
    execFile(bin, [url, "-AtqX", "-F,", "-c", sql], { timeout: 20_000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim()),
    );
  });
}

function procStatus(pid: number): { rssMb: number; fds: number } {
  let rssMb = Number.NaN;
  let fds = Number.NaN;
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    if (m?.[1]) rssMb = Number(m[1]) / 1024;
  } catch {
    // no /proc (not Linux) or the process is gone
  }
  try {
    fds = readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    // as above
  }
  return { rssMb, fds };
}

/** Every outbox row the soak saw stuck, by name and state (for the report's repro). */
export async function stuckOutboxRows(databaseUrl: string): Promise<string> {
  const out = await psql(
    databaseUrl,
    `select name, state, count(*) from task_outbox where (state = 'queued' and run_after < now() - interval '5 minutes')
       or (state in ('dispatched', 'running') and updated_at < now() - interval '5 minutes') or state = 'dead'
     group by 1, 2 order by 3 desc limit 20`,
  );
  return out ?? "";
}

export async function sampleServer(o: {
  pid: number;
  databaseUrl: string | null;
  startedAt: number;
}): Promise<ServerSample> {
  const [l1, l5, l15] = loadavg();
  const proc = procStatus(o.pid);
  const row = o.databaseUrl ? await psql(o.databaseUrl, SQL) : null;
  const n = (row ?? "").split(",").map((x) => (x === "" ? Number.NaN : Number(x)));
  const at = (i: number) => (row === null ? Number.NaN : (n[i] ?? Number.NaN));
  return {
    at: new Date().toISOString(),
    elapsedS: Math.round((Date.now() - o.startedAt) / 1000),
    load1: l1 ?? Number.NaN,
    load5: l5 ?? Number.NaN,
    load15: l15 ?? Number.NaN,
    rssMb: proc.rssMb,
    fds: proc.fds,
    dbConns: at(0),
    dbActive: at(1),
    dbIdleInTx: at(2),
    outboxStuck: at(3),
    outboxQueued: at(4),
    outboxDead: at(5),
    paypalWindow: at(6),
    paypal429h: at(7),
    runEvents: at(8),
  };
}

export const SAMPLE_COLUMNS: readonly (keyof ServerSample & string)[] = [
  "at",
  "elapsedS",
  "load1",
  "load5",
  "load15",
  "rssMb",
  "fds",
  "dbConns",
  "dbActive",
  "dbIdleInTx",
  "outboxStuck",
  "outboxQueued",
  "outboxDead",
  "paypalWindow",
  "paypal429h",
  "runEvents",
];
