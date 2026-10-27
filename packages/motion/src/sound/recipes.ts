// One DSP source for every product sound (design §4, S2 §2.10). Each recipe renders to a 48 kHz mono
// Float32Array with noise from a seeded mulberry32, so the web (Web Audio buffers) and native (committed
// 16-bit WAVs) play bit-identical sounds. Levels are peak dBFS.

export const SAMPLE_RATE = 48_000;

/** Samples always live in their own ArrayBuffer. */
export type Samples = Float32Array<ArrayBuffer>;

/** E major pentatonic, one note per verified item webhook, in order of arrival. */
export const SCALE_HZ = [659.26, 739.99, 830.61, 987.77, 1108.73, 1318.51, 1479.98, 1661.22] as const;
export const ROOT_HZ = 329.63;

export type RecipeName =
  | "tick"
  | "plunk"
  | "plunk-low"
  | "clack"
  | "chime"
  | "root"
  | "thud"
  | `scale-${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;

export interface Recipe {
  readonly lengthMs: number;
  readonly peakDbfs: number;
  /** Native ships a WAV for this sound; scale notes and the root are web only. */
  readonly native: boolean;
  readonly description: string;
}

export const RECIPES: Readonly<Record<RecipeName, Recipe>> = {
  tick: { lengthMs: 12, peakDbfs: -28, native: true, description: "White noise band-passed at 4 kHz (Q 2)" },
  plunk: { lengthMs: 70, peakDbfs: -14, native: true, description: "Sine 90 → 70 Hz plus brown noise" },
  "plunk-low": { lengthMs: 70, peakDbfs: -14, native: true, description: "The plunk an octave lower" },
  clack: { lengthMs: 45, peakDbfs: -18, native: true, description: "140 Hz odd-harmonic burst and a click" },
  chime: { lengthMs: 275, peakDbfs: -16, native: true, description: "E5, then G♯5 at +90 ms" },
  root: { lengthMs: 300, peakDbfs: -18, native: false, description: "E4, the season's root note" },
  thud: { lengthMs: 50, peakDbfs: -30, native: true, description: "70 Hz for 50 ms. Never musical" },
  "scale-0": { lengthMs: 225, peakDbfs: -20, native: false, description: "E5" },
  "scale-1": { lengthMs: 225, peakDbfs: -20, native: false, description: "F♯5" },
  "scale-2": { lengthMs: 225, peakDbfs: -20, native: false, description: "G♯5" },
  "scale-3": { lengthMs: 225, peakDbfs: -20, native: false, description: "B5" },
  "scale-4": { lengthMs: 225, peakDbfs: -20, native: false, description: "C♯6" },
  "scale-5": { lengthMs: 225, peakDbfs: -20, native: false, description: "E6" },
  "scale-6": { lengthMs: 225, peakDbfs: -20, native: false, description: "F♯6" },
  "scale-7": { lengthMs: 225, peakDbfs: -20, native: false, description: "G♯6" },
};

export const RECIPE_NAMES = Object.keys(RECIPES) as RecipeName[];

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const dbToGain = (db: number) => 10 ** (db / 20);
const samples = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000);
/** ln(1000): an exponential envelope reaching −60 dB after `length`. */
const LN_1000 = Math.log(1000);

/** Attack-then-exponential-decay envelope, reaching −60 dB at `decayMs` after the attack. */
function envelope(i: number, attackMs: number, decayMs: number): number {
  const t = (i / SAMPLE_RATE) * 1000;
  if (t < attackMs) return t / attackMs;
  return Math.exp((-LN_1000 * (t - attackMs)) / decayMs);
}

/** RBJ biquad band-pass (constant 0 dB peak gain). */
function bandPass(input: Samples, freq: number, q: number): Samples {
  const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i] ?? 0;
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** One-pole low-pass. */
function lowPass(input: Samples, freq: number): Samples {
  const k = 1 - Math.exp((-2 * Math.PI * freq) / SAMPLE_RATE);
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i++) {
    y += k * ((input[i] ?? 0) - y);
    out[i] = y;
  }
  return out;
}

function normalise(buffer: Samples, peakDbfs: number): Samples {
  let peak = 0;
  for (const v of buffer) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return buffer;
  const gain = dbToGain(peakDbfs) / peak;
  for (let i = 0; i < buffer.length; i++) buffer[i] = (buffer[i] ?? 0) * gain;
  return buffer;
}

function noise(length: number, seed: number): Samples {
  const rng = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** A tone with an exponential pitch glide from f0 to f1 over `glideMs`, plus one partial. */
function tone(
  length: number,
  f0: number,
  f1: number,
  glideMs: number,
  partial: { readonly ratio: number; readonly db: number },
  attackMs: number,
  decayMs: number,
  offset = 0,
  out: Samples = new Float32Array(length),
): Samples {
  const glide = samples(glideMs);
  let phase = 0;
  let phaseP = 0;
  const partialGain = dbToGain(partial.db);
  for (let i = 0; i + offset < length; i++) {
    const f = glide > 0 && i < glide ? f0 * (f1 / f0) ** (i / glide) : f1;
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    phaseP += (2 * Math.PI * f * partial.ratio) / SAMPLE_RATE;
    const env = envelope(i, attackMs, decayMs);
    out[i + offset] = (out[i + offset] ?? 0) + env * (Math.sin(phase) + partialGain * Math.sin(phaseP));
  }
  return out;
}

function plunk(lengthMs: number, fundamental: [number, number], partialRatio: number, seed: number): Samples {
  const length = samples(lengthMs);
  const out = tone(length, fundamental[0], fundamental[1], 60, { ratio: partialRatio, db: -14 }, 2, lengthMs);
  // 30 ms of brown noise, low-passed at 800 Hz, at −10 dB under the tone.
  const white = noise(samples(30), seed);
  const brown = new Float32Array(white.length);
  let acc = 0;
  for (let i = 0; i < white.length; i++) {
    acc = 0.98 * acc + 0.02 * (white[i] ?? 0);
    brown[i] = acc;
  }
  const shaped = normalise(lowPass(brown, 800), 0);
  const gain = dbToGain(-10);
  for (let i = 0; i < shaped.length; i++) {
    out[i] = (out[i] ?? 0) + gain * (shaped[i] ?? 0) * envelope(i, 1, 30);
  }
  return out;
}

/** Renders one sound. Pure and deterministic: the same name always returns the same samples. */
export function renderSound(name: RecipeName): Samples {
  const recipe = RECIPES[name];
  const length = samples(recipe.lengthMs);
  let out: Samples;
  switch (name) {
    case "tick": {
      const shaped = bandPass(noise(length, 0x7f3a), 4000, 2);
      out = new Float32Array(length);
      for (let i = 0; i < length; i++) out[i] = (shaped[i] ?? 0) * envelope(i, 0.5, 11.5);
      break;
    }
    case "plunk":
      out = plunk(70, [90, 70], 3, 0x91c2);
      break;
    case "plunk-low":
      out = plunk(70, [45, 35], 4, 0x91c3);
      break;
    case "clack": {
      out = new Float32Array(length);
      const burst = samples(40);
      for (let i = 0; i < burst; i++) {
        const t = i / SAMPLE_RATE;
        let v = 0;
        for (const n of [1, 3, 5, 7, 9]) v += Math.sin(2 * Math.PI * 140 * n * t) / n;
        out[i] = v * envelope(i, 1, 39);
      }
      out = lowPass(out, 1200);
      const click = noise(samples(5), 0x0457);
      for (let i = 0; i < click.length; i++)
        out[i] = (out[i] ?? 0) + 0.6 * (click[i] ?? 0) * envelope(i, 0.2, 4.8);
      break;
    }
    case "chime": {
      out = new Float32Array(length);
      tone(length, 659.26, 659.26, 0, { ratio: 2, db: -18 }, 5, 180, 0, out);
      tone(length, 830.61, 830.61, 0, { ratio: 2, db: -18 }, 5, 180, samples(90), out);
      break;
    }
    case "root":
      out = tone(length, ROOT_HZ, ROOT_HZ, 0, { ratio: 2, db: -12 }, 5, 295);
      break;
    case "thud":
      out = tone(length, 70, 70, 0, { ratio: 3, db: -14 }, 2, 48);
      break;
    default: {
      const index = Number(name.slice("scale-".length));
      const hz = SCALE_HZ[index] ?? SCALE_HZ[0];
      out = tone(length, hz, hz, 0, { ratio: 2, db: -18 }, 5, 220);
    }
  }
  return normalise(out, recipe.peakDbfs);
}

/** Encodes samples as a 16-bit mono PCM WAV. */
export function toWav16(samplesIn: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const dataBytes = samplesIn.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samplesIn.length; i++) {
    const v = Math.max(-1, Math.min(1, samplesIn[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return new Uint8Array(buffer);
}

/** The recipe a feedback sound plays: scale notes wrap after eight. */
export function recipeFor(sound: string, index = 0): RecipeName {
  if (sound === "scale") return `scale-${(((index % 8) + 8) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
  return sound as RecipeName;
}
