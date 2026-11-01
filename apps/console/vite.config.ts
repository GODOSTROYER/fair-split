import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { type Connect, defineConfig, loadEnv, type Plugin } from "vite";
import { exhibitDefines, previewMedia } from "./scripts/exhibit-data.js";

// The console SPA (register §6). The router plugin must run before the React plugin.
//
// Data source: `vite` (dev) answers from msw over the seed snapshot unless VITE_PUBLIC_FS_DATA=http, which
// proxies /v1, /app and /media to a local fs-api (FS_API_DEV_ORIGIN, default http://127.0.0.1:8787).
// `vite build` targets the API on its own origin unless VITE_PUBLIC_FS_DATA=mock (a labelled static demo).
// Only VITE_PUBLIC_* variables reach the bundle (envPrefix), and env files are read from this folder only.

/**
 * Development stand-in for the Expo web export at /app: answers the IC-12 frame bridge, labelled. `vite dev` and
 * `vite preview` of a mock build serve it; it is never part of a build's output.
 */
function appStub(): Plugin {
  const page = readFileSync(new URL("./dev/app-stub.html", import.meta.url), "utf8");
  const serveStub = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path !== "/app" && !path.startsWith("/app/")) return next();
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(page);
    });
  };
  return {
    name: "fs-app-stub",
    apply: "serve",
    configureServer: serveStub,
    configurePreviewServer: serveStub,
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_PUBLIC_");
  const requested = env.VITE_PUBLIC_FS_DATA;
  const data =
    requested === "mock" || requested === "http" ? requested : command === "serve" ? "mock" : "http";
  const apiOrigin = process.env.FS_API_DEV_ORIGIN ?? "http://127.0.0.1:8787";
  return {
    envPrefix: "VITE_PUBLIC_",
    define: { __FS_DATA__: JSON.stringify(data), ...exhibitDefines() },
    // contracts carries its own copy of zod 4.6.7 (the root hoists zod 3 for paypal-*); one copy is enough.
    resolve: { dedupe: ["zod"] },
    // The mock's handlers come from @fairsplit/api-client's source (imports "msw") while the worker starts from
    // "msw/browser": pre-bundle both in one pass so they share one msw core (two copies never match a request).
    optimizeDeps: data === "mock" ? { include: ["msw", "msw/browser"] } : undefined,
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double", semicolons: true }),
      react(),
      tailwindcss(),
      ...(data === "mock" ? [msw({ mode: "worker-only" }), appStub(), previewMedia()] : []),
    ],
    server:
      data === "http"
        ? {
            proxy: Object.fromEntries(
              ["/v1", "/app", "/media", "/healthz", "/readyz", "/.well-known"].map((p) => [p, apiOrigin]),
            ),
          }
        : undefined,
    build: {
      target: "es2023",
      sourcemap: true,
      // scripts/budget.mjs reads it to measure S2.11's JavaScript budgets per route.
      manifest: true,
    },
  };
});
