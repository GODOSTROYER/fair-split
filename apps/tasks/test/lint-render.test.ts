import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BLUEPRINT_PATH } from "../../../tools/lib/blueprint.js";
import { formatLint, lintRender, main, parseArgs } from "../../../tools/lint-render.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A copy of render.yaml with one textual edit, in a temp dir. */
function variant(from: string, to: string): string {
  const text = readFileSync(BLUEPRINT_PATH, "utf8");
  expect(text).toContain(from);
  dir = mkdtempSync(join(tmpdir(), "fs-lint-render-"));
  const file = join(dir, "render.yaml");
  writeFileSync(file, text.replace(from, to));
  return file;
}

describe("tools/lint-render (CI's render.yaml lint)", () => {
  it("passes the committed render.yaml", () => {
    const lines: string[] = [];
    expect(main([], (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual(["render.yaml schema: PASS", "render.yaml policy: PASS"]);
  });

  it("fails a schema error (a workflow with a plan) and a policy error (a literal secret)", () => {
    const schemaBad = variant(
      "    # No `plan` (each task defaults to `flex`)",
      "    plan: flex\n    # No `plan` (each task defaults to `flex`)",
    );
    expect(lintRender(schemaBad).schema.length).toBeGreaterThan(0);
    rmSync(dir as string, { recursive: true, force: true });
    const policyBad = variant(
      "      - key: ANTHROPIC_API_KEY\n        sync: false\n      - key: RENDER_API_KEY",
      "      - key: ANTHROPIC_API_KEY\n        value: not-a-real-key\n      - key: RENDER_API_KEY",
    );
    const result = lintRender(policyBad);
    expect(result.policy).toContain("fs-api: ANTHROPIC_API_KEY must not have a literal value");
    const lines: string[] = [];
    expect(main([`--file=${policyBad}`], (l) => lines.push(l))).toBe(1);
    expect(lines).toContain("render.yaml policy: FAIL");
  });

  it("formats each section and parses its one flag strictly", () => {
    expect(formatLint({ schema: [], policy: ["x"] })).toEqual([
      "render.yaml schema: PASS",
      "render.yaml policy: FAIL",
      "  - x",
    ]);
    expect(parseArgs([]).file).toBe(BLUEPRINT_PATH);
    expect(() => parseArgs(["--fix"])).toThrow(/unknown argument/);
  });
});
