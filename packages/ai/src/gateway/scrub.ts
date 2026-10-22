import type { Recording } from "./types.js";

/**
 * Recorded fixtures are scrubbed before they are stored (AGENTS.md): secrets → REDACTED, emails →
 * an alias, thinking signatures (opaque, account-bound, never needed to replay a read) → REDACTED.
 * The scrub is a pure function over JSON, so a scrubbed recording replays exactly as before.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[a-z]{2,6}\d{0,2}-[A-Za-z0-9_-]{20,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /AQ\.[A-Za-z0-9_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /\bA21AA[A-Za-z0-9_-]{20,}/g,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubString(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "REDACTED");
  return out.replace(EMAIL, "redacted@example.invalid");
}

function scrubValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    if (key === "signature" || key === "data" || key === "encrypted_content") return "REDACTED";
    return scrubString(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, null));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, k)]));
  }
  return value;
}

export function scrubRecording(rec: Recording): Recording {
  return scrubValue(rec, null) as Recording;
}
