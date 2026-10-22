#!/usr/bin/env node
// Fails when a change touches a path its workstream does not own (docs/ownership.md).
//
// Usage:
//   node tools/check-ownership.mjs --branch ws/qa --base origin/main      # diff <base>...HEAD via git
//   node tools/check-ownership.mjs --ws qa path/a path/b                  # explicit files (treated as edits)
//   git diff --name-status main...HEAD | node tools/check-ownership.mjs --ws WS-QA --stdin
// Options:
//   --repo <dir>            repository to diff and read rules from (default: the script's parent directory)
//   --ownership-ref <ref>   read docs/ownership.md from this commit. With --base it defaults to the base, so
//                           a PR is judged by the base's rules and cannot widen its own row. It fails closed
//                           (exit 1) unless the base copy is read and parsed, with one exception: when
//                           `git cat-file -e <ref>:docs/ownership.md` reports the file absent from that commit
//                           (and `git ls-tree` confirms the tree is readable and has no such entry), only
//                           WS-QA's PR that introduces the file is judged by the working-tree copy and may also
//                           touch the deps-lane files (S5.2.3 rule 4: WS-QA's bootstrap PR). Any other git
//                           error, an unknown ref, or a copy that exists but cannot be read or parsed: exit 1.
//   --ownership <file>      read the rules from a file instead (tests, local use)
//   --strict                fail on a branch that is neither ws/<id> nor deps/* (CI sets it on every PR);
//                           without it such a branch is skipped (exit 0)
// Option values must be present, non-empty and not start with "-" (they reach git as revisions).
// Without --ws, the branch comes from --branch, then GITHUB_HEAD_REF, then GITHUB_REF_NAME.
// CI runs the BASE commit's copy of this script, so a PR cannot weaken the checker that judges it.
import { execFileSync, spawnSync } from "node:child_process";
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
  for (const [ws, row] of Object.entries(workstreams)) {
    if (row.include.length === 0) throw new Error(`docs/ownership.md: ${ws} owns no backticked paths`);
  }
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
 * A line without a tab is a plain path (`git diff --name-only`) and counts as a modification.
 */
export function parseNameStatus(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!line.includes("\t")) {
      out.push({ status: "M", path: normalize(line.trim()) });
      continue;
    }
    const [code, a, b] = line.split("\t");
    if (!code || !a) throw new Error(`Unreadable --name-status line: ${JSON.stringify(line)}`);
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

/** The workstream whose bootstrap PR installs the pinned stack (S5.2.3 rule 4). */
export const BOOTSTRAP_WS = "WS-QA";

/**
 * Checks changes [{status: A|M|D|R|..., path}] for workstream `ws` (`WS-*` or `deps`).
 * `bootstrap: true` (the base has no machine-readable rules yet) also lets WS-QA touch the deps-lane files.
 * Returns { ok, violations: [{path, status, reason}] }.
 */
export function checkChanges(ownership, ws, changes, { bootstrap = false } = {}) {
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
    if (bootstrap && ws === BOOTSTRAP_WS && anyMatch(ownership.depsLane, file)) continue;
    if (!owns(ownership, ws, file)) {
      const owners = Object.keys(ownership.workstreams).filter((w) => owns(ownership, w, file));
      const who = owners.length ? `owned by ${owners.join(", ")}` : "owned by no workstream";
      violations.push({ path: file, status, reason: `not owned by ${ws} (${who})` });
    }
  }
  return { ok: violations.length === 0, violations };
}

const VALUE_OPTIONS = {
  "--ws": "ws",
  "--branch": "branch",
  "--base": "base",
  "--ownership": "ownership",
  "--ownership-ref": "ownershipRef",
  "--repo": "repo",
};

/** A value that is missing, empty or starts with "-" is refused: refs reach git, and "" must not mean "none". */
export function parseArgs(argv) {
  const opts = { files: [], strict: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.hasOwn(VALUE_OPTIONS, a)) {
      const v = argv[++i];
      if (v === undefined || v.trim() === "" || v.startsWith("-")) {
        const got = v === undefined ? "nothing" : JSON.stringify(v);
        throw new Error(`${a} needs a value that is not empty and does not start with "-" (got ${got})`);
      }
      opts[VALUE_OPTIONS[a]] = v;
    } else if (a === "--strict") opts.strict = true;
    else if (a === "--stdin") opts.stdin = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

// Untranslated git messages: loadOwnership tells "absent" from other errors by git's wording.
const GIT_ENV = { ...process.env, LC_ALL: "C", LANG: "C", LANGUAGE: "" };

const git = (repo, args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });

/** Runs git without throwing: { status, stdout, stderr } (status is null when git could not start). */
function gitTry(repo, args) {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: String(r.stderr || r.error?.message || "").trim(),
  };
}

export const OWNERSHIP_FILE = "docs/ownership.md";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True only when commit `sha` has no docs/ownership.md: `git cat-file -e` failed with git's own
 * "path ... does not exist in" / "exists on disk, but not in" message for exactly this path and commit,
 * AND `git ls-tree` reads every tree on the way and finds no such entry. git prints the same messages
 * when a tree object is missing (corrupt or partial clone); ls-tree fails there, so that is not "absent".
 */
function absentFromCommit(repo, sha, catFileStderr) {
  const said = new RegExp(
    `^fatal: [Pp]ath '${escapeRe(OWNERSHIP_FILE)}' (?:does not exist in|exists on disk, but not in) '${sha}'$`,
  );
  if (!said.test(catFileStderr)) return false;
  const tree = gitTry(repo, ["ls-tree", "-z", "--full-tree", sha, "--", OWNERSHIP_FILE]);
  return tree.status === 0 && tree.stderr === "" && tree.stdout === "";
}

/**
 * Loads the rules. `file` wins; without `ref`, reads the working tree (local use). With `ref`, reads
 * docs/ownership.md from that commit and fails closed: it throws unless the copy there is read and parsed,
 * except when git reports the file absent from that commit (WS-QA's bootstrap PR, the one that introduces
 * it). Only then does it read the working tree, flagged `bootstrap: true`. Head rules are never used once
 * the base has the file, so a PR that edits docs/ownership.md is still judged by the base's copy.
 */
export function loadOwnership({ repo, ref, file }) {
  if (file) return { ownership: parseOwnership(readFileSync(file, "utf8")), source: file, bootstrap: false };
  const head = join(repo, OWNERSHIP_FILE);
  if (ref === undefined || ref === null) {
    return { ownership: parseOwnership(readFileSync(head, "utf8")), source: head, bootstrap: false };
  }
  const closed = (why) =>
    new Error(`cannot judge by ${ref}:${OWNERSHIP_FILE}: ${why}; failing closed (exit 1)`);
  if (typeof ref !== "string" || ref.trim() === "" || ref.startsWith("-")) throw closed("not a usable ref");

  const commit = gitTry(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const sha = commit.stdout.trim();
  if (commit.status !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw closed(`no such commit${commit.stderr ? ` (${commit.stderr.split("\n")[0]})` : ""}`);
  }
  const spec = `${sha}:${OWNERSHIP_FILE}`;
  const exists = gitTry(repo, ["cat-file", "-e", spec]);
  if (exists.status === 0) {
    const blob = gitTry(repo, ["cat-file", "blob", spec]);
    if (blob.status !== 0) throw closed(`it exists but cannot be read (${blob.stderr.split("\n")[0]})`);
    try {
      return { ownership: parseOwnership(blob.stdout), source: `${ref}:${OWNERSHIP_FILE}`, bootstrap: false };
    } catch (e) {
      throw closed(`it exists but is malformed (${e.message})`);
    }
  }
  if (!absentFromCommit(repo, sha, exists.stderr)) {
    throw closed(`git cat-file -e failed (${exists.stderr.split("\n")[0] || `exit ${exists.status}`})`);
  }
  return {
    ownership: parseOwnership(readFileSync(head, "utf8")),
    source: `${head} (bootstrap: ${ref} has no ${OWNERSHIP_FILE})`,
    bootstrap: true,
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`check-ownership: ${e.message}`);
    return 1;
  }
  if (opts.help) {
    console.log(
      "usage: check-ownership (--ws <id> | --branch <ws/id>) [--base <ref> | --stdin | files...] " +
        "[--ownership-ref <ref> | --ownership <file>] [--repo <dir>] [--strict]",
    );
    return 0;
  }
  const repo = resolve(opts.repo ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const branch = opts.branch ?? env.GITHUB_HEAD_REF ?? env.GITHUB_REF_NAME;
  const ws = opts.ws ? normalizeWorkstream(opts.ws) : workstreamFromBranch(branch);
  if (!ws) {
    const msg = `check-ownership: branch "${branch ?? "(none)"}" is not ws/<id> or deps/*`;
    if (opts.strict) {
      console.error(`${msg}; --strict set, failing. Name the branch ws/<id> or deps/<topic>.`);
      return 1;
    }
    console.log(`${msg}; skipped.`);
    return 0;
  }

  const ref = opts.ownership ? undefined : (opts.ownershipRef ?? opts.base);
  let loaded;
  try {
    loaded = loadOwnership({ repo, ref, file: opts.ownership });
  } catch (e) {
    console.error(`check-ownership: ${e.message}`);
    return 1;
  }
  const { ownership, source, bootstrap } = loaded;
  if (bootstrap && ws !== BOOTSTRAP_WS) {
    console.error(
      `check-ownership: ${ref} has no ${OWNERSHIP_FILE}, and only ${BOOTSTRAP_WS}'s PR may introduce it ` +
        `(S5.2.3 rule 4); ${ws} is never judged by its own copy. Land the rules on the base first.`,
    );
    return 1;
  }
  if (bootstrap) console.warn(`check-ownership: warning: rules from ${source}`);

  let changes;
  try {
    if (opts.base) {
      const range = `${opts.base}...HEAD`;
      changes = parseNameStatus(git(repo, ["diff", "--name-status", "-M", "--end-of-options", range]));
    } else if (opts.stdin) {
      changes = parseNameStatus(readFileSync(0, "utf8"));
    } else {
      changes = opts.files.map((path) => ({ status: "M", path }));
    }
  } catch (e) {
    console.error(`check-ownership: cannot read the changed paths: ${e.message}`);
    return 1;
  }

  let result;
  try {
    result = checkChanges(ownership, ws, changes, { bootstrap });
  } catch (e) {
    console.error(`check-ownership: ${e.message} (rules from ${source})`);
    return 1;
  }
  if (!result.ok) {
    console.error(
      `check-ownership: ${result.violations.length} path(s) outside ${ws} (rules from ${source}):`,
    );
    for (const v of result.violations) console.error(`  ${v.status} ${v.path}: ${v.reason}`);
    return 1;
  }
  console.log(`check-ownership: ${changes.length} changed path(s), all within ${ws} (rules from ${source}).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
