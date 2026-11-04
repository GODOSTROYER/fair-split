import { readFileSync } from "node:fs";
import { MOMENT_INFO, type MomentId } from "@fairsplit/motion";

// video/script.ts is an editorial source outside a type:module package. Read its data fields without evaluating it.
export function scriptBeatStarts(source: string): { id: string; start: number }[] {
  const rows = [...source.matchAll(/\bid:\s*"([^"]+)",\s*start:\s*(\d+),?/g)].map((match) => ({
    id: match[1] ?? "",
    start: Number(match[2]),
  }));
  if (rows.length === 0) throw new Error("No film beats found in video/script.ts");
  if (new Set(rows.map((beat) => beat.id)).size !== rows.length) throw new Error("Duplicate film beat id");
  return rows;
}

const beats = scriptBeatStarts(readFileSync(new URL("../../video/script.ts", import.meta.url), "utf8"));

export interface PhaseLanding {
  readonly moment: string;
  readonly phase: string;
  readonly atMs: number;
}

const beatMoments: Readonly<Record<string, MomentId>> = {
  arrival: "MM-1",
  funding: "MM-S",
  reading: "MM-2",
  duplicate: "MM-3",
  rules: "MM-4",
  signing: "MM-5",
  payouts: "MM-6",
  listening: "MM-7",
};

/** Editorial times stay distinct from real browser observations, especially the paid cold-open. */
export function beatReceipts(phases: readonly PhaseLanding[]) {
  return beats.map((beat) => {
    const moment = beatMoments[beat.id] ?? null;
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
    const pressedAt =
      moment === "MM-1"
        ? phases.find((event) => event.moment === "MM-1" && event.phase === "press")?.atMs
        : undefined;
    const landed = phases.find(
      (event) =>
        event.moment === moment &&
        terminal.includes(event.phase) &&
        (moment !== "MM-1" || (pressedAt !== undefined && event.atMs >= pressedAt)),
    );
    return {
      id: beat.id,
      plannedStartMs: beat.start * 1_000,
      moment,
      phase: landed?.phase ?? null,
      landedAtMs: landed?.atMs ?? null,
    };
  });
}

/** A pacing wait changes no product state. A slow take keeps its actual clock instead of catching up on paper. */
export async function waitUntilBeat(
  id: string,
  startedAt: number,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const beat = beats.find((entry) => entry.id === id);
  if (!beat) throw new Error(`Unknown film beat: ${id}`);
  const remaining = startedAt + beat.start * 1_000 - now();
  if (remaining > 0) await wait(remaining);
}
