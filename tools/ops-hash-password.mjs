// Makes the value for FS_OPERATOR_PASSWORD_SCRYPT, the /ops sign-in fs-api checks (render.yaml prompts for it once,
// when the Blueprint is created). Runs from any checkout with no install: node and its built-in modules only.
//
//   node tools/ops-hash-password.mjs           asks for the password twice in the terminal, never echoing it
//   node tools/ops-hash-password.mjs --stdin   reads the first line of standard input instead (scripts, tests)
//
// Without --stdin it refuses a stdin that is not a terminal, so a password is never read from a pipe or echoed by
// accident (Git Bash's mintty is not a terminal to node: use `winpty node tools/ops-hash-password.mjs`, or
// PowerShell). It prints only the hash, on stdout, in the PHC form fs-api verifies
// (apps/api/src/credentials/issue/operator.ts, `verifyOperatorPassword`):
//
//   $scrypt$ln=15,r=8,p=1$<16-byte salt, base64>$<32-byte key, base64>
//
// The password is NFC-normalised, as fs-api does; it must be 12 to 1024 characters. Exit 0 with the hash on
// stdout; 1 for a refused password or two entries that differ; 2 for a usage error; 130 when cancelled.
import { randomBytes, scrypt } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LN = 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
export const MIN_LENGTH = 12;
/** fs-api refuses longer passwords before doing any work (OPERATOR_PASSWORD_MAX). */
export const MAX_LENGTH = 1024;

const USAGE = "usage: node tools/ops-hash-password.mjs [--stdin]";

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The PHC scrypt string fs-api's verifyOperatorPassword accepts, with a fresh random salt. */
export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const N = 2 ** LN;
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFC"),
      salt,
      KEY_BYTES,
      { N, r: R, p: P, maxmem: 64 * 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else {
          const b64 = (b) => b.toString("base64").replace(/=+$/, "");
          resolve(`$scrypt$ln=${LN},r=${R},p=${P}$${b64(salt)}$${b64(key)}`);
        }
      },
    );
  });
}

/** The first line of a stream, without its line ending. */
function readFirstLine(stdin) {
  return new Promise((resolve, reject) => {
    let text = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      text += chunk;
    });
    stdin.on("end", () => resolve(text.split(/\r?\n/)[0] ?? ""));
    stdin.on("error", reject);
  });
}

/**
 * A chunk of raw terminal input without its control sequences: CSI (ESC [ parameters, then one final byte: the
 * arrow and function keys, and the bracketed-paste markers ESC[200~ and ESC[201~ a terminal wraps a paste in),
 * SS3 (ESC O and one key), and ESC with the key after it (Alt+key, a lone Esc). What is left is what was typed or
 * pasted; a sequence never takes the rest of the chunk with it.
 */
export function stripControlSequences(chunk) {
  let out = "";
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== "\u001b") {
      out += chunk[i];
      continue;
    }
    const next = chunk[i + 1];
    if (next === "[") {
      // parameter and intermediate bytes (0x20-0x3F), then the final byte, which the loop's i++ skips
      let j = i + 2;
      while (j < chunk.length && chunk.charCodeAt(j) >= 0x20 && chunk.charCodeAt(j) <= 0x3f) j++;
      i = j;
    } else if (next === "O") {
      i += 2;
    } else if (next !== undefined && next !== "\r" && next !== "\n") {
      i += 1;
    }
  }
  return out;
}

/** One line typed at the terminal in raw mode, so nothing is echoed. Backspace edits; Ctrl-C cancels. */
export function readHidden(prompt, io) {
  const { stdin, stderr } = io;
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (fn) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      fn();
    };
    const onData = (chunk) => {
      // arrow and function keys, Alt+key and a paste's bracketed-paste markers are not part of a password
      for (const ch of stripControlSequences(chunk)) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish(() => resolve(value));
        if (ch === "\u0003") return finish(() => reject(new Exit(130, "cancelled; nothing printed")));
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
    stdin.resume();
    stderr.write(prompt);
  });
}

function checkPassword(password) {
  if (password.length === 0) throw new Exit(1, "no password given; nothing printed");
  if (password.length < MIN_LENGTH)
    throw new Exit(1, `the password must be at least ${MIN_LENGTH} characters; nothing printed`);
  if (password.length > MAX_LENGTH)
    throw new Exit(
      1,
      `the password must be at most ${MAX_LENGTH} characters (fs-api's limit); nothing printed`,
    );
}

async function hashFrom(argv, io) {
  let fromStdin = false;
  for (const arg of argv) {
    if (arg === "--stdin") fromStdin = true;
    else if (arg === "--help" || arg === "-h") {
      io.stderr.write(`${USAGE}\n`);
      return;
    } else throw new Exit(2, `unknown argument: ${arg}\n${USAGE}`);
  }
  let password;
  if (fromStdin) password = await readFirstLine(io.stdin);
  else {
    if (!io.stdin.isTTY)
      throw new Exit(
        2,
        "stdin is not a terminal, so the password could echo or come from a pipe. Run this in a terminal " +
          "(Git Bash: winpty node tools/ops-hash-password.mjs), or pass --stdin to read the first line of stdin.",
      );
    password = await readHidden("Operator password for /ops (not shown): ", io);
    checkPassword(password);
    const again = await readHidden("The same password again: ", io);
    if (again !== password) throw new Exit(1, "the two entries differ; nothing printed");
  }
  checkPassword(password);
  io.stdout.write(`${await hashPassword(password)}\n`);
}

/** The whole tool over injectable streams; resolves to the exit code. Messages go to stderr, the hash to stdout. */
export async function run(
  argv,
  io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
) {
  try {
    await hashFrom(argv, io);
    return 0;
  } catch (err) {
    io.stderr.write(`ops-hash-password: ${err instanceof Exit ? err.message : "failed"}\n`);
    return err instanceof Exit ? err.code : 1;
  }
}

const isEntry = (() => {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (isEntry)
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
