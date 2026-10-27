// Console entry: one Vite SPA served from the API's origin (register §4). It builds the data runtime (the
// HTTP adapter over API_COMMANDS; in a mock build, a mock world over the seed snapshot answers it through
// msw, or in memory where a service worker cannot run), the router, and the providers every surface shares.
// WS-DS's /prototype keeps working under the same root.

import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders, motionFromLocation } from "./chrome/AppProviders.js";
import type { DataAdapter } from "./data/adapter.js";
import { createHttpAdapter } from "./data/http.js";
import { createDataRuntime } from "./data/provider.js";
import { loadSnapshot } from "./data/snapshot.js";
import { env } from "./lib/env.js";
import { createConsoleRouter } from "./router.js";
import { installSound } from "./sound/sound.js";
import "./styles.css";
import "./theme/console.css";

async function createAdapter(): Promise<DataAdapter> {
  // `__FS_DATA__` is a literal after the build's define, so an API build drops msw and the mock entirely.
  if (__FS_DATA__ === "mock") {
    const { startMockData } = await import("./data/mock/browser.js");
    return (await startMockData(await loadSnapshot(), env.apiBase)).adapter;
  }
  return createHttpAdapter({ baseUrl: env.apiBase, snapshot: loadSnapshot, paypalRail: env.paypalRail });
}

/** If the console cannot start at all, say so in plain HTML instead of leaving a blank page. */
function renderBootFailure(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const main = document.createElement("main");
  main.className = "fsc-fallback";
  main.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.className = "fs-t-title-1";
  title.textContent = "The console didn't start.";
  const detail = document.createElement("p");
  detail.className = "fsc-fallback__lede";
  detail.textContent = `${message} Reload the page to try again.`;
  main.append(title, detail);
  root.replaceChildren(main);
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("index.html is missing #root");
  try {
    const runtime = createDataRuntime(await createAdapter());
    const router = createConsoleRouter(runtime);
    installSound();
    createRoot(root).render(
      <StrictMode>
        <AppProviders runtime={runtime} motion={motionFromLocation()}>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );
  } catch (error) {
    console.error(error);
    renderBootFailure(root, error);
  }
}

void boot();
