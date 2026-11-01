// The mock data path for `vite dev` (and for a build made with VITE_PUBLIC_FS_DATA=mock): api-client's seeded
// mock of fs-api answers the console's adapter through a service worker that msw's own Vite plugin serves.
// Where a service worker cannot register (embedded browsers, some private windows), the same handlers answer
// in memory instead, so the console still boots. The world lives in memory: a reload starts a fresh first
// view, like a new judge visit. The stage labels everything as mock data, and PayPal as simulated.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { setupWorker } from "msw/browser";
import type { DataAdapter } from "../adapter.js";
import {
  type ConsoleMock,
  createConsoleMock,
  createMockAdapter,
  createMockDriver,
  type MockDriver,
} from "./index.js";

declare global {
  interface Window {
    /** Development handle on the mock API: the world and a driver acting as the people. Mock mode only. */
    __fsMock?: {
      readonly mock: ConsoleMock;
      readonly transport: MockTransport;
      /** Acts as the treasurer or the Chair without the UI (async steps keep their pace). */
      readonly driver: MockDriver;
      /** The Chair's key, while no Chair frame is attached. */
      cosign(): void;
    };
  }
}

export type MockTransport = "service-worker" | "memory";

export interface MockData {
  readonly adapter: DataAdapter;
  readonly mock: ConsoleMock;
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
  const mock = createConsoleMock({ stage: "invoiced", pace: "auto", origin: window.location.origin });
  const snapshotLoader = async () => snapshot;
  let data: MockData;
  try {
    const worker = setupWorker(...mock.handlers);
    await withTimeout(
      worker.start({
        onUnhandledFrame: "bypass",
        quiet: true,
        serviceWorker: { url: "/mockServiceWorker.js" },
      }),
      WORKER_START_TIMEOUT_MS,
    );
    data = {
      adapter: createMockAdapter(mock, {
        snapshot: snapshotLoader,
        baseUrl: apiBase,
        fetch: (input, init) => window.fetch(input, init),
      }),
      mock,
      transport: "service-worker",
    };
  } catch (error) {
    console.warn(
      `[fair split] The mock service worker did not start (${error instanceof Error ? error.message : String(error)}). The same mock answers in memory instead.`,
    );
    data = { adapter: createMockAdapter(mock, { snapshot: snapshotLoader }), mock, transport: "memory" };
  }
  const driver = createMockDriver(mock.world, { settle: false });
  window.__fsMock = {
    mock,
    transport: data.transport,
    driver,
    cosign: () => void driver.cosign(),
  };
  return data;
}
