// Builds the web export that fs-api serves at /app (register C-11; S3 "Expo and EAS").
// A Node wrapper instead of `EXPO_WEB_BASE=/app expo export …` keeps it cross-platform: cmd.exe has no inline env,
// and Git Bash would rewrite "/app" into a Windows path.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("expo/bin/cli");
const env = {
  ...process.env,
  EXPO_WEB_BASE: process.env.EXPO_WEB_BASE || "/app",
  EXPO_PUBLIC_API_ORIGIN: "same-origin",
};

const result = spawnSync(
  process.execPath,
  [cli, "export", "--platform", "web", "--output-dir", "dist", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
process.exit(result.status ?? 1);
