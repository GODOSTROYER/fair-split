/**
 * IC-12 FrameBridge, the frame side (approved plan; S3.8). The judge stage embeds the web export in same-origin
 * phone frames. It hands each frame a 2-hour frame token (`fs.token`, never a URL), display preferences
 * (`fs.prefs`) and resets (`fs.reset`); the frame reports `fs.ready`, moment phases, feedback events (only the stage
 * plays sound) and the screen it shows. Every message carries `{v: 1}`; anything else is ignored.
 */
import type { AppRole, FramePrefs, ScreenId, ToFrame, ToStage } from "../_shims/contracts";
import { FRAME_PROTOCOL_VERSION } from "../_shims/contracts";

/** Frame tokens are opaque; bound them so a hostile message cannot push megabytes into memory. */
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,512}$/;
const PERSONA_RE = /^(member|board|clerk):[A-Za-z0-9-]{1,32}$/;
const WS_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Parses a stage → frame message; returns null for anything that is not exactly an IC-12 message. */
export function parseToFrame(data: unknown): ToFrame | null {
  if (!isObject(data) || data.v !== FRAME_PROTOCOL_VERSION) return null;
  switch (data.t) {
    case "fs.token": {
      const { token, exp, persona, ws } = data;
      if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
      if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
      if (typeof persona !== "string" || !PERSONA_RE.test(persona)) return null;
      if (typeof ws !== "string" || !WS_RE.test(ws)) return null;
      return { v: 1, t: "fs.token", token, exp, persona, ws };
    }
    case "fs.prefs": {
      const { tier, sound, reducedMotion, gloss } = data;
      if (tier !== "full" && tier !== "low") return null;
      if (typeof sound !== "boolean" || typeof reducedMotion !== "boolean" || typeof gloss !== "boolean") {
        return null;
      }
      return { v: 1, t: "fs.prefs", tier, sound, reducedMotion, gloss };
    }
    case "fs.reset":
      return { v: 1, t: "fs.reset" };
    default:
      return null;
  }
}

/**
 * The receiving rule (S3.8): same origin, and only from the frame's own parent window. Returns the parsed message
 * or null.
 */
export function acceptFromStage(
  e: { origin: string; source: unknown; data: unknown },
  self: { origin: string; parent: unknown },
): ToFrame | null {
  if (e.origin !== self.origin || e.source !== self.parent || e.source === null) return null;
  return parseToFrame(e.data);
}

/** `member:M-014` → member. */
export function personaRole(persona: string): AppRole | null {
  const m = PERSONA_RE.exec(persona);
  return m ? (m[1] as AppRole) : null;
}

/** `member:M-014` → M-014; other roles have no member number. */
export function personaMemberNo(persona: string): string | null {
  const [role, id] = persona.split(":");
  return role === "member" && id && /^M-\d{3}$/.test(id) ? id : null;
}

/** `exp` may arrive in seconds (JWT style) or milliseconds; both become an ISO instant. */
export function expiryIso(exp: number): string {
  const ms = exp < 1e12 ? exp * 1000 : exp;
  return new Date(ms).toISOString();
}

/** Builds a frame → stage message with the protocol version. */
export function toStage<M extends Omit<ToStage, "v">>(msg: M): M & { v: 1 } {
  return { ...msg, v: FRAME_PROTOCOL_VERSION };
}

export function readyMessage(frameId: string, persona: string | null, build: string): ToStage {
  return toStage({ t: "fs.ready", frameId, persona, build } as const);
}

export function focusMessage(screenId: ScreenId): ToStage {
  return toStage({ t: "fs.focus", screenId } as const);
}

export function momentMessage(moment: string, phase: string): ToStage {
  return toStage({ t: "fs.moment", moment, phase } as const);
}

export function feedbackMessage(event: string, index?: number): ToStage {
  return toStage(index === undefined ? { t: "fs.feedback", event } : { t: "fs.feedback", event, index });
}

/** Frames default to full motion, no sound and no gloss until the stage says otherwise. */
export const DEFAULT_FRAME_PREFS: FramePrefs = {
  tier: "full",
  sound: false,
  reducedMotion: false,
  gloss: false,
};
