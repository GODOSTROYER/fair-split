import { execFile, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** ffmpeg and ffprobe must be on PATH (S5.1: ffmpeg 9.0.2 on the dev machine). CI may not have them. */
export function hasFfmpeg(): boolean {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

export interface Silence {
  start: number;
  end: number;
}

/** Parses `silencedetect` lines from ffmpeg's stderr into silence intervals, in seconds. */
export function parseSilencedetect(stderr: string, durationSec?: number): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s?.[1] !== undefined) open = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e?.[1] !== undefined) {
      out.push({ start: open ?? 0, end: Number(e[1]) });
      open = null;
    }
  }
  // A silence that runs to the end of the file has a start and no end.
  if (open !== null && durationSec !== undefined) out.push({ start: open, end: durationSec });
  return out;
}

export interface SplitOptions {
  /** Silence threshold in dB (S4.6: −40 dB). */
  noiseDb?: number;
  /** Minimum silence in seconds (S4.6: 0.6 s). */
  minSilenceSec?: number;
}

export async function detectSilences(
  wavPath: string,
  durationSec: number,
  opts: SplitOptions = {},
): Promise<Silence[]> {
  const noise = opts.noiseDb ?? -40;
  const d = opts.minSilenceSec ?? 0.6;
  const { stderr } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      wavPath,
      "-af",
      `silencedetect=noise=${noise}dB:d=${d}`,
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return parseSilencedetect(stderr, durationSec);
}

export interface Cut {
  start: number;
  end: number;
}

export type CutPlan = { ok: true; cuts: Cut[] } | { ok: false; reason: string; interior: number };

/**
 * Turns silences into one cut per sentence. Exactly `clips − 1` interior silences must exist (S4.6:
 * "silencedetect must produce exactly one clip per sentence"); otherwise the caller re-requests the
 * statement one sentence at a time. Each clip keeps `padSec` of its neighbouring silence. When more pauses
 * than expected are found, the longest ones are used if they are at least `separation` times longer than the rest.
 */
export function planCuts(
  durationSec: number,
  silences: readonly Silence[],
  clips: number,
  padSec = 0.15,
  separation = 1.4,
): CutPlan {
  const edge = 0.05;
  const leading = silences.find((s) => s.start <= edge);
  const trailing = silences.find((s) => s.end >= durationSec - edge && s !== leading);
  const all = silences.filter((s) => s !== leading && s !== trailing);
  const want = clips - 1;
  let interior = all;
  if (all.length > want && want > 0) {
    // A long sentence can hold a natural pause of 0.6 s or more (22 Oct: 0.61 s inside an English
    // sentence, 1.12 s for the tag). The <long pause> tags are then the clips − 1 longest silences, but
    // only when they stand clearly apart from every other pause.
    const len = (x: Silence) => x.end - x.start;
    const byLength = [...all].sort((a, b) => len(b) - len(a));
    const chosen = byLength.slice(0, want);
    const shortestChosen = Math.min(...chosen.map(len));
    const longestOther = Math.max(...byLength.slice(want).map(len));
    if (shortestChosen >= longestOther * separation) interior = chosen.sort((a, b) => a.start - b.start);
  }
  if (interior.length !== want) {
    return {
      ok: false,
      reason: `expected ${want} pause(s) between ${clips} sentence(s), found ${all.length}`,
      interior: all.length,
    };
  }
  const starts = [
    leading ? Math.max(0, leading.end - padSec) : 0,
    ...interior.map((s) => Math.max(0, s.end - padSec)),
  ];
  const ends = [
    ...interior.map((s) => Math.min(durationSec, s.start + padSec)),
    trailing ? Math.min(durationSec, trailing.start + padSec) : durationSec,
  ];
  const cuts = starts.map((start, i) => ({ start: round3(start), end: round3(ends[i] ?? durationSec) }));
  if (cuts.some((c) => c.end - c.start < 0.2))
    return { ok: false, reason: "a clip would be shorter than 0.2 s", interior: interior.length };
  return { ok: true, cuts };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Encodes one cut to AAC 32 kbps mono in an .m4a container (S4.6, AI-10). */
export async function encodeAac(wavPath: string, out: string, cut?: Cut): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const trim = cut ? ["-ss", cut.start.toFixed(3), "-t", (cut.end - cut.start).toFixed(3)] : [];
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      wavPath,
      ...trim,
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      out,
    ],
    { windowsHide: true },
  );
}

export interface ProbeInfo {
  durationMs: number;
  codec: string;
  channels: number;
  bitRate: number;
  sampleRate: number;
}

export async function probeAudio(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,channels,bit_rate,sample_rate:format=duration",
      "-of",
      "json",
      file,
    ],
    { windowsHide: true },
  );
  const j = JSON.parse(stdout) as {
    streams?: { codec_name?: string; channels?: number; bit_rate?: string; sample_rate?: string }[];
    format?: { duration?: string };
  };
  const s = j.streams?.[0] ?? {};
  return {
    durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000),
    codec: s.codec_name ?? "unknown",
    channels: s.channels ?? 0,
    bitRate: Number(s.bit_rate ?? 0),
    sampleRate: Number(s.sample_rate ?? 0),
  };
}
