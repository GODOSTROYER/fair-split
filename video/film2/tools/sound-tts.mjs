// Film v7 narration takes: one Gemini TTS request per section (or per run of its paragraphs), through the repo's own
// pipeline (media/src/tts: KeyPool, synthesize(), the shared daily ledger). Keys are loaded by the pipeline from the
// repo-root .env of the worktree that holds the ledger; this tool never reads, prints or logs one.
//
//   cd <worktree with .env and media/audio/.quota.json>/media
//   corepack pnpm exec tsx <f7>/video/film2/tools/sound-tts.mjs --media . --takes <dir outside the repo> s1 s2 s4:0-3
//
// A unit is a section id (all its paragraphs) or <id>:<from>-<to> (paragraphs from..to, 0-based, inclusive). Each
// request writes <takes>/<unit>-t<n>.wav (the raw 24 kHz take) and appends to <takes>/requests.json (the text sent,
// the key id, never a key). SDK retries are off; a request refused with a 429 moves to the next key at most once.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    media: { type: "string" },
    takes: { type: "string" },
    pace: { type: "string" }, // replaces the section's pace note for this run (a retake that must sit in a fixed slot)
    "dry-run": { type: "boolean" },
  },
});
if (!values.media || !values.takes || !positionals.length)
  throw new Error("usage: sound-tts.mjs --media <media root> --takes <dir> <unit>...");
const mediaRoot = resolve(values.media);
const takesDir = resolve(values.takes);
if (existsSync(join(takesDir, ".git")) || /[\\/]fs-wt[\\/]|[\\/]fair-split[\\/]/.test(takesDir))
  throw new Error("raw takes stay outside the repo");
mkdirSync(takesDir, { recursive: true });
const takes = JSON.parse(readFileSync(new URL("../audio/narration/takes.json", import.meta.url), "utf8"));

const units = positionals.map((unit) => {
  // (a name in takes.json `extra` is a few sentences of a section, recorded to replace part of it)
  const extra = takes.extra?.[unit];
  const [id, range] = extra ? [extra.section] : unit.split(":");
  const section = takes.sections[id];
  if (!section) throw new Error(`no section ${id}`);
  const [from, to] = range ? range.split("-").map(Number) : [0, section.paragraphs.length - 1];
  const text = extra ? extra.text : section.paragraphs.slice(from, to + 1).join("\n\n");
  const name = extra ? unit : range ? `${id}_${from}-${to}` : id;
  const style = takes.style.replace("<the section's pace>", values.pace ?? section.pace);
  const n =
    Math.max(
      0,
      ...readdirSync(takesDir)
        .map((f) => new RegExp(`^${name}-t(\\d+)\\.wav$`).exec(f)?.[1])
        .filter(Boolean)
        .map(Number),
    ) + 1;
  return { unit, id, name, take: n, text, style };
});
if (values["dry-run"]) {
  for (const u of units)
    console.log(`${u.name} take ${u.take}\n  style: ${u.style}\n  text: ${JSON.stringify(u.text)}`);
  process.exit(0);
}

const lib = (file) => import(pathToFileURL(join(mediaRoot, "src", "tts", file)).href);
const { KeyPool, keysFromEnv, describeError, keysForScrubbing } = await lib("keys.ts");
const { synthesize } = await lib("gemini.ts");
const { QuotaLedger } = await lib("quota.ts");
const require = createRequire(join(mediaRoot, "package.json"));
const { GoogleGenAI } = await import(pathToFileURL(require.resolve("@google/genai")).href);
delete process.env.GOOGLE_GENAI_DEBUG;

const logFile = join(takesDir, "requests.json");
const log = existsSync(logFile) ? JSON.parse(readFileSync(logFile, "utf8")) : { log: [] };
const ledger = new QuotaLedger(join(mediaRoot, "audio", ".quota.json"));
const pool = new KeyPool(keysFromEnv(), {
  ledger,
  makeClient: (apiKey) => new GoogleGenAI({ apiKey }),
  log: (line) => console.log(line),
});
let failed = 0;
await Promise.all(
  units.map(async (u) => {
    const entry = {
      unit: u.name,
      section: u.id,
      take: u.take,
      model: takes.model,
      voice: takes.voice,
      style: u.style,
      text: u.text,
      at: new Date().toISOString(),
    };
    try {
      let keyId = null;
      const result = await pool.run(
        takes.model,
        (client, id) => {
          keyId = id;
          return synthesize(client, { model: takes.model, voice: takes.voice, style: u.style, text: u.text });
        },
        { latencyMs: (r) => r.latencyMs, maxAttempts: 2 },
      );
      const file = `${u.name}-t${u.take}.wav`;
      writeFileSync(join(takesDir, file), result.wav);
      Object.assign(entry, {
        ok: true,
        keyId,
        file,
        bytes: result.wav.length,
        sha256: createHash("sha256").update(result.wav).digest("hex"),
        latencyMs: result.latencyMs,
      });
      console.log(
        `${u.name} take ${u.take}: ${file}, ${result.wav.length} bytes, ${result.latencyMs} ms, key ${keyId}`,
      );
    } catch (e) {
      failed += 1;
      Object.assign(entry, { ok: false, error: describeError(e, keysForScrubbing()).slice(0, 400) });
      console.error(`${u.name} take ${u.take}: FAILED ${entry.error}`);
    }
    log.log.push(entry);
  }),
);
writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`);
const status = await pool.status([takes.model]);
const t = status.total[takes.model];
console.log(
  `${takes.model}: ${t.used} used today, ${t.remaining} left of ${t.cap}; resets ${status.resetsAt}`,
);
process.exitCode = failed ? 1 : 0;
