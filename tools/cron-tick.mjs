// fs-cron's whole job (approved S3.3 and S3.14): at :07 UTC every hour, POST fs-api's
// /internal/cron/tick over Render's private network. fs-api checks CRON_SECRET in constant time,
// accepts at most one tick per 30 minutes, and enqueues the hour's scheduled tasks through the
// transactional outbox (the plan is apps/tasks/src/cron.ts). fs-cron's build is `true`, so this file
// has no dependencies and runs on bare Node.
//
//   node tools/cron-tick.mjs
//
// Env: FS_API_HOSTPORT (render.yaml: fs-api's `hostport`, e.g. `fs-api-x1y2:10000`) and CRON_SECRET
// (shared from fs-api). Contract with fs-api: `POST /internal/cron/tick`,
// `Authorization: Bearer <CRON_SECRET>`, JSON body `{"at": "<ISO time>"}`.
// Exit 0 when fs-api took the tick (2xx) or had already taken one in this half hour (429); exit 1
// otherwise, so the Render cron run shows as failed. Connection errors and 5xx are retried twice
// (CRON_TICK_BACKOFF_MS, default "2000,8000"); a missed hour is made up by the next tick, because
// the plan's dedupe keys cover whole slots. Prints status lines only, never the secret.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TICK_PATH = "/internal/cron/tick";
const TIMEOUT_MS = 30_000;
const HOSTPORT = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?:\d{1,5}$/;

/** @param {string | undefined} value */
function backoff(value) {
  const ms = (value ?? "2000,8000").split(",").map((v) => Number(v.trim()));
  return ms.every((n) => Number.isInteger(n) && n >= 0) ? ms : [2000, 8000];
}

/** @param {number} status */
const retryable = (status) => status >= 500;

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function tick(deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? ((line) => console.log(line));
  const hostport = (env.FS_API_HOSTPORT ?? "").trim();
  const secret = env.CRON_SECRET ?? "";
  if (!HOSTPORT.test(hostport)) {
    log("fs-cron tick: FAIL FS_API_HOSTPORT must be host:port (fs-api's private address)");
    return 1;
  }
  if (secret.length < 16) {
    log("fs-cron tick: FAIL CRON_SECRET is missing or too short");
    return 1;
  }
  const url = `http://${hostport}${TICK_PATH}`;
  const waits = backoff(env.CRON_TICK_BACKOFF_MS);
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "user-agent": "fs-cron",
        },
        body: JSON.stringify({ at: new Date().toISOString() }),
        // Never follow a redirect: the bearer secret goes to fs-api and nowhere else.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel();
    } catch (err) {
      log(`fs-cron tick: attempt ${attempt} unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    if (status >= 200 && status < 300) {
      log(`fs-cron tick: OK ${status} (attempt ${attempt})`);
      return 0;
    }
    if (status === 429) {
      log("fs-cron tick: OK 429, fs-api already took a tick in this half hour");
      return 0;
    }
    if (status !== 0) log(`fs-cron tick: attempt ${attempt} got HTTP ${status}`);
    const wait = waits[attempt - 1];
    if ((status !== 0 && !retryable(status)) || wait === undefined) {
      log("fs-cron tick: FAIL");
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

const isMain = (() => {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
})();

if (isMain) {
  tick().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.log("fs-cron tick: FAIL");
      process.exitCode = 1;
    },
  );
}
