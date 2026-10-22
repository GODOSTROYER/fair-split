#!/usr/bin/env node
// Fails when a change touches a path its workstream does not own (docs/ownership.md).
//
// Usage:
//   node tools/check-ownership.mjs --branch ws/qa --base origin/main      # diff <base>...HEAD via git
//   node tools/check-ownership.mjs --ws qa path/a path/b                  # explicit files (treated as edits)
//   git diff --name-status main...HEAD | node tools/check-ownership.mjs --ws WS-QA --stdin
// Without --ws, the branch comes from --branch, then GITHUB_HEAD_REF, then GITHUB_REF_NAME.
// A branch that is neither ws/<id> nor deps/* is skipped (exit 0) unless --strict is given.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEPS_LANE = "deps";
const ELSEWHERE = "*elsewhere*";

/** Converts one glob (`*`, `**`, `?`, `{a,b}`) to an anchored RegExp over POSIX paths. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) throw new Error(`Unclosed brace in pattern: ${glob}`);
      const parts = glob.slice(i + 1, end).split(",");
      re += `(?:${parts.map((p) => globToRegExp(p).source.slice(1, -1)).join("|")})`;
      i = end;
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when `file` matches `pattern`; a pattern without glob characters also matches everything below it. */
export function matchPath(pattern, file) {
  const f = normalize(file);
  const p = pattern.replace(/\/+$/, "");
  if (!/[*?{]/.test(p)) return f === p || f.startsWith(`${p}/`);
  return globToRegExp(p).test(f);
}

export function normalize(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

const backticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

function tableRows(md, firstHeader) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\|\\s*${firstHeader}\\s*\\|`).test(l));
  if (start === -1) throw new Error(`docs/ownership.md: no table whose first column is "${firstHeader}"`);
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    rows.push(
      lines[i]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
  }
  return rows;
}

/** Parses docs/ownership.md into { workstreams: {id: {include, exclude}}, appendOnly, anyWorkstream, depsLane }. */
export function parseOwnership(md) {
  const workstreams = {};
  for (const [ws, owned = "", except = ""] of tableRows(md, "WS")) {
    if (!/^WS-[A-Z0-9]+$/.test(ws)) throw new Error(`docs/ownership.md: bad workstream id "${ws}"`);
    workstreams[ws] = { include: backticked(owned), exclude: backticked(except) };
  }
  const shared = { appendOnly: [], anyWorkstream: [], depsLane: [] };
  const keys = { "append-only": "appendOnly", "any-workstream": "anyWorkstream", "deps-lane": "depsLane" };
  for (const [rule, paths = ""] of tableRows(md, "Rule")) {
    const key = keys[rule];
    if (!key) throw new Error(`docs/ownership.md: unknown shared rule "${rule}"`);
    shared[key] = backticked(paths);
  }
  if (Object.keys(workstreams).length === 0) throw new Error("docs/ownership.md: no workstreams found");
  return { workstreams, ...shared };
}

/** Maps `ws/ppcore` → `WS-PPCORE`, `deps/*` → `deps`; anything else → null. Accepts ids too (`qa`, `WS-QA`). */
export function workstreamFromBranch(branch) {
  if (!branch) return null;
  const b = branch.replace(/^refs\/heads\//, "").trim();
  if (b === DEPS_LANE || b.startsWith("deps/")) return DEPS_LANE;
  const m = /^ws\/([a-z0-9]+)$/i.exec(b);
  return m ? `WS-${m[1].toUpperCase()}` : null;
}

export function normalizeWorkstream(id) {
  if (!id) return null;
  if (id.toLowerCase() === DEPS_LANE) return DEPS_LANE;
  return id.toUpperCase().startsWith("WS-") ? id.toUpperCase() : `WS-${id.toUpperCase()}`;
}

const anyMatch = (patterns, file) => patterns.some((p) => matchPath(p, file));

/** True when workstream `ws` owns `file` (includes minus excludes; `*elsewhere*` subtracts other rows). */
export function owns(ownership, ws, file) {
  const row = ownership.workstreams[ws];
  if (!row || !anyMatch(row.include, file)) return false;
  for (const ex of row.exclude) {
    if (ex === ELSEWHERE) {
      for (const [other, r] of Object.entries(ownership.workstreams)) {
        if (other !== ws && anyMatch(r.include, file) && !anyMatch(r.exclude, file)) return false;
      }
    } else if (matchPath(ex, file)) {
      return false;
    }
  }
  return true;
}

/**
 * Parses `git diff --name-status` output into [{status, path}]; a rename or copy yields
 * the new path with its status and, for a rename, the old path as a deletion.
 */
export function parseNameStatus(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [code, a, b] = line.split("\t");
    const s = code[0];
    if ((s === "R" || s === "C") && b) {
      if (s === "R") out.push({ status: "D", path: normalize(a) });
      out.push({ status: s === "R" ? "R" : "A", path: normalize(b) });
    } else {
      out.push({ status: s, path: normalize(a) });
    }
  }
  return out;
}

/**
 * Checks changes [{status: A|M|D|R|..., path}] for workstream `ws` (`WS-*` or `deps`).
 * Returns { ok, violations: [{path, status, reason}] }.
 */
export function checkChanges(ownership, ws, changes) {
  if (ws !== DEPS_LANE && !ownership.workstreams[ws]) {
    throw new Error(`Unknown workstream "${ws}". Known: ${Object.keys(ownership.workstreams).join(", ")}`);
  }
  const violations = [];
  for (const { status = "M", path } of changes) {
    const file = normalize(path);
    if (anyMatch(ownership.appendOnly, file)) {
      if (status !== "A") {
        violations.push({
          path: file,
          status,
          reason: "append-only folder: add a new file instead of editing",
        });
      }
      continue;
    }
    if (anyMatch(ownership.anyWorkstream, file)) continue;
    if (ws === DEPS_LANE) {
      if (!anyMatch(ownership.depsLane, file)) {
        violations.push({ path: file, status, reason: "the deps lane may touch only dependency files" });
      }
      continue;
    }
    if (!owns(ownership, ws, file)) {
      const owners = Object.keys(ownership.workstreams).filter((w) => owns(ownership, w, file));
      const who = owners.length ? `owned by ${owners.join(", ")}` : "owned by no workstream";
      violations.push({ path: file, status, reason: `not owned by ${ws} (${who})` });
    }
  }
  return { ok: violations.length === 0, violations };
}

function parseArgs(argv) {
  const opts = { files: [], strict: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ws") opts.ws = argv[++i];
    else if (a === "--branch") opts.branch = argv[++i];
    else if (a === "--base") opts.base = argv[++i];
    else if (a === "--ownership") opts.ownership = argv[++i];
    else if (a === "--strict") opts.strict = true;
    else if (a === "--stdin") opts.stdin = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log("usage: check-ownership (--ws <id> | --branch <ws/id>) [--base <ref> | --stdin | files...]");
    return 0;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const branch = opts.branch ?? env.GITHUB_HEAD_REF ?? env.GITHUB_REF_NAME;
  const ws = opts.ws ? normalizeWorkstream(opts.ws) : workstreamFromBranch(branch);
  if (!ws) {
    const msg = `check-ownership: branch "${branch ?? "(none)"}" is not ws/<id> or deps/*`;
    if (opts.strict) {
      console.error(`${msg}; --strict set, failing.`);
      return 1;
    }
    console.log(`${msg}; skipped.`);
    return 0;
  }
  const ownership = parseOwnership(
    readFileSync(opts.ownership ?? join(repoRoot, "docs/ownership.md"), "utf8"),
  );

  let changes;
  if (opts.base) {
    const out = execFileSync("git", ["diff", "--name-status", "-M", `${opts.base}...HEAD`], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    changes = parseNameStatus(out);
  } else if (opts.stdin) {
    changes = parseNameStatus(readFileSync(0, "utf8"));
  } else {
    changes = opts.files.map((path) => ({ status: "M", path }));
  }

  const { ok, violations } = checkChanges(ownership, ws, changes);
  if (!ok) {
    console.error(`check-ownership: ${violations.length} path(s) outside ${ws}:`);
    for (const v of violations) console.error(`  ${v.status} ${v.path}: ${v.reason}`);
    return 1;
  }
  console.log(`check-ownership: ${changes.length} changed path(s), all within ${ws}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
