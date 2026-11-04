// One judge's browser, as far as fs-api can tell: its own cookie jar (no cookie is ever shared between judges) and
// its own source address on the loopback network (127.0.0.0/8 is all loopback on Linux), so per-IP throttles see
// separate judges the way a hosted demo sees judges on separate networks. A judge built with `localAddress` unset
// shares the host's address with every other judge, as judges behind one NAT would.
//
// node:http, not fetch: the built-in fetch cannot bind a source address without an extra dependency. Every request
// is recorded (endpoint name, status, latency, X-FS-Rail), and nothing here prints a token, a cookie or a key.
import { Agent, type IncomingMessage, request } from "node:http";

export interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: unknown;
  text: string;
}

export interface Exchange {
  /** A stable endpoint name ("press", "run", "approvals"…), never the URL with its slugs. */
  name: string;
  status: number;
  ms: number;
  rail: string | null;
  /** The problem code of a 4xx/5xx answer (RATE_LIMITED, QUEUED…), when it has one. */
  code: string | null;
  at: number;
}

export type Hdrs = Record<string, string>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClientOptions {
  origin: string;
  /** Source address for every socket (a loopback alias); unset = the host's default. */
  localAddress?: string | undefined;
  /** Per-request timeout. */
  timeoutMs?: number;
}

export class JudgeClient {
  readonly origin: URL;
  readonly localAddress: string | undefined;
  readonly exchanges: Exchange[] = [];
  private readonly jar = new Map<string, string>();
  private readonly agent: Agent;
  private readonly timeoutMs: number;

  constructor(o: ClientOptions) {
    this.origin = new URL(o.origin);
    this.localAddress = o.localAddress;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.agent = new Agent({ keepAlive: true, maxSockets: 6 });
  }

  /** The cookie header this judge's browser would send ("" before the first Set-Cookie). */
  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  private keep(res: IncomingMessage): void {
    const set = res.headers["set-cookie"];
    for (const line of set ?? []) {
      const [pair] = line.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq <= 0) continue;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(line) || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }

  private headersFor(extra: Hdrs | undefined, body: boolean): Hdrs {
    const cookie = this.cookieHeader();
    return {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(extra ?? {}),
    };
  }

  call(name: string, method: string, path: string, init: { body?: unknown; headers?: Hdrs } = {}) {
    const started = Date.now();
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    return new Promise<Answer>((resolve) => {
      const done = (a: Answer) => {
        const b = a.json as { code?: unknown } | null;
        const header = a.headers["x-fs-rail"];
        this.exchanges.push({
          name,
          status: a.status,
          ms: Date.now() - started,
          rail: typeof header === "string" ? header : null,
          code: a.status >= 400 && typeof b?.code === "string" ? b.code : null,
          at: started,
        });
        resolve(a);
      };
      const req = request(
        {
          protocol: this.origin.protocol,
          hostname: this.origin.hostname,
          port: this.origin.port,
          path,
          method,
          agent: this.agent,
          headers: this.headersFor(init.headers, payload !== undefined),
          ...(this.localAddress ? { localAddress: this.localAddress } : {}),
          timeout: this.timeoutMs,
        },
        (res) => {
          this.keep(res);
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", () => done({ status: -1, headers: {}, json: null, text: "response error" }));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = null;
            try {
              json = text === "" ? null : JSON.parse(text);
            } catch {
              json = null;
            }
            done({ status: res.statusCode ?? 0, headers: res.headers, json, text });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e) => done({ status: -1, headers: {}, json: null, text: e.message }));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  get(name: string, path: string, headers?: Hdrs) {
    return this.call(name, "GET", path, headers ? { headers } : {});
  }

  post(name: string, path: string, body: unknown, headers?: Hdrs) {
    return this.call(name, "POST", path, { body, ...(headers ? { headers } : {}) });
  }

  /** Opens an SSE stream on this judge's sockets (its own source address and cookies). */
  stream(path: string, headers: Hdrs): EventStream {
    return openStream(this, path, headers);
  }

  close(): void {
    this.agent.destroy();
  }

  /** @internal for openStream */
  rawRequest(path: string, headers: Hdrs, onResponse: (res: IncomingMessage) => void) {
    const req = request({
      protocol: this.origin.protocol,
      hostname: this.origin.hostname,
      port: this.origin.port,
      path,
      method: "GET",
      headers: this.headersFor(headers, false),
      ...(this.localAddress ? { localAddress: this.localAddress } : {}),
    });
    req.on("response", onResponse);
    return req;
  }
}

export interface StreamEvent {
  id: string;
  type: string;
  provenance: string;
  /** The server's write time of the event (`at`, clock_timestamp() at insert), ms since the epoch. */
  at: number;
  payload: Record<string, unknown>;
  /** This client's clock when the event's data line arrived, ms since the epoch. */
  arrivedAt: number;
  /** True when the event came from the Last-Event-ID replay rather than live fan-out. */
  replayed: boolean;
}

export interface EventStream {
  readonly events: StreamEvent[];
  /** Answers other than 200 when (re)opening the stream (a 429 is the hub's per-credential or per-instance cap). */
  readonly refusals: number[];
  readonly reconnects: number;
  waitFor(pred: (e: StreamEvent) => boolean, ms: number): Promise<StreamEvent | null>;
  stop(): void;
}

/**
 * Streams from Last-Event-ID 0 and reconnects from the last id it saw when the server ends the stream (a slow
 * client's overflow, a credential re-check), so the history has no gap and no duplicate. Events that arrive within
 * the first read after a (re)connect and that were written before the connect are flagged `replayed`: only live
 * fan-out counts toward the fan-out latency.
 */
function openStream(client: JudgeClient, path: string, headers: Hdrs): EventStream {
  const events: StreamEvent[] = [];
  const refusals: number[] = [];
  const seen = new Set<string>();
  const waiters = new Set<() => void>();
  let lastId = "0";
  let stopped = false;
  let reconnects = 0;
  let current: ReturnType<JudgeClient["rawRequest"]> | null = null;

  const connect = () => {
    if (stopped) return;
    const connectedAt = Date.now();
    current = client.rawRequest(
      path,
      { ...headers, accept: "text/event-stream", "last-event-id": lastId },
      (res) => {
        if (res.statusCode !== 200) {
          refusals.push(res.statusCode ?? 0);
          res.resume();
          res.on("end", () => setTimeout(again, 1_000));
          return;
        }
        let buffer = "";
        let data: string[] = [];
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const line = buffer.slice(0, nl).replace(/\r$/, "");
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf("\n");
            if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            else if (line === "" && data.length > 0) {
              take(data.join("\n"), connectedAt);
              data = [];
            }
          }
        });
        res.on("end", again);
        res.on("error", again);
      },
    );
    current.on("error", () => setTimeout(again, 500));
    current.end();
  };
  const again = () => {
    if (stopped) return;
    reconnects++;
    setTimeout(connect, 200);
  };
  const take = (raw: string, connectedAt: number) => {
    let e: { id?: unknown; type?: unknown; provenance?: unknown; at?: unknown; payload?: unknown };
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof e.type !== "string" || e.id === undefined) return;
    const id = String(e.id);
    if (seen.has(id)) return;
    seen.add(id);
    lastId = id;
    const at = typeof e.at === "string" ? Date.parse(e.at) : Number.NaN;
    events.push({
      id,
      type: e.type,
      provenance: String(e.provenance),
      at,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      arrivedAt: Date.now(),
      replayed: !(at >= connectedAt),
    });
    for (const w of waiters) w();
  };
  connect();

  return {
    events,
    refusals,
    get reconnects() {
      return reconnects;
    },
    waitFor(pred, ms) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const check = () => {
          const found = events.find(pred);
          if (found) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve(found);
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          resolve(null);
        }, ms);
        waiters.add(check);
      });
    },
    stop() {
      stopped = true;
      current?.destroy();
      for (const w of waiters) w();
    },
  };
}
