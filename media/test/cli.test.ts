import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLIP_0403, SLIP_0462 } from "../src/content/spike.js";
import { Fixture, type SlipImageFixture } from "../src/fixtures/schema.js";
import { main } from "../src/imagegen/cli.js";
import { CODEX_LEDGER_ENV, codexLedgerFor } from "../src/imagegen/ledger.js";
import { emptyManifest } from "../src/imagegen/manifest.js";
import { applyObservations } from "../src/imagegen/review.js";
import type { TerminalIo } from "../src/review/confirm.js";
import { applySubmission } from "../src/review/session.js";
import { REPO_ROOT } from "../src/util/env.js";
import { entry, slipPageFixture } from "./support.js";

const AT = "2026-10-22T12:00:00.000Z";
const agentShell: TerminalIo = { interactive: false, ask: async () => "", say: () => undefined };

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const keep = (...a: unknown[]) => void logs.push(a.join(" "));
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

function media(fixtures: Fixture[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "fs-cli-"));
  const m = emptyManifest();
  m.assets["spike-0403"] = entry("spike-0403");
  m.assets["spike-0462"] = entry("spike-0462");
  writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
  mkdirSync(join(root, "fixtures"), { recursive: true });
  for (const f of fixtures) writeFileSync(join(root, "fixtures", `${f.id}.json`), JSON.stringify(f));
  return root;
}

function personChecked(): Fixture {
  const f = slipPageFixture("spike-0403", SLIP_0403);
  applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
  return f;
}

const readFixture = (root: string, id: string) =>
  Fixture.parse(JSON.parse(readFileSync(join(root, "fixtures", `${id}.json`), "utf8"))) as SlipImageFixture;

describe("imagegen CLI guards", () => {
  it("gen never spends an exec on an asset that already has a master", async () => {
    const root = media();
    expect(await main(["gen", "spike-0403"], root, agentShell)).toBe(0);
    expect(logs.join("\n")).toMatch(/spike-0403: skipped, has an accepted master .*pass --force/);
    expect(logs.join("\n")).toMatch(/nothing to generate/);
  });

  it("gen refuses --force with all, and --force on a person-reviewed master without --replace-reviewed", async () => {
    expect(await main(["gen", "all", "--force"], media(), agentShell)).toBe(1);
    expect(logs.join("\n")).toMatch(/never applies to `all`/);
    const reviewed = slipPageFixture("spike-0403", SLIP_0403);
    reviewed.review.status = "human-reviewed";
    const root = mkdtempSync(join(tmpdir(), "fs-cli-"));
    const m = emptyManifest();
    m.assets["spike-0403"] = entry("spike-0403");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    mkdirSync(join(root, "fixtures"));
    // Written raw: only the status matters to the guard.
    writeFileSync(join(root, "fixtures", "spike-0403.json"), JSON.stringify(reviewed));
    expect(await main(["gen", "spike-0403", "--force"], root, agentShell)).toBe(1);
    expect(logs.join("\n")).toMatch(/add --replace-reviewed/);
  });

  it("mark cannot stamp agent-checked: that comes only from a recorded check", async () => {
    const root = media([slipPageFixture("spike-0403", SLIP_0403)]);
    expect(
      await main(["mark", "spike-0403", "--status", "agent-checked", "--reviewer", "x"], root, agentShell),
    ).toBe(1);
    expect(readFixture(root, "spike-0403").review.status).toBe("draft");
  });

  it("mark human-reviewed refuses an agent's shell, and a fixture a person has not read field by field", async () => {
    const f = personChecked();
    const root = media([f]);
    const person: TerminalIo = { interactive: true, ask: async () => "spike-0403", say: () => undefined };
    expect(
      await main(
        ["mark", "spike-0403", "--status", "human-reviewed", "--reviewer", "Analyn"],
        root,
        agentShell,
      ),
    ).toBe(1);
    expect(logs.join("\n")).toMatch(/interactive terminal/);
    // Agent-checked fields are not a person's reading, even at a terminal.
    expect(
      await main(["mark", "spike-0403", "--status", "human-reviewed", "--reviewer", "Analyn"], root, person),
    ).toBe(1);
    expect(readFixture(root, "spike-0403").review.status).toBe("draft");
    // After the person's own pass in the review page, the terminal confirmation marks it.
    const g = slipPageFixture("spike-0403", SLIP_0403);
    applySubmission(
      g,
      {
        fields: [...(await import("../src/imagegen/review.js")).fixtureFields(g)].map(([path, x]) => ({
          path,
          visible: x.visible,
          legibility: x.visible === "" ? "ABSENT" : "CLEAR",
          expect: x.expect,
        })),
      },
      { reviewer: "Analyn", startedAt: AT, submittedAt: AT },
    );
    const root2 = media([g]);
    expect(
      await main(["mark", "spike-0403", "--status", "human-reviewed", "--reviewer", "Analyn"], root2, person),
    ).toBe(0);
    expect(readFixture(root2, "spike-0403").review).toMatchObject({
      status: "human-reviewed",
      reviewer: "Analyn",
    });
    // A redraft would send that review back to draft, so it needs --replace-reviewed too.
    expect(await main(["fixture", "spike-0403", "--force"], root2, person)).toBe(2);
    expect(logs.join("\n")).toMatch(/needs --replace-reviewed/);
    expect(readFixture(root2, "spike-0403").review.status).toBe("human-reviewed");
  });

  it("review refuses to start a review page without a person at the terminal", async () => {
    const root = media([slipPageFixture("spike-0403", SLIP_0403)]);
    expect(await main(["review", "spike-0403", "--reviewer", "Analyn"], root, agentShell)).toBe(1);
    expect(logs.join("\n")).toMatch(/interactive terminal/);
  });

  it("trap-verdict needs a recorded read inside the repo and pins its hash", async () => {
    const root = media([slipPageFixture("spike-0462", SLIP_0462)]);
    const outside = join(mkdtempSync(join(tmpdir(), "fs-ev-")), "read.json");
    writeFileSync(outside, "{}");
    expect(
      await main(
        ["trap-verdict", "spike-0462", "ONLY", "WATER_STAIN", "--status", "HOLDS", "--evidence", outside],
        root,
        agentShell,
      ),
    ).toBe(1);
    expect(
      await main(
        [
          "trap-verdict",
          "spike-0462",
          "ONLY",
          "WATER_STAIN",
          "--status",
          "HOLDS",
          "--evidence",
          join(REPO_ROOT, "package.json"),
        ],
        root,
        agentShell,
      ),
    ).toBe(0);
    expect(readFixture(root, "spike-0462").slips[0]?.trapChecks[0]).toMatchObject({
      status: "HOLDS",
      by: "read",
    });
    expect(readFixture(root, "spike-0462").slips[0]?.trapChecks[0]?.evidence).toMatch(
      /^package\.json sha256:[0-9a-f]{16}$/,
    );
  });

  it("replay-check lists what still stops an image", async () => {
    const root = media([slipPageFixture("spike-0462", SLIP_0462)]);
    expect(await main(["replay-check", "spike-0462"], root, agentShell)).toBe(2);
    expect(logs.join("\n")).toMatch(/not human-reviewed[\s\S]*WATER_STAIN must be shown to hold/);
  });

  it("budget reads the one machine-wide Codex ledger, whichever checkout runs it", async () => {
    const shared = join(mkdtempSync(join(tmpdir(), "fs-codex-home-")), "ledger.json");
    vi.stubEnv(CODEX_LEDGER_ENV, shared);
    try {
      // An exec reserved from one checkout counts in another's budget, and nothing is written in either.
      const first = media();
      const second = media();
      await codexLedgerFor(first).reserve("exec:mat-1#1");
      expect(await main(["budget"], second, agentShell)).toBe(0);
      expect(logs.join("\n")).toMatch(/Codex: 1 of 12 execs in the last 5 h/);
      expect(logs.join("\n")).toContain(shared);
      expect(existsSync(join(first, ".codex-ledger.json"))).toBe(false);
      expect(existsSync(join(second, ".codex-ledger.json"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
