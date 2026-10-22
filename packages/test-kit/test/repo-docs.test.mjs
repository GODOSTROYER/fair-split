// Repo hygiene checks owned by WS-QA: the register copy stays verbatim, and every catalog pin is recorded.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

describe("repo docs", () => {
  it("docs/decision-register.md is a verbatim copy of docs/spec/00-decision-register.md", () => {
    expect(read("docs/decision-register.md")).toBe(read("docs/spec/00-decision-register.md"));
  });

  it("docs/versions.md records every catalog pin at its exact version", () => {
    const versions = read("docs/versions.md");
    const pins = [...read("pnpm-workspace.yaml").matchAll(/^\s+"?([@\w./-]+)"?:\s*(\d[\w.-]*)\s*$/gm)];
    expect(pins.length).toBeGreaterThan(40);
    for (const [, name, version] of pins) {
      expect(versions, `${name}@${version}`).toMatch(
        new RegExp(`| \`${name.replace(/[.*+?^${}()|[\]/]/g, "$&")}\`s*| ${version.replace(/\./g, ".")}s*|`),
      );
    }
  });

  it("every workflow pins actions by full commit SHA", () => {
    for (const wf of [".github/workflows/ci.yml", ".github/workflows/sandbox-smoke.yml"]) {
      const uses = [...read(wf).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u, `${wf}: ${u}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it("README names the PayPal APIs and the three Claude model IDs", () => {
    const readme = read("README.md");
    for (const s of ["Invoicing v2", "Agent Toolkit 1.11.0", "Payouts v1", "Webhooks"])
      expect(readme).toContain(s);
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) expect(readme).toContain(m);
  });
});
