// A route folder module: what each folder under src/routes exports as its default. The registry mounts every
// folder, so a slice fills in handlers here and never touches the registry, package.json or the lockfile.
//
//   export default defineRouteFolder({
//     folder: "holds",
//     commands: { resolveHold: async ({ input, scope, deps }) => { …; return body } },   // exactly this folder's commands
//     routes: (r) => { r.route({ method: "GET", path: "/v1/runs/:runSlug/holds", auth: "frame_or_session", … }, handler) },
//     tasks: (deps) => ({ … }),   // outbox task handlers this folder owns
//     onBoot: async (deps) => { … },
//   });
import type { TaskHandlers } from "@fairsplit/outbox";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { z } from "zod";
import type { AuthClass, CommandHandler, RouteDef, RouteHandler } from "./command.js";
import type { CommandsOf, JsonCommandName, RouteFolder } from "./commands.js";
import type { AppDeps, AppEnv } from "./context.js";

export interface FolderRouter {
  readonly folder: RouteFolder;
  /** A JSON route with the shell's credential policy, validation, idempotency, error mapping and OpenAPI docs. */
  route<
    P extends string,
    A extends AuthClass,
    Req extends z.ZodType | undefined,
    Res extends z.ZodType | undefined,
  >(def: RouteDef<P, A, Req, Res>, handler: RouteHandler<P, A, Req, Res>): void;
  /**
   * Raw Hono for what is not JSON (302 redirects, HTML, SSE through `deps.sse`). Use the shell helpers
   * (`requireActing`, `requireCredential`, `sendProblem`) so auth and errors stay uniform.
   */
  readonly app: OpenAPIHono<AppEnv>;
}

export type FolderCommands<F extends RouteFolder> = {
  readonly [N in Extract<CommandsOf<F>, JsonCommandName>]: CommandHandler<N>;
};

export interface RouteFolderModule<F extends RouteFolder> {
  readonly folder: F;
  /** Exactly the IC-01 commands `COMMAND_FOLDER` assigns to this folder (a missing or extra key is a type error). */
  readonly commands: FolderCommands<F>;
  /** Extra routes (non-contract reads, redirects, ops pages). Mounted before the static fallback. */
  readonly routes?: (r: FolderRouter) => void;
  /** Outbox task handlers this folder implements; each TaskName may be claimed by one folder only. */
  readonly tasks?: (deps: AppDeps) => TaskHandlers;
  /** Runs once after boot (pool refills, key publication, cache warming). Failures are logged, not fatal. */
  readonly onBoot?: (deps: AppDeps) => Promise<void>;
}

export function defineRouteFolder<F extends RouteFolder>(m: RouteFolderModule<F>): RouteFolderModule<F> {
  return m;
}
