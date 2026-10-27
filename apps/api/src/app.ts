// The fs-api app factory: one Hono app (with @hono/zod-openapi's registry) wired in a fixed order.
//
//   request context (id, logger, deps) → security headers → errors → /healthz, /readyz → /openapi.json, /docs
//   → /webhooks/paypal (WS-PPCORE's route) → SSE (/v1/runs|workspaces|lines/…/events) → every route folder
//   (IC-01 commands, 501 until a slice fills them in, plus the folders' extra routes) → static (/media, /app, console)
//
// `createApp` takes fully built deps, so the server (src/server.ts) and the test harness (src/test) build
// the same app; nothing here reads process.env or opens a connection.
import { OpenAPIHono } from "@hono/zod-openapi";
import { type HealthProbes, mountHealth } from "./health.js";
import type { Mounter } from "./lib/command.js";
import type { AppDeps, AppEnv } from "./lib/context.js";
import { onError, onNotFound } from "./middleware/errors.js";
import { requestContext } from "./middleware/request.js";
import { securityHeaders } from "./middleware/security.js";
import { buildOpenApiDocument, DOCS_CSP, docsHtml, SchemaCatalog } from "./openapi.js";
import { createWebhookHandler, mountPayPalWebhooks } from "./paypal/webhooks.js";
import {
  type AnyFolderModule,
  mountRegistry,
  type Registry,
  ROUTE_FOLDER_MODULES,
} from "./routes/registry.js";
import { mountSseRoutes } from "./sse/routes.js";
import { mountStatic, type StaticDirs, staticDirs } from "./static.js";
import type { PayPalWebhookHandler } from "./webhooks/paypal.js";

export const API_VERSION = "0.1.0";

export interface CreateAppOptions {
  deps: AppDeps;
  health: HealthProbes;
  /** Route folders to mount (default: all 17). Tests may mount a subset or a stand-in folder. */
  folders?: readonly AnyFolderModule[];
  /** The webhook route's handler (default: WS-PPCORE's handler over this app's database and rail). */
  webhookHandler?: PayPalWebhookHandler;
  /** Static directories, or false to serve no pages (API-only tests). */
  static?: StaticDirs | false;
}

export interface FairSplitApp {
  readonly app: OpenAPIHono<AppEnv>;
  readonly registry: Registry;
  /** The OpenAPI 3.1 document (generated once, after every route is mounted). */
  openapi(): ReturnType<typeof buildOpenApiDocument>;
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

export function createApp(o: CreateAppOptions): FairSplitApp {
  const { deps } = o;
  const app = new OpenAPIHono<AppEnv>();
  const catalog = new SchemaCatalog();
  const m: Mounter = { app, catalog };

  app.use("*", requestContext(deps));
  app.use("*", securityHeaders({ publicOrigin: deps.env.publicOrigin, railLabel: deps.paypal.label }));
  app.onError(onError);
  app.notFound(onNotFound);

  mountHealth(app, o.health);

  let doc: ReturnType<typeof buildOpenApiDocument> | null = null;
  const openapi = () => {
    doc ??= buildOpenApiDocument(app, catalog, {
      version: API_VERSION,
      publicOrigin: deps.env.publicOrigin,
      railLabel: deps.paypal.label,
    });
    return doc;
  };
  for (const p of ["/openapi.json", "/v1/openapi.json"]) {
    app.get(p, (c) => {
      c.header("Cache-Control", "no-cache");
      return c.json(openapi());
    });
  }
  for (const p of ["/docs", "/v1/docs"]) {
    app.get(p, (c) => {
      c.header("Content-Security-Policy", DOCS_CSP);
      c.header("Cache-Control", "no-cache");
      return c.html(docsHtml(openapi()));
    });
  }

  mountPayPalWebhooks(
    app,
    o.webhookHandler ?? createWebhookHandler({ db: deps.db, rail: deps.paypal, logger: deps.logger }),
  );
  mountSseRoutes(m);
  const registry = mountRegistry(m, o.folders ?? ROUTE_FOLDER_MODULES);

  const dirs = o.static === undefined ? staticDirs(deps.env.static) : o.static;
  if (dirs) mountStatic(app, dirs);

  return { app, registry, openapi, fetch: (req) => app.fetch(req) };
}
