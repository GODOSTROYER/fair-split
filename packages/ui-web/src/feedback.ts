// feedback.play(event): the only way web UI makes a sound (design §4, S2 §2.10). The web promises no haptics.
// Sound is off by default behind a visible toggle, remembered per viewer, and never autoplays: the
// AudioContext is created inside the toggle's click handler. Sounds come from the same recipes as native.

import { FEEDBACK, type FeedbackEvent, type FeedbackOptions } from "@fairsplit/motion";
import { type RecipeName, recipeFor, renderSound, SAMPLE_RATE } from "@fairsplit/motion/sound";

const STORAGE_KEY = "fs.sound";
type Channel = "narration" | "paminawa";

interface Played {
  readonly event: FeedbackEvent;
  readonly at: number;
  readonly sound: RecipeName | null;
}

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function store(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage can be blocked; the toggle still works for this page.
  }
}

type AudioContextCtor = new () => AudioContext;

class WebFeedback {
  private context: AudioContext | null = null;
  private output: AudioNode | null = null;
  private readonly buffers = new Map<RecipeName, AudioBuffer>();
  private readonly lastPlayed = new Map<FeedbackEvent, number>();
  private readonly ducked = new Set<Channel>();
  private soundOn = false;
  private readonly listeners = new Set<(on: boolean) => void>();
  /** Every event played, for tests and the `?fsTrace=1` overlay. */
  readonly log: Played[] = [];

  /** Restores the viewer's remembered choice without starting audio (that needs a click). */
  restore(): boolean {
    this.soundOn = readStored();
    return this.soundOn;
  }

  isSoundOn(): boolean {
    return this.soundOn;
  }

  /** Call from a click or key handler: browsers only allow audio to start from a user gesture. */
  setSound(on: boolean): void {
    this.soundOn = on;
    store(on);
    if (on) this.ensureContext();
    for (const listener of this.listeners) listener(on);
  }

  onChange(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** No product sound plays under narration or Paminawa. */
  duck(channel: Channel, on: boolean): void {
    if (on) this.ducked.add(channel);
    else this.ducked.delete(channel);
  }

  play(event: FeedbackEvent, options: FeedbackOptions = {}): void {
    const spec = FEEDBACK[event];
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const last = this.lastPlayed.get(event);
    if (spec.throttleMs !== undefined && last !== undefined && now - last < spec.throttleMs) return;
    this.lastPlayed.set(event, now);
    const sound = spec.sound ? recipeFor(spec.sound.name, options.index ?? 0) : null;
    this.log.push({ event, at: now, sound });
    if (this.log.length > 200) this.log.shift();
    if (!sound || !this.soundOn || this.ducked.size > 0) return;
    const repeat = spec.sound?.repeat ?? 1;
    for (let i = 0; i < repeat; i++) this.schedule(sound, ((spec.sound?.gap ?? 0) * i) / 1000);
  }

  private ensureContext(): void {
    if (this.context) {
      void this.context.resume?.();
      return;
    }
    const Ctor = (globalThis as { AudioContext?: AudioContextCtor }).AudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    // Gain into a compressor with a −1 dBFS ceiling (S2 §2.10).
    const gain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -1;
    compressor.ratio.value = 20;
    gain.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    this.output = gain;
  }

  private buffer(name: RecipeName): AudioBuffer | null {
    if (!this.context) return null;
    const cached = this.buffers.get(name);
    if (cached) return cached;
    const samples = renderSound(name);
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    this.buffers.set(name, buffer);
    return buffer;
  }

  private schedule(name: RecipeName, delaySeconds: number): void {
    const context = this.context;
    const output = this.output;
    const buffer = this.buffer(name);
    if (!context || !output || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.start(context.currentTime + delaySeconds);
  }
}

/** The page's single feedback mixer. */
export const feedback = new WebFeedback();
