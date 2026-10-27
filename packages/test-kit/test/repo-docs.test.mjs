// Repo hygiene checks owned by WS-QA: one decision register, every catalog pin recorded, ADRs numbered.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");
const esc = (s) => s.replace(/[.*+?^${}()|[\]/\\]/g, "\\$&");

/** [name, version] for every exact pin in the catalog and named catalogs of pnpm-workspace.yaml. */
const catalogPins = (yaml) =>
  [...yaml.matchAll(/^\s+"?([@\w./-]+)"?:\s*(\d[\w.-]*)\s*$/gm)].map((m) => [m[1], m[2]]);

/** True when a markdown table row reads | `name` | version |. */
const recordsPin = (md, name, version) =>
  new RegExp(`\\|\\s*\`${esc(name)}\`\\s*\\|\\s*${esc(version)}\\s*\\|`).test(md);

describe("repo docs", () => {
  it("the decision register lives only in docs/spec/, and the docs link it there", () => {
    expect(existsSync(resolve(root, "docs/spec/00-decision-register.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/decision-register.md"))).toBe(false);
    for (const f of ["AGENTS.md", "README.md", "CONTRIBUTING.md"]) {
      expect(read(f), f).toContain("docs/spec/00-decision-register.md");
      expect(read(f), f).not.toMatch(/[(`]docs\/decision-register\.md/);
    }
  });

  it("an ADR records where the repo departs from the register's 'Changes' line, which WS-QA cannot edit", () => {
    const register = read("docs/spec/00-decision-register.md");
    const adrs = readdirSync(resolve(root, "docs/adr")).map((f) => read(`docs/adr/${f}`));
    const amending = (quote) =>
      adrs.find((text) => text.includes(quote) && /Register text this ADR amends/.test(text));
    for (const quote of ["`docs/adr/NNN-title.md`", "`docs/decision-register.md`"]) {
      if (register.includes(quote)) expect(amending(quote), quote).toBeDefined();
    }
  });

  it("docs/versions.md records every catalog pin at its exact version", () => {
    const versions = read("docs/versions.md");
    const pins = catalogPins(read("pnpm-workspace.yaml"));
    expect(pins.length).toBeGreaterThan(40);
    expect(pins).toContainEqual(["zod", "3.25.76"]);
    for (const [name, version] of pins) {
      expect(recordsPin(versions, name, version), `${name}@${version}`).toBe(true);
    }
  });

  it("the pin check fails on a pin that versions.md does not record", () => {
    const versions = read("docs/versions.md");
    expect(recordsPin(versions, "typescript", "6.0.3")).toBe(true);
    expect(recordsPin(versions, "typescript", "6.0.4")).toBe(false);
    expect(recordsPin(versions, "typescript", "6x0x3")).toBe(false);
    expect(recordsPin(versions, "left-pad-not-pinned", "1.3.0")).toBe(false);
    expect(recordsPin("| `typescript` | 6.0.3 |", "typescript", "6.0.3")).toBe(true);
    expect(recordsPin("| `typescript` | 6.0.30 |", "typescript", "6.0.3")).toBe(false);
    expect(recordsPin("", "typescript", "6.0.3")).toBe(false);
  });

  it("every workflow pins actions by full commit SHA", () => {
    const workflows = readdirSync(resolve(root, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));
    expect(workflows).toEqual(expect.arrayContaining(["ci.yml", "ownership.yml", "sandbox-smoke.yml"]));
    for (const wf of workflows.map((f) => `.github/workflows/${f}`)) {
      const uses = [...read(wf).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u, `${wf}: ${u}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("the docs describe the gate that runs: ownership.yml from main, plus the merger's run of main's checker", () => {
    expect(read(".github/workflows/ci.yml")).not.toMatch(/check-ownership/);
    const contributing = read("CONTRIBUTING.md");
    expect(contributing).toMatch(/^## Merging$/m);
    expect(contributing).toContain(
      'git show main:tools/check-ownership.mjs > "$TMPDIR/check-ownership.main.mjs"',
    );
    expect(contributing).toMatch(/--branch ws\/<id> --base main --head ws\/<id> --strict/);
    expect(contributing).toContain("--approve-gate-change <token>");
    expect(read("AGENTS.md")).toContain("never pass `--approve-gate-change`");
    const rules = read("docs/ownership.md");
    for (const f of ["docs/ownership.md", "tools/check-ownership.mjs", ".github/workflows/ownership.yml"]) {
      expect(rules).toContain(`\`${f}\``);
    }
    expect(rules).toContain("`pull_request_target`");
    // The workstream is the branch name; the docs say so instead of implying an access-control boundary.
    expect(rules).toMatch(/does\s+not authenticate who pushed/);
    expect(rules).not.toMatch(/CI runs the PR's own copy|base commit's `tools\/check-ownership\.mjs`/);
  });

  it("no merge queue: CI has no merge_group trigger and nothing describes a merge train (ADR-0006)", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/sandbox-smoke.yml"]) {
      expect(read(f), f).not.toMatch(/merge_group|merge train/);
    }
    for (const f of ["CONTRIBUTING.md", "docs/adr/0000-template.md"]) {
      expect(read(f), f).not.toMatch(/merge train/);
    }
    expect(read("docs/adr/0006-ownership-gate-runs-from-main.md")).toMatch(
      /CI does not trigger on `merge_group`/,
    );
  });

  it("gitleaks can list a PR's commits in this private repository (pull-requests: read)", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("\n  gitleaks:\n"));
    expect(job).toMatch(/\n {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n/);
    expect(job).not.toMatch(/:\s*write\b/);
  });

  it("test-kit's tests never replay from turbo's cache: they read files across the whole repository", () => {
    const turbo = JSON.parse(read("turbo.json"));
    expect(turbo.tasks["@fairsplit/test-kit#test"].cache).toBe(false);
  });

  it("Biome errors on inline type-only imports and exports (see dependency-rules.test.mjs)", () => {
    const style = JSON.parse(read("biome.json")).linter.rules.style;
    expect(style).toMatchObject({ useImportType: "error", useExportType: "error" });
  });

  it("gitleaks also runs on a schedule, the only automatic trigger on which it scans full history", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/^ {2}schedule:\n {4}- cron: "[^"]+"/m);
    expect(ci).toMatch(/verify:\n\s+name: [^\n]+\n\s+if: \$\{\{ github\.event_name != 'schedule' \}\}/);
    expect(read("docs/security.md")).not.toMatch(/\| gitleaks\s+\| Full git history/);
  });

  it("the smoke workflow takes sandbox addresses from secrets, never unmasked vars", () => {
    const wf = read(".github/workflows/sandbox-smoke.yml");
    expect(wf).not.toMatch(/vars\.PAYPAL_/);
    for (const v of ["PAYPAL_BUSINESS_EMAIL", "PAYPAL_BUYER_EMAIL", "PAYPAL_SMOKE_RECEIVER_EMAIL"]) {
      expect(wf).toContain(`secrets.${v}`);
    }
  });

  it("the smoke job runs only on main, whichever branch a manual run starts from", () => {
    const wf = read(".github/workflows/sandbox-smoke.yml");
    const ifs = [...wf.matchAll(/^ {4}if: (.+)$/gm)].map((m) => m[1]);
    expect(ifs).toEqual([
      expect.stringMatching(
        /^\$\{\{ github\.ref == 'refs\/heads\/main' && vars\.SANDBOX_SMOKE_ENABLED == 'true' \}\}$/,
      ),
    ]);
    expect(wf).not.toMatch(/public repo's logs/);
    expect(read("docs/security.md")).toMatch(
      /`sandbox-smoke` and `eval-live`[\s\S]*Deployment branches[\s\S]*`main` only/,
    );
  });

  it("test-kit uses only reserved email domains (RFC 2606 / RFC 6761)", () => {
    const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
    const reserved = /(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/i;
    const files = readdirSync(resolve(root, "packages/test-kit"), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|mjs|json|md)$/.test(d.name))
      .map((d) => join(d.parentPath, d.name))
      .filter((f) => !/[\\/]node_modules[\\/]/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      for (const [address, domain] of readFileSync(f, "utf8").matchAll(email)) {
        expect(domain, `${f}: ${address}`).toMatch(reserved);
      }
    }
  });

  it("ADR numbers that other branches hold are not taken here", () => {
    // Numbers held outside this branch. Before taking a number, check main and every in-flight branch.
    const held = {
      "0001": "plan-errata",
      "0002": "simulated-paypal-sandbox-and-private-repo",
      "0003": "ai-replay-identity-rate-card-term-key-and-slip-hash", // ws/read
    };
    for (const f of readdirSync(resolve(root, "docs/adr"))) {
      const slug = held[f.slice(0, 4)];
      if (slug) expect(f).toBe(`${f.slice(0, 4)}-${slug}.md`);
    }
    expect(read("CONTRIBUTING.md")).toContain("docs/adr/0005-working-copy-on-local-z-drive.md");
  });

  it("ADRs are NNNN-title.md with unique numbers, and none on main is left 'Proposed'", () => {
    const adrs = readdirSync(resolve(root, "docs/adr")).filter((f) => f.endsWith(".md"));
    expect(adrs).toContain("0000-template.md");
    for (const f of adrs) expect(f).toMatch(/^\d{4}-[a-z0-9-]+\.md$/);
    const numbers = adrs.map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const f of adrs) {
      const text = read(`docs/adr/${f}`);
      expect(text, f).toMatch(/\bStatus\b[:*\s]*Accepted\b/i);
      expect(text, f).not.toMatch(/\bStatus\b[:*\s]*Proposed\b/i);
    }
  });

  it("README names the PayPal APIs and the three Claude model IDs", () => {
    const readme = read("README.md");
    for (const s of ["Invoicing v2", "Agent Toolkit 1.11.0", "Payouts v1", "Webhooks"])
      expect(readme).toContain(s);
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) expect(readme).toContain(m);
  });
});
