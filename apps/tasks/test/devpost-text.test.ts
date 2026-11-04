// S2: docs/devpost.md is generated from IC-03 (packages/seed) and the film script, never edited by hand.
// The first test regenerates it and compares, so the Devpost text cannot drift from the canonical figures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEVPOST_PATH,
  type DevpostInput,
  devpostSections,
  EXCLUDED_TAGS,
  loadFilm,
  loadInput,
  main,
  PROJECT_NAME,
  renderDevpost,
  TAGS,
} from "../../../tools/devpost-text.js";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";

/** Loading the seed snapshot (zod-parsed) and the film script can pass Vitest's default under load. */
const SLOW = 60_000;
const committed = () => readFileSync(join(REPO_ROOT, DEVPOST_PATH), "utf8").replace(/\r\n/g, "\n");

let input: DevpostInput;
beforeAll(async () => {
  input = await loadInput();
}, SLOW);

describe("docs/devpost.md", () => {
  it("is exactly what tools/devpost-text.ts renders from IC-03 and the script (regenerate it, never edit it)", () => {
    expect(
      committed(),
      "docs/devpost.md drifted: run `corepack pnpm exec tsx tools/devpost-text.ts` and commit the result",
    ).toBe(renderDevpost(input));
  });

  it("carries the Devpost name, never bare 'Fair Split', as its title", () => {
    expect(PROJECT_NAME).toBe("Fair Split: audited co-op payroll on PayPal");
    expect(renderDevpost(input).split("\n")[0]).toBe(`# ${PROJECT_NAME}`);
    expect(devpostSections(input).name).toBe(PROJECT_NAME);
  });

  it("opens in at most 300 characters that name every PayPal API, Agent Toolkit 1.11.0, the three models and the simulator (DR-3)", () => {
    const { opening, story } = devpostSections(input);
    expect(opening.length).toBeLessThanOrEqual(300);
    for (const s of [
      "Invoicing v2",
      "Agent Toolkit 1.11.0",
      "Payouts v1",
      "Webhooks",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "simulated PayPal sandbox",
      "7 of 64",
    ])
      expect(opening).toContain(s);
    // §6: no live Claude reading on the judge path, so the reader is "built to read".
    expect(opening).toMatch(/claude-opus-5-5 is built to read/);
    // The story starts with the opening, so Devpost's first 300 characters are these.
    expect(story.startsWith(opening)).toBe(true);
  });

  it("keeps the elevator pitch within Devpost's 200 characters and says the PayPal rail is simulated", () => {
    const { pitch } = devpostSections(input);
    expect(pitch.length).toBeLessThanOrEqual(200);
    expect(pitch).toMatch(/simulated/i);
  });

  it("lists 25 tags that match what shipped: unique, lower case, none of the excluded ones", () => {
    expect(TAGS).toHaveLength(25);
    expect(new Set(TAGS).size).toBe(25);
    for (const tag of TAGS) expect(tag).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
    for (const tag of EXCLUDED_TAGS) expect(TAGS).not.toContain(tag);
    for (const tag of ["nextjs", "ag-studio", "apimatic", "postman", "maestro", "render"])
      expect(EXCLUDED_TAGS).toContain(tag);
  });

  it("reads every season figure from the snapshot, so a changed seed changes the text", () => {
    const display = {
      ...input.snapshot.figures.display,
      invoice: "US$1,111.11",
      batchTotal: "US$222.22",
      endPaid: "US$333.33",
      endCash: "US$444.44",
      redirected: "US$55.55",
    };
    const changed = renderDevpost({
      ...input,
      snapshot: {
        ...input.snapshot,
        figures: { ...input.snapshot.figures, display, endCashMembers: 58, endPaidMembers: 6 },
      },
    });
    for (const f of [
      "US$1,111.11",
      "US$222.22",
      "US$333.33",
      "US$444.44",
      "US$55.55",
      "6 of 64",
      "58 in cash",
    ])
      expect(changed).toContain(f);
    for (const f of [
      "US$4,333.50",
      "US$368.39",
      "US$341.74",
      "US$3,876.43",
      "US$21.14",
      "7 of 64",
      "57 in cash",
    ])
      expect(changed).not.toContain(f);
  });

  it(
    "quotes the film script's disclosure word for word",
    async () => {
      const film = await loadFilm();
      expect(film.descriptionDisclosure).toMatch(/Simulated PayPal sandbox/);
      expect(renderDevpost(input)).toContain(`"${film.descriptionDisclosure}"`);
      const changed = renderDevpost({ ...input, film: { descriptionDisclosure: "A changed disclosure." } });
      expect(changed).toContain("A changed disclosure.");
    },
    SLOW,
  );

  it("holds no placeholder but the two marked TODO lines: the hosted URL and the APK", () => {
    const text = renderDevpost(input);
    const todos = text.split("\n").filter((l) => /\bTODO\b/.test(l));
    expect(todos).toHaveLength(2);
    expect(todos[0]).toMatch(/TODO \(merger\).*hosted/i);
    expect(todos[1]).toMatch(/TODO \(merger\).*APK/);
    expect(text).not.toMatch(/\bTBD\b|\bXXX\b|lorem|example\.com|\{\{|\}\}/i);
    // The only link is the repository's: no made-up URL.
    expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://github.com/GODOSTROYER/fair-split"]);
  });

  it("names no AI tool the build does not use (§6: no PP-OCRv5, no Kokoro, no APIMatic)", () => {
    const text = renderDevpost(input);
    expect(text).not.toMatch(/PP-?OCR|Kokoro|APIMatic/i);
    for (const s of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "Claude Code", "Gemini"])
      expect(text).toContain(s);
  });

  it("gives the testing instructions the plan asks for", () => {
    expect(devpostSections(input).testing).toContain(
      "No login: open Judge Mode. Local: pnpm i && pnpm verify",
    );
  });
});

describe("tools/devpost-text.ts CLI", () => {
  const io = (current: string | null) => {
    const writes: string[] = [];
    const lines: string[] = [];
    return {
      writes,
      lines,
      deps: {
        input,
        read: () => current,
        write: (text: string) => {
          writes.push(text);
        },
        print: (line: string) => {
          lines.push(line);
        },
      },
    };
  };

  it("writes docs/devpost.md by default", async () => {
    const t = io(null);
    expect(await main([], t.deps)).toBe(0);
    expect(t.writes).toEqual([renderDevpost(input)]);
  });

  it("--check passes on the rendered text, fails on drift, and never writes", async () => {
    const same = io(renderDevpost(input));
    expect(await main(["--check"], same.deps)).toBe(0);
    const drifted = io(`${renderDevpost(input)}\nedited by hand\n`);
    expect(await main(["--check"], drifted.deps)).toBe(1);
    expect(drifted.lines.join("\n")).toMatch(/drifted/);
    const missing = io(null);
    expect(await main(["--check"], missing.deps)).toBe(1);
    expect([...same.writes, ...drifted.writes, ...missing.writes]).toEqual([]);
  });

  it("refuses an unknown option", async () => {
    const t = io(null);
    expect(await main(["--force"], t.deps)).toBe(2);
    expect(t.writes).toEqual([]);
  });
});
