// "Play it for me" (S1.6): a flat control on the run pill. While it drives, every 4 s or so it performs the
// step the pill names with a visible cursor (the stage overlay), pressing exactly what a person would press;
// the run then moves on the server's events, never on this timer. It stops before both keys ("Your turn: hold
// to approve", "Your turn: co-sign as Ernesto"), and any input from the judge pauses it ("Paused. You're
// driving."). The stage shows the autoplay state in its notice strip (the "Autoplay" chip).

import { spring } from "@fairsplit/motion/web";
import { Glyph, useMotionMode } from "@fairsplit/ui-web";
import { useRouterState } from "@tanstack/react-router";
import { animate, motion, useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChromePortal } from "../../chrome/slots.js";
import { INVOICE_WAIT } from "../../data/session.js";
import { useAnnounce } from "../../lib/announce.js";
import { type StageApi, useOptionalStage } from "../../stage/context.js";
import {
  AUTOPLAY_COPY,
  AUTOPLAY_STEP_MS,
  type AutoplayPlan,
  aimAt,
  planStep,
  resolveTarget,
} from "./autoplay-plan.js";
import "./judge.css";

/**
 * How long autoplay waits between steps, how many idle ticks mean a step needs the judge, and how long a press in
 * flight may stay busy before it does: longer than the press's own wait for the session's invoice, so a slow
 * invoice is waited out, but a press that can never land (a stream gone quiet) is said, never waited on forever.
 */
export const autoplayTiming = {
  stepMs: AUTOPLAY_STEP_MS,
  stuckTicks: 4,
  busyMs: INVOICE_WAIT.deadlineMs + 15_000,
};

export function StageAutoplay() {
  const stage = useOptionalStage();
  if (!stage || stage.layout.phone === "phone-visit") return null;
  return <Autoplay stage={stage} />;
}

function Autoplay({ stage }: { readonly stage: StageApi }) {
  const mode = useMotionMode();
  const announce = useAnnounce();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const x = useMotionValue(-64);
  const y = useMotionValue(-64);
  const [turn, setTurn] = useState<string | null>(null);
  const [press, setPress] = useState(0);
  const [placed, setPlaced] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const { autoplay, setAutoplay, next } = stage;

  // The loop reads the latest step and location without restarting on every render.
  const latest = useRef({ next, pathname, search, mode });
  latest.current = { next, pathname, search, mode };

  // A new step (or Reset) clears the "Your turn" tag.
  const turnFor = useRef<string | null>(null);
  useEffect(() => {
    if (turnFor.current !== null && turnFor.current !== next.id) {
      setTurn(null);
      turnFor.current = null;
    }
  }, [next.id]);

  // Any input from the judge pauses autoplay; its own presses are synthetic and never trusted.
  useEffect(() => {
    if (autoplay !== "autoplay") return;
    const onInput = (event: Event) => {
      if (!event.isTrusted) return;
      if (toggle.current && event.target instanceof Node && toggle.current.contains(event.target)) return;
      setAutoplay("paused");
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    return () => {
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
    };
  }, [autoplay, setAutoplay]);

  const moveTo = useCallback(
    async (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) el.scrollIntoView({ block: "center" });
      const aim = aimAt(el.getBoundingClientRect());
      setPlaced(true);
      if (latest.current.mode === "reduced") {
        x.jump(aim.x);
        y.jump(aim.y);
        return;
      }
      await Promise.all([
        animate(x, aim.x, spring("glide")).finished,
        animate(y, aim.y, spring("glide")).finished,
      ]);
    },
    [x, y],
  );

  // The driver: one step, then the next after AUTOPLAY_STEP_MS. Only "turn" and "finish" end the loop.
  useEffect(() => {
    if (autoplay !== "autoplay") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idle = 0;
    let busySince: number | null = null;
    const keyOf = (step: StageApi["next"]) => `${step.id}|${step.to}|${step.text}`;
    let lastStep = keyOf(latest.current.next);
    const later = (fn: () => void, ms = autoplayTiming.stepMs) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };
    const pressOn = (el: HTMLElement) => {
      if (!el.isConnected) return;
      setPress((p) => p + 1);
      el.click();
    };
    const stop = (message: string, el: HTMLElement | null) => {
      const show = () => {
        if (cancelled) return;
        turnFor.current = latest.current.next.id;
        setTurn(message);
        announce(message);
        setAutoplay("paused");
      };
      if (el) void moveTo(el).then(show);
      else show();
    };
    const tick = () => {
      const { next: step, pathname: path, search: query } = latest.current;
      if (keyOf(step) !== lastStep) {
        lastStep = keyOf(step);
        idle = 0;
      }
      const plan: AutoplayPlan = planStep(step, { pathname: path, search: query });
      switch (plan.kind) {
        case "wait":
          later(tick);
          return;
        case "turn":
          stop(plan.message, resolveTarget(document, plan.selectors));
          return;
        case "finish": {
          const el = resolveTarget(document, [plan.selector]);
          announce(AUTOPLAY_COPY.done);
          if (!el) {
            setAutoplay("off");
            return;
          }
          void moveTo(el).then(() => {
            if (cancelled) return;
            setAutoplay("off");
            pressOn(el);
          });
          return;
        }
        case "go":
        case "press": {
          // A press still in flight (the first view waits for the session's invoice): wait, up to a ceiling.
          if (document.querySelector('[data-testid="W-JG-01.stage"] [aria-busy="true"]')) {
            busySince ??= Date.now();
            if (Date.now() - busySince >= autoplayTiming.busyMs) stop(AUTOPLAY_COPY.stuck, null);
            else later(tick);
            return;
          }
          busySince = null;
          const el = resolveTarget(document, plan.kind === "go" ? [plan.selector] : plan.selectors);
          if (!el) {
            idle += 1;
            if (idle >= autoplayTiming.stuckTicks) stop(AUTOPLAY_COPY.stuck, null);
            else later(tick);
            return;
          }
          idle += 1;
          if (idle > autoplayTiming.stuckTicks) {
            stop(AUTOPLAY_COPY.stuck, el);
            return;
          }
          void moveTo(el).then(() => {
            if (cancelled) return;
            pressOn(el);
            later(tick);
          });
          return;
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoplay, setAutoplay, moveTo, announce]);

  const driving = autoplay === "autoplay";
  const onToggle = () => {
    if (driving) {
      setAutoplay("paused");
      return;
    }
    setTurn(null);
    turnFor.current = null;
    setAutoplay("autoplay");
  };

  const cursorShown = placed && (driving || turn !== null);
  return (
    <>
      <ChromePortal name="pill.accessory">
        <button
          ref={toggle}
          type="button"
          className="fsc-autoplay"
          data-state={autoplay}
          data-testid="W-JG-01.autoplay"
          aria-pressed={driving}
          aria-label={driving ? AUTOPLAY_COPY.stopSr : undefined}
          onClick={onToggle}
        >
          <Glyph name={driving ? "ms:pause" : "ms:play-arrow"} size={16} />
          <span>
            {driving ? AUTOPLAY_COPY.stop : autoplay === "paused" ? AUTOPLAY_COPY.resume : AUTOPLAY_COPY.play}
          </span>
        </button>
      </ChromePortal>
      {cursorShown && (
        <ChromePortal name="stage.overlay">
          <motion.div
            className="fsc-cursor"
            aria-hidden
            data-testid="W-JG-01.autoplay.cursor"
            data-motion={mode}
            data-press={press > 0 ? "on" : undefined}
            style={{ x, y }}
          >
            <span key={press} className="fsc-cursor__press" />
            <svg
              className="fsc-cursor__arrow"
              width="22"
              height="26"
              viewBox="0 0 22 26"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15.2 Z" />
            </svg>
            <span
              className="fsc-cursor__tag"
              data-turn={turn ? "" : undefined}
              data-testid="W-JG-01.autoplay.tag"
            >
              {turn ?? AUTOPLAY_COPY.cursor}
            </span>
          </motion.div>
        </ChromePortal>
      )}
    </>
  );
}
