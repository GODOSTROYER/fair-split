// Fixture scrubber: tokens become REDACTED and email addresses become stable sandbox aliases.
// Every recorded PayPal or Claude exchange passes through `scrub` before it is written, and
// `assertScrubbed` re-checks committed fixtures in CI (architecture section 17).
import { createHash } from "node:crypto";

export const REDACTED = "REDACTED";
/** Aliases live under a reserved TLD (RFC 2606), so they can never reach a real inbox. */
export const ALIAS_DOMAIN = "sandbox.fairsplit.invalid";

/** Object keys whose string values are always secret, whatever they look like. */
const SECRET_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|anthropic-api-key|x-goog-api-key|paypal-auth-assertion|paypal-transmission-sig|paypal-cert-url)$|(^|[_-])(access|refresh|id|bearer|nonce|session|frame|pairing|push)?[_-]?token$|secret|password|passwd|api[_-]?key|client[_-]?secret|private[_-]?key/i;

/** Secret-looking substrings, replaced wherever they appear in a string. */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`],
  [/\bA21AA[A-Za-z0-9_-]{20,}/g, REDACTED], // PayPal access token
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED], // Anthropic key
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED], // Google API key
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED], // JWT
  [/("?access_token"?\s*[:=]\s*"?)(?!REDACTED)[A-Za-z0-9._~+/=-]{8,}/g, `$1${REDACTED}`],
];

const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export interface ScrubOptions {
  /** Known addresses mapped to readable aliases, e.g. a member's sandbox account → `m-014@…`. */
  emailAliases?: Readonly<Record<string, string>>;
}

const isAlias = (email: string) => email.toLowerCase().endsWith(".invalid");

/** A stable alias for an address: the same input always gives the same alias. */
export function emailAlias(email: string, options: ScrubOptions = {}): string {
  const plain = email.replace(/%40/gi, "@");
  const lower = plain.toLowerCase();
  for (const [real, alias] of Object.entries(options.emailAliases ?? {})) {
    if (real.toLowerCase() !== lower) continue;
    if (!isAlias(alias)) throw new Error(`Email alias "${alias}" must use a reserved .invalid domain`);
    return alias;
  }
  if (isAlias(plain)) return plain;
  const digest = createHash("sha256").update(lower).digest("hex").slice(0, 8);
  return `sb-${digest}@${ALIAS_DOMAIN}`;
}

export function scrubString(text: string, options: ScrubOptions = {}): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.replace(EMAIL, (m) => emailAlias(m, options));
}

/** Returns a deep copy of `value` with secrets redacted and emails aliased. Idempotent. */
export function scrub<T>(value: T, options: ScrubOptions = {}): T {
  return walk(value, undefined, options) as T;
}

function walk(value: unknown, key: string | undefined, options: ScrubOptions): unknown {
  if (typeof value === "string") {
    if (key !== undefined && SECRET_KEY.test(key) && value !== "") {
      // Keep the auth scheme so tests can still assert on it.
      const scheme = /^(Bearer|Basic)\s/i.exec(value)?.[1];
      return scheme ? `${scheme} ${REDACTED}` : REDACTED;
    }
    return scrubString(value, options);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, key, options));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, k, options);
    return out;
  }
  return value;
}

export interface ScrubFinding {
  path: string;
  reason: string;
}

/** Lists every place in `value` that still holds a secret or a non-alias email. */
export function findUnscrubbed(value: unknown, path = "$"): ScrubFinding[] {
  const findings: ScrubFinding[] = [];
  const visit = (v: unknown, p: string, key: string | undefined) => {
    if (typeof v === "string") {
      if (key !== undefined && SECRET_KEY.test(key) && v !== "" && !v.endsWith(REDACTED)) {
        findings.push({ path: p, reason: `secret key "${key}" is not ${REDACTED}` });
      }
      for (const [pattern, replacement] of SECRET_PATTERNS) {
        if (v.replace(pattern, replacement) !== v)
          findings.push({ path: p, reason: `matches ${pattern.source}` });
      }
      for (const m of v.match(EMAIL) ?? []) {
        if (!isAlias(m.replace(/%40/gi, "@")))
          findings.push({ path: p, reason: "contains a non-alias email" });
      }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => {
        visit(x, `${p}[${i}]`, key);
      });
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) visit(x, `${p}.${k}`, k);
    }
  };
  visit(value, path, undefined);
  return findings;
}

export class UnscrubbedFixtureError extends Error {
  constructor(
    readonly source: string,
    readonly findings: ScrubFinding[],
  ) {
    super(`${source} is not scrubbed:\n${findings.map((f) => `  ${f.path}: ${f.reason}`).join("\n")}`);
    this.name = "UnscrubbedFixtureError";
  }
}

export function assertScrubbed(value: unknown, source = "fixture"): void {
  const findings = findUnscrubbed(value);
  if (findings.length > 0) throw new UnscrubbedFixtureError(source, findings);
}
