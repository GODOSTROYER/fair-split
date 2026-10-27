// The mock data path for `vite dev` (and for a build made with VITE_PUBLIC_FS_DATA=mock): msw answers the
// HTTP adapter from a MockWorld over the seed snapshot, through a service worker that msw's own Vite plugin
// serves. Where a service worker cannot register (embedded browsers, some private windows), the same world
// answers through the in-memory adapter instead, so the console still boots. The world lives in memory: a
// reload starts a fresh first view, like a new judge visit. The stage labels everything as mock data.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { setupWorker } from "msw/browser";
import type { DataAdapter } from "../adapter.js";
import { createHttpAdapter } from "../http.js";
import { createMockHandlers } from "./handlers.js";
import { createMemoryAdapter } from "./memory.js";
import { MockWorld } from "./world.js";

declare global {
  interface Window {
    /** Development handle on the mock API: the Chair's co-sign and the world itself. Mock mode only. */
    __fsMock?: {
      readonly world: MockWorld;
      readonly transport: MockTransport;
      cosign(runSlug: string): void;
    };
  }
}

export type MockTransport = "service-worker" | "memory";

export interface MockData {
  readonly adapter: DataAdapter;
  readonly world: MockWorld;
  readonly transport: MockTransport;
}

/** A service worker that never answers must not hold the console's first paint hostage. */
const WORKER_START_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function startMockData(snapshot: SeasonSnapshot, apiBase = ""): Promise<MockData> {
  const world = new MockWorld({ snapshot, pace: "paced" });
  const snapshotLoader = async () => snapshot;
  let data: MockData;
  try {
    const worker = setupWorker(...createMockHandlers(world));
    await withTimeout(
      worker.start({
        onUnhandledFrame: "bypass",
        quiet: true,
        serviceWorker: { url: "/mockServiceWorker.js" },
      }),
      WORKER_START_TIMEOUT_MS,
    );
    data = {
      adapter: createHttpAdapter({ baseUrl: apiBase, snapshot: snapshotLoader, paypalRail: "simulator" }),
      world,
      transport: "service-worker",
    };
  } catch (error) {
    console.warn(
      `[fair split] The mock service worker did not start (${error instanceof Error ? error.message : String(error)}). The same mock world answers in memory instead.`,
    );
    data = { adapter: createMemoryAdapter(world, { paypalRail: "simulator" }), world, transport: "memory" };
  }
  window.__fsMock = {
    world,
    transport: data.transport,
    cosign: (runSlug: string) => void world.cosign(runSlug),
  };
  return data;
}
