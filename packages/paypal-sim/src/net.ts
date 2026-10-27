// Address and URL policy: loopback detection and the webhook target policy that keeps the simulator from
// POSTing anywhere it was not told to (SSRF), or to itself (its own admin API and pages).

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

/**
 * A server as a URL reaches it: `host:port` (port made explicit, IPv6 brackets and IPv4-mapped forms
 * normalised), and the port again when the host is loopback, because then every loopback name reaches it.
 */
export interface ServerRef {
  readonly hostPort: string;
  readonly loopbackPort: number | null;
}

function effectivePort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export function serverRef(url: URL): ServerRef {
  const port = effectivePort(url);
  const host = normalizeIp(url.hostname).replace(/\.$/, "");
  return { hostPort: `${host}:${port}`, loopbackPort: isLoopbackHostname(url.hostname) ? port : null };
}

function reaches(url: URL, server: ServerRef): boolean {
  const ref = serverRef(url);
  return (
    ref.hostPort === server.hostPort ||
    (server.loopbackPort !== null && ref.loopbackPort === server.loopbackPort)
  );
}

/**
 * The path a router may end up matching: percent-decoded until stable (Hono decodes once, around any stray
 * `%`; a proxy in front may decode again), backslashes read as slashes, dot segments resolved, empty segments
 * dropped, lower-cased. Only ASCII escapes are decoded: the characters that spell a route (letters, `/`, `.`)
 * are ASCII, and a UTF-8 decoder never turns a multi-byte escape into one. Only used to refuse, so reading
 * too much into a path can only refuse more.
 */
export function routedPath(pathname: string): string {
  let p = pathname;
  for (let i = 0; i < 8; i++) {
    const next = p.replace(/%([0-7][0-9a-f])/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === p) break;
    p = next;
  }
  const segments: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  return `/${segments.join("/")}`.toLowerCase();
}

/** Where webhook deliveries (and simulate-event mocks) may go. */
export interface WebhookTargetPolicy {
  /**
   * Exact origins (`scheme://host[:port]`): publicBaseUrl's (the host app, whose `/webhooks/paypal` receives
   * them) unless the simulator serves that origin itself, plus SIM_WEBHOOK_ORIGINS.
   */
  readonly origins: ReadonlySet<string>;
  /** Dev only: any loopback host, on any port. */
  readonly allowLoopback: boolean;
  /**
   * Servers the simulator answers in full (the standalone server: its address and publicBaseUrl). Never a
   * target, whatever `origins` or `allowLoopback` say: a delivery there would run the simulator's own routes.
   */
  readonly selfServers?: readonly ServerRef[];
  /** The host app that mounts the simulator's pages, and their path prefixes there (`/paypal-sim/sim`, `/sim`). */
  readonly selfPages?: { readonly server: ServerRef; readonly prefixes: readonly string[] };
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; description: string };

/**
 * Decides whether the simulator may POST to `value`. PayPal itself accepts any public https listener; the
 * simulator is stricter on purpose: it delivers only to origins it was configured with (its own host app's
 * `/webhooks/paypal` by default), so a caller holding the public simulator credentials cannot make it
 * POST to internal addresses. Like PayPal it refuses plain http, except for loopback hosts in local dev.
 * It never delivers to itself: not to a server it answers in full, and not to its own /sim pages on the host
 * app (decoded, case-folded), so a webhook can never be aimed at /sim/admin or the pay page.
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
  if ((policy.selfServers ?? []).some((server) => reaches(url, server)))
    return { ok: false, description: "The simulator never delivers webhooks to itself." };
  const pages = policy.selfPages;
  if (pages && reaches(url, pages.server)) {
    const path = routedPath(url.pathname);
    if (pages.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
      return { ok: false, description: "The simulator never delivers webhooks to its own /sim pages." };
  }
  if (policy.origins.has(url.origin) || (policy.allowLoopback && loopback)) return { ok: true, url };
  const allowed = [...policy.origins];
  return {
    ok: false,
    description:
      allowed.length > 0
        ? `The simulator delivers webhooks only to ${allowed.join(", ")} (its host app; add more with SIM_WEBHOOK_ORIGINS). ${url.origin} is not on that list.`
        : `The simulator delivers webhooks only to origins added with SIM_WEBHOOK_ORIGINS (--webhook-origin), and none is. ${url.origin} is not on that list.`,
  };
}
