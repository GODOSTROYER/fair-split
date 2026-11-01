// Keep Vitest startup invalidation inside this package when Turbo runs packages in parallel.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { fsModuleCachePath: "./node_modules/.vitest-cache" } });
