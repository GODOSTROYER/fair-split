/**
 * OD-2 (S1.6, design §8): every Cebuano and Filipino surface shows "Machine-translated, pending native review", on
 * camera too. The chrome draws it: `<Screen>` puts `<SurfaceLabels>` (the demo label and the review chip) at the top
 * of every screen, and the one register §4 surface that is not a `<Screen>`, the Paminawa sheet, draws the same
 * labels itself. This walks every route file under src/app to the component that draws its root, so no slice can
 * add a surface that skips them. `scripts/smoke-web.mjs` checks the same in the browser, in ceb and fil.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCREEN } from "../_shims/contracts";

const src = fileURLToPath(new URL("../", import.meta.url));
const read = (file: string) => readFileSync(join(src, file), "utf8");

/** Every app route (register §4, with its web entry points) and the file whose component draws its root. */
const SURFACES: Readonly<Record<string, string>> = {
  "onboarding/language.tsx": "features/onboarding/language-screen.tsx",
  "onboarding/theme.tsx": "features/onboarding/theme-screen.tsx",
  "onboarding/pair.tsx": "features/onboarding/pair-screen.tsx",
  "pair.tsx": "features/onboarding/pair-screen.tsx",
  "(member)/(tabs)/bayad.tsx": "features/statement/bayad-screen.tsx",
  "(member)/(tabs)/resibo.tsx": "features/statement/resibo-screen.tsx",
  "(member)/(tabs)/pangutana.tsx": "features/statement/pangutana-screen.tsx",
  "(member)/paminawa.tsx": "features/statement/paminawa-panel.tsx",
  "s/[token].tsx": "features/statement/member-link-screen.tsx",
  "(clerk)/scan.tsx": "features/clerk/scan-screen.tsx",
  "(clerk)/outbox.tsx": "features/clerk/outbox-screen.tsx",
  "(board)/pirma/index.tsx": "features/board/pirma-index.tsx",
  "(board)/pirma/[runSlug]/index.tsx": "features/board/cosign-screen.tsx",
  "(board)/pirma/[runSlug]/sign.tsx": "features/board/sign-screen.tsx",
  "(board)/bayad.tsx": "features/statement/board-bayad-screen.tsx",
  "(board)/pangutana.tsx": "features/statement/pangutana-screen.tsx",
};

function routeFiles(dir = join(src, "app")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(path);
    return e.name.endsWith(".tsx") ? [relative(join(src, "app"), path).replaceAll("\\", "/")] : [];
  });
}

/** The feature files a route file imports (a route re-exports a screen, or renders one). */
function featureImports(route: string): string[] {
  const text = read(join("app", route));
  return [...text.matchAll(/from "([^"]*features\/[^"]+)"/g)].map((m) =>
    relative(src, resolve(dirname(join(src, "app", route)), `${m[1]}.tsx`)).replaceAll("\\", "/"),
  );
}

describe("the review chip is on every surface (OD-2)", () => {
  it("knows where every route draws its root; a new route must be added here", () => {
    const surfaces = routeFiles().filter((f) => !f.endsWith("_layout.tsx") && f !== "index.tsx");
    expect(surfaces.sort()).toEqual(Object.keys(SURFACES).sort());
    for (const [route, file] of Object.entries(SURFACES)) {
      const imported = featureImports(route);
      const name = file.split("/").pop()?.replace(".tsx", "") ?? "";
      // The route renders the mapped component, or a screen that hands its root to it (Paminawa's panel).
      const via = imported.includes(file) || imported.some((f) => read(f).includes(`"./${name}"`));
      expect(via, `${route} → ${file}`).toBe(true);
    }
  });

  it("draws every root inside the chrome, or with the chrome's labels where the surface is a sheet", () => {
    for (const [route, file] of Object.entries(SURFACES)) {
      const text = read(file);
      expect(/<Screen\b/.test(text) || /<SurfaceLabels\b/.test(text), `${route}: ${file}`).toBe(true);
    }
    // Paminawa is the sheet: its root is the register's M-MB-03 and it carries the labels with that ID.
    expect(read("features/statement/paminawa-panel.tsx")).toMatch(
      new RegExp(`<SurfaceLabels screen="${SCREEN.paminawa}"`),
    );
  });

  it("the chrome puts the labels at the top of every screen, scrolling or not", () => {
    const chrome = read("ui/chrome.tsx");
    const screen = chrome.slice(chrome.indexOf("export function Screen"));
    expect(screen.match(/<SurfaceLabels screen=\{testID\} \/>/g)?.length).toBe(2);
    // One chip per surface: the member's language bar no longer draws a second one.
    expect(read("features/statement/parts.tsx")).not.toMatch(/machineTranslated|MachineChip/);
  });
});
