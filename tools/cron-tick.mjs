// fs-cron's whole job (approved S3.3 and S3.14): at :07 UTC every hour, POST fs-api's
// /internal/cron/tick over Render's private network. fs-api checks CRON_SECRET in constant time,
// accepts at most one tick per 30 minutes, and enqueues the hour's scheduled tasks through the
// transactional outbox (the plan is apps/tasks/src/cron.ts). fs-cron's build is `true`, so this file
// has no dependencies and runs on bare Node.
//
//   node tools/cron-tick.mjs
//
// Env: FS_API_HOSTPORT (render.yaml: fs-api's `hostport`, e.g. `fs-api-x1y2:10000`; locally
// `127.0.0.1:8787`) and CRON_SECRET (shared from fs-api, at least 16 characters). Contract with fs-api
// (apps/api/src/routes/internal): `POST /internal/cron/tick`, `Authorization: Bearer <CRON_SECRET>`,
// JSON body `{"at": "<ISO time>"}`; a taken tick answers 202 `{at, nextTickFrom, tasks: [{task,
// dedupeKey, created}], skipped: [{task, dedupeKey, reason: "no handler"}]}` (`skipped`: jobs of the
// plan fs-api has no handler for, so it did not enqueue them), a tick within 30 minutes of the last
// answers 429 with Retry-After.
// Exit codes: 0 fs-api took the tick (2xx; the enqueued and the skipped task names are printed), or answered 429 to a
// retry after an attempt that failed (that attempt's tick most likely landed); 2 refused: a 429 on the
// first attempt (a tick was taken less than 30 minutes ago, nothing was enqueued); 1 anything else, so
// the Render cron run shows as failed. Connection errors and 5xx are retried twice
// (CRON_TICK_BACKOFF_MS, default "2000,8000"); a missed hour is made up by the next tick, because the
// plan's dedupe keys cover whole slots. Prints status lines and task names only, never the secret.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TICK_PATH = "/internal/cron/tick";
const TIMEOUT_MS = 30_000;
const HOSTPORT = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?:\d{1,5}$/;
/** The answer is read only this far; a longer one lists no tasks. */
const MAX_BODY_BYTES = 16_384;
/** Only plain task names (IC-01 TaskName shape) are ever printed from fs-api's answer. */
const TASK_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
/** Only plain lower-case words are printed as the reason fs-api skipped a job (`no handler`). */
const REASON = /^[a-z][a-z ]{0,39}$/;
const RETRY_AFTER = /^\d{1,6}$/;

/**
 * The body as text, or "" when it is missing, unreadable or longer than MAX_BODY_BYTES.
 * @param {Response} res
 */
async function readCapped(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return "";
      }
      chunks.push(value);
    }
  } catch {
    return "";
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * `judgeReset (new), warmCaches (already queued)` from a taken tick's answer, or `none listed`; then, when fs-api
 * skipped jobs it has no handler for, `; skipped, not enqueued: reconcile (no handler)`.
 * @param {string} text
 */
export function describeTasks(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "none listed";
  }
  /** @param {string} key */
  const listed = (key) => {
    const v =
      parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed)[key] : undefined;
    return Array.isArray(v) ? v : [];
  };
  const names = [];
  for (const t of listed("tasks")) {
    if (!t || typeof t !== "object") continue;
    const { task, created } = /** @type {{task?: unknown, created?: unknown}} */ (t);
    if (typeof task !== "string" || !TASK_NAME.test(task)) continue;
    names.push(created === true ? `${task} (new)` : created === false ? `${task} (already queued)` : task);
  }
  const skipped = [];
  for (const t of listed("skipped")) {
    if (!t || typeof t !== "object") continue;
    const { task, reason } = /** @type {{task?: unknown, reason?: unknown}} */ (t);
    if (typeof task !== "string" || !TASK_NAME.test(task)) continue;
    skipped.push(typeof reason === "string" && REASON.test(reason) ? `${task} (${reason})` : task);
  }
  const enqueued = names.length > 0 ? names.join(", ") : "none listed";
  return skipped.length > 0 ? `${enqueued}; skipped, not enqueued: ${skipped.join(", ")}` : enqueued;
}

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
  // an earlier attempt failed (unreachable or 5xx): fs-api may still have taken that attempt's tick
  let failedBefore = false;
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let text = "";
    let retryAfter = "";
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
      if (status >= 200 && status < 300) text = await readCapped(res);
      else {
        retryAfter = (res.headers.get("retry-after") ?? "").trim();
        await res.body?.cancel();
      }
    } catch (err) {
      log(`fs-cron tick: attempt ${attempt} unreachable (${err instanceof Error ? err.name : "error"})`);
    }
    if (status >= 200 && status < 300) {
      log(`fs-cron tick: OK ${status} (attempt ${attempt}); tasks: ${describeTasks(text)}`);
      return 0;
    }
    if (status === 429 && failedBefore) {
      log("fs-cron tick: OK 429 after a failed attempt: fs-api already has this half hour's tick");
      return 0;
    }
    if (status === 429) {
      const after = RETRY_AFTER.test(retryAfter) ? `; retry after ${retryAfter} s` : "";
      log(`fs-cron tick: REFUSED 429, fs-api took a tick less than 30 minutes ago; nothing enqueued${after}`);
      return 2;
    }
    failedBefore = true;
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
