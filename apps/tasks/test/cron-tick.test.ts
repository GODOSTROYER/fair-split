// tools/cron-tick.mjs is fs-cron's whole start command (approved S3.14). It runs here exactly as
// Render runs it, `node tools/cron-tick.mjs`, against a local stand-in for fs-api's tick endpoint.
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";

const SECRET = ["cron", "secret", "for", "tests", "only", "0001"].join("-");

interface Seen {
  method: string | undefined;
  url: string | undefined;
  auth: string | undefined;
  body: string;
}

let server: Server;
let port = 0;
let seen: Seen[] = [];
let replies: number[] = [];
/** Bodies fs-api answers with, in order (default: a taken tick's, or a refusal's for a 429). */
let bodies: string[] = [];

const TAKEN = JSON.stringify({
  at: "2026-11-01T10:07:00.000Z",
  nextTickFrom: "2026-11-01T10:37:00.000Z",
  tasks: [
    { task: "judgeReset", dedupeKey: "reset:pool:2026-11-01T10", created: true },
    { task: "warmCaches", dedupeKey: "warm:w1", created: false },
  ],
});

beforeEach(async () => {
  seen = [];
  replies = [];
  bodies = [];
  server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    seen.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    const status = replies.shift() ?? 202;
    const body = bodies.shift() ?? (status === 429 ? '{"code":"RATE_LIMITED"}' : TAKEN);
    if (status === 302) res.writeHead(302, { location: "http://example.invalid/steal" }).end();
    else if (status === 429)
      res.writeHead(429, { "content-type": "application/json", "retry-after": "1500" }).end(body);
    else res.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function runTick(env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  const base = { ...process.env };
  delete base.FS_API_HOSTPORT;
  delete base.CRON_SECRET;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/cron-tick.mjs"], {
      cwd: REPO_ROOT,
      env: { ...base, CRON_TICK_BACKOFF_MS: "0,0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
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

const env = () => ({ FS_API_HOSTPORT: `127.0.0.1:${port}`, CRON_SECRET: SECRET });

describe("tools/cron-tick.mjs (fs-cron, a thin trigger)", () => {
  it("POSTs the tick to fs-api with the bearer secret and exits 0 on 2xx", async () => {
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/internal/cron/tick", auth: `Bearer ${SECRET}` });
    expect(Number.isNaN(Date.parse((JSON.parse(seen[0]?.body ?? "{}") as { at: string }).at))).toBe(false);
    expect(r.out).toMatch(/OK 202/);
  });

  it("prints the task names fs-api enqueued, and which were already queued for their slot", async () => {
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(r.out).toContain("tasks: judgeReset (new), warmCaches (already queued)");
  });

  it("prints only plain task names from the answer, never other text it carries", async () => {
    bodies = [
      JSON.stringify({
        tasks: [
          { task: "judgeReset", created: true },
          { task: "\u001b[31mevil\nline", created: true },
          { task: "x".repeat(200), created: true },
          { created: true },
          "warmCaches",
        ],
      }),
    ];
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(r.out).toContain("tasks: judgeReset (new)");
    expect(r.out).not.toContain("evil");
    expect(r.out).not.toContain("x".repeat(50));
  });

  it("prints the jobs fs-api skipped because it has no handler for them, labelled, and still exits 0", async () => {
    bodies = [
      JSON.stringify({
        at: "2026-11-01T02:07:00.000Z",
        tasks: [{ task: "judgeReset", dedupeKey: "reset:pool:2026-11-01T02", created: true }],
        skipped: [
          {
            task: "reconcile",
            dedupeKey: "reconcile:nightly:2026-10-30T00:00:00.000Z",
            reason: "no handler",
          },
          { task: "warmCaches", dedupeKey: "warm:w1", reason: "no handler" },
        ],
      }),
    ];
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "tasks: judgeReset (new); skipped, not enqueued: reconcile (no handler), warmCaches (no handler)",
    );
  });

  it("prints only plain names and reasons from the skipped list", async () => {
    bodies = [
      JSON.stringify({
        tasks: [],
        skipped: [
          { task: "warmCaches", reason: "\u001b[31mevil\nreason" },
          { task: "\u001b[31mevil\nline", reason: "no handler" },
          "reconcile",
        ],
      }),
    ];
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(r.out).toContain("tasks: none listed; skipped, not enqueued: warmCaches");
    expect(r.out).not.toContain("evil");
  });

  it("a 2xx without a readable task list still counts as taken", async () => {
    bodies = ["not json"];
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/OK 202/);
    expect(r.out).toContain("tasks: none listed");
  });

  it("never prints the secret", async () => {
    replies = [503, 401];
    const r = await runTick(env());
    expect(r.out).not.toContain(SECRET);
    expect(r.out).not.toMatch(/Bearer/);
  });

  it("a 429 is a refusal: fs-api took a tick less than 30 minutes ago; exit 2, no retry", async () => {
    replies = [429];
    const r = await runTick(env());
    expect(r.code).toBe(2);
    expect(seen).toHaveLength(1);
    expect(r.out).toMatch(/REFUSED 429/);
    expect(r.out).toMatch(/retry after 1500 s/);
  });

  it("a 429 after a failed attempt (5xx or unreachable) counts as taken: that attempt may have landed", async () => {
    replies = [503, 429];
    const r = await runTick(env());
    expect(r.code).toBe(0);
    expect(seen).toHaveLength(2);
    expect(r.out).toMatch(/OK 429/);
  });

  it("retries a 5xx, then succeeds", async () => {
    replies = [503, 502, 200];
    await expect(runTick(env())).resolves.toMatchObject({ code: 0 });
    expect(seen).toHaveLength(3);
  });

  it("fails after three 5xx attempts, so the Render cron run shows as failed", async () => {
    replies = [503, 503, 503, 200];
    await expect(runTick(env())).resolves.toMatchObject({ code: 1 });
    expect(seen).toHaveLength(3);
  });

  it("does not retry a refused secret (401), and never follows a redirect with it", async () => {
    replies = [401];
    await expect(runTick(env())).resolves.toMatchObject({ code: 1 });
    expect(seen).toHaveLength(1);
    replies = [302];
    await expect(runTick(env())).resolves.toMatchObject({ code: 1 });
    expect(seen).toHaveLength(2);
  });

  it("retries an unreachable fs-api, then fails", async () => {
    const r = await runTick({ FS_API_HOSTPORT: "127.0.0.1:1", CRON_SECRET: SECRET });
    expect(r.code).toBe(1);
    expect(r.out.match(/unreachable/g)).toHaveLength(3);
  });

  it("refuses a missing or malformed configuration without sending anything", async () => {
    for (const bad of [
      { CRON_SECRET: SECRET },
      { FS_API_HOSTPORT: `127.0.0.1:${port}` },
      { FS_API_HOSTPORT: `127.0.0.1:${port}`, CRON_SECRET: "short" },
      { FS_API_HOSTPORT: `http://127.0.0.1:${port}/x`, CRON_SECRET: SECRET },
      { FS_API_HOSTPORT: `evil@127.0.0.1:${port}`, CRON_SECRET: SECRET },
    ]) {
      await expect(runTick(bad), JSON.stringify(bad)).resolves.toMatchObject({ code: 1 });
    }
    expect(seen).toEqual([]);
  });
});
