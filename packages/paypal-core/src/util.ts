// Small internal helpers shared by auth, http and the webhook verifier. Not exported from the package.

import { isPayPalHost } from "./env.js";
import { PayPalConfigError } from "./errors.js";

/** True when `fetch` rejected because an `AbortSignal.timeout()` fired. */
export function isTimeoutError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  if (name === "TimeoutError") return true;
  const cause = (err as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null && (cause as { name?: unknown }).name === "TimeoutError";
}

/** Parse JSON without throwing: returns `undefined` for empty or non-JSON text. */
export function parseJsonLoose(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Validate a PayPal API base URL: https, on a paypal.com host, no path. Returns the origin. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PayPalConfigError("INVALID_VALUE", "PayPal base URL is not a valid URL");
  }
  if (url.protocol !== "https:" || !isPayPalHost(url.hostname) || url.username || url.password) {
    throw new PayPalConfigError("INVALID_HOST", "PayPal base URL must be https on a paypal.com host");
  }
  return url.origin;
}

/** `Retry-After` as milliseconds (delta-seconds or HTTP-date), or null. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Clip a string for log fields and error messages. */
export function clip(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
