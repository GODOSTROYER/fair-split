// Typed client configuration. Clients may read only VITE_PUBLIC_* (AGENTS.md); vite.config.ts sets
// envPrefix to VITE_PUBLIC_ so nothing else can reach the bundle.

export type DataSource = "mock" | "http";

/** PP_MODE as the console labels it (ADR-0002): a contract-faithful simulator by default. */
export type PaypalRail = "simulator" | "sandbox";

export interface ConsoleEnv {
  /** Where data comes from: msw over the seed snapshot (dev and tests), or the API on this origin. */
  readonly data: DataSource;
  /**
   * How PayPal steps are labelled until the API reports its own mode (a pending IC-08 read). Every
   * PayPal-derived value must say which rail it came from (I8).
   */
  readonly paypalRail: PaypalRail;
  /** API origin. Empty means same origin: fs-api serves the console (register §4). */
  readonly apiBase: string;
  /** Where the Expo web export is served (C-11). */
  readonly appBase: string;
}

type RawEnv = Readonly<Record<string, unknown>>;

/** The data source this build was made for (`__FS_DATA__`, set by vite.config.ts and vitest.config.ts). */
export const BUILD_DATA: DataSource = typeof __FS_DATA__ === "string" ? __FS_DATA__ : "http";

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function cleanBase(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** Reads the build's public env. The data source is fixed at build time (BUILD_DATA). */
export function readEnv(
  raw: RawEnv = import.meta.env as unknown as RawEnv,
  data: DataSource = BUILD_DATA,
): ConsoleEnv {
  return {
    data,
    paypalRail: pick(raw.VITE_PUBLIC_FS_PAYPAL_RAIL, ["simulator", "sandbox"] as const, "simulator"),
    apiBase: cleanBase(raw.VITE_PUBLIC_FS_API_BASE),
    appBase: "/app",
  };
}

export const env: ConsoleEnv = readEnv();
