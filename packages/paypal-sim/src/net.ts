// Address and URL policy: loopback detection, the client address the throttle keys on, and the webhook
// target policy that keeps the simulator from POSTing anywhere it was not told to (SSRF).

/** Lower-cases an address and strips IPv6 brackets, a zone id and the IPv4-mapped prefix. */
export function normalizeIp(addr: string): string {
  let a = addr.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = mappedIpv4(a);
  return mapped ?? a;
}

/** `::ffff:127.0.0.1` (Node's spelling) or `::ffff:7f00:1` (the URL parser's) → `127.0.0.1`. */
function mappedIpv4(a: string): string | null {
  if (!a.startsWith("::ffff:")) return null;
  const rest = a.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!m) return null;
  const hi = Number.parseInt(m[1] as string, 16);
  const lo = Number.parseInt(m[2] as string, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** 127.0.0.0/8, ::1 and their IPv4-mapped forms. */
export function isLoopbackIp(addr: string): boolean {
  const a = normalizeIp(addr);
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** A URL hostname that names this machine: `localhost`, `*.localhost` or a loopback IP literal. */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || isLoopbackIp(h);
}

/** Where webhook deliveries (and simulate-event mocks) may go. */
export interface WebhookTargetPolicy {
  /** Exact origins (`scheme://host[:port]`), always including the origin of publicBaseUrl. */
  readonly origins: ReadonlySet<string>;
  /** Dev only: any loopback host, on any port. */
  readonly allowLoopback: boolean;
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; description: string };

/**
 * Decides whether the simulator may POST to `value`. PayPal itself accepts any public https listener; the
 * simulator is stricter on purpose: it delivers only to origins it was configured with (its own host app's
 * `/webhooks/paypal` by default), so a caller holding the public simulator credentials cannot make it
 * POST to internal addresses. Like PayPal it refuses plain http, except for loopback hosts in local dev.
 */
export function checkWebhookTarget(policy: WebhookTargetPolicy, value: unknown): TargetCheck {
  if (typeof value !== "string") return { ok: false, description: "The webhook URL must be a string." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, description: "The webhook URL must be an absolute https URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, description: "The webhook URL must be an absolute https URL." };
  if (url.username !== "" || url.password !== "")
    return { ok: false, description: "The webhook URL must not carry credentials." };
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol === "http:" && !loopback)
    return {
      ok: false,
      description:
        "PayPal delivers webhooks over https only; http is accepted for loopback hosts in local development.",
    };
  if (policy.origins.has(url.origin) || (policy.allowLoopback && loopback)) return { ok: true, url };
  return {
    ok: false,
    description: `The simulator delivers webhooks only to ${[...policy.origins].join(", ")} (its host app; add more with SIM_WEBHOOK_ORIGINS). ${url.origin} is not on that list.`,
  };
}
