import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "@playwright/test";
import { installFilmCapture, installFilmPointerObserver, paceFilmBeat } from "./capture.js";

test("pointer refresh aborts old listeners, reuses the arrow and retains actual frame offsets", () => {
  const points: { x: number; y: number; pressed: boolean }[] = [];
  const events = new EventTarget();
  const makeNode = () => ({
    dataset: {},
    style: { cssText: "", transform: "" },
    isConnected: false,
    setAttribute() {},
    append() {},
  });
  let arrow: ReturnType<typeof makeNode> | null = null;
  let mounted = 0;
  const document = {
    querySelector: () => arrow,
    createElementNS: makeNode,
    addEventListener: events.addEventListener.bind(events),
    documentElement: {
      append: (node: ReturnType<typeof makeNode>) => {
        arrow = node;
        node.isConnected = true;
        mounted++;
      },
    },
  };
  const top = { document, top: null as unknown };
  top.top = top;
  const window = {
    top,
    parent: top,
    frameElement: { getBoundingClientRect: () => ({ left: 1_500, top: 300 }) },
    __fsFilmPointerController: undefined as AbortController | undefined,
    __fsFilmCapture: async (point: { x: number; y: number; pressed: boolean }) => {
      points.push(point);
    },
  };
  // First exercise the top window, then reuse the recorder as a same-origin phone frame.
  window.top = window as unknown as typeof top;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    installFilmPointerObserver({ startedAt: Date.now() });
    const first = window.__fsFilmPointerController;
    installFilmPointerObserver({ startedAt: Date.now() });
    assert.equal(first?.signal.aborted, true);
    assert.equal(mounted, 1);
    window.top = top;
    installFilmPointerObserver({ startedAt: Date.now() });
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new Event(type);
      Object.defineProperties(event, { clientX: { value: 34 }, clientY: { value: 56 } });
      events.dispatchEvent(event);
    }
    assert.equal(points.length, 2);
    assert.deepEqual(
      points.map(({ x, y, pressed }) => ({ x, y, pressed })),
      [
        { x: 1_534, y: 356, pressed: true },
        { x: 1_534, y: 356, pressed: false },
      ],
    );
    assert.equal(mounted, 1);
  } finally {
    window.__fsFilmPointerController?.abort();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("film observation refresh installs on each booted frame without driving a product action", async () => {
  const refreshed: { frame: string; at: number; installer: string }[] = [];
  const page = {
    exposeBinding: async () => {},
    addInitScript: async () => {},
    frames: () =>
      ["", "member", "chair"].map((frame) => ({
        evaluate: async (fn: (arg: { startedAt: number }) => void, arg: { startedAt: number }) => {
          refreshed.push({ frame, at: arg.startedAt, installer: fn.name });
        },
      })),
  } as unknown as Page;
  const capture = await installFilmCapture(page, 123);
  await capture.refresh();
  assert.deepEqual(refreshed, [
    { frame: "", at: 123, installer: "installFilmPhaseObserver" },
    { frame: "", at: 123, installer: "installFilmPointerObserver" },
    { frame: "member", at: 123, installer: "installFilmPhaseObserver" },
    { frame: "member", at: 123, installer: "installFilmPointerObserver" },
    { frame: "chair", at: 123, installer: "installFilmPhaseObserver" },
    { frame: "chair", at: 123, installer: "installFilmPointerObserver" },
  ]);
});

test("paced film waits show the honest real-time multiplier and always clear it", async () => {
  const badges: { show: boolean; label: string }[] = [];
  const delays: number[] = [];
  const page = {
    evaluate: async (_fn: unknown, badge: { show: boolean; label: string }) => badges.push(badge),
    waitForTimeout: async (ms: number) => delays.push(ms),
  } as unknown as Page;
  await paceFilmBeat(page, "funding", 1_000, () => 60_000);
  assert.deepEqual(delays, [6_000]);
  assert.deepEqual(badges, [
    { show: true, label: "×1 real time" },
    { show: false, label: "×1 real time" },
  ]);
  badges.length = 0;
  await paceFilmBeat(page, "funding", 1_000, () => 70_000);
  assert.deepEqual(badges, []);
});

test("film cursor waits for the HTML root when Chromium injects before documentElement exists", async () => {
  const listeners = new Map<string, () => void>();
  let mounted = 0;
  const document = {
    documentElement: null as null | { append(): void },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    createElementNS: () => ({
      setAttribute() {},
      append() {},
      dataset: {},
      style: {},
      isConnected: false,
    }),
  };
  const window = { top: null as unknown, __fsFilmCapture: async () => {} };
  window.top = window;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const injected = {
    window,
    document,
    MutationObserver: class {
      observe() {}
    },
  };
  for (const [key, value] of Object.entries(injected)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    const page = {
      exposeBinding: async () => {},
      addInitScript: async (fn: (arg: { startedAt: number }) => void, arg: { startedAt: number }) => fn(arg),
    } as unknown as Page;
    await installFilmCapture(page, Date.now());
    assert.equal(mounted, 0);
    document.documentElement = { append: () => mounted++ };
    listeners.get("DOMContentLoaded")?.();
    assert.equal(mounted, 1);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
