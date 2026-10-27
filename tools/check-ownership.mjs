#!/usr/bin/env node
// Fails when a change touches a path its workstream does not own (docs/ownership.md).
//
// Usage:
//   node tools/check-ownership.mjs --branch ws/qa --base origin/main      # judge merging HEAD into <base>
//   node tools/check-ownership.mjs --branch ws/qa --base main --head ws/qa # judge merging <head> into <base>
//   node tools/check-ownership.mjs --ws qa path/a path/b                  # explicit files (treated as edits)
//   git diff --name-status main...HEAD | node tools/check-ownership.mjs --ws WS-QA --stdin
// With --base, the changed paths are what merging <head> into <base> would bring, as `git merge` makes it
// (mergeChanges): the branch's own diff since its merge base, every path the merged tree changes on <base>
// (`git merge-tree --write-tree`), and every path the merge leaves conflicted. Base and head must have exactly one
// merge base; with several, git merge merges against a virtual base that no diff shows, so the check fails closed
// and asks for the base's tip to be merged into the branch first.
// Options:
//   --repo <dir>            repository to diff and read rules from (default: the script's parent directory)
//   --head <ref>            with --base: the commit to judge (default HEAD), merged into <base>
//   --ownership-ref <ref>   read docs/ownership.md from this commit. With --base it defaults to the base, so
//                           a PR is judged by the base's rules and cannot widen its own row. It fails closed
//                           (exit 1) unless the base copy is read and parsed. The one exception is bootstrap:
//                           git confirms (`cat-file -e`, then `ls-tree`) that the commit has neither
//                           docs/ownership.md nor tools/check-ownership.mjs, i.e. a new repository. Only WS-QA
//                           is then judged by its own copy (the judged commit's, or the working tree's without
//                           --base) and may also touch the deps-lane files (S5.2.3 rule 4). A commit with the
//                           checker but not the rules, any other git error, an unknown ref, or a copy that
//                           exists but cannot be read or parsed: exit 1.
//   --ownership <file>      read the rules from a file instead (tests, local use)
//   --strict                fail on a branch that is neither ws/<id> nor deps/* (the gate sets it);
//                           without it such a branch is skipped (exit 0)
//   --approve-gate-change <token>
//                           the merger approves this exact change to the gate's own files (GATE_FILES). The
//                           token is printed when such a change is found and is bound to the gate files'
//                           content at <head>, so it approves nothing else. Only the merger passes it, after
//                           reading that diff; workstream agents never do (AGENTS.md).
// Option values must be present, non-empty and not start with "-" (they reach git as revisions).
// Without --ws, the branch comes from --branch, then GITHUB_HEAD_REF, then GITHUB_REF_NAME; an empty value
// counts as missing (GitHub sets GITHUB_HEAD_REF to "" on pushes).
//
// Who runs it: .github/workflows/ownership.yml on pull_request_target, so GitHub takes the workflow, the checker
// and the rules from the default branch and a PR cannot edit or skip the check that judges it; and the merger
// (plan amendment 2: the orchestrator) runs main's copy on every branch before merging it (CONTRIBUTING.md,
// "Merging"; ADR-0006). The gate's files are GATE_FILES: no workstream may delete, rename or retype them, and a
// change to them lands only with --approve-gate-change, so no merged PR switches the gate off without the merger
// approving exactly that version.
// The workstream comes from the branch name: the gate stops a workstream from straying (or from widening its own
// row), not an author who names a branch after another workstream. Path matching ignores letter case, because
// Windows and macOS checkouts do, and a path that differs from another only in case is refused.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEPS_LANE = "deps";
const ELSEWHERE = "*elsewhere*";
export const OWNERSHIP_FILE = "docs/ownership.md";
export const CHECKER_FILE = "tools/check-ownership.mjs";
/** The workflow that runs the gate on pull_request_target (from the default branch). */
export const GATE_WORKFLOW_FILE = ".github/workflows/ownership.yml";
/**
 * The gate's own files. Deleting, renaming or retyping one is a violation for every workstream and deps;
 * any other change to one needs the merger's approval (--approve-gate-change) on top of ownership.
 */
export const GATE_FILES = [OWNERSHIP_FILE, CHECKER_FILE, GATE_WORKFLOW_FILE];

/** Converts one glob (`*`, `**`, `?`, `{a,b}`) to an anchored, case-sensitive RegExp over POSIX paths. */
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

/**
 * True when `file` matches `pattern`, ignoring letter case (Windows and macOS checkouts do, so
 * `apps/api/src/Webhooks/x.ts` is the webhooks folder there); a pattern without glob characters also matches
 * everything below it.
 */
export function matchPath(pattern, file) {
  const f = normalize(file).toLowerCase();
  const p = pattern.replace(/\/+$/, "").toLowerCase();
  if (!/[*?{]/.test(p)) return f === p || f.startsWith(`${p}/`);
  return globToRegExp(p).test(f);
}

export function normalize(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True when `file` is one of GATE_FILES, in any letter case. */
export function isGateFile(file) {
  const f = normalize(file).toLowerCase();
  return GATE_FILES.some((g) => g.toLowerCase() === f);
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

/** One rename or copy expands to the old path as a deletion (renames only) plus the new path. */
function pushChange(out, code, a, b) {
  const s = code[0];
  if ((s === "R" || s === "C") && b) {
    if (s === "R") out.push({ status: "D", path: normalize(a) });
    out.push({ status: s === "R" ? "R" : "A", path: normalize(b) });
  } else {
    out.push({ status: s, path: normalize(a) });
  }
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
    pushChange(out, code, a, b);
  }
  return out;
}

/**
 * Parses `git diff --name-status -z` output (NUL-separated, paths never quoted), the form the checker asks git
 * for: a path with a tab, a newline or non-ASCII characters arrives exactly as committed.
 */
export function parseNameStatusZ(text) {
  const parts = text.split("\0");
  if (parts.at(-1) === "") parts.pop();
  const out = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!/^[A-Z]\d*$/.test(code))
      throw new Error(`Unreadable --name-status -z entry: ${JSON.stringify(code)}`);
    const pair = code[0] === "R" || code[0] === "C";
    const a = parts[i++];
    const b = pair ? parts[i++] : undefined;
    if (!a || (pair && !b))
      throw new Error(`Unreadable --name-status -z entry after ${JSON.stringify(code)}`);
    pushChange(out, code, a, b);
  }
  return out;
}

/**
 * Paths of `changes` (other than deletions) that collide, by letter case alone, with another path in `tree`
 * (every path at the judged commit), at any depth: `README.MD` next to `README.md`, or `apps/api/src/Webhooks/x.ts`
 * next to the folder `apps/api/src/webhooks/`. Windows and macOS checkouts cannot hold both.
 * Returns violations [{path, status, reason}].
 */
export function caseCollisions(tree, changes) {
  const spellings = new Map(); // lower-cased path or folder → the spellings in `tree`
  for (const path of tree) {
    const parts = normalize(path).split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const key = prefix.toLowerCase();
      if (!spellings.has(key)) spellings.set(key, new Set());
      spellings.get(key).add(prefix);
    }
  }
  const violations = [];
  for (const { status = "M", path } of changes) {
    if (status === "D") continue;
    const parts = normalize(path).split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const others = [...(spellings.get(prefix.toLowerCase()) ?? [])].filter((p) => p !== prefix);
      if (others.length) {
        violations.push({
          path: normalize(path),
          status,
          reason:
            `${prefix} differs only in letter case from ${others.join(", ")}; ` +
            "Windows and macOS checkouts cannot hold both",
        });
        break;
      }
    }
  }
  return violations;
}

/** The workstream whose bootstrap PR installs the pinned stack in a new repository (S5.2.3 rule 4). */
export const BOOTSTRAP_WS = "WS-QA";

const GATE_APPROVAL_REASON =
  "the ownership gate's own file: a change lands only when the merger approves exactly this version";

/**
 * Checks changes [{status: A|M|D|R|T..., path}] for workstream `ws` (`WS-*` or `deps`).
 * A deletion (`D`, which includes the old path of a rename) or type change (`T`) of a GATE_FILES entry is a
 * violation for everyone. Any other change to a gate file must be owned AND approved (`gateChangeApproved`,
 * which main() sets only for a matching --approve-gate-change). `bootstrap: true` (the base has neither
 * docs/ownership.md nor the checker: a new repository) also lets WS-QA touch the deps-lane files.
 * Returns { ok, violations: [{path, status, reason, gate?}] }; `gate: true` marks a change awaiting approval.
 */
export function checkChanges(ownership, ws, changes, { bootstrap = false, gateChangeApproved = false } = {}) {
  if (ws !== DEPS_LANE && !ownership.workstreams[ws]) {
    throw new Error(`Unknown workstream "${ws}". Known: ${Object.keys(ownership.workstreams).join(", ")}`);
  }
  const notOwned = (file) => {
    const owners = Object.keys(ownership.workstreams).filter((w) => owns(ownership, w, file));
    const who = owners.length ? `owned by ${owners.join(", ")}` : "owned by no workstream";
    return `not owned by ${ws} (${who})`;
  };
  const violations = [];
  for (const { status = "M", path } of changes) {
    const file = normalize(path);
    if (isGateFile(file)) {
      if (status === "D" || status === "T") {
        violations.push({
          path: file,
          status,
          reason: "the ownership gate's files may not be deleted, renamed or retyped by any workstream",
        });
      } else if (ws === DEPS_LANE) {
        violations.push({ path: file, status, reason: "the deps lane may touch only dependency files" });
      } else if (!owns(ownership, ws, file)) {
        violations.push({ path: file, status, reason: notOwned(file) });
      } else if (!gateChangeApproved) {
        violations.push({ path: file, status, reason: GATE_APPROVAL_REASON, gate: true });
      }
      continue;
    }
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
    if (!owns(ownership, ws, file)) violations.push({ path: file, status, reason: notOwned(file) });
  }
  return { ok: violations.length === 0, violations };
}

const VALUE_OPTIONS = {
  "--ws": "ws",
  "--branch": "branch",
  "--base": "base",
  "--head": "head",
  "--ownership": "ownership",
  "--ownership-ref": "ownershipRef",
  "--repo": "repo",
  "--approve-gate-change": "approveGateChange",
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
  if (opts.head && !opts.base)
    throw new Error("--head needs --base (<head> is judged as merged into <base>)");
  if (opts.approveGateChange && !/^[0-9a-f]{16}$/.test(opts.approveGateChange)) {
    throw new Error("--approve-gate-change takes the 16-hex-digit token the checker printed");
  }
  return opts;
}

// Untranslated git messages: loadOwnership tells "absent" from other errors by git's wording.
const GIT_ENV = { ...process.env, LC_ALL: "C", LANG: "C", LANGUAGE: "" };

const git = (repo, args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });

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

/** The full commit id `ref` names, or null (unknown ref, not a commit, git error). */
function commitOf(repo, ref) {
  const r = gitTry(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const sha = r.stdout.trim();
  return r.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True only when commit `sha` has no entry at `path`: `git cat-file -e` failed with git's own
 * "path ... does not exist in" / "exists on disk, but not in" message for exactly this path and commit,
 * AND `git ls-tree` reads every tree on the way and finds no such entry. git prints the same messages
 * when a tree object is missing (corrupt or partial clone); ls-tree fails there, so that is not "absent".
 */
function absentFromCommit(repo, sha, path, catFileStderr) {
  const said = new RegExp(
    `^fatal: [Pp]ath '${escapeRe(path)}' (?:does not exist in|exists on disk, but not in) '${sha}'$`,
  );
  if (!said.test(catFileStderr)) return false;
  const tree = gitTry(repo, ["ls-tree", "-z", "--full-tree", sha, "--", path]);
  return tree.status === 0 && tree.stderr === "" && tree.stdout === "";
}

/** "present" or "absent" for `path` in commit `sha`; any other git outcome throws `closed(...)`. */
function presence(repo, sha, path, closed) {
  const exists = gitTry(repo, ["cat-file", "-e", `${sha}:${path}`]);
  if (exists.status === 0) return "present";
  if (absentFromCommit(repo, sha, path, exists.stderr)) return "absent";
  throw closed(`git cat-file -e ${path} failed (${exists.stderr.split("\n")[0] || `exit ${exists.status}`})`);
}

/**
 * Loads the rules. `file` wins; without `ref`, reads the working tree (local use). With `ref`, reads
 * docs/ownership.md from that commit and fails closed: it throws unless the copy there is read and parsed,
 * except when git confirms that commit has neither docs/ownership.md nor tools/check-ownership.mjs (a new
 * repository). Only then does it read the PR's own copy, flagged `bootstrap: true`: the one in commit `head`
 * (the commit being judged) when given, else the working tree's. A commit that has the checker but not the
 * rules lost them, so it throws too. Head rules are never used once the base has the file, so a PR that edits
 * docs/ownership.md is still judged by the base's copy.
 */
export function loadOwnership({ repo, ref, file, head }) {
  if (file) return { ownership: parseOwnership(readFileSync(file, "utf8")), source: file, bootstrap: false };
  const headFile = join(repo, OWNERSHIP_FILE);
  if (ref === undefined || ref === null) {
    return { ownership: parseOwnership(readFileSync(headFile, "utf8")), source: headFile, bootstrap: false };
  }
  const closed = (why) =>
    new Error(`cannot judge by ${ref}:${OWNERSHIP_FILE}: ${why}; failing closed (exit 1)`);
  if (typeof ref !== "string" || ref.trim() === "" || ref.startsWith("-")) throw closed("not a usable ref");

  const commit = gitTry(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const sha = commit.stdout.trim();
  if (commit.status !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw closed(`no such commit${commit.stderr ? ` (${commit.stderr.split("\n")[0]})` : ""}`);
  }
  if (presence(repo, sha, OWNERSHIP_FILE, closed) === "present") {
    const blob = gitTry(repo, ["cat-file", "blob", `${sha}:${OWNERSHIP_FILE}`]);
    if (blob.status !== 0) throw closed(`it exists but cannot be read (${blob.stderr.split("\n")[0]})`);
    try {
      return { ownership: parseOwnership(blob.stdout), source: `${ref}:${OWNERSHIP_FILE}`, bootstrap: false };
    } catch (e) {
      throw closed(`it exists but is malformed (${e.message})`);
    }
  }
  if (presence(repo, sha, CHECKER_FILE, closed) === "present") {
    throw closed(`it is absent but ${CHECKER_FILE} is there, so the rules were removed; restore them first`);
  }
  const why = `bootstrap: ${ref} has neither ${OWNERSHIP_FILE} nor ${CHECKER_FILE}`;
  if (head === undefined || head === null) {
    const ownership = parseOwnership(readFileSync(headFile, "utf8"));
    return { ownership, source: `${headFile} (${why})`, bootstrap: true };
  }
  // The PR's own rules are the judged commit's copy, not whatever the working tree holds (the gate job checks
  // out the base and judges a fetched head).
  const judged = gitTry(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${head}^{commit}`]);
  const headSha = judged.stdout.trim();
  if (judged.status !== 0 || !/^[0-9a-f]{40,64}$/.test(headSha)) {
    throw closed(`${why}, and the judged commit ${head} is not a commit`);
  }
  const own = gitTry(repo, ["cat-file", "blob", `${headSha}:${OWNERSHIP_FILE}`]);
  if (own.status !== 0) {
    throw closed(`${why}, and ${head} has no readable ${OWNERSHIP_FILE} (${own.stderr.split("\n")[0]})`);
  }
  try {
    const ownership = parseOwnership(own.stdout);
    return { ownership, source: `${headSha}:${OWNERSHIP_FILE} (${why})`, bootstrap: true };
  } catch (e) {
    throw closed(`${why}, and ${head}'s own ${OWNERSHIP_FILE} is malformed (${e.message})`);
  }
}

/** An error that refuses to judge (the check fails closed), as opposed to one that stops it from reading. */
class Refusal extends Error {}

const isObjectId = (s) => typeof s === "string" && /^[0-9a-f]{40,64}$/.test(s);

/**
 * The changes that merging commit `headSha` into commit `baseSha` brings, as `git merge` (ort) would make them:
 * - the branch's own changes, `git diff -M <merge base> <head>`;
 * - every path the merged tree changes on the base, `git diff -M <base> <tree>` with `<tree>` from
 *   `git merge-tree --write-tree`, so a file that the merge moves by following a rename on the base is judged
 *   where git puts it;
 * - every path the merge leaves conflicted (status M unless already listed): the merger resolves those.
 * A conflict does not stop the check: whatever the merger picks at a conflicted path is one side's version, and
 * the branch's side is judged above.
 * Throws a Refusal unless the two commits have exactly one merge base. With several (a criss-cross history),
 * git merge merges against a virtual base built from all of them, which no diff from one base shows. Such a
 * history can be made on purpose: start at a main merge's first parent, merge its second parent with `-s ours`
 * (its history without its tree), and merging that branch into main reverts the second parent's work while
 * `git diff main...branch` shows none of it. `labels` name the two commits in messages.
 * Returns { changes: [{status, path}], tree, mergeBase, conflicts: [path] }.
 */
export function mergeChanges(repo, baseSha, headSha, labels = { base: baseSha, head: headSha }) {
  if (!isObjectId(baseSha) || !isObjectId(headSha)) throw new Error("mergeChanges takes two full commit ids");
  const pair = `--base ${labels.base} (${baseSha}) and --head ${labels.head} (${headSha})`;
  const found = gitTry(repo, ["merge-base", "--all", baseSha, headSha]);
  const bases = found.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (found.status === 1 && bases.length === 0 && found.stderr === "") {
    throw new Refusal(
      `cannot judge this merge: ${pair} share no history (no merge base); git merge refuses them`,
    );
  }
  if (found.status !== 0 || bases.length === 0 || !bases.every(isObjectId)) {
    throw new Error(`git merge-base --all failed (${found.stderr.split("\n")[0] || `exit ${found.status}`})`);
  }
  if (bases.length > 1) {
    throw new Refusal(
      `cannot judge this merge: ${pair} have ${bases.length} merge bases (${bases.join(", ")}). git merge ` +
        "would merge against a virtual base built from all of them, which no diff from one of them shows: such " +
        "a merge can silently revert work that is already on the base. Merge the base's tip " +
        `(${labels.base}, ${baseSha}) into the branch first, so that it is the only merge base, then rerun.`,
    );
  }
  const [mergeBase] = bases;
  const own = parseNameStatusZ(git(repo, ["diff", "--name-status", "-z", "-M", mergeBase, headSha]));

  const merged = spawnSync(
    "git",
    ["merge-tree", "--write-tree", "-z", "--name-only", "--no-messages", baseSha, headSha],
    {
      cwd: repo,
      encoding: "utf8",
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  // 0: clean, 1: conflicts; anything else is an error (merge-tree --write-tree needs git 2.38 or newer).
  if (merged.status !== 0 && merged.status !== 1) {
    const why =
      String(merged.stderr || merged.error?.message || "").split("\n")[0] || `exit ${merged.status}`;
    throw new Error(`git merge-tree --write-tree failed (${why}); git 2.38 or newer is needed`);
  }
  const fields = String(merged.stdout).split("\0");
  if (fields.at(-1) === "") fields.pop();
  const [tree, ...conflictedPaths] = fields;
  if (!isObjectId(tree)) throw new Error("git merge-tree --write-tree printed no tree id");
  const onBase = parseNameStatusZ(git(repo, ["diff", "--name-status", "-z", "-M", baseSha, tree]));

  const changes = [];
  const seen = new Set();
  const add = (c) => {
    const key = `${c.status}\0${c.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      changes.push(c);
    }
  };
  for (const c of [...own, ...onBase]) add(c);
  const conflicts = [...new Set(conflictedPaths.map(normalize))];
  const listed = new Set(changes.map((c) => c.path));
  for (const path of conflicts) if (!listed.has(path)) add({ status: "M", path });
  return { changes, tree, mergeBase, conflicts };
}

/**
 * The approval token for a change to the gate's files: the first 16 hex digits of a SHA-256 over each changed
 * gate path with its status and its tree entry (mode and blob id) at `headSha`. Any further edit to those files,
 * or a different set of them, gives a different token, so an approval covers exactly the version reviewed.
 */
export function gateChangeToken(repo, headSha, gateChanges) {
  const paths = [...new Set(gateChanges.map((c) => normalize(c.path)))].sort();
  const entries = git(repo, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", headSha, "--", ...paths]);
  const statuses = gateChanges
    .map((c) => `${c.status} ${normalize(c.path)}`)
    .sort()
    .join("\n");
  return createHash("sha256")
    .update(`fair-split gate change v1\n${statuses}\n\0${entries}`)
    .digest("hex")
    .slice(0, 16);
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
      "usage: check-ownership (--ws <id> | --branch <ws/id>) [--base <ref> [--head <ref>] | --stdin | files...] " +
        "[--ownership-ref <ref> | --ownership <file>] [--repo <dir>] [--strict] [--approve-gate-change <token>]",
    );
    return 0;
  }
  const repo = resolve(opts.repo ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  // `||`, not `??`: on a push GitHub exports GITHUB_HEAD_REF as an empty string, which must not hide the branch.
  const branch = opts.branch || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;
  const ws = opts.ws ? normalizeWorkstream(opts.ws) : workstreamFromBranch(branch);
  if (!ws) {
    const msg = `check-ownership: branch "${branch || "(none)"}" is not ws/<id> or deps/*`;
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
    // With --base the judged commit is <head>; bootstrap (a new repository) then reads that commit's own rules.
    const head = opts.base ? (opts.head ?? "HEAD") : undefined;
    loaded = loadOwnership({ repo, ref, file: opts.ownership, head });
  } catch (e) {
    console.error(`check-ownership: ${e.message}`);
    return 1;
  }
  const { ownership, source, bootstrap } = loaded;
  if (bootstrap && ws !== BOOTSTRAP_WS) {
    console.error(
      `check-ownership: ${ref} has neither ${OWNERSHIP_FILE} nor ${CHECKER_FILE}, and only ` +
        `${BOOTSTRAP_WS}'s PR may introduce them (S5.2.3 rule 4); ${ws} is never judged by its own copy. ` +
        "Land the rules on the base first.",
    );
    return 1;
  }
  if (bootstrap) console.warn(`check-ownership: warning: rules from ${source}`);

  let changes;
  let headSha = null;
  const extra = [];
  try {
    if (opts.base) {
      const head = opts.head ?? "HEAD";
      const baseSha = commitOf(repo, opts.base);
      headSha = commitOf(repo, head);
      if (!baseSha) throw new Error(`--base ${opts.base} is not a commit in ${repo}`);
      if (!headSha) throw new Error(`--head ${head} is not a commit in ${repo}`);
      const merge = mergeChanges(repo, baseSha, headSha, { base: opts.base, head });
      changes = merge.changes;
      if (merge.conflicts.length) {
        console.warn(
          `check-ownership: note: merging ${head} into ${opts.base} conflicts in ${merge.conflicts.length} ` +
            `path(s), which the merger resolves; each is judged as a change: ${merge.conflicts.join(", ")}`,
        );
      }
      // Letter-case collisions in the judged commit or in the tree the merge would produce.
      const paths = (sha) =>
        git(repo, ["ls-tree", "-r", "-z", "--full-tree", "--name-only", sha]).split("\0");
      const tree = new Set([...paths(headSha), ...paths(merge.tree)].filter(Boolean));
      extra.push(...caseCollisions([...tree], changes));
    } else if (opts.stdin) {
      changes = parseNameStatus(readFileSync(0, "utf8"));
    } else {
      changes = opts.files.map((path) => ({ status: "M", path }));
    }
  } catch (e) {
    const what = e instanceof Refusal ? "" : "cannot read the changed paths: ";
    console.error(`check-ownership: ${what}${e.message}`);
    return 1;
  }

  // A change to the gate's own files needs an approval bound to its content, so only --base mode can approve.
  let gateChangeApproved = false;
  let token = null;
  const gateChanges = changes.filter((c) => isGateFile(c.path) && c.status !== "D" && c.status !== "T");
  if (opts.approveGateChange && !headSha) {
    console.error("check-ownership: --approve-gate-change needs --base: the approval is bound to a commit");
    return 1;
  }
  if (gateChanges.length && headSha) {
    try {
      token = gateChangeToken(repo, headSha, gateChanges);
    } catch (e) {
      console.error(`check-ownership: cannot read the gate files at ${headSha}: ${e.message}`);
      return 1;
    }
    gateChangeApproved = opts.approveGateChange === token;
  }

  let result;
  try {
    result = checkChanges(ownership, ws, changes, { bootstrap, gateChangeApproved });
  } catch (e) {
    console.error(`check-ownership: ${e.message} (rules from ${source})`);
    return 1;
  }
  const violations = [...result.violations, ...extra];
  if (violations.length) {
    console.error(`check-ownership: ${violations.length} path(s) outside ${ws} (rules from ${source}):`);
    for (const v of violations) console.error(`  ${v.status} ${v.path}: ${v.reason}`);
    if (violations.some((v) => v.gate)) {
      const stale = opts.approveGateChange
        ? ` The approval given (${opts.approveGateChange}) is for a different version of these files.`
        : "";
      const how = token
        ? `review exactly this version, then rerun with --approve-gate-change ${token}`
        : "rerun with --base (and --head) so the approval can be bound to a commit";
      console.error(
        `check-ownership: these files are the ownership gate itself, so the merger approves each change to them:${stale} ` +
          `${how}. CI cannot approve, and workstream agents never pass this flag (AGENTS.md).`,
      );
    }
    return 1;
  }
  const approved = gateChangeApproved ? `; gate change ${token} approved` : "";
  if (opts.approveGateChange && !gateChangeApproved) {
    console.log(
      "check-ownership: --approve-gate-change given, but no gate file changed; nothing to approve.",
    );
  }
  console.log(
    `check-ownership: ${changes.length} changed path(s), all within ${ws} (rules from ${source}${approved}).`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
