// Observe product hooks, including same-origin phone frames. This never drives product state.

import { MOMENTS, type MomentId } from "@fairsplit/motion";
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fixtures.js";

export interface PhaseLanding {
  moment: string;
  phase: string;
  at: number;
  frame: string;
}

function installObserver() {
  const host = window as unknown as {
    __fsPhase(value: { moment: string; phase: string; at: number }): Promise<void>;
    __fsFlight(): Promise<void>;
    __fsMomentObserver?: MutationObserver;
  };
  host.__fsMomentObserver?.disconnect();
  const previous = new WeakMap<Element, string>();
  const record = (root: Element, phase: string) => {
    const moment = root.getAttribute("data-moment") ?? "";
    if (!moment || !phase || previous.get(root) === phase) return;
    previous.set(root, phase);
    void host.__fsPhase({ moment, phase, at: Date.now() });
  };
  const scan = () => {
    for (const root of document.querySelectorAll("[data-moment][data-moment-phase]")) {
      record(root, root.getAttribute("data-moment-phase") ?? "");
    }
    if (document.querySelector(".fsc-flight")) void host.__fsFlight();
  };
  const observer = new MutationObserver((mutations) => {
    // MutationObserver batches writes. The next mutation's oldValue is the preceding write's actual
    // new value; the final write is still on the element. Preserve those DOM writes, never infer a phase.
    const later = new Map<Element, string | null>();
    const writes: { root: Element; phase: string }[] = [];
    for (let i = mutations.length - 1; i >= 0; i--) {
      const mutation = mutations[i];
      if (mutation?.attributeName !== "data-moment-phase" || !(mutation.target instanceof Element)) continue;
      const root = mutation.target;
      const phase = later.has(root) ? later.get(root) : root.getAttribute("data-moment-phase");
      if (phase) writes.push({ root, phase });
      later.set(root, mutation.oldValue);
    }
    for (const { root, phase } of writes.reverse()) record(root, phase);
    scan();
  });
  host.__fsMomentObserver = observer;
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-moment", "data-moment-phase"],
  });
  document.addEventListener("DOMContentLoaded", scan, { once: true });
  scan();
}

export async function observeMoments(context: BrowserContext) {
  const landings: PhaseLanding[] = [];
  let flights = 0;
  await context.exposeBinding("__fsPhase", ({ frame }, value: Omit<PhaseLanding, "frame">) => {
    expect(Object.hasOwn(MOMENTS, value.moment), `known moment ${value.moment}`).toBe(true);
    expect(
      MOMENTS[value.moment as MomentId] as readonly string[],
      `${value.moment} canonical phase`,
    ).toContain(value.phase);
    landings.push({ ...value, frame: frame.name() });
  });
  await context.exposeBinding("__fsFlight", () => flights++);
  await context.addInitScript(installObserver);
  return {
    landings,
    async refresh(page: Page) {
      for (const frame of page.frames()) await frame.evaluate(installObserver);
    },
    get flights() {
      return flights;
    },
    clear() {
      landings.length = 0;
      flights = 0;
    },
    async reached(moment: string, phase: string) {
      await expect
        .poll(() => landings.some((entry) => entry.moment === moment && entry.phase === phase), {
          message: `${moment} reaches ${phase} on a real product event`,
          timeout: 30_000,
        })
        .toBe(true);
    },
    ordered(moment: string, phases: readonly string[], frame?: string) {
      let after = -1;
      for (const phase of phases) {
        const next = landings.findIndex(
          (entry, i) =>
            i > after &&
            entry.moment === moment &&
            entry.phase === phase &&
            (frame === undefined || entry.frame === frame),
        );
        expect(
          next,
          `${moment}: ${phase} follows ${phases.slice(0, phases.indexOf(phase)).join(" → ")}`,
        ).toBeGreaterThan(after);
        after = next;
      }
    },
  };
}
