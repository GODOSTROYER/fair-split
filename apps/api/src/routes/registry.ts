// The route registry (shell; frozen once the slices start). It mounts one router module per folder under
// src/routes, binds every IC-01 command to the folder `COMMAND_FOLDER` assigns, merges the folders' outbox
// task handlers, and runs their boot hooks. Slices change their folder's index.ts, never this file.
import { API_COMMANDS, type ApiCommandName } from "@fairsplit/contracts";
import type { TaskHandlers } from "@fairsplit/outbox";
import {
  type CommandHandler,
  isNotImplemented,
  type Mounter,
  mountCommand,
  mountRoute,
  type RouteSpec,
} from "../lib/command.js";
import {
  COMMAND_FOLDER,
  type JsonCommandName,
  ROUTE_FOLDERS,
  type RouteFolder,
  type SliceName,
} from "../lib/commands.js";
import type { AppDeps } from "../lib/context.js";
import type { FolderRouter, RouteFolderModule } from "../lib/slice.js";
import approvals from "./approvals/index.js";
import auth from "./auth/index.js";
import brand from "./brand/index.js";
import fields from "./fields/index.js";
import holds from "./holds/index.js";
import internal from "./internal/index.js";
import judge from "./judge/index.js";
import lines from "./lines/index.js";
import media from "./media/index.js";
import ops from "./ops/index.js";
import print from "./print/index.js";
import proof from "./proof/index.js";
import rateCards from "./rate-cards/index.js";
import runs from "./runs/index.js";
import season from "./season/index.js";
import slips from "./slips/index.js";
import statements from "./statements/index.js";
import wellknown from "./wellknown/index.js";

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of folder modules
export type AnyFolderModule = RouteFolderModule<any>;

/** Every route folder, in mount order (more specific paths first is not needed: commands never overlap). */
export const ROUTE_FOLDER_MODULES: readonly AnyFolderModule[] = [
  judge,
  auth,
  season,
  rateCards,
  slips,
  runs,
  holds,
  fields,
  approvals,
  lines,
  proof,
  wellknown,
  brand,
  statements,
  print,
  ops,
  media,
  internal,
];

export interface CommandStatus {
  name: ApiCommandName;
  folder: RouteFolder | "shell:sse";
  slice: SliceName | "shell";
  implemented: boolean;
}

export interface Registry {
  /** Every IC-01 command and whether its handler is filled in (SSE commands are the shell's). */
  readonly commands: readonly CommandStatus[];
  /** Extra (non-contract) routes the folders registered. */
  readonly routes: readonly RouteSpec[];
  /** Outbox task handlers from every folder; a TaskName claimed twice is a boot error. */
  taskHandlers(deps: AppDeps): TaskHandlers;
  /** Runs every folder's onBoot; failures are logged and do not stop the server. */
  onBoot(deps: AppDeps): Promise<void>;
}

export function mountRegistry(
  m: Mounter,
  modules: readonly AnyFolderModule[] = ROUTE_FOLDER_MODULES,
): Registry {
  const seen = new Set<string>();
  for (const mod of modules) {
    if (!(mod.folder in ROUTE_FOLDERS))
      throw new Error(`registry: unknown route folder ${String(mod.folder)}`);
    if (seen.has(mod.folder)) throw new Error(`registry: folder ${mod.folder} mounted twice`);
    seen.add(mod.folder);
  }
  const byFolder = new Map<string, AnyFolderModule>(modules.map((mod) => [mod.folder, mod]));
  const statuses: CommandStatus[] = [];

  for (const name of Object.keys(API_COMMANDS) as ApiCommandName[]) {
    const folder = COMMAND_FOLDER[name];
    if (folder === "shell:sse") {
      statuses.push({ name, folder, slice: "shell", implemented: true });
      continue;
    }
    const mod = byFolder.get(folder);
    if (!mod) continue; // a test mounting a subset of folders
    const handler = (mod.commands as Record<string, unknown>)[name];
    if (typeof handler !== "function") throw new Error(`registry: ${folder} does not handle ${name}`);
    mountCommand(m, name as JsonCommandName, handler as CommandHandler<JsonCommandName>);
    statuses.push({ name, folder, slice: ROUTE_FOLDERS[folder], implemented: !isNotImplemented(handler) });
  }
  for (const mod of modules) {
    for (const key of Object.keys(mod.commands)) {
      if (COMMAND_FOLDER[key as ApiCommandName] !== mod.folder) {
        throw new Error(`registry: ${mod.folder} handles ${key}, which COMMAND_FOLDER assigns elsewhere`);
      }
    }
  }

  const routes: RouteSpec[] = [];
  for (const mod of modules) {
    if (!mod.routes) continue;
    const router: FolderRouter = {
      folder: mod.folder,
      app: m.app,
      route: (def, handler) => {
        routes.push(mountRoute(m, mod.folder, def, handler));
      },
    };
    mod.routes(router);
  }

  return {
    commands: statuses,
    routes,
    taskHandlers(deps) {
      const merged: TaskHandlers = {};
      const owner = new Map<string, string>();
      for (const mod of modules) {
        const handlers = mod.tasks?.(deps) ?? {};
        for (const [task, fn] of Object.entries(handlers)) {
          if (!fn) continue;
          const prev = owner.get(task);
          if (prev) throw new Error(`registry: task ${task} is claimed by both ${prev} and ${mod.folder}`);
          owner.set(task, mod.folder);
          (merged as Record<string, unknown>)[task] = fn;
        }
      }
      return merged;
    },
    async onBoot(deps) {
      for (const mod of modules) {
        if (!mod.onBoot) continue;
        try {
          await mod.onBoot(deps);
        } catch (err) {
          deps.logger.error({ err, folder: mod.folder }, "route folder boot hook failed");
        }
      }
    },
  };
}
