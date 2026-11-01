// tools/ops-hash-password.mjs: the FS_OPERATOR_PASSWORD_SCRYPT value the person creating the Blueprint pastes.
// fs-api's acceptance of its output is proved in apps/api/src/runbook.pg.test.ts; this file covers the tool itself.
import { spawnSync } from "node:child_process";
import { scryptSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";

const TOOL = join(REPO_ROOT, "tools", "ops-hash-password.mjs");
// Assembled at runtime, so no password-shaped literal sits in the source for the secret guards.
const PASSWORD = ["lantern", "bay", "operator", "7f3a"].join("-");

/** Runs the tool with a piped (non-TTY) stdin, from a folder with no node_modules, with a bare environment. */
function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: join(REPO_ROOT, "docs"),
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    input: input ?? "",
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const PHC = /^\$scrypt\$ln=15,r=8,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})\n$/;

interface Io {
  stdin: unknown;
  stdout: { write(s: string): boolean };
  stderr: { write(s: string): boolean };
}
let loaded: { run(argv: string[], io: Io): Promise<number> } | undefined;
const tool = () => {
  if (!loaded) throw new Error("tool not loaded");
  return loaded;
};
beforeAll(async () => {
  loaded = (await import(pathToFileURL(TOOL).href)) as typeof loaded;
});

/** A terminal that types each line once the tool has written its prompt, and records raw-mode switches. */
function fakeTerminal(lines: string[]) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode(on: boolean) {
      rawModes.push(on);
      return stdin;
    },
    setEncoding: () => stdin,
    resume: () => stdin,
    pause: () => stdin,
  });
  const rawModes: boolean[] = [];
  let out = "";
  let err = "";
  const queue = [...lines];
  const io: Io = {
    stdin,
    stdout: {
      write(s) {
        out += s;
        return true;
      },
    },
    stderr: {
      write(s) {
        err += s;
        // A prompt ends with ": "; type the next line(s) up to and including one that ends it.
        if (s.endsWith(": "))
          setImmediate(() => {
            while (queue.length > 0) {
              const chunk = queue.shift() as string;
              stdin.emit("data", chunk);
              if (chunk.endsWith("\r") || chunk.endsWith("\u0003")) break;
            }
          });
        return true;
      },
    },
  };
  return { io, rawModes, out: () => out, err: () => err };
}

describe("tools/ops-hash-password.mjs (FS_OPERATOR_PASSWORD_SCRYPT)", () => {
  it("refuses a non-terminal stdin unless --stdin says so, and prints nothing on stdout", () => {
    const r = run([], `${PASSWORD}\n`);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/not a terminal/);
    expect(r.stderr).toMatch(/--stdin/);
  });

  it("with --stdin prints only the PHC scrypt hash of the first line, which node:crypto reproduces", () => {
    const r = run(["--stdin"], `${PASSWORD}\r\nignored second line\n`);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const m = PHC.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    const salt = Buffer.from(m?.[1] ?? "", "base64");
    const key = scryptSync(PASSWORD.normalize("NFC"), salt, 32, {
      N: 2 ** 15,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    expect(key.toString("base64").replace(/=+$/, "")).toBe(m?.[2]);
    expect(r.stdout).not.toContain(PASSWORD);
  });

  it("salts every hash afresh", () => {
    const a = run(["--stdin"], PASSWORD).stdout;
    const b = run(["--stdin"], PASSWORD).stdout;
    expect(a).toMatch(PHC);
    expect(b).toMatch(PHC);
    expect(a).not.toBe(b);
  });

  it("refuses a password under 12 characters, an empty one, one over fs-api's 1024 limit, and unknown flags", () => {
    for (const input of ["short-pw", "", "x".repeat(1025)]) {
      const r = run(["--stdin"], input);
      expect(r.status, input.slice(0, 12)).toBe(1);
      expect(r.stdout).toBe("");
      if (input) expect(r.stderr).not.toContain(input);
    }
    const flag = run(["--echo"]);
    expect(flag.status).toBe(2);
    expect(flag.stderr).toMatch(/unknown argument/);
  });

  it("at a terminal: raw mode (no echo), asked twice, Backspace edits, arrow keys ignored, only the hash printed", async () => {
    const tty = fakeTerminal([`${PASSWORD}x\u007f\r`, "\u001b[A", `${PASSWORD}\r`]);
    expect(await tool().run([], tty.io)).toBe(0);
    expect(tty.out()).toMatch(PHC);
    expect(tty.err()).toMatch(/Operator password for \/ops \(not shown\): \nThe same password again: \n$/);
    expect(tty.err() + tty.out()).not.toContain(PASSWORD);
    expect(tty.rawModes).toEqual([true, false, true, false]);
  });

  it("at a terminal: a paste wrapped in bracketed-paste codes keeps the password and drops only the codes", async () => {
    // a terminal with bracketed paste on sends ESC[200~ <text> ESC[201~ in one chunk; the old guard dropped all of it
    const tty = fakeTerminal([`\u001b[200~${PASSWORD}\u001b[201~\r`, `\u001b[200~${PASSWORD}\u001b[201~\r`]);
    expect(await tool().run([], tty.io)).toBe(0);
    const m = PHC.exec(tty.out());
    expect(m, tty.err()).not.toBeNull();
    const salt = Buffer.from(m?.[1] ?? "", "base64");
    const key = scryptSync(PASSWORD.normalize("NFC"), salt, 32, {
      N: 2 ** 15,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    expect(key.toString("base64").replace(/=+$/, "")).toBe(m?.[2]);
    expect(tty.err() + tty.out()).not.toContain(PASSWORD);
  });

  it("at a terminal: other control sequences inside a chunk are stripped, not typed and not the whole chunk", async () => {
    // an arrow key (CSI), an F1 key (SS3) and an Alt+key inside one chunk: none of them is part of the password
    const typed = `${PASSWORD.slice(0, 4)}\u001b[D\u001bOP\u001bq${PASSWORD.slice(4)}\r`;
    const tty = fakeTerminal([typed, `${PASSWORD}\r`]);
    expect(await tool().run([], tty.io)).toBe(0);
    expect(tty.out()).toMatch(PHC);
    expect(tty.err()).not.toMatch(/differ/);
  });

  it("at a terminal: two different entries, a short one, or Ctrl-C print nothing", async () => {
    const differ = fakeTerminal([`${PASSWORD}\r`, `${PASSWORD}!\r`]);
    expect(await tool().run([], differ.io)).toBe(1);
    expect(differ.err()).toMatch(/the two entries differ/);
    const short = fakeTerminal(["short\r"]);
    expect(await tool().run([], short.io)).toBe(1);
    const cancelled = fakeTerminal(["lant\u0003"]);
    expect(await tool().run([], cancelled.io)).toBe(130);
    for (const t of [differ, short, cancelled]) {
      expect(t.out()).toBe("");
      expect(t.rawModes.at(-1)).toBe(false);
    }
  });

  it("needs no install: it imports only node: built-ins", () => {
    const src = readFileSync(TOOL, "utf8");
    const specifiers = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s, s).toMatch(/^node:/);
    expect(src).not.toMatch(/\brequire\(|import\(/);
  });
});
