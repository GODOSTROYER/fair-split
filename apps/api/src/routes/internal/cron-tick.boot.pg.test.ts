// fs-cron's real trigger against a really booted fs-api: `startServer()` (env parse, the fs_app role check, the
// LISTEN bus, the outbox dispatcher, the listening port, the folders' boot hooks) on a fresh migrated database of
// the run's embedded cluster, then `node tools/cron-tick.mjs` exactly as Render's fs-cron runs it. The first run
// takes the tick, the second within 30 minutes is refused, and the judgeReset pass the tick enqueued is run by the
// booted server's own dispatcher.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schema } from "@fairsplit/db";
import { openTestDb, type TestDb } from "@fairsplit/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../../server.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
// made for this run only, never printed
const SECRET = randomBytes(24).toString("base64url");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

let db: TestDb;
let running: RunningServer;
let hostport = "";

beforeAll(async () => {
  db = await openTestDb({ max: 2 });
  const port = await freePort();
  hostport = `127.0.0.1:${port}`;
  running = await startServer({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_ORIGIN: `http://${hostport}`,
    DATABASE_URL: db.url,
    PP_ENV: "sandbox",
    PP_MODE: "simulator",
    EXECUTOR: "inline",
    FS_COOKIE_SECRET: randomBytes(32).toString("hex"),
    FS_LINK_SIGNING_KEY: randomBytes(32).toString("hex"),
    CRON_SECRET: SECRET,
  });
});

afterAll(async () => {
  await running?.stop("test done");
  await db?.close();
});

function cronTick(secret = SECRET): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/cron-tick.mjs"], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        FS_API_HOSTPORT: hostport,
        CRON_SECRET: secret,
        CRON_TICK_BACKOFF_MS: "0,0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, out }));
  });
}

describe("tools/cron-tick.mjs against a booted fs-api", () => {
  it("a wrong secret is refused (401) and takes nothing", async () => {
    const r = await cronTick(`${SECRET}-wrong`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/HTTP 401/);
    expect(r.out).not.toContain(SECRET);
  });

  it("the first run takes the tick and prints the tasks it enqueued", async () => {
    const r = await cronTick();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/OK 202 \(attempt 1\); tasks: judgeReset \(new\)/);
    // every pass's jobs (the nightly reconcile joins them from 02:00 to 05:59 UTC)
    expect(r.out).toMatch(/warmCaches \((new|already queued)\)/);
    expect(r.out).not.toContain(SECRET);
  });

  it("a second run within 30 minutes is refused: exit 2, nothing enqueued", async () => {
    const before = await db.owner.db.select({ id: schema.taskOutbox.id }).from(schema.taskOutbox);
    const r = await cronTick();
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/REFUSED 429/);
    expect(r.out).toMatch(/retry after \d+ s/);
    const after = await db.owner.db.select({ id: schema.taskOutbox.id }).from(schema.taskOutbox);
    expect(after.length).toBe(before.length);
  });

  it("the booted server's dispatcher runs the judgeReset pass the tick enqueued", async () => {
    const ot = schema.taskOutbox;
    const until = Date.now() + 90_000;
    let rows: { state: string; dedupeKey: string }[] = [];
    while (Date.now() < until) {
      rows = await db.owner.db
        .select({ state: ot.state, dedupeKey: ot.dedupeKey })
        .from(ot)
        .where(eq(ot.name, "judgeReset"));
      if (rows.length > 0 && rows.every((x) => x.state === "done" || x.state === "dead")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupeKey).toMatch(/^reset:pool:\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(rows[0]?.state).toBe("done");
  });
});
