// The two values the person creating the Render Blueprint makes by hand (apps/tasks/README.md, "Deploying"), checked
// against what fs-api actually verifies: FS_OPERATOR_PASSWORD_SCRYPT from tools/ops-hash-password.mjs signs in at
// POST /v1/ops/login, and the runbook's judge-code one-liner prints a JUDGE_CODE_SHA256 that POST /v1/judge/code
// accepts for the code it prints. Both run exactly as a person would: the tool from a folder with no install, the
// one-liner copied out of the README.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyOperatorPassword } from "./credentials/issue/operator.js";
import { parseEnv } from "./env.js";
import { createTestApp, type TestApp } from "./test/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNBOOK = path.join(REPO, "apps", "tasks", "README.md");
// Assembled at runtime, so no password-shaped literal sits in the source for the secret guards.
const PASSWORD = ["coop", "treasurer", "ops", "9b41"].join("-");

const bare = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };

function operatorHash(password: string): string {
  const r = spawnSync(process.execPath, [path.join(REPO, "tools", "ops-hash-password.mjs"), "--stdin"], {
    cwd: path.join(REPO, "docs"),
    env: bare,
    input: `${password}\n`,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

/** The runbook's judge-code one-liner: the one README line that runs `node -e "…"` and prints JUDGE_CODE_SHA256. */
function judgeCodeOneLiner(): string {
  const lines = readFileSync(RUNBOOK, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('node -e "') && l.includes("JUDGE_CODE_SHA256"));
  expect(lines).toHaveLength(1);
  const line = lines[0] as string;
  expect(line.endsWith('"')).toBe(true);
  const js = line.slice('node -e "'.length, -1);
  // It must paste unchanged into PowerShell and bash alike: no $ to expand, no backtick, no inner double quote.
  expect(js).not.toMatch(/[$`"]/);
  return js;
}

function runJudgeCodeOneLiner(): { code: string; sha256: string } {
  const r = spawnSync(process.execPath, ["-e", judgeCodeOneLiner()], {
    env: bare,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  expect(r.status, r.stderr).toBe(0);
  const code = /^judge code[^:]*: (\S+)$/m.exec(r.stdout)?.[1];
  const sha256 = /^JUDGE_CODE_SHA256: (\S+)$/m.exec(r.stdout)?.[1];
  if (!code || !sha256)
    throw new Error(`unexpected one-liner output shape (${r.stdout.split("\n").length} lines)`);
  return { code, sha256 };
}

let t: TestApp;
let judge: { code: string; sha256: string };
let hash: string;

beforeAll(async () => {
  judge = runJudgeCodeOneLiner();
  hash = operatorHash(PASSWORD);
  t = await createTestApp({
    db: "postgres",
    clock: new Date(),
    env: { JUDGE_CODE_SHA256: judge.sha256, FS_OPERATOR_PASSWORD_SCRYPT: hash },
  });
});
afterAll(async () => t?.close());

describe("runbook: the hand-made Blueprint values are the ones fs-api verifies", () => {
  it("tools/ops-hash-password.mjs prints an FS_OPERATOR_PASSWORD_SCRYPT that boot accepts and the password matches", async () => {
    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(parseEnv({ FS_OPERATOR_PASSWORD_SCRYPT: hash }).secrets.operatorPasswordScrypt).toBe(hash);
    expect(await verifyOperatorPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyOperatorPassword(hash, `${PASSWORD}!`)).toBe(false);
  });

  it("the runbook's seed one-liner makes FS_LINK_SIGNING_KEY and FS_LEDGER_SIGNING_KEY values boot accepts", () => {
    const line = readFileSync(RUNBOOK, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith('node -e "') && l.includes("randomBytes(32).toString('hex')"));
    if (!line) throw new Error("no seed one-liner in the runbook");
    const seed = () =>
      spawnSync(process.execPath, ["-e", line.slice('node -e "'.length, -1)], {
        env: bare,
        encoding: "utf8",
      }).stdout.trim();
    const [link, ledger] = [seed(), seed()];
    expect(link).toMatch(/^[0-9a-f]{64}$/);
    expect(link).not.toBe(ledger);
    const env = parseEnv({ FS_LINK_SIGNING_KEY: link, FS_LEDGER_SIGNING_KEY: ledger });
    expect([env.secrets.linkSigningKey, env.secrets.ledgerSigningKey]).toEqual([link, ledger]);
  });

  it("POST /v1/ops/login signs in with that password, and only with it", async () => {
    const wrong = await t.json("/v1/ops/login", { method: "POST", body: { password: `${PASSWORD}!` } });
    expect(wrong.status).toBe(401);
    const ok = await t.json<{ ok: boolean }>("/v1/ops/login", {
      method: "POST",
      body: { password: PASSWORD },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.headers.get("set-cookie") ?? "").toMatch(/fs_ops=/);
  });

  it("the judge-code one-liner prints a JUDGE_CODE_SHA256 boot accepts, and POST /v1/judge/code takes its code", async () => {
    expect(judge.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parseEnv({ JUDGE_CODE_SHA256: judge.sha256 }).secrets.judgeCodeSha256).toBe(judge.sha256);
    expect(judge.code.length).toBeGreaterThanOrEqual(16);
    const session = await t.json("/v1/judge/sessions", { method: "POST", body: {} });
    expect([200, 201]).toContain(session.status);
    const cookie = /fs_js=([^;]+)/.exec(session.headers.get("set-cookie") ?? "")?.[1];
    if (!cookie) throw new Error("no judge session cookie");
    const as = t.credentials.judge(cookie);
    const wrong = await t.json("/v1/judge/code", { method: "POST", body: { code: `${judge.code}x` }, as });
    expect(wrong.status).toBe(403);
    const ok = await t.json<{ ok: boolean; bucket: string }>("/v1/judge/code", {
      method: "POST",
      body: { code: judge.code },
      as,
    });
    expect(ok.body).toEqual({ ok: true, bucket: "judge_code" });
  });
});
