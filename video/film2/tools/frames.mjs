// Fair Split film v7: export exact frames of the assembled film as PNG, at film seconds.
//   node tools/frames.mjs 60.2 63 71.5            1920x1080 PNGs in out/frames/at-<seconds>s.png
//   node tools/frames.mjs 60.2 63 --2x            3840x2160 PNGs (the final render's pixels) in out/frames-2x/
//   node tools/frames.mjs s4 6                    six frames spread over section s4's window
//   node tools/frames.mjs 60.2 --out out/mine     another folder (give each agent its own to avoid collisions)
// It runs tools/sync.mjs first, so word times and stills are current. A frame is taken at the exact instant asked.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(readFileSync(join(root, "timing.json"), "utf8"));
const args = process.argv.slice(2);
const twice = args.includes("--2x");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : twice ? "out/frames-2x" : "out/frames";
const skipped = new Set(outIndex >= 0 ? [outIndex, outIndex + 1] : []);
const values = args.filter((arg, index) => !skipped.has(index) && !arg.startsWith("--"));

let times;
const section = timing.sections.find((entry) => entry.id === values[0]);
if (section) {
  const count = Number(values[1] ?? 6);
  times = Array.from(
    { length: count },
    (_, index) => section.start + ((index + 0.5) * section.duration) / count,
  );
} else {
  times = values.map(Number);
}
times = times.map((time) => Math.round(time * 1000) / 1000);
if (
  times.length === 0 ||
  times.some((time) => !Number.isFinite(time) || time < 0 || time > timing.duration)
) {
  console.error("usage: node tools/frames.mjs <film seconds ...> | <section id> [count]  [--2x] [--out dir]");
  process.exit(2);
}

const run = (command) => spawnSync(command, { cwd: root, shell: true, stdio: "inherit" }).status ?? 1;
run("node tools/sync.mjs");
const zoom = twice ? ` "--zoom=0,0,${timing.canvas.width},${timing.canvas.height}" --zoom-scale 2` : "";
process.exit(
  run(`npx hyperframes snapshot "--at=${times.join(",")}" --no-end --keep${zoom} --output "${out}"`),
);
