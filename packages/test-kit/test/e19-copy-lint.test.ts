// E-19, the public-copy lint (schedule replan-1031 §3 Q2, §6; ADR-0002; plan S5.7.1 and S5.6.1). It reads the
// README, docs/devpost.md, video/script.ts, packages/i18n, the console copy, the app catalogs and the statement
// templates, and fails on any banned or unqualified claim, any money or kilo figure IC-03 does not hold, and a film
// script over 240 words or 140 wpm in a beat. Planted copy below proves every rule fires and lets honest copy pass.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { figuresIn, ic03Figures } from "./e19/figures.js";
import { CLEAN, FIGURES, HONEST, PLANTED, PLANTED_FORMS, PLANTED_TEMPLATES, SCRIPTS } from "./e19/planted.js";
import { ALLOWANCES, CONSOLE_MERGED_SENTINEL, FIGURES_RULE, RULES } from "./e19/rules.js";
import {
  AREAS,
  describeFinding,
  type Finding,
  judge,
  lintFiles,
  lintText,
  markdownSentences,
  scopeFiles,
  sourceSentences,
} from "./e19/scan.js";
import { beatsFrom, checkScript, countWords, MAX_WORDS } from "./e19/script.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = "video/script.ts";
/** Loading TypeScript and the seed snapshot under a busy machine can pass Vitest's 5 s default. */
const SLOW = 60_000;

/** Rule ids that fire on one plain-text sentence (as a paragraph of markdown). */
const firing = (text: string): string[] => [...new Set(lintText("planted.md", text).map((f) => f.rule))];
/** Rule ids that fire on the same text as a string literal in a TypeScript copy module. */
const literalFiring = (text: string): string[] => [
  ...new Set(
    lintText("copy.ts", `export const copy = { "X-01.line": ${JSON.stringify(text)} };`).map((f) => f.rule),
  ),
];

const scope = () => scopeFiles(root);
const scanned = () => [...scope().values()].flat();
const findings = (): Finding[] => lintFiles(root, scanned());

describe("E-19 public copy", () => {
  it(
    "reads every area the schedule names that exists today",
    () => {
      const areas = scope();
      expect([...areas.keys()]).toEqual(AREAS.map((a) => a.name));
      for (const area of AREAS) {
        const files = areas.get(area.name) ?? [];
        if (!area.optional) expect(files.length, area.name).toBeGreaterThan(0);
      }
      expect(areas.get("README")).toEqual(["README.md"]);
      expect(areas.get("i18n catalogs")).toEqual(
        expect.arrayContaining([
          "packages/i18n/src/catalog/en.ts",
          "packages/i18n/src/catalog/ceb.ts",
          "packages/i18n/src/catalog/fil.ts",
        ]),
      );
      expect(areas.get("app catalogs")).toEqual(
        expect.arrayContaining([
          "apps/mobile/src/_shims/i18n.ts",
          "apps/mobile/src/features/board/messages.ts",
          "apps/mobile/src/features/statement/messages.ts",
        ]),
      );
      expect(scanned().some((f) => /\.test\./.test(f))).toBe(false);
    },
    SLOW,
  );

  it(
    "breaks no rule: every banned or unqualified claim is reworded (allowances aside)",
    () => {
      const verdict = judge(findings(), ALLOWANCES, new Set(scanned()));
      expect(verdict.violations.map(describeFinding)).toEqual([]);
    },
    SLOW,
  );

  it(
    "keeps no stale allowance: once the named work package lands, its entry must go",
    () => {
      const files = new Set(scanned());
      const verdict = judge(findings(), ALLOWANCES, files);
      expect(
        verdict.stale.map(
          (a) =>
            `${a.file} [${a.rule}] "${a.phrase}" (${a.pending ? `pending ${a.pending}` : "exception"}): delete it`,
        ),
      ).toEqual([]);
      // An allowance may name a file the tree lacks only while ws/console is unmerged (its copy module is absent).
      const consoleMerged = existsSync(resolve(root, CONSOLE_MERGED_SENTINEL));
      for (const a of verdict.dormant) {
        expect(a.file.startsWith("apps/console/src/"), a.file).toBe(true);
        expect(consoleMerged, `${a.file} is named but not in the tree`).toBe(false);
      }
      expect(ALLOWANCES.every((a) => a.why.length > 10 && a.phrase.length > 2)).toBe(true);
    },
    SLOW,
  );

  it.skipIf(!existsSync(resolve(root, SCRIPT)))(
    "video/script.ts: at most 240 spoken words and 140 wpm in every beat",
    async () => {
      const mod = (await import(pathToFileURL(resolve(root, SCRIPT)).href)) as Record<string, unknown>;
      expect(checkScript(beatsFrom(mod)).violations).toEqual([]);
    },
    SLOW,
  );
});

describe("E-19 rules fire on planted copy", () => {
  it("every rule has a reason, a planted violation and at least one near miss", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(PLANTED).sort()).toEqual([...ids].sort());
    expect(Object.keys(CLEAN).sort()).toEqual([...ids].sort());
    for (const rule of RULES) {
      expect(rule.reason.length, rule.id).toBeGreaterThan(20);
      expect(CLEAN[rule.id]?.length, rule.id).toBeGreaterThan(0);
    }
  });

  it.each(RULES.map((r) => r.id))("%s fires on its planted sentence", (id) => {
    expect(firing(PLANTED[id] ?? "")).toContain(id);
  });

  it.each(RULES.map((r) => r.id))(
    "%s lets its near misses through, as markdown and as a TypeScript literal",
    (id) => {
      for (const text of CLEAN[id] ?? []) {
        expect(firing(text), text).not.toContain(id);
        expect(literalFiring(text), text).not.toContain(id);
      }
    },
  );

  it.each(PLANTED_FORMS.map(([rule, text]) => [rule, text] as const))(
    "%s fires on the planted form %j, as markdown and as a TypeScript literal",
    (rule, text) => {
      expect(firing(text)).toContain(rule);
      expect(literalFiring(text)).toContain(rule);
    },
  );

  it.each(PLANTED_TEMPLATES.map(([rule, source]) => [rule, source] as const))(
    "%s fires on a template literal whose substitution is the date: %s",
    (rule, source) => {
      expect(lintText("copy.ts", source).map((f) => f.rule)).toContain(rule);
    },
  );

  it("the schedule's replacement wording (§6) passes every rule", () => {
    for (const text of HONEST) expect(firing(text), text).toEqual([]);
  });

  it("the product AI_NOTE passes only beside its seeded variant (T1)", () => {
    const product = 'export const en = { "AI_NOTE.default": "Your slips were read twice by AI (Claude)." };';
    const both = `export const en = {
  "AI_NOTE.default": "Your slips were read twice by AI (Claude).",
  "AI_NOTE.seeded": "In this demo, the slip readings are a labelled stand-in for Claude's double reading.",
};`;
    expect(lintText("templates.ts", product).map((f) => f.rule)).toEqual(["read-twice-by-ai-seeded"]);
    expect(lintText("templates.ts", both)).toEqual([]);
  });
});

describe("E-19 figures equal IC-03", () => {
  it(
    "builds the allowed set from the seed snapshot",
    () => {
      const set = ic03Figures();
      expect(set.size).toBeGreaterThan(100);
      expect(set.has({ unit: "USD", value: 4333.5, text: "US$4,333.50" })).toBe(true);
      expect(set.has({ unit: "KG", value: 148, text: "148.0 kg" })).toBe(true);
      expect(set.has({ unit: "USD", value: 4333.51, text: "US$4,333.51" })).toBe(false);
    },
    SLOW,
  );

  it("reads money and kilo figures as written", () => {
    expect(
      figuresIn("US$4,333.50, ₱62.50, $0.25, PHP 5,000 and 9,625 kg").map((f) => [f.unit, f.value]),
    ).toEqual([
      ["USD", 4333.5],
      ["PHP", 62.5],
      ["USD", 0.25],
      ["PHP", 5000],
      ["KG", 9625],
    ]);
    expect(figuresIn("{amount} for {kg}, a 40-case eval, Node 24.19, 2%")).toEqual([]);
  });

  it(
    "flags planted figures IC-03 does not hold, and passes the ones it does",
    () => {
      for (const text of FIGURES.planted) expect(firing(text), text).toEqual([FIGURES_RULE.id]);
      for (const text of FIGURES.clean) expect(firing(text), text).toEqual([]);
    },
    SLOW,
  );
});

describe("E-19 film script limits", () => {
  it("counts words as a word processor does: a hyphenated word is one", () => {
    expect(countWords("Sixty-four cacao farmers — two hundred sixty-four slips.")).toBe(7);
  });

  it("fails a script over 240 words with a beat over 140 wpm, and passes one inside both", () => {
    const over = checkScript(SCRIPTS.over);
    expect(over.words).toBeGreaterThan(MAX_WORDS);
    expect(over.violations).toEqual([
      expect.stringMatching(/^script-wpm: fast runs at \d+ wpm/),
      expect.stringMatching(/^script-words: \d+ spoken words, over 240$/),
    ]);
    expect(checkScript(SCRIPTS.within)).toEqual({ words: expect.any(Number), violations: [] });
  });

  it("reads beats timed by seconds, m:ss or a time range, and refuses untimed ones", () => {
    const beats = beatsFrom({
      script: [
        { id: "cold open", time: "0:00–0:10", say: "None." },
        { start: "0:10", end: "0:24", say: ["Two", "lines"] },
        { from: 24, to: 38, say: "Third beat." },
      ],
    });
    expect(beats.map((b) => [b.label, b.start, b.end, b.say])).toEqual([
      ["cold open", 0, 10, "None."],
      ["beat 2", 10, 24, "Two lines"],
      ["beat 3", 24, 38, "Third beat."],
    ]);
    expect(() => beatsFrom({ script: [{ say: "untimed" }] })).toThrow(/no readable start and end time/);
    expect(() => beatsFrom({ notes: "no beats" })).toThrow(/no array of beats/);
  });
});

describe("E-19 scanner", () => {
  it("reads markdown by paragraph, list item, table row and quote, never code or comments", () => {
    const text = readFileSync(resolve(here, "e19/fixtures/planted.md"), "utf8");
    expect(markdownSentences(text).some((s) => /fence|never shown/.test(s.text))).toBe(false);
    const got = lintText("planted.md", text).map((f) => [f.line, f.rule]);
    expect(got).toEqual([
      [3, "sandbox-says-simulated"],
      [5, "webhooks-move-payouts"],
      [5, "drive-every-state"],
      [9, "nightly-reconciliation"],
      [11, "live-payouts"],
      [22, FIGURES_RULE.id],
    ]);
  });

  it("reads TypeScript string and template literals, never keys, comments or code values", () => {
    const text = readFileSync(resolve(here, "e19/fixtures/planted-catalog.ts"), "utf8");
    const got = lintText("planted-catalog.ts", text).map((f) => [f.line, f.rule]);
    expect(got).toEqual([
      [4, "sandbox-says-simulated"],
      [7, "apimatic"],
      [12, "claudes-draft"],
    ]);
  });

  it("reads JSX text in a .tsx copy module", () => {
    const tsx = "export const B = () => <p>Live payouts, every day.</p>;";
    expect(sourceSentences("Banner.tsx", tsx).map((s) => s.text)).toEqual(["Live payouts, every day."]);
    expect(lintText("Banner.tsx", tsx).map((f) => f.rule)).toEqual(["live-payouts"]);
  });

  it("an allowance covers its sentence only in its file, and goes stale when the sentence is gone", () => {
    const allowance = {
      rule: "sandbox-says-simulated",
      file: "a.md",
      phrase: "sandbox prototype",
      why: "test",
      pending: "C5a",
    } as const;
    const hit = lintText("a.md", "A sandbox prototype.");
    expect(judge(hit, [allowance], new Set(["a.md"]))).toMatchObject({ violations: [], stale: [] });
    const elsewhere = lintText("b.md", "A sandbox prototype.");
    expect(judge(elsewhere, [allowance], new Set(["a.md", "b.md"])).violations).toHaveLength(1);
    expect(judge([], [allowance], new Set(["a.md"])).stale).toEqual([allowance]);
    expect(judge([], [allowance], new Set()).dormant).toEqual([allowance]);
  });
});
