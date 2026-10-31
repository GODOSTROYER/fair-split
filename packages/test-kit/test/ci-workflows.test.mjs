// What CI runs on Linux and what it costs in Actions minutes (work package Q1), and the gitleaks allowlist.
// The workflows are read as text, like repo-docs.test.mjs does: test-kit carries no YAML or TOML parser.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");
const workflows = () =>
  readdirSync(resolve(root, ".github/workflows"))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `.github/workflows/${f}`);

/** One YAML block: the line `key:` at `indent` spaces and every following line indented deeper (or blank). */
function block(text, key, indent) {
  const lines = text.split("\n");
  const head = `${" ".repeat(indent)}${key}:`;
  const start = lines.findIndex((l) => l === head || l.startsWith(`${head} `));
  if (start < 0) return null;
  const out = [lines[start]];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== "" && l.length - l.trimStart().length <= indent) break;
    out.push(l);
  }
  return out.join("\n");
}

/** The `on:` triggers of a workflow, by name, each as its block (or the bare line). */
const triggers = (wf) => {
  const on = block(read(wf), "on", 0) ?? "";
  return Object.fromEntries(
    [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(([, name]) => [name, block(on, name, 2) ?? ""]),
  );
};

const crons = (text) => [...text.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);

describe("CI on Linux (Q1)", () => {
  it("block() reads a YAML block up to the next line at its own indent", () => {
    const y = "on:\n  push:\n    branches: [main]\n\n    paths: [x]\n  pull_request:\njobs:\n  a: 1\n";
    expect(block(y, "push", 2)).toBe("  push:\n    branches: [main]\n\n    paths: [x]");
    expect(block(y, "pull_request", 2)).toBe("  pull_request:");
    expect(block(y, "pull_request_target", 2)).toBeNull();
    expect(Object.keys(triggers(".github/workflows/ci.yml"))).toContain("push");
  });

  it("every workflow cancels a superseded run (concurrency with cancel-in-progress)", () => {
    for (const wf of workflows()) {
      const c = block(read(wf), "concurrency", 0);
      expect(c, wf).toMatch(/\n {2}group: \S/);
      expect(c, wf).toMatch(/\n {2}cancel-in-progress: true$/m);
    }
  });

  it("every push and pull_request trigger has a path filter, but ci.yml's and the ownership gate's", () => {
    // ci.yml's job reads every path: Biome formats Markdown, tests read docs/, media/ and assets/, and secretlint
    // scans the whole tree. A filter there would let a docs or asset change that breaks a check reach main.
    const unfiltered = new Set([".github/workflows/ci.yml"]);
    expect(read(".github/workflows/ci.yml")).toMatch(
      /^# No path filter, on purpose: the job reads every path\./m,
    );
    let filtered = 0;
    for (const wf of workflows()) {
      for (const [name, body] of Object.entries(triggers(wf))) {
        if (name !== "push" && name !== "pull_request") continue;
        if (unfiltered.has(wf)) {
          expect(body, `${wf} ${name}`).not.toMatch(/paths/);
          continue;
        }
        expect(body, `${wf} ${name}`).toMatch(/\n {4}paths(-ignore)?:\n( {6}- "[^"]+"\n?)+/);
        filtered++;
      }
    }
    expect(filtered).toBeGreaterThanOrEqual(2); // gitleaks.yml, push and pull_request
    // pull_request_target takes the workflow from main; a path filter there would let a PR skip the gate.
    expect(triggers(".github/workflows/ownership.yml")).toHaveProperty("pull_request_target");
    expect(read(".github/workflows/ownership.yml")).not.toMatch(/^\s+paths(-ignore)?:/m);
  });

  it("push runs CI on the branches the merger judges, plus a work-package branch pushed to try CI", () => {
    for (const wf of [".github/workflows/ci.yml", ".github/workflows/gitleaks.yml"]) {
      expect(triggers(wf).push, wf).toMatch(
        /^ {4}branches: \[main, "ws\/\*\*", "deps\/\*\*", "wp\/\*\*"\]$/m,
      );
    }
  });

  it("nothing runs nightly: every schedule is weekly at most", () => {
    const all = workflows().flatMap((wf) => crons(read(wf)).map((c) => [wf, c]));
    expect(all.length).toBeGreaterThan(0);
    for (const [wf, cron] of all) {
      const [, , dayOfMonth, , dayOfWeek] = cron.split(/\s+/);
      expect(dayOfMonth === "*" && dayOfWeek === "*", `${wf}: ${cron}`).toBe(false);
    }
    // ci.yml's nightly run did nothing but gitleaks; that scan now lives in gitleaks.yml.
    expect(triggers(".github/workflows/ci.yml")).not.toHaveProperty("schedule");
    // The smoke job is a placeholder that every scheduled run skipped; it runs by hand until E-17 exists.
    expect(Object.keys(triggers(".github/workflows/sandbox-smoke.yml"))).toEqual(["workflow_dispatch"]);
  });

  it("ci.yml typechecks and tests every package even after one fails (turbo --continue)", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/run: pnpm exec turbo run typecheck --continue\n/);
    expect(ci).toMatch(/run: pnpm exec turbo run test --continue\n/);
    expect(ci).not.toMatch(/run: pnpm (typecheck|test)\n/);
    expect(ci).not.toMatch(/uses: gitleaks\//);
  });

  it("gitleaks scans the pushed or PR commits on every push and PR, and the whole history weekly", () => {
    const wf = read(".github/workflows/gitleaks.yml");
    const t = triggers(".github/workflows/gitleaks.yml");
    expect(Object.keys(t).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(crons(wf)).toHaveLength(1);
    expect(crons(wf)[0]).toMatch(/^\d+ \d+ \* \* [0-6]$/);
    // gitleaks scans patches, and git shows no patch for a binary file: only binary-only changes skip it.
    for (const name of ["push", "pull_request"]) {
      const ignored = [...t[name].matchAll(/^ {6}- "([^"]+)"$/gm)].map((m) => m[1]);
      expect(ignored.length, name).toBeGreaterThan(0);
      for (const p of ignored)
        expect(p, name).toMatch(/^\*\*\/\*\.(png|jpg|webp|ttf|woff2|mp3|m4a|mp4|wav)$/);
    }
    // A push run scans only its own commits: it must never be cancelled or replaced by a later push's run.
    expect(block(wf, "concurrency", 0)).toMatch(
      /\n {2}group: gitleaks-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event_name == 'push' && github\.sha \|\| github\.ref \}\}\n/,
    );
    expect(wf).toMatch(/\n {10}GITLEAKS_CONFIG: \.github\/\.gitleaks\.toml\n/);
    expect(wf).toMatch(/\n {10}GITLEAKS_VERSION: "8\.24\.3"\n/);
    expect(read("docs/security.md")).toMatch(
      /\| gitleaks +\| Push: the pushed commits\. PR: the PR's commits\. Weekly/,
    );
  });
});

describe("vitest never passes a package that has tests but ran none (Q1)", () => {
  const isTest = (f) => /\.test\.(?:[cm]?[jt]sx?)$/.test(f);
  const testFiles = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (isTest(name)) out.push(relative(root, p));
      }
    };
    walk(dir);
    return out;
  };
  const packages = ["apps", "packages"]
    .flatMap((top) => readdirSync(resolve(root, top)).map((n) => `${top}/${n}`))
    .concat(["media"])
    .filter((d) => {
      try {
        return statSync(resolve(root, d, "package.json")).isFile();
      } catch {
        return false;
      }
    });

  it("only a package with no test files keeps --passWithNoTests", () => {
    expect(packages.length).toBeGreaterThan(15);
    const keeping = [];
    for (const dir of packages) {
      const test = JSON.parse(read(`${dir}/package.json`)).scripts?.test ?? "";
      if (!/--passWithNoTests/.test(test)) continue;
      expect(testFiles(resolve(root, dir)), `${dir} has tests but passes with none`).toEqual([]);
      keeping.push(dir);
    }
    expect(keeping).toEqual(["packages/ui-native"]);
  });
});

describe(".github/.gitleaks.toml allowlists only the PayPal simulator's fictional app credentials", () => {
  // Under .github, which WS-QA owns: docs/ownership.md gives a root .gitleaks.toml to no workstream.
  const toml = existsSync(resolve(root, ".github/.gitleaks.toml")) ? read(".github/.gitleaks.toml") : "";
  const code = toml
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const literals = (s) => [...s.matchAll(/'''([^']*)'''/g)].map((m) => m[1]);
  const lists = code.split(/^\[\[rules\.allowlists\]\]$/m).slice(1);

  /** The simulator apps' client_id and client_secret, and render.yaml's PP_CLIENT_ID and PP_CLIENT_SECRET. */
  const accounts = JSON.parse(read("packages/paypal-sim/data/accounts.json"));
  const appValues = accounts.apps.flatMap((a) => [a.client_id, a.client_secret]);
  const render = read("render.yaml");
  const renderValue = (key) => new RegExp(`- key: ${key}\\n\\s+value: (\\S+)`).exec(render)?.[1];
  const ppValues = ["PP_CLIENT_ID", "PP_CLIENT_SECRET"].map(renderValue);

  /** Every scalar value in the two files, which the allowlist must leave alone unless it is one of the above. */
  const everyValue = [
    ...[...read("packages/paypal-sim/data/accounts.json").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]),
    ...[...render.matchAll(/^\s*(?:- )?[\w-]+: ("?)([^"\n#]+)\1\s*(?:#.*)?$/gm)].map((m) => m[2].trim()),
  ];

  it("keeps every default rule and has no global [allowlist], which in gitleaks 8.24 cannot AND a path", () => {
    expect(code).toMatch(/^\[extend\]\nuseDefault = true$/m);
    expect(code).not.toMatch(/^\[allowlist\]$/m);
    expect(code).not.toMatch(/^\[\[allowlists\]\]$/m);
    expect(code).not.toMatch(/disabledRules/);
    // Only generic-api-key is extended, and with nothing but allowlists: no regex, path, entropy or keywords.
    const rules = code.split(/^\[\[rules\]\]$/m).slice(1);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/^\nid = "generic-api-key"\n/);
    expect(rules[0].split("[[rules.allowlists]]")[0].trim()).toBe('id = "generic-api-key"');
  });

  it("each allowlist needs an exact value AND one of the two files that hold the fictional apps", () => {
    expect(lists).toHaveLength(1);
    for (const list of lists) {
      expect(list).toMatch(/^condition = "AND"$/m);
      expect(list).not.toMatch(/^(commits|stopwords|regexTarget) =/m); // regexes target the secret itself
      const paths = literals(/^paths = \[([\s\S]*?)\]$/m.exec(list)?.[1] ?? "");
      expect(paths).toEqual(["^render\\.yaml$", "^packages/paypal-sim/data/accounts\\.json$"]);
      const regexes = literals(/^regexes = \[([\s\S]*?)\]$/m.exec(list)?.[1] ?? "");
      expect(regexes.length).toBeGreaterThan(0);
      for (const r of regexes) expect(r).toMatch(/^\^[^.*+?]*(\(\?:[\w|-]+\))?[^.*+?]*\$$/);
    }
  });

  it("the regexes match exactly the simulator's client ids and secrets, and no other value in those files", () => {
    const regexes = lists.flatMap((l) =>
      literals(/^regexes = \[([\s\S]*?)\]$/m.exec(l)?.[1] ?? "").map((r) => new RegExp(r)),
    );
    expect(appValues).toHaveLength(4);
    expect(ppValues.every((v) => v && appValues.includes(v))).toBe(true);
    const allowed = new Set(everyValue.filter((v) => regexes.some((r) => r.test(v))));
    expect([...allowed].sort()).toEqual([...new Set(appValues)].sort());
    // and not a real-looking PayPal client id or secret of the same shape
    for (const v of ["SIM-fs-prod-client", "AZ-real-client-id", "sim-fs-judge-not-a-paypal-secret2"]) {
      expect(
        regexes.some((r) => r.test(v)),
        v,
      ).toBe(false);
    }
  });
});
