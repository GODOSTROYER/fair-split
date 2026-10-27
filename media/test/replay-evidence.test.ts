import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLIP_0462 } from "../src/content/spike.js";
import { Fixture, type SlipImageFixture, type TrapCheck } from "../src/fixtures/schema.js";
import { main } from "../src/imagegen/cli.js";
import { emptyManifest } from "../src/imagegen/manifest.js";
import { fixtureFields } from "../src/imagegen/review.js";
import { confirmHumanReview, type TerminalIo } from "../src/review/confirm.js";
import { applySubmission, replayBlockers, replayReadiness, sessionPath } from "../src/review/session.js";
import { sha256 } from "../src/util/hash.js";
import { entry, SHA_B, slipPageFixture } from "./support.js";

/**
 * verify:media minor: `replay-check` took any trap check that said `HOLDS` by `read` on trust, while a
 * person's review is re-checked against its saved session at replay time. A recorded read now keeps its
 * report's path and sha256 as fields, and `replay-check` re-runs what `trap-verdict` checked: the report is
 * still there, still hashes to its pin, still read and passed this slip, and was made after the exec that
 * made the current master. A HOLDS written by hand does not get an image into a replay set.
 */

const AT = "2026-10-24T05:00:00.000Z";
const LATER = "2026-10-24T05:10:00.000Z";
const DECISION = "user, 24 Oct: box 11 stays readable";
const agentShell: TerminalIo = { interactive: false, ask: async () => "", say: () => undefined };
const person: TerminalIo = { interactive: true, ask: async () => "spike-0462", say: () => undefined };

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const keep = (...a: unknown[]) => void logs.push(a.join(" "));
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

const legibilityOf = (visible: string) =>
  visible === "" ? ("ABSENT" as const) : visible.includes("?") ? ("SMUDGED" as const) : ("CLEAR" as const);

/**
 * Slip 0462's flat as it stands before its trap verdict: a person typed every field in the review page and
 * confirmed at the terminal (so only the trap keeps it out of a replay set). Its master (support `entry`)
 * was made by the exec of 2026-10-22T07:00Z. Reports go under `repo`.
 */
async function reviewed0462() {
  const media = mkdtempSync(join(tmpdir(), "fs-replay-"));
  const repo = mkdtempSync(join(tmpdir(), "fs-replay-repo-"));
  const m = emptyManifest();
  m.assets["spike-0462"] = entry("spike-0462");
  writeFileSync(join(media, "manifest.json"), JSON.stringify(m));
  mkdirSync(join(media, "fixtures"), { recursive: true });
  mkdirSync(join(media, "review", "sessions"), { recursive: true });
  mkdirSync(join(repo, "packages", "eval", "report", "history"), { recursive: true });
  const f = slipPageFixture("spike-0462", SLIP_0462);
  const answers = {
    fields: [...fixtureFields(f)].map(([path, x]) => ({
      path,
      visible: x.visible,
      legibility: legibilityOf(x.visible),
      expect: x.expect,
    })),
  };
  const record = applySubmission(f, answers, { reviewer: "Analyn", startedAt: AT, submittedAt: AT });
  const path = sessionPath(f.id, AT);
  const done = await confirmHumanReview(f, "Analyn", person, { path, record }, () => new Date(LATER));
  writeFileSync(join(media, path), JSON.stringify(done.session));
  writeFixture(media, done.fixture as SlipImageFixture);
  return { media, repo, fixture: done.fixture as SlipImageFixture };
}

function writeFixture(media: string, f: SlipImageFixture | object) {
  writeFileSync(join(media, "fixtures", "spike-0462.json"), JSON.stringify(f));
}

const readFixture = (media: string) =>
  Fixture.parse(
    JSON.parse(readFileSync(join(media, "fixtures", "spike-0462.json"), "utf8")),
  ) as SlipImageFixture;

/** A WS-READ report under packages/eval/report/history/ that read spike-0462#ONLY; returns its repo path. */
function report(repo: string, name: string, over: { generatedAt?: string; pass?: boolean } = {}): string {
  const rel = `packages/eval/report/history/${name}.json`;
  const pass = over.pass ?? true;
  writeFileSync(
    join(repo, rel),
    JSON.stringify({
      v: 1,
      generated_at: over.generatedAt ?? "2026-10-24T06:00:00.000Z",
      mode: "live",
      set: "dev",
      cases: [{ id: "spike-0462#ONLY", kind: "slip", pass, reasons: pass ? [] : ["row not exact"] }],
    }),
  );
  return rel;
}

const pinOf = (repo: string, rel: string) => sha256(readFileSync(join(repo, rel)));

describe("replay-check re-runs the checks a recorded read passed", () => {
  it("keeps the report's path and sha256 as fields, and refuses the image once the report no longer matches its pin", async () => {
    const { media, repo } = await reviewed0462();
    const rel = report(repo, "2026-10-24T06-00-00-000Z-live-dev");
    const replay = () => main(["replay-check", "spike-0462"], media, agentShell, repo);
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
          rel,
          "--accept-leak",
          DECISION,
        ],
        media,
        agentShell,
        repo,
      ),
    ).toBe(0);
    expect(readFixture(media).slips[0]?.trapChecks[0]).toMatchObject({
      status: "HOLDS",
      by: "read",
      evidenceFile: rel,
      evidenceSha256: pinOf(repo, rel),
      leakAccepted: DECISION,
    });
    expect(await replay()).toBe(0);
    expect(logs.join("\n")).toMatch(/spike-0462: ready for a replay set/);
    // The report is rewritten after the verdict (here: a later run failed the slip).
    writeFileSync(
      join(repo, rel),
      readFileSync(join(repo, rel), "utf8").replace('"pass":true', '"pass":false'),
    );
    logs = [];
    expect(await replay()).toBe(2);
    expect(logs.join("\n")).toMatch(
      /ONLY slip 0462: WATER_STAIN HOLDS rests on .*-live-dev\.json, which no longer hashes to the sha256 the verdict pinned/,
    );
  });

  it("trap-verdict warns that a verdict pinned to latest.json falls with the next READ run", async () => {
    const { media, repo } = await reviewed0462();
    const history = report(repo, "2026-10-24T06-00-00-000Z-live-dev");
    const latest = "packages/eval/report/latest.json";
    writeFileSync(join(repo, latest), readFileSync(join(repo, history)));
    const verdict = (rel: string) =>
      main(
        [
          "trap-verdict",
          "spike-0462",
          "ONLY",
          "WATER_STAIN",
          "--status",
          "HOLDS",
          "--evidence",
          rel,
          "--accept-leak",
          DECISION,
        ],
        media,
        agentShell,
        repo,
      );
    expect(await verdict(history)).toBe(0);
    expect(logs.join("\n")).not.toMatch(/rewrites latest\.json/);
    expect(await verdict(latest)).toBe(0);
    expect(logs.join("\n")).toMatch(/every READ run rewrites latest\.json, so pin its history\/ copy/);
  });

  it("refuses a HOLDS written by hand, whatever evidence it names", async () => {
    const { media, repo, fixture } = await reviewed0462();
    const failing = report(repo, "failing", { pass: false });
    const early = report(repo, "early", { generatedAt: "2026-10-21T00:00:00.000Z" });
    const passing = report(repo, "passing");
    writeFileSync(join(repo, "README.md"), "# readme");
    const handWritten = {
      status: "HOLDS",
      by: "read",
      at: AT,
      evidence: "README.md",
      leakAccepted: DECISION,
    };
    const cases: [Partial<TrapCheck>, RegExp][] = [
      // verify:media probe C: no pinned report at all.
      [{}, /not a valid fixture: .*a recorded read names the report it rests on/],
      [
        { evidenceFile: "README.md", evidenceSha256: pinOf(repo, "README.md") },
        /must be a WS-READ eval report under packages\/eval\/report\//,
      ],
      [
        { evidenceFile: "packages/eval/report/history/never-run.json", evidenceSha256: "0".repeat(64) },
        /never-run\.json, which does not exist/,
      ],
      [{ evidenceFile: passing, evidenceSha256: "f".repeat(64) }, /no longer hashes to the sha256/],
      [{ evidenceFile: failing, evidenceSha256: pinOf(repo, failing) }, /fails spike-0462#ONLY/],
      [{ evidenceFile: early, evidenceSha256: pinOf(repo, early) }, /predates this master/],
    ];
    const replayWith = async (pins: Partial<TrapCheck>) => {
      const f = structuredClone(fixture);
      Object.assign(f.slips[0]?.trapChecks[0] ?? {}, handWritten, pins);
      writeFixture(media, f);
      logs = [];
      return main(["replay-check", "spike-0462"], media, agentShell, repo);
    };
    for (const [pins, why] of cases) {
      expect(await replayWith(pins), String(why)).toBe(2);
      expect(logs.join("\n")).toMatch(/spike-0462: not ready/);
      expect(logs.join("\n")).toMatch(why);
    }
    // The control: pinned to a report that stands, the same check passes; it is what trap-verdict records.
    expect(await replayWith({ evidenceFile: passing, evidenceSha256: pinOf(repo, passing) })).toBe(0);
  });

  it("refuses a recorded read once the fixture no longer describes the current master", async () => {
    const { media, repo, fixture } = await reviewed0462();
    const passing = report(repo, "passing");
    const f = structuredClone(fixture);
    Object.assign(f.slips[0]?.trapChecks[0] ?? {}, {
      status: "HOLDS",
      by: "read",
      at: AT,
      evidence: `${passing} sha256:…`,
      evidenceFile: passing,
      evidenceSha256: pinOf(repo, passing),
      leakAccepted: DECISION,
    });
    const ready = await replayReadiness(f, { mediaRoot: media, repoRoot: repo, entry: entry("spike-0462") });
    expect(ready).toEqual([]);
    const replaced = entry("spike-0462", { masterSha: SHA_B });
    expect(
      (await replayReadiness(f, { mediaRoot: media, repoRoot: repo, entry: replaced })).join(" "),
    ).toMatch(/describes other pixels .* than the current master/);
    expect(
      (await replayReadiness(f, { mediaRoot: media, repoRoot: repo, entry: undefined })).join(" "),
    ).toMatch(/no manifest entry/);
  });

  it("replayBlockers names a HOLDS that pins no report, even on a fixture that was never parsed", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    Object.assign(f.slips[0]?.trapChecks[0] ?? {}, {
      status: "HOLDS",
      by: "read",
      at: AT,
      evidence: "README.md",
      leakAccepted: "x",
    });
    expect(replayBlockers(f).join(" ")).toMatch(/WATER_STAIN HOLDS pins no WS-READ report/);
  });

  it("re-checks that the label still sends every stained field to a person", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const t = f.slips[0]?.trapChecks[0];
    Object.assign(t ?? {}, {
      status: "HOLDS",
      by: "read",
      at: AT,
      evidence: "r",
      evidenceFile: "packages/eval/report/history/r.json",
      evidenceSha256: "a".repeat(64),
      leakAccepted: DECISION,
    });
    expect(replayBlockers(f).join(" ")).not.toMatch(/to a person/);
    // A later review relabels the stained gross EITHER: a read that passed then shows nothing about the stain.
    Object.assign(f.slips[0]?.fields.gross_kg ?? {}, { expect: "EITHER" });
    expect(replayBlockers(f).join(" ")).toMatch(/gross_kg is EITHER, not HUMAN/);
  });
});

describe("the schema: a recorded read always pins its report, and only a read does", () => {
  it("requires evidenceFile and evidenceSha256 on a read, and refuses them on a look", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const t = f.slips[0]?.trapChecks[0];
    Object.assign(t ?? {}, { status: "HOLDS", by: "read", at: AT, evidence: "x" });
    expect(Fixture.safeParse(f).error?.message).toMatch(/a recorded read names the report it rests on/);
    Object.assign(t ?? {}, {
      evidenceFile: "packages/eval/report/latest.json",
      evidenceSha256: "a".repeat(64),
    });
    expect(Fixture.safeParse(f).success).toBe(true);
    Object.assign(t ?? {}, { evidenceSha256: "not-a-sha" });
    expect(Fixture.safeParse(f).success).toBe(false);
    Object.assign(t ?? {}, { status: "FAILED", by: "agent", evidenceSha256: "a".repeat(64) });
    expect(Fixture.safeParse(f).error?.message).toMatch(/only a recorded read pins a report/);
  });
});
