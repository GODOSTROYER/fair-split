// The API test harness every slice uses:
//
//   const t = await createTestApp();                      // no database: memory bus, memory stores
//   const t = await createTestApp({ db: "postgres" });    // a fresh migrated embedded-Postgres database
//   const ws = t.credentials.workspace();                 // (postgres: `await t.fixture()` instead)
//   const token = await t.credentials.frameToken({ workspaceId: ws, role: "treasurer", persona: "analyn" });
//   const r = await t.json("/v1/holds/<id>/resolve", { method: "POST", body: {...}, as: t.credentials.bearer(token) });
//   t.clock.advance(60_000);                              // the fake clock every handler reads
//   await t.close();
//
// Requests go through `app.request()` in-process (no port, no network). PayPal is the simulator stub by
// default (no network either); pass `env: { PP_MODE: "sandbox", … }` with `createPayPalMock()` for msw.

import { type ApiClient, createApiClient } from "@fairsplit/api-client";
import { createBus } from "@fairsplit/db";
import type { FixtureOptions, FixtureWorkspace, TestDb } from "@fairsplit/db/testing";
import type { TaskHandlers } from "@fairsplit/outbox";
import type { FetchLike } from "@fairsplit/paypal-core";
import { API_VERSION, createApp, type FairSplitApp } from "../app.js";
import { wireOutbox } from "../db.js";
import type { EnvSource } from "../env.js";
import { createFakeClock, type FakeClock } from "../lib/clock.js";
import type { AppDeps } from "../lib/context.js";
import type { InProcessSimulator } from "../paypal/mode.js";
import type { AnyFolderModule } from "../routes/registry.js";
import type { StaticDirs } from "../static.js";
import { type TestAuth, TestCredentials } from "./credentials.js";
import { createTestDeps } from "./deps.js";
import type { MemoryBus } from "./memory-bus.js";
import { type SseReader, sseReader } from "./sse.js";

export interface TestAppOptions {
  /** "none" (default): no database. "postgres": a fresh copy of the migrated template (needs the global setup). */
  db?: "none" | "postgres";
  clock?: FakeClock | Date | string;
  /** Env overrides on top of TEST_ENV (PP_MODE, FS_KILL, …). */
  env?: EnvSource;
  /** Route folders to mount (default all). */
  folders?: readonly AnyFolderModule[];
  /** Outbox handlers merged over the folders' (postgres; with `dispatcher: true` they run automatically). */
  taskHandlers?: TaskHandlers;
  /** Start the inline outbox dispatcher (postgres only). */
  dispatcher?: boolean;
  simulator?: InProcessSimulator;
  paypalFetch?: FetchLike;
  webhookTrustAnchors?: readonly string[];
  static?: StaticDirs | false;
}

export interface JsonInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  as?: TestAuth;
}

export interface JsonResult<T> {
  status: number;
  headers: Headers;
  body: T;
}

export interface TestApp {
  readonly app: FairSplitApp;
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  /** The in-memory bus (no-database mode): `bus.publish({...})` to drive SSE. */
  readonly bus: MemoryBus | null;
  /** The test database (postgres mode): `pg.owner` / `pg.app` pools. */
  readonly pg: TestDb | null;
  readonly credentials: TestCredentials;
  /** A synthetic workspace with a coop, season, ratified card and members (postgres mode). */
  fixture(opts?: FixtureOptions): Promise<FixtureWorkspace>;
  request(path: string, init?: RequestInit & { as?: TestAuth }): Promise<Response>;
  json<T = unknown>(path: string, init?: JsonInit): Promise<JsonResult<T>>;
  /**
   * The typed client (`@fairsplit/api-client`, what the console and the app use) over this app, in-process:
   * `await t.client(token).resolveHold({ params, body })` parses the response with the contract and throws
   * typed `ApiClientError`s. Pass a bearer token, a `TestAuth` (e.g. `t.credentials.judge(cookie)`), or nothing.
   */
  client(as?: string | TestAuth | null): ApiClient;
  /** Open an SSE stream and read it message by message. */
  sse(
    path: string,
    init?: RequestInit & { as?: TestAuth },
  ): Promise<{ response: Response; reader: SseReader }>;
  close(): Promise<void>;
}

const BASE = "http://localhost:8787";

export async function createTestApp(o: TestAppOptions = {}): Promise<TestApp> {
  const clock =
    o.clock && typeof (o.clock as FakeClock).advance === "function"
      ? (o.clock as FakeClock)
      : createFakeClock(o.clock as Date | string | undefined);
  let pg: TestDb | null = null;
  let stopBus: (() => Promise<void>) | null = null;
  let pingBus: (() => Promise<number>) | null = null;
  let data: Parameters<typeof createTestDeps>[0]["data"];
  if (o.db === "postgres") {
    const testing = await import("@fairsplit/db/testing");
    pg = await testing.openTestDb();
    const bus = createBus({ url: pg.url, db: pg.app.db });
    await bus.start();
    stopBus = () => bus.close();
    pingBus = () => bus.ping();
    data = { database: pg.app, bus };
  }
  const { deps, bus, memoryStore } = createTestDeps({
    clock,
    ...(o.env ? { env: o.env } : {}),
    ...(data ? { data } : {}),
    ...(o.simulator ? { simulator: o.simulator } : {}),
    ...(o.paypalFetch ? { paypalFetch: o.paypalFetch } : {}),
    ...(o.webhookTrustAnchors ? { webhookTrustAnchors: o.webhookTrustAnchors } : {}),
  });
  const app = createApp({
    deps,
    ...(o.folders ? { folders: o.folders } : {}),
    static: o.static ?? false,
    health: {
      db: async () => {
        if (!pg) throw new Error("no database in this test app");
        await pg.app.sql`select 1`;
      },
      ...(pingBus ? { listen: pingBus } : {}),
      dispatcher: () => ({ running: deps.outbox?.started ?? false, executor: "inline" }),
      roleMode: pg ? "assumed" : null,
      version: API_VERSION,
      startedAt: clock.now(),
    },
  });

  let stopOutbox: (() => Promise<void>) | null = null;
  if (pg && (o.dispatcher || o.taskHandlers)) {
    const wiring = wireOutbox({
      env: deps.env,
      data: { database: pg.app },
      listenUrl: o.dispatcher ? pg.url : undefined,
      handlers: { ...app.registry.taskHandlers(deps), ...(o.taskHandlers ?? {}) },
      logger: deps.logger,
    });
    deps.outbox = wiring.runtime;
    if (o.dispatcher) {
      await wiring.start();
      stopOutbox = () => wiring.stop();
    }
  }

  const credentials = new TestCredentials(deps, memoryStore, pg ? pg.app.db : null);

  const withAuth = (init: RequestInit & { as?: TestAuth } = {}): RequestInit => {
    const { as, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (as && "authorization" in as) headers.set("authorization", as.authorization);
    if (as && "cookie" in as) headers.set("cookie", as.cookie);
    return { ...rest, headers };
  };

  const request = async (path: string, init?: RequestInit & { as?: TestAuth }) =>
    app.app.request(new URL(path, BASE).toString(), withAuth(init));

  return {
    app,
    deps,
    clock,
    bus,
    pg,
    credentials,
    async fixture(opts) {
      if (!pg) throw new Error('fixture() needs createTestApp({ db: "postgres" })');
      const { fixtureWorkspace } = await import("@fairsplit/db/testing");
      return fixtureWorkspace(pg.app.db, opts);
    },
    request,
    async json<T>(path: string, init: JsonInit = {}) {
      const { body, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await request(path, {
        ...rest,
        headers,
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        // not JSON: keep the text
      }
      return { status: res.status, headers: res.headers, body: parsed as T };
    },
    client(as) {
      const headers: Record<string, string> = {};
      if (as && typeof as === "object" && "cookie" in as) headers.cookie = as.cookie;
      if (as && typeof as === "object" && "authorization" in as) headers.authorization = as.authorization;
      return createApiClient({
        baseUrl: BASE,
        fetch: async (url, init) => app.app.request(url, init),
        token: typeof as === "string" ? as : null,
        headers,
      });
    },
    async sse(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("accept", "text/event-stream");
      const response = await request(path, { ...init, headers });
      if (response.status !== 200) return { response, reader: sseReader(new Response("")) };
      return { response, reader: sseReader(response) };
    },
    async close() {
      await deps.sse.close();
      await stopOutbox?.().catch(() => undefined);
      await stopBus?.().catch(() => undefined);
      await pg?.close();
    },
  };
}
