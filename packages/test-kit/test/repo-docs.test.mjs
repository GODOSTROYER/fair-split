// Repo hygiene checks owned by WS-QA: the register copy stays verbatim, and every catalog pin is recorded.
import { readdirSync, readFileSync } from "node:fs";
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
  it("docs/decision-register.md is a verbatim copy of docs/spec/00-decision-register.md", () => {
    expect(read("docs/decision-register.md")).toBe(read("docs/spec/00-decision-register.md"));
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
    for (const wf of [".github/workflows/ci.yml", ".github/workflows/sandbox-smoke.yml"]) {
      const uses = [...read(wf).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u, `${wf}: ${u}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("CI checks ownership on every PR with the base's checker and rules", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/git show "\$BASE_SHA:tools\/check-ownership\.mjs"/);
    expect(ci).toMatch(/--ownership-ref "\$BASE_SHA" --strict/);
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

  it("ADRs on main are accepted by merging them, so none is left 'Proposed'", () => {
    const adrs = readdirSync(resolve(root, "docs/adr")).filter((f) => /^\d{3}-.+\.md$/.test(f));
    expect(adrs).toContain("000-template.md");
    for (const f of adrs) {
      expect(read(`docs/adr/${f}`), f).toMatch(/^- \*\*Status:\*\* Accepted \(user, on merge\)/m);
    }
  });

  it("README names the PayPal APIs and the three Claude model IDs", () => {
    const readme = read("README.md");
    for (const s of ["Invoicing v2", "Agent Toolkit 1.11.0", "Payouts v1", "Webhooks"])
      expect(readme).toContain(s);
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) expect(readme).toContain(m);
  });
});
