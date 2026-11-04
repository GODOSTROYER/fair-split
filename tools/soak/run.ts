// The judge-load soak (handoff T5): N concurrent judges through the 60-second loop against a running stack, with
// server samples on a timer. Plain Node over HTTP; each judge has its own cookie jar and its own loopback source
// address, so fs-api's per-IP throttles see separate networks (pass --shared-ip to put every judge behind one
// address, as judges behind one NAT would be).
//
//   corepack pnpm exec tsx tools/soak/stack.ts &                     # the stack (state in .codex-scratch/soak)
//   corepack pnpm exec tsx tools/soak/run.ts --judges=10 --label=n10 # one round: 10 judges at once
//   corepack pnpm exec tsx tools/soak/run.ts --judges=10 --minutes=125 --label=long   # 10 workers, looping
//
// Options: --judges=N  --rounds=R (each worker runs R loops; default 1)  --minutes=M (loop until M minutes pass,
// instead of rounds)  --ramp-s=S (spread the workers' first press over S seconds; default 0, all at once)
// --label=NAME  --out=DIR (default .codex-scratch/soak/out)  --state=FILE (the soak stack's state)
// --origin=URL (instead of the state file; then no server samples)  --sample-s=30  --ip-base=10 (second octet of
// the judges' addresses)  --shared-ip  --judge-rows=500 (cap on per-judge CSV rows)  --step-s=180 (how long a judge
// waits for any one step before giving up and pressing Reset)  --prod-quota[=N] (LOCAL stack only: labelled synthetic
// reservations bring the e2e stack's raised hourly cap down to N live payouts per clock hour, default production's 3;
// 0 makes every run a labelled replay, the hosted demo once an hour's three are used).
//
// Writes, in --out: <label>-judges.csv (one row per judge, capped), <label>-minutes.csv (per-minute aggregate,
// appended as it goes), <label>-metrics.csv (server samples, appended), <label>-endpoints.csv and
// <label>-summary.json at the end. Prints the summary. No token, cookie, key or database URL is ever written.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Exchange, JudgeClient, sleep } from "./client.js";
import { type FanoutSample, type JudgeResult, runJudge } from "./judge.js";
import {
  emulateProductionHourlyQuota,
  SAMPLE_COLUMNS,
  type ServerSample,
  sampleServer,
  stuckOutboxRows,
} from "./sample.js";
import { csvLine, judgeAddress, parseArgs, summarize, tally, toCsv } from "./stats.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const JUDGE_COLUMNS: readonly (keyof JudgeResult & string)[] = [
  "judge",
  "ip",
  "outcome",
  "failedAt",
  "detail",
  "rail",
  "railReason",
  "payoutRail",
  "payoutReason",
  "pressStatus",
  "pressMs",
  "invoicedMs",
  "fundedMs",
  "inReviewMs",
  "keysMs",
  "postingMs",
  "postedMs",
  "settledMs",
  "proofMs",
  "resetMs",
  "markPaidQueued",
  "cashPaced",
  "proofStatus",
  "payoutPlate",
  "paypalVerified",
  "labelViolations",
  "labelNotes",
  "lines",
  "paidLineProvenance",
  "exportItems",
  "events",
  "streamRefusals",
  "streamReconnects",
];

const MINUTE_COLUMNS = [
  "minute",
  "at",
  "load1",
  "judgesDone",
  "settled",
  "refused",
  "stuck",
  "errors",
  "live",
  "replay",
  "postingP50S",
  "postingP95S",
  "resetP95Ms",
  "requests",
  "r429",
  "r5xx",
  "netErrors",
  "fanoutP95Ms",
  "labelViolations",
  "rssMb",
  "fds",
  "dbConns",
  "outboxStuck",
] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const judges = Number(args.get("judges") ?? "10");
  const rounds = Number(args.get("rounds") ?? "1");
  const minutes = args.has("minutes") ? Number(args.get("minutes")) : null;
  const rampS = Number(args.get("ramp-s") ?? "0");
  const label = args.get("label") ?? `n${judges}`;
  const outDir = path.resolve(args.get("out") ?? path.join(REPO_ROOT, ".codex-scratch", "soak", "out"));
  const statePath = path.resolve(
    args.get("state") ?? path.join(REPO_ROOT, ".codex-scratch", "soak", "stack.json"),
  );
  const sampleS = Number(args.get("sample-s") ?? "30");
  const ipBase = Number(args.get("ip-base") ?? "10");
  const sharedIp = args.has("shared-ip");
  const judgeRowCap = Number(args.get("judge-rows") ?? "500");
  const stepMs = Number(args.get("step-s") ?? "180") * 1000;
  // --prod-quota[=N]: leave N live payouts in each clock hour (production's 3 by default; 0 = every payout replays)
  const prodQuota = args.has("prod-quota");
  const liveLeft = args.get("prod-quota") === "true" ? 3 : Number(args.get("prod-quota") ?? "3");

  let origin = args.get("origin") ?? null;
  let pid = 0;
  let databaseUrl: string | null = null;
  if (!origin) {
    if (!existsSync(statePath))
      throw new Error(`no stack state at ${statePath}: start tools/soak/stack.ts first`);
    const st = JSON.parse(readFileSync(statePath, "utf8")) as {
      origin: string;
      pid: number;
      databaseUrl: string;
    };
    origin = st.origin;
    pid = st.pid;
    databaseUrl = st.databaseUrl;
  }
  mkdirSync(outDir, { recursive: true });
  const file = (suffix: string) => path.join(outDir, `${label}-${suffix}`);
  writeFileSync(file("judges.csv"), csvLine(JUDGE_COLUMNS));
  writeFileSync(file("metrics.csv"), csvLine(SAMPLE_COLUMNS));
  writeFileSync(file("minutes.csv"), csvLine(MINUTE_COLUMNS));
  const log = (line: string) => process.stdout.write(`[soak ${label}] ${new Date().toISOString()} ${line}\n`);

  // --prod-quota: production's three live payouts per clock hour, emulated with labelled synthetic reservations
  let quotaHour = -1;
  const emulateQuota = async () => {
    if (!prodQuota || !databaseUrl) return;
    const hour = Math.floor(Date.now() / 3_600_000);
    if (hour === quotaHour) return;
    quotaHour = hour;
    const lane = await new JudgeClient({ origin: origin as string }).get("lane", "/v1/judge/lane");
    const cap =
      (lane.json as { rail?: { quota?: { hourlyCap?: number } } } | null)?.rail?.quota?.hourlyCap ?? 0;
    const n = await emulateProductionHourlyQuota(databaseUrl, cap, liveLeft);
    log(
      `prod-quota: ${n} labelled synthetic reservations leave ${liveLeft} of the hour's ${cap} live payouts`,
    );
  };
  await emulateQuota();
  const startedAt = Date.now();
  const deadline = minutes === null ? null : startedAt + minutes * 60_000;
  const results: JudgeResult[] = [];
  const exchanges: Exchange[] = [];
  const fanout: FanoutSample[] = [];
  const samples: ServerSample[] = [];
  let judgeRows = 0;
  let nextJudge = 0;
  // per-minute window
  let minute = 0;
  let windowResults: JudgeResult[] = [];
  let windowExchanges: Exchange[] = [];
  let windowFanout: FanoutSample[] = [];

  const takeSample = async () => {
    if (!pid) return null;
    const s = await sampleServer({ pid, databaseUrl, startedAt });
    samples.push(s);
    appendFileSync(file("metrics.csv"), csvLine(SAMPLE_COLUMNS.map((c) => s[c])));
    return s;
  };
  const baseline = await takeSample();
  if (baseline)
    log(`baseline rss ${baseline.rssMb.toFixed(0)} MB, fds ${baseline.fds}, db conns ${baseline.dbConns}`);

  let running = true;
  const sampler = (async () => {
    while (running) {
      await sleep(sampleS * 1000);
      if (running) {
        await emulateQuota();
        await takeSample();
      }
    }
  })();
  const minuteWriter = (async () => {
    while (running) {
      await sleep(60_000);
      minute++;
      const last = samples.at(-1);
      const rs = windowResults;
      const ex = windowExchanges;
      const fo = windowFanout;
      windowResults = [];
      windowExchanges = [];
      windowFanout = [];
      const posting = summarize(rs.map((r) => r.postingMs / 1000));
      const row = [
        minute,
        new Date().toISOString(),
        last?.load1,
        rs.length,
        rs.filter((r) => r.outcome === "settled").length,
        rs.filter((r) => r.outcome === "press_refused").length,
        rs.filter((r) => r.outcome === "stuck").length,
        rs.filter((r) => r.outcome === "error").length,
        rs.filter((r) => r.payoutRail === "live").length,
        rs.filter((r) => r.payoutRail === "replay").length,
        posting.p50,
        posting.p95,
        summarize(rs.map((r) => r.resetMs)).p95,
        ex.length,
        ex.filter((x) => x.status === 429).length,
        ex.filter((x) => x.status >= 500).length,
        ex.filter((x) => x.status < 0).length,
        summarize(fo.filter((f) => f.tail).map((f) => Math.max(f.lagA, f.lagB))).p95,
        rs.reduce((n, r) => n + r.labelViolations, 0),
        last?.rssMb,
        last?.fds,
        last?.dbConns,
        last?.outboxStuck,
      ];
      appendFileSync(file("minutes.csv"), csvLine(row));
      if (minutes !== null) {
        log(
          `minute ${minute}: ${rs.length} judges done (${tally(rs.map((r) => r.outcome))}), rss ${last?.rssMb?.toFixed(0)} MB, fds ${last?.fds}, db ${last?.dbConns}`,
        );
      }
    }
  })();

  const record = (r: JudgeResult, client: JudgeClient) => {
    results.push(r);
    windowResults.push(r);
    exchanges.push(...client.exchanges);
    windowExchanges.push(...client.exchanges);
    if (judgeRows < judgeRowCap) {
      appendFileSync(file("judges.csv"), csvLine(JUDGE_COLUMNS.map((c) => r[c])));
      judgeRows++;
    }
    if (minutes === null || r.outcome !== "settled") {
      log(
        `judge ${r.judge} ${r.outcome}${r.failedAt ? ` at ${r.failedAt} (${r.detail})` : ""} rail ${r.rail}/${r.payoutRail}${r.payoutReason ? ` ${r.payoutReason}` : ""} posting ${(r.postingMs / 1000).toFixed(1)} s reset ${r.resetMs} ms proof ${r.proofStatus} labels ${r.labelViolations}`,
      );
    }
  };

  const worker = async (w: number) => {
    if (rampS > 0) await sleep((rampS * 1000 * w) / judges);
    for (let round = 0; ; round++) {
      if (deadline === null ? round >= rounds : Date.now() >= deadline) return;
      const n = nextJudge++;
      const client = new JudgeClient({
        origin: origin as string,
        localAddress: sharedIp ? undefined : judgeAddress(n, ipBase),
      });
      try {
        const r = await runJudge(n, client, {
          stepMs,
          fanout: (s) => {
            fanout.push(s);
            windowFanout.push(s);
          },
        });
        record(r, client);
        // a refused judge waits as a person would before trying again, instead of hammering the press
        if (r.outcome === "press_refused") await sleep(10_000);
      } finally {
        client.close();
      }
    }
  };
  log(
    `${judges} judges, ${minutes === null ? `${rounds} round(s)` : `${minutes} min`}, ${sharedIp ? "one shared address" : `own addresses 127.${ipBase}.x.y`}, origin ${origin}`,
  );
  await Promise.all(Array.from({ length: judges }, (_, w) => worker(w)));
  running = false;
  const end = await takeSample();
  await Promise.race([sampler, sleep(100)]);
  await Promise.race([minuteWriter, sleep(100)]);

  // endpoints
  const byName = new Map<string, Exchange[]>();
  for (const x of exchanges) byName.set(x.name, [...(byName.get(x.name) ?? []), x]);
  const endpointRows = [...byName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, xs]) => {
      const ms = summarize(xs.map((x) => x.ms));
      return {
        name,
        n: xs.length,
        p50Ms: ms.p50,
        p95Ms: ms.p95,
        maxMs: ms.max,
        s2xx: xs.filter((x) => x.status >= 200 && x.status < 300).length,
        s4xx: xs.filter((x) => x.status >= 400 && x.status < 500 && x.status !== 429).length,
        s429: xs.filter((x) => x.status === 429).length,
        s5xx: xs.filter((x) => x.status >= 500).length,
        netErr: xs.filter((x) => x.status < 0).length,
        codes: tally(xs.filter((x) => x.code).map((x) => `${x.status}/${x.code}`)),
      };
    });
  writeFileSync(
    file("endpoints.csv"),
    toCsv(
      ["name", "n", "p50Ms", "p95Ms", "maxMs", "s2xx", "s4xx", "s429", "s5xx", "netErr", "codes"],
      endpointRows,
    ),
  );

  const settled = results.filter((r) => r.outcome === "settled");
  const sec = (xs: number[]) => {
    const s = summarize(xs.map((x) => x / 1000));
    return { n: s.n, p50: s.p50, p95: s.p95, max: s.max };
  };
  const rss = samples.map((s) => s.rssMb).filter(Number.isFinite);
  const fds = samples.map((s) => s.fds).filter(Number.isFinite);
  const summary = {
    label,
    judges,
    stepS: stepMs / 1000,
    prodQuota: prodQuota ? liveLeft : null,
    rounds: minutes === null ? rounds : null,
    minutes,
    sharedIp,
    startedAt: new Date(startedAt).toISOString(),
    wallS: Math.round((Date.now() - startedAt) / 1000),
    loadAtStart: baseline ? [baseline.load1, baseline.load5, baseline.load15] : null,
    loadAtEnd: end ? [end.load1, end.load5, end.load15] : null,
    loadMax1: samples.length ? Math.max(...samples.map((s) => s.load1)) : null,
    judgesRun: results.length,
    outcomes: tally(results.map((r) => r.outcome)),
    failedAt: tally(results.filter((r) => r.failedAt).map((r) => `${r.failedAt}:${r.detail.slice(0, 60)}`)),
    railAtPress: tally(results.map((r) => `${r.rail || "-"}${r.railReason ? `/${r.railReason}` : ""}`)),
    railAtPayout: tally(
      results
        .filter((r) => r.payoutRail)
        .map((r) => `${r.payoutRail}${r.payoutReason ? `/${r.payoutReason}` : ""}`),
    ),
    proofStatus: tally(settled.map((r) => `${r.payoutRail}:${r.proofStatus}`)),
    paidLineProvenance: tally(settled.map((r) => `${r.payoutRail}:${r.paidLineProvenance}`)),
    exportItems: tally(settled.filter((r) => r.exportItems).map((r) => r.exportItems)),
    pressToPostingS: sec(results.map((r) => r.postingMs)),
    pressToPostingLiveS: sec(results.filter((r) => r.payoutRail === "live").map((r) => r.postingMs)),
    pressToPostingReplayS: sec(results.filter((r) => r.payoutRail === "replay").map((r) => r.postingMs)),
    pressToPostedS: sec(results.map((r) => r.postedMs)),
    pressToInReviewS: sec(results.map((r) => r.inReviewMs)),
    pressToSettledS: sec(results.map((r) => r.settledMs)),
    pressAnswerMs: summarize(exchanges.filter((x) => x.name === "press").map((x) => x.ms)),
    resetMs: summarize(results.map((r) => r.resetMs)),
    within60s: results.filter((r) => r.postingMs <= 60_000).length,
    markPaidQueued: results.reduce((n, r) => n + r.markPaidQueued, 0),
    cashPaced: tally(results.filter((r) => r.cashPaced).map((r) => r.cashPaced)),
    fanout: {
      events: fanout.length,
      bursts: fanout.filter((f) => f.tail).length,
      /** commit → delivery estimate: the last-written event of each burst, the slower of the two streams */
      burstTailMs: summarize(fanout.filter((f) => f.tail).map((f) => Math.max(f.lagA, f.lagB))),
      /** every event's write → delivery (also counts the rest of its transaction): an upper bound */
      writeToArrivalMs: summarize(fanout.map((f) => Math.max(f.lagA, f.lagB))),
      spreadMs: summarize(fanout.map((f) => f.spread)),
    },
    requests: exchanges.length,
    r429: exchanges.filter((x) => x.status === 429).length,
    r4xxOther: exchanges.filter(
      (x) => x.status >= 400 && x.status < 500 && x.status !== 429 && x.name !== "run-after-reset",
    ).length,
    r5xx: exchanges.filter((x) => x.status >= 500).length,
    netErrors: exchanges.filter((x) => x.status < 0).length,
    streamRefusals: results.reduce((n, r) => n + r.streamRefusals, 0),
    streamReconnects: results.reduce((n, r) => n + r.streamReconnects, 0),
    labelViolations: results.reduce((n, r) => n + r.labelViolations, 0),
    labelNotes: tally(results.filter((r) => r.labelNotes).map((r) => r.labelNotes)),
    server: {
      rssMbStart: baseline?.rssMb ?? null,
      rssMbEnd: end?.rssMb ?? null,
      rssMbMax: rss.length ? Math.max(...rss) : null,
      fdsStart: baseline?.fds ?? null,
      fdsEnd: end?.fds ?? null,
      fdsMax: fds.length ? Math.max(...fds) : null,
      dbConnsMax: samples.length ? Math.max(...samples.map((s) => s.dbConns).filter(Number.isFinite)) : null,
      dbConnsEnd: end?.dbConns ?? null,
      outboxStuckMax: samples.length
        ? Math.max(...samples.map((s) => s.outboxStuck).filter(Number.isFinite))
        : null,
      outboxDeadEnd: end?.outboxDead ?? null,
      paypalWindowMax: samples.length
        ? Math.max(...samples.map((s) => s.paypalWindow).filter(Number.isFinite))
        : null,
      paypal429h: end?.paypal429h ?? null,
      stuckRows: databaseUrl ? await stuckOutboxRows(databaseUrl) : "",
    },
  };
  writeFileSync(file("summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`[soak] ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
