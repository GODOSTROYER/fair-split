// IC-12 FrameBridge, stage side (plan "Realtime, auth and Judge Mode"; S3.8). Stage → frame: fs.token,
// fs.prefs, fs.reset. Frame → stage: fs.ready, fs.moment, fs.feedback, fs.focus. Versioned {v: 1};
// senders post to location.origin, never "*"; the stage accepts a message only from its own origin AND
// from the contentWindow of a frame it registered. Unknown t or v is ignored. Only the stage plays sound.
//
// Contracts does not export IC-12 yet (reported): these schemas are the stage's copy of the plan's
// definition, matched field for field with the frame side WS-APP built (apps/mobile frame-protocol.ts):
// `fs.ready` carries the iframe's `name` as frameId, a null persona and the app's build; `fs.prefs.tier` is
// "full" or "low" (reduced motion is the low tier, S2.8, and travels as its own flag). They move to
// @fairsplit/contracts unchanged when WS-CORE adds IC-12.

import { SCREEN_IDS } from "@fairsplit/contracts";
import { FEEDBACK_EVENTS, type FeedbackEvent, MOMENT_IDS, type MomentId } from "@fairsplit/motion";
import { z } from "zod";
import type { FramePersona, FrameTokenGrant } from "../data/adapter.js";

export const FRAME_BRIDGE_VERSION = 1 as const;

export const FRAME_PERSONAS = ["member", "chair", "clerk"] as const satisfies readonly FramePersona[];

/** The motion renderer a frame uses. Reduced motion is the low tier (S2.8) plus `reducedMotion: true`. */
export const FrameTier = z.enum(["full", "low"]);
export type FrameTier = z.infer<typeof FrameTier>;

/** The `build` a development stand-in for /app announces; the stage keeps its preview over it. */
export const DEV_STUB_BUILD = "dev-stub";

const v = z.literal(FRAME_BRIDGE_VERSION);

export const ToFrame = z.discriminatedUnion("t", [
  z.strictObject({
    v,
    t: z.literal("fs.token"),
    token: z.string().min(16),
    /** Epoch milliseconds. */
    exp: z.number().int().positive(),
    /** The credential scope: "member:M-014", "board:ernesto", "clerk:jessie". */
    persona: z.string().min(1),
    ws: z.string().min(1),
  }),
  z.strictObject({
    v,
    t: z.literal("fs.prefs"),
    tier: FrameTier,
    sound: z.boolean(),
    reducedMotion: z.boolean(),
    /** Put English under each Cebuano or Filipino sentence (judges read the gloss). */
    gloss: z.boolean(),
  }),
  z.strictObject({ v, t: z.literal("fs.reset") }),
]);
export type ToFrame = z.infer<typeof ToFrame>;

export const ToStage = z.discriminatedUnion("t", [
  z.strictObject({
    v,
    t: z.literal("fs.ready"),
    /** The iframe's `name` (the stage names them member, chair and clerk). Informational only. */
    frameId: z.string().min(1).max(64),
    /** Informational: the stage trusts which iframe sent it, never this field. */
    persona: z.string().max(64).nullable().optional(),
    /** The app's build, e.g. "1.0.0+42"; the development stand-in says "dev-stub". */
    build: z.string().max(64).optional(),
  }),
  z.strictObject({
    v,
    t: z.literal("fs.moment"),
    moment: z.enum(MOMENT_IDS as [MomentId, ...MomentId[]]),
    phase: z.string().min(1).max(32),
  }),
  z.strictObject({
    v,
    t: z.literal("fs.feedback"),
    event: z.enum(FEEDBACK_EVENTS),
    index: z.number().int().min(0).max(64).optional(),
  }),
  z.strictObject({
    v,
    t: z.literal("fs.focus"),
    screenId: z.enum(SCREEN_IDS as [string, ...string[]]),
  }),
]);
export type ToStage = z.infer<typeof ToStage>;

export interface FramePrefs {
  readonly tier: FrameTier;
  readonly sound: boolean;
  readonly reducedMotion: boolean;
  readonly gloss: boolean;
}

/** The app role each stage persona maps to (`member:`, `board:`, `clerk:` credential scopes). */
export const FRAME_APP_ROLE: Readonly<Record<FramePersona, "member" | "board" | "clerk">> = {
  member: "member",
  chair: "board",
  clerk: "clerk",
};

/**
 * The URL a persona's iframe loads, once, for the stage's whole life (re-pointing an iframe reloads it). Before
 * the first press there is no session and so no token (S3.9: the first view makes no calls), so each frame
 * opens on the app's labelled demo state for its role; `fs.token` then makes it that persona's live session
 * and `fs.reset` returns it here. Phones are Adlaw (S2.1). Tokens never travel in a URL.
 */
export function frameSrc(persona: FramePersona, appBase = "/app"): string {
  const role = FRAME_APP_ROLE[persona];
  const query = new URLSearchParams({ theme: "adlaw", demo: role });
  if (role === "member") query.set("stage", "checking");
  return `${appBase}/?${query.toString()}`;
}

/** Refresh a frame token this long before it expires (S3.8). */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;

export interface StageBridgeHost {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  readonly location: { readonly origin: string };
}

export interface FrameReady {
  readonly frameId: string;
  /** The app's build as it announced it; null when it did not say. */
  readonly build: string | null;
}

export interface StageBridgeOptions {
  readonly host: StageBridgeHost;
  /** Mints a token for a persona's frame; null before a judge session exists. */
  readonly tokenFor: (persona: FramePersona) => Promise<FrameTokenGrant | null>;
  readonly onFeedback?: (event: FeedbackEvent, index: number | undefined, persona: FramePersona) => void;
  readonly onMoment?: (persona: FramePersona, moment: MomentId, phase: string) => void;
  readonly onFocus?: (persona: FramePersona, screenId: string) => void;
  readonly onReady?: (persona: FramePersona, ready: FrameReady) => void;
  readonly now?: () => number;
}

interface FrameEntry {
  readonly persona: FramePersona;
  readonly target: Window;
  ready: boolean;
  frameId: string | null;
  build: string | null;
  tokenExp: number | null;
  refresh: ReturnType<typeof setTimeout> | null;
}

export class StageBridge {
  private readonly frames = new Map<FramePersona, FrameEntry>();
  private prefs: FramePrefs | null = null;
  private started = false;
  private generation = 0;
  private readonly now: () => number;
  private readonly origin: string;

  constructor(private readonly options: StageBridgeOptions) {
    this.now = options.now ?? (() => Date.now());
    this.origin = options.host.location.origin;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.host.addEventListener("message", this.onMessage);
  }

  /**
   * Stops listening and cancels token refreshes. Registered frames stay registered: each one leaves through its
   * own detach function (React may stop and start the bridge while the iframes stay mounted).
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.options.host.removeEventListener("message", this.onMessage);
    for (const entry of this.frames.values()) {
      if (entry.refresh) clearTimeout(entry.refresh);
      entry.refresh = null;
    }
  }

  /** Registers a frame's window for a persona. Returns the function that forgets it. */
  attach(persona: FramePersona, target: Window): () => void {
    const previous = this.frames.get(persona);
    if (previous?.refresh) clearTimeout(previous.refresh);
    const entry: FrameEntry = {
      persona,
      target,
      ready: false,
      frameId: null,
      build: null,
      tokenExp: null,
      refresh: null,
    };
    this.frames.set(persona, entry);
    return () => {
      if (this.frames.get(persona) !== entry) return;
      if (entry.refresh) clearTimeout(entry.refresh);
      this.frames.delete(persona);
    };
  }

  isReady(persona: FramePersona): boolean {
    return this.frames.get(persona)?.ready ?? false;
  }

  /** The build a ready frame announced (null before fs.ready, or when it did not say). */
  buildOf(persona: FramePersona): string | null {
    return this.frames.get(persona)?.build ?? null;
  }

  /** Sends the stage's preferences now and to every frame that becomes ready later. */
  setPrefs(prefs: FramePrefs): void {
    this.prefs = prefs;
    for (const entry of this.frames.values())
      if (entry.ready) this.post(entry, { v: 1, t: "fs.prefs", ...prefs });
  }

  /** Tells every ready frame to drop its session (Reset). */
  reset(): void {
    this.generation += 1;
    for (const entry of this.frames.values()) {
      if (entry.refresh) clearTimeout(entry.refresh);
      entry.refresh = null;
      entry.tokenExp = null;
      if (entry.ready) this.post(entry, { v: 1, t: "fs.reset" });
    }
  }

  /** Mints and sends tokens to every ready frame (after the first press starts a session). */
  async refreshTokens(): Promise<void> {
    await Promise.all([...this.frames.values()].filter((e) => e.ready).map((e) => this.sendToken(e)));
  }

  private post(entry: FrameEntry, message: ToFrame): void {
    entry.target.postMessage(ToFrame.parse(message), this.origin);
  }

  private entryFor(source: MessageEventSource | null): FrameEntry | null {
    if (!source) return null;
    for (const entry of this.frames.values()) if (entry.target === source) return entry;
    return null;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.origin !== this.origin) return;
    const entry = this.entryFor(event.source);
    if (!entry) return;
    const parsed = ToStage.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.t) {
      case "fs.ready":
        // A reload erased the frame memory even if its Window and token expiry stayed the same.
        entry.tokenExp = null;
        entry.ready = true;
        entry.frameId = message.frameId;
        entry.build = message.build ?? null;
        if (this.prefs) this.post(entry, { v: 1, t: "fs.prefs", ...this.prefs });
        void this.sendToken(entry);
        this.options.onReady?.(entry.persona, { frameId: message.frameId, build: entry.build });
        return;
      case "fs.feedback":
        this.options.onFeedback?.(message.event, message.index, entry.persona);
        return;
      case "fs.moment":
        this.options.onMoment?.(entry.persona, message.moment, message.phase);
        return;
      case "fs.focus":
        this.options.onFocus?.(entry.persona, message.screenId);
        return;
    }
  };

  private async sendToken(entry: FrameEntry): Promise<void> {
    const generation = this.generation;
    let grant: FrameTokenGrant | null;
    try {
      grant = await this.options.tokenFor(entry.persona);
    } catch {
      return;
    }
    if (!grant || generation !== this.generation || this.frames.get(entry.persona) !== entry) return;
    if (entry.tokenExp !== null && grant.exp <= entry.tokenExp) return; // never resend a staler token
    entry.tokenExp = grant.exp;
    this.post(entry, {
      v: 1,
      t: "fs.token",
      token: grant.token,
      exp: grant.exp,
      persona: grant.persona,
      ws: grant.ws,
    });
    if (entry.refresh) clearTimeout(entry.refresh);
    const delay = grant.exp - TOKEN_REFRESH_LEAD_MS - this.now();
    entry.refresh = setTimeout(
      () => {
        entry.refresh = null;
        void this.sendToken(entry);
      },
      Math.max(30_000, delay),
    );
  }
}
