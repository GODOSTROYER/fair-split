// What the console build fs-api serves can do, read from the build itself: Vite's manifest (`.vite/manifest.json`,
// which the console's vite.config.ts writes) names every route module the build holds. Main's console before M3
// (ws/console) holds only /prototype and writes no manifest, so the Judge stage's specs are fixme there, and they run
// as soon as the served build has the route. A hosted origin (E2E_BASE_URL set by hand) is taken to have them all.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The route module a stage URL needs, as the manifest names it. */
export const ROUTES = {
  judge: "src/routes/_stage/judge.tsx",
  proof: "src/routes/proof/$runSlug.tsx",
} as const;

export function consoleHas(route: keyof typeof ROUTES): boolean {
  const dir = process.env.E2E_STACK_CONSOLE_DIR;
  if (!dir) return true;
  const manifest = path.join(dir, ".vite", "manifest.json");
  if (!existsSync(manifest)) return false;
  // the router plugin splits each route (`…/judge.tsx?tsr-split=component`)
  const modules = Object.keys(JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>);
  return modules.some((m) => m.split("?")[0] === ROUTES[route]);
}

/** The reason a stage spec is fixme while the served console has no such route. */
export function missingRoute(route: keyof typeof ROUTES): string {
  return `M3: the console build fs-api serves (${process.env.E2E_STACK_CONSOLE_DIR ?? "?"}) has no ${ROUTES[route]}; main's console holds only /prototype until ws/console merges (or set E2E_CONSOLE_DIR to a ws/console build)`;
}
