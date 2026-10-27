// Test support for the season slice (imported by tests only, never by a screen). It renders the console the way
// the shared kit's renderConsole does, over the same mock world, with one addition: a stream it can feed events
// the mock does not emit yet. api-client's mock plays no `extract.row` (reported to WS-API), so the reading
// room's tests push the recorded run's rows (reading/replay-fixture.ts) into the run's SSE stream. To keep the
// reducer's forward-only IDs true, every world event's ID is scaled by 1000 and injected events take the IDs
// between: an injected row is always newer than what came before it and older than what follows.

import type { RunEvent } from "@fairsplit/contracts";
import type { MotionPreference } from "@fairsplit/ui-web";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, waitFor } from "@testing-library/react";
import { AppProviders } from "../../chrome/AppProviders.js";
import type { DataAdapter, StreamHandlers } from "../../data/adapter.js";
import { createMockAdapter } from "../../data/mock/index.js";
import { createDataRuntime } from "../../data/provider.js";
import { createQueryClient } from "../../data/query.js";
import type { JudgeSession } from "../../data/session.js";
import { createConsoleRouter } from "../../router.js";
import { createTestWorld, seedSnapshot, setViewport, type TestWorld } from "../../test/index.js";
import { type EventStamp, extractRowEvent, quarantineEvent, replayRows } from "../reading/replay-fixture.js";

const SCALE = 1000;

export interface InjectableStream {
  /** Pushes events into every open run stream, newest after the last one delivered. */
  inject(make: (stamp: (offset: number) => EventStamp) => readonly RunEvent[]): void;
}

function injectable(base: DataAdapter): { adapter: DataAdapter; stream: InjectableStream } {
  const open = new Set<StreamHandlers>();
  let last = 0;
  let injected = 0;
  let stamp = { ws: "", runId: null as string | null };
  const adapter: DataAdapter = {
    ...base,
    subscribe(scope, handlers, options) {
      const scaled: StreamHandlers = {
        onEvent: (event) => {
          const id = Number(event.id) * SCALE;
          last = Math.max(last, id);
          injected = 0;
          stamp = { ws: event.ws, runId: event.runId };
          handlers.onEvent({ ...event, id: String(id) });
        },
        ...(handlers.onStatus ? { onStatus: handlers.onStatus } : {}),
      };
      const after = options?.lastEventId ? String(Math.floor(Number(options.lastEventId) / SCALE)) : null;
      const stop = base.subscribe(scope, scaled, { lastEventId: after });
      open.add(handlers);
      return () => {
        stop();
        open.delete(handlers);
      };
    },
  };
  const stream: InjectableStream = {
    inject(make) {
      const events = make((offset) => ({
        id: String(last + injected + offset + 1),
        at: new Date().toISOString(),
        ws: stamp.ws,
        runId: stamp.runId,
      }));
      injected += events.length;
      for (const handlers of open) for (const event of events) handlers.onEvent(event);
    },
  };
  return { adapter, stream };
}

export interface SeasonRender {
  readonly world: TestWorld;
  readonly stream: InjectableStream;
  readonly container: HTMLElement;
  navigate(path: string): Promise<void>;
  startSession(): Promise<JudgeSession>;
  unmount(): void;
  readonly runtime: ReturnType<typeof createDataRuntime>;
}

export async function renderSeason(
  options: {
    readonly path: string;
    readonly motion?: MotionPreference;
    readonly world?: TestWorld;
    readonly width?: number;
  } = { path: "/judge" },
): Promise<SeasonRender> {
  setViewport(options.width ?? 1470, 956);
  const world = options.world ?? createTestWorld();
  const base = createMockAdapter(world.mock, { snapshot: async () => seedSnapshot() });
  const { adapter, stream } = injectable(base);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const runtime = createDataRuntime(adapter, client);
  const history = createMemoryHistory({ initialEntries: [options.path] });
  const router = createConsoleRouter(runtime, history);
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <AppProviders runtime={runtime} motion={options.motion ?? "full"}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  });
  await waitFor(() => {
    if (router.state.status !== "idle" || router.state.isLoading) throw new Error("loading");
  });
  const rendered = view as ReturnType<typeof render>;
  return {
    world,
    stream,
    runtime,
    container: rendered.container,
    unmount: () => rendered.unmount(),
    async navigate(path) {
      await act(async () => {
        await router.navigate({ to: path });
      });
    },
    async startSession() {
      let session: JudgeSession | undefined;
      await act(async () => {
        session = await runtime.session.start();
      });
      return session as JudgeSession;
    },
  };
}

/** The recorded run's rows for some photos, as events (the 0449 quarantine with photo I). */
export function rowsFor(photos: readonly string[]) {
  const snapshot = seedSnapshot();
  const rows = replayRows(snapshot).filter((r) => photos.includes(r.photoId));
  return (stamp: (offset: number) => EventStamp): RunEvent[] => {
    const out: RunEvent[] = rows.map((row, i) => extractRowEvent(row, stamp(i)));
    if (photos.includes("I")) {
      const q = quarantineEvent(snapshot, stamp(out.length));
      if (q) out.push(q);
    }
    return out;
  };
}
