import { execFileSync } from "node:child_process";
import { MOMENT_INFO, type MomentId } from "@fairsplit/motion";

/** A beat or capture slot of the film script, at its film second. */
export interface FilmMark {
  readonly id: string;
  readonly start: number;
}

export interface FilmTimeline {
  /** Every beat, in script order. */
  readonly beats: readonly FilmMark[];
  /** Every capture slot. A slot can cut in partway through its beat (v4's by-hand entry at 1:16.5). */
  readonly slots: readonly FilmMark[];
}

/** The two exports pacing reads from a loaded video/script.ts module; nothing else is trusted. */
export interface FilmScript {
  readonly beats?: unknown;
  readonly CAPTURES?: unknown;
}

const marks = (script: FilmScript, name: "beats" | "CAPTURES"): FilmMark[] => {
  const list = script[name];
  const what = name === "beats" ? "film beats" : "film capture slots";
  if (!Array.isArray(list) || list.length === 0) throw new Error(`No ${what} found in video/script.ts`);
  return list.map((entry: unknown, index) => {
    const { id, start } = (entry ?? {}) as { id?: unknown; start?: unknown };
    if (
      typeof id !== "string" ||
      id === "" ||
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      start < 0
    )
      throw new Error(`video/script.ts ${name}[${index}] has no id and start second`);
    return { id, start };
  });
};

/**
 * The film's timeline from a loaded video/script.ts module: its exported `beats` and `CAPTURES`, the same data
 * video/build.mjs assembles the film from. It reads values, not source text, so field order never matters.
 */
export function filmTimeline(script: FilmScript): FilmTimeline {
  const beats = marks(script, "beats");
  const slots = marks(script, "CAPTURES");
  const ids = [...beats, ...slots].map((mark) => mark.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate film beat or capture slot id");
  return { beats, slots };
}

const SCRIPT = new URL("../../video/script.ts", import.meta.url);

/**
 * Evaluates video/script.ts as `node video/build.mjs` does, in plain Node 24 (which strips its types), and returns
 * the two exports pacing reads. It runs in a child process: video/ has no package.json, and Playwright's loader
 * cannot import the script into a spec, even lazily (require(esm) "in a cycle").
 */
export function readFilmScript(url: URL = SCRIPT): FilmScript {
  const program = `const m = await import(${JSON.stringify(url.href)});
process.stdout.write(JSON.stringify({ beats: m.beats, CAPTURES: m.CAPTURES }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    // Plain Node, as the film build runs: no test runner's loader rides along in NODE_OPTIONS.
    env: { ...process.env, NODE_OPTIONS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out) as FilmScript;
}

const film = filmTimeline(readFilmScript());

/** The marks the E-01 take paces to, in take order: the deep dive from funding to the member's traced peso. */
export const TAKE_MARKS = [
  "funding",
  "reading",
  "reading-byhand",
  "count-once",
  "holds",
  "rules-console",
  "signing",
  "signing-phone",
  "payouts",
  "payouts-cash",
  "proof",
  "member",
] as const;
export type TakeMark = (typeof TAKE_MARKS)[number];

export interface PhaseLanding {
  readonly moment: string;
  readonly phase: string;
  readonly atMs: number;
}

/** The beats a magic moment carries; each one's capture slots in video/script.ts record that moment. */
export const BEAT_MOMENTS: Readonly<Record<string, MomentId>> = {
  funding: "MM-S",
  reading: "MM-2",
  "count-once": "MM-3",
  holds: "MM-4",
  signing: "MM-5",
  payouts: "MM-6",
  member: "MM-7",
};

/** Editorial times stay distinct from real browser observations: a late landing keeps its actual time. */
export function beatReceipts(phases: readonly PhaseLanding[]) {
  return film.beats.map((beat) => {
    const moment = BEAT_MOMENTS[beat.id] ?? null;
    // The reading edit is by-hand done; a prior row landing belongs to the earlier reading.
    // MM-7's rest is both an initial phase and a return terminal. This take records the actual slip tap.
    const terminal: readonly string[] =
      moment === "MM-2"
        ? ["done"]
        : moment === "MM-7"
          ? ["tiled"]
          : moment
            ? MOMENT_INFO[moment].terminal
            : [];
    const landed = phases.find((event) => event.moment === moment && terminal.includes(event.phase));
    return {
      id: beat.id,
      plannedStartMs: beat.start * 1_000,
      moment,
      phase: landed?.phase ?? null,
      landedAtMs: landed?.atMs ?? null,
    };
  });
}

/**
 * Waits until a beat's or capture slot's film second. A pacing wait changes no product state. A slow take keeps its
 * actual clock instead of catching up on paper.
 */
export async function waitUntilBeat(
  id: string,
  startedAt: number,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const mark = [...film.beats, ...film.slots].find((entry) => entry.id === id);
  if (!mark) throw new Error(`Unknown film beat or capture slot: ${id}`);
  const remaining = startedAt + mark.start * 1_000 - now();
  if (remaining > 0) await wait(remaining);
}
