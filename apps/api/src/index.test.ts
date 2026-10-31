// The entry Render starts (`node apps/api/dist/index.js`, here src/index.ts through tsx). On Render fs-api gets
// only the owner's DATABASE_OWNER_URL and FS_APP_DB_PASSWORD (render.yaml, ADR-0005): the entry builds fs_app's
// DATABASE_URL from them before the boot checks, and refuses by name, never by value, when it cannot.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Assembled at runtime, so no credential-bearing URL sits in the source for the secret guards. Port 9 refuses.
const OWNER_PASSWORD = ["owner", "password", "not", "real"].join("-");
const ownerUrl = () => {
  const u = new URL("postgresql://127.0.0.1:9/fairsplit");
  u.username = "fairsplit";
  u.password = OWNER_PASSWORD;
  return u.toString();
};
/** Each case boots the entry through tsx (a cold transform of the whole server), which is slow on a busy machine. */
const BOOT_TIMEOUT_MS = 120_000;
const APP_PASSWORD = ["app", "password", "not", "real", "0123"].join("-");

function boot(env: Record<string, string>): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: API_ROOT,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      LOG_LEVEL: "info",
      HOST: "127.0.0.1",
      PORT: "0",
      ...env,
    },
    encoding: "utf8",
    timeout: 110_000,
    windowsHide: true,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** What render.yaml gives fs-api besides the database: its plain values and the secrets. */
const RENDER_ENV = {
  RENDER: "true",
  RENDER_EXTERNAL_URL: "https://fs-api.onrender.com",
  PP_ENV: "sandbox",
  PP_MODE: "simulator",
  EXECUTOR: "inline",
};

describe("fs-api entry on Render: fs_app's DATABASE_URL is built at boot (ADR-0005)", () => {
  it(
    "refuses, naming FS_APP_DB_PASSWORD and never the owner's URL, when only the owner URL is set",
    () => {
      const r = boot({ ...RENDER_ENV, DATABASE_OWNER_URL: ownerUrl() });
      expect(r.status).toBe(1);
      expect(r.output).toContain("fs-api refuses to boot");
      expect(r.output).toContain("FS_APP_DB_PASSWORD");
      expect(r.output).not.toContain(OWNER_PASSWORD);
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    "with DATABASE_OWNER_URL and FS_APP_DB_PASSWORD, DATABASE_URL is no longer missing",
    () => {
      const r = boot({ ...RENDER_ENV, DATABASE_OWNER_URL: ownerUrl(), FS_APP_DB_PASSWORD: APP_PASSWORD });
      expect(r.status).toBe(1);
      expect(r.output).toContain("FS_COOKIE_SECRET is required in production");
      expect(r.output).not.toContain("DATABASE_URL is required in production");
      expect(r.output).not.toContain(OWNER_PASSWORD);
      expect(r.output).not.toContain(APP_PASSWORD);
    },
    BOOT_TIMEOUT_MS,
  );
});
