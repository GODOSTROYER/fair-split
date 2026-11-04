import type { Locator, Page } from "@playwright/test";
import { type PhaseLanding, waitUntilBeat } from "./timeline.js";

export interface CursorPoint {
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
  readonly pressed: boolean;
}

type CaptureEvent = ({ readonly kind: "phase" } & PhaseLanding) | ({ readonly kind: "cursor" } & CursorPoint);

/** Serializable installer, refreshed once the phone has finished booting. */
export function installFilmPhaseObserver({ startedAt }: { startedAt: number }) {
  const host = window as typeof window & {
    __fsFilmCapture: (event: CaptureEvent) => Promise<void>;
    __fsFilmPhaseObserver?: MutationObserver;
  };
  host.__fsFilmPhaseObserver?.disconnect();
  const seen = new WeakMap<Element, string>();
  const scan = () => {
    for (const root of document.querySelectorAll("[data-moment][data-moment-phase]")) {
      const moment = root.getAttribute("data-moment");
      const phase = root.getAttribute("data-moment-phase");
      if (!moment || !phase || seen.get(root) === phase) continue;
      seen.set(root, phase);
      void host
        .__fsFilmCapture({ kind: "phase", moment, phase, atMs: Date.now() - startedAt })
        .catch(() => undefined);
    }
  };
  const observer = new MutationObserver(scan);
  host.__fsFilmPhaseObserver = observer;
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-moment", "data-moment-phase"],
  });
  document.addEventListener("DOMContentLoaded", scan, { once: true });
  scan();
}

/** Pointer listeners are renewed after phone boot; aborting the old set prevents duplicate cursor samples. */
export function installFilmPointerObserver({ startedAt }: { startedAt: number }) {
  const host = window as typeof window & {
    __fsFilmCapture: (event: CaptureEvent) => Promise<void>;
    __fsFilmPointerController?: AbortController;
  };
  host.__fsFilmPointerController?.abort();
  const controller = new AbortController();
  host.__fsFilmPointerController = controller;
  const options = { capture: true, signal: controller.signal };
  const emit = (event: CaptureEvent) => {
    void host.__fsFilmCapture(event).catch(() => undefined);
  };
  let arrow = window === window.top ? document.querySelector<SVGSVGElement>("[data-fs-film-cursor]") : null;
  if (window === window.top && !arrow) {
    arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 42 52");
    arrow.setAttribute("aria-hidden", "true");
    arrow.dataset.fsFilmCursor = "";
    arrow.style.cssText =
      "position:fixed;left:0;top:0;width:32px;height:40px;pointer-events:none;z-index:2147483647;transform:translate(-64px,-64px);filter:drop-shadow(1px 2px 0 #17141d66)";
    const ink = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ink.setAttribute("d", "M3 2 L7 36 L17 27 L27 47 L34 43 L24 24 L38 21 Z");
    ink.setAttribute("fill", "#faf8f2");
    ink.setAttribute("stroke", "#17141d");
    ink.setAttribute("stroke-width", "3");
    ink.setAttribute("stroke-linejoin", "round");
    arrow.append(ink);
  }
  if (arrow) {
    const mount = () => {
      if (arrow && !arrow.isConnected && document.documentElement) document.documentElement.append(arrow);
    };
    mount();
    document.addEventListener("DOMContentLoaded", mount, { once: true, signal: controller.signal });
  }
  let pressed = false;
  const point = (event: PointerEvent) => {
    let x = event.clientX;
    let y = event.clientY;
    let child: Window = window;
    while (child !== child.top) {
      const rect = child.frameElement?.getBoundingClientRect();
      if (!rect) break;
      x += rect.left;
      y += rect.top;
      child = child.parent;
    }
    const topArrow = arrow ?? window.top?.document.querySelector<SVGSVGElement>("[data-fs-film-cursor]");
    if (topArrow) topArrow.style.transform = `translate(${x}px,${y}px) scale(${pressed ? 0.9 : 1})`;
    emit({ kind: "cursor", atMs: Date.now() - startedAt, x, y, pressed });
  };
  document.addEventListener("pointermove", point, options);
  document.addEventListener(
    "pointerdown",
    (event) => {
      pressed = true;
      point(event);
    },
    options,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      pressed = false;
      point(event);
    },
    options,
  );
}

/** Test injection only. It observes real DOM commits and pointer events, including same-origin phone frames. */
export async function installFilmCapture(page: Page, startedAt: number) {
  const phases: PhaseLanding[] = [];
  const cursor: CursorPoint[] = [];
  await page.exposeBinding("__fsFilmCapture", (_source, event: CaptureEvent) => {
    if (event.kind === "phase") {
      const { moment, phase, atMs } = event;
      phases.push({ moment, phase, atMs });
    } else {
      const { atMs, x, y, pressed } = event;
      cursor.push({ atMs, x, y, pressed });
    }
  });
  await page.addInitScript(installFilmPhaseObserver, { startedAt });
  await page.addInitScript(installFilmPointerObserver, { startedAt });
  return {
    phases,
    cursor,
    async refresh() {
      for (const frame of page.frames()) {
        await frame.evaluate(installFilmPhaseObserver, { startedAt });
        await frame.evaluate(installFilmPointerObserver, { startedAt });
      }
    },
  };
}

/** Actual pointer movement gives the capture and its JSON the same cursor. Key confirmation uses ordinary clicks. */
export async function filmClick(page: Page, target: Locator): Promise<void> {
  // Hover re-resolves an updating locator and scrolls it into view before the cursor's final approach.
  await target.hover();
  const box = await target.boundingBox();
  if (!box) throw new Error("Film target has no pointer box");
  await page.mouse.move(box.x + Math.min(28, box.width / 2), box.y + box.height / 2, { steps: 12 });
  await target.click({ position: { x: Math.min(28, box.width / 2), y: box.height / 2 } });
}

/** Only editorial pacing is labelled here. Product waits and simulator time are never accelerated. */
export async function paceFilmBeat(page: Page, id: string, startedAt: number, now: () => number = Date.now) {
  const badge = (show: boolean) =>
    page.evaluate(
      ({ show, label }) => {
        let node = document.querySelector<HTMLElement>("[data-fs-film-wait]");
        if (!show) {
          node?.remove();
          return;
        }
        if (!node) {
          node = document.createElement("div");
          node.dataset.fsFilmWait = "";
          node.setAttribute("aria-hidden", "true");
          node.style.cssText =
            "position:fixed;left:24px;bottom:24px;padding:8px 12px;background:#17141d;color:#faf8f2;border:1px solid #faf8f2;font:14px monospace;pointer-events:none;z-index:2147483646";
          document.documentElement.append(node);
        }
        node.textContent = label;
      },
      { show, label: "×1 real time" },
    );
  await waitUntilBeat(id, startedAt, now, async (ms) => {
    await badge(true);
    try {
      await page.waitForTimeout(ms);
    } finally {
      await badge(false);
    }
  });
}
