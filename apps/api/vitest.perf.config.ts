import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

export default mergeConfig(base, defineConfig({ test: { env: { FS_WEBHOOK_PERF: "1" } } }));
