// The stage's FrameBridge as a React hook: one StageBridge per stage, tokens minted for each persona once a
// judge session exists (and refreshed 5 minutes before they expire), preferences sent whenever sound,
// motion or the gloss change, fs.reset on Reset, and frame feedback played here, never in the frames.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FramePersona } from "../data/adapter.js";
import { useJudgeSession } from "../data/hooks.js";
import { useDataRuntime } from "../data/provider.js";
import { playFromFrame } from "../sound/sound.js";
import { DEV_STUB_BUILD, FRAME_PERSONAS, type FramePrefs, StageBridge } from "./bridge.js";

/** How a persona's frame stands: not answered yet, the app answered, or the development stand-in did. */
export type FrameStatus = "waiting" | "app" | "stub";

export interface StageBridgeApi {
  readonly bridge: StageBridge;
  readonly status: Readonly<Record<FramePersona, FrameStatus>>;
  /** Ref callback for a persona's iframe; returns React 19's ref cleanup. */
  attach(persona: FramePersona): (el: HTMLIFrameElement | null) => (() => void) | undefined;
}

export interface StageBridgeHandlers {
  readonly onFocus?: (persona: FramePersona, screenId: string) => void;
  readonly onMoment?: (persona: FramePersona, moment: string, phase: string) => void;
}

const WAITING: Readonly<Record<FramePersona, FrameStatus>> = {
  member: "waiting",
  chair: "waiting",
  clerk: "waiting",
};

export function useStageBridge(prefs: FramePrefs, handlers: StageBridgeHandlers = {}): StageBridgeApi {
  const { adapter } = useDataRuntime();
  const session = useJudgeSession();
  const sessionId = session.status === "active" ? (session.session?.sessionId ?? null) : null;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [status, setStatus] = useState(WAITING);

  const bridge = useMemo(
    () =>
      new StageBridge({
        host: window,
        tokenFor: async (persona) => {
          const sid = sessionRef.current;
          return sid ? adapter.pending.frameToken(sid, persona) : null;
        },
        onFeedback: (event, index) => playFromFrame(event, index),
        onFocus: (persona, screenId) => handlersRef.current.onFocus?.(persona, screenId),
        onMoment: (persona, moment, phase) => handlersRef.current.onMoment?.(persona, moment, phase),
        onReady: (persona, ready) => {
          const next: FrameStatus = ready.build === DEV_STUB_BUILD ? "stub" : "app";
          setStatus((prev) => (prev[persona] === next ? prev : { ...prev, [persona]: next }));
        },
      }),
    [adapter],
  );

  useEffect(() => {
    bridge.start();
    return () => bridge.stop();
  }, [bridge]);

  useEffect(() => {
    bridge.setPrefs(prefs);
  }, [bridge, prefs]);

  // A session starts: every ready frame gets its token. A session ends: every frame drops it.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId && sessionId !== previous.current) {
      if (previous.current) bridge.reset();
      void bridge.refreshTokens();
    }
    if (!sessionId && previous.current) bridge.reset();
    previous.current = sessionId;
  }, [bridge, sessionId]);

  const attach = useMemo(() => {
    const cache = new Map<FramePersona, (el: HTMLIFrameElement | null) => (() => void) | undefined>();
    for (const persona of FRAME_PERSONAS) {
      cache.set(persona, (el) => {
        const target = el?.contentWindow;
        if (!target) return undefined;
        const detach = bridge.attach(persona, target);
        return () => {
          detach();
          setStatus((prev) => (prev[persona] === "waiting" ? prev : { ...prev, [persona]: "waiting" }));
        };
      });
    }
    return (persona: FramePersona) => cache.get(persona) ?? (() => undefined);
  }, [bridge]);

  return { bridge, status, attach };
}
