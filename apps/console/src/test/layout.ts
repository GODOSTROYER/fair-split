// A ResizeObserver a test drives, for what jsdom never does (it lays nothing out, and the setup's stub observes
// nothing): `layout.resized(el)` is a layout change that resized `el`, delivered to every observer watching it as a
// browser would, after layout and before paint. `layout.watching()` counts the elements still observed, so a test
// can see a watch end. It replaces the global until the test's `vi.unstubAllGlobals()` (or the file's afterEach).

import { vi } from "vitest";

interface Watch {
  readonly targets: Set<Element>;
  readonly callback: ResizeObserverCallback;
}

export interface FakeLayout {
  /** Delivers a resize of `el` to every observer watching it. */
  resized(el: Element): void;
  /** How many elements are still observed, across every live observer. */
  watching(): number;
}

export function fakeResizeObserver(): FakeLayout {
  const live = new Set<Watch>();
  class FakeResizeObserver {
    private readonly watch: Watch;
    constructor(callback: ResizeObserverCallback) {
      this.watch = { targets: new Set(), callback };
      live.add(this.watch);
    }
    observe(target: Element) {
      this.watch.targets.add(target);
    }
    unobserve(target: Element) {
      this.watch.targets.delete(target);
    }
    disconnect() {
      this.watch.targets.clear();
      live.delete(this.watch);
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    resized(el) {
      for (const watch of [...live]) {
        if (!watch.targets.has(el)) continue;
        watch.callback([{ target: el } as ResizeObserverEntry], watch as unknown as ResizeObserver);
      }
    },
    watching: () => [...live].reduce((n, watch) => n + watch.targets.size, 0),
  };
}
