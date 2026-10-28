#!/usr/bin/env node
/**
 * Writes the three product sounds native plays (S2.10: chime, plunk, clack) as 48 kHz mono 16-bit WAVs, each 30 KB
 * or less, from the recipes in design §4. TEMPORARY until WS-DS ships `assets/sfx/build.ts`; the recipes are the
 * same, so the swap changes files, not code.
 *
 *   node scripts/make-sfx.mjs    → assets/sfx/{chime,plunk,clack}.wav
 *
 * Deterministic: noise comes from a seeded generator, so a rebuild is byte-identical.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48_000;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sfx");

/** mulberry32: a tiny seeded PRNG in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbfs = (db) => 10 ** (db / 20);
const samples = (ms) => Math.round((RATE * ms) / 1000);

/** Scales the buffer so its peak sits at `db` dBFS. */
function normalise(buf, db) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? dbfs(db) / peak : 0;
  return buf.map((v) => v * k);
}

/** A 2 ms fade at both ends so no sound starts or stops with a click. */
function edges(buf, ms = 2) {
  const n = Math.min(samples(ms), Math.floor(buf.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return buf;
}

function wav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  });
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** chime: E5 then G♯5, 90 ms apart, 5 ms attack, 180 ms decay; the 2× partial helps phone speakers. −16 dBFS. */
function chime() {
  const buf = new Array(samples(300)).fill(0);
  for (const [f, startMs] of [
    [659.25, 0],
    [830.61, 90],
  ]) {
    const s0 = samples(startMs);
    for (let i = 0; s0 + i < buf.length; i++) {
      const t = i / RATE;
      const env = t < 0.005 ? t / 0.005 : Math.exp(-(t - 0.005) / (0.18 / 4));
      const v = Math.sin(2 * Math.PI * f * t) + dbfs(-12) * Math.sin(2 * Math.PI * 2 * f * t);
      buf[s0 + i] += v * env;
    }
  }
  return wav(edges(normalise(buf, -16)));
}

/** plunk: a sine falling 90 → 70 Hz over 60 ms over 30 ms of brown noise; 3rd partial at −14 dB. −14 dBFS. */
function plunk() {
  const r = rng(0x9e3779b9);
  const buf = new Array(samples(96)).fill(0);
  let phase = 0;
  let brown = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / RATE;
    const f = 90 - 20 * Math.min(1, t / 0.06);
    phase += (2 * Math.PI * f) / RATE;
    const tone = Math.sin(phase) + dbfs(-14) * Math.sin(3 * phase);
    const toneEnv = Math.exp(-t / 0.03) * Math.min(1, t / 0.0015);
    brown = Math.max(-1, Math.min(1, brown * 0.98 + (r() * 2 - 1) * 0.08));
    const noiseEnv = t < 0.03 ? 1 - t / 0.03 : 0;
    buf[i] = tone * toneEnv + 0.5 * brown * noiseEnv;
  }
  return wav(edges(normalise(buf, -14)));
}

/** clack: a dry 140 Hz burst of 40 ms, low-passed. −18 dBFS. */
function clack() {
  const r = rng(0x85ebca6b);
  const n = samples(44);
  const raw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = t < 0.04 ? (1 - t / 0.04) ** 2 : 0;
    const square = Math.sign(Math.sin(2 * Math.PI * 140 * t));
    raw[i] = (0.8 * square + 0.4 * (r() * 2 - 1)) * env;
  }
  // One-pole low-pass at about 1.2 kHz keeps it dry rather than buzzy.
  const a = Math.exp((-2 * Math.PI * 1200) / RATE);
  let y = 0;
  const buf = raw.map((x) => {
    y = (1 - a) * x + a * y;
    return y;
  });
  return wav(edges(normalise(buf, -18)));
}

mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries({ chime, plunk, clack })) {
  const file = join(out, `${name}.wav`);
  const bytes = make();
  if (bytes.length > 30 * 1024)
    throw new Error(`${name}.wav is ${bytes.length} bytes, over the 30 KB budget`);
  writeFileSync(file, bytes);
  console.log(`${name}.wav ${bytes.length} bytes`);
}
