// fs-api over HTTP the way the console and the Chair's frame call it: a judge session from the first press, its
// treasurer (the console token) and its Chair (a board:ernesto frame token), both signing with browser demo keys and
// proof of possession. Every /v1 answer is recorded with its X-FS-Rail header, so a spec can assert the rail label on
// all of them. Nothing here prints a token, a cookie or a key.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { ApprovalPayload, CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { approvalBytes, ed25519Sign, jcs } from "@fairsplit/domain";

export interface Answer {
  status: number;
  headers: Headers;
  json: unknown;
  text: string;
}

export interface Exchange {
  method: string;
  path: string;
  status: number;
  rail: string | null;
}

export type Headers2 = Record<string, string>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Api {
  readonly base: string;
  /** Every request this client made, with the X-FS-Rail header of its answer. */
  readonly exchanges: Exchange[] = [];

  constructor(base: string) {
    this.base = base.replace(/\/+$/, "");
  }

  async call(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Headers2 } = {},
  ): Promise<Answer> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    this.exchanges.push({ method, path, status: res.status, rail: res.headers.get("x-fs-rail") });
    return { status: res.status, headers: res.headers, json, text };
  }

  get(path: string, headers?: Headers2) {
    return this.call("GET", path, headers ? { headers } : {});
  }

  post(path: string, body: unknown, headers?: Headers2) {
    return this.call("POST", path, { body, ...(headers ? { headers } : {}) });
  }
}

/** The answer's JSON as T, or a failure that names the request and shows the start of the body. */
export function body<T>(a: Answer, what: string): T {
  if (a.json === null) throw new Error(`${what}: ${a.status} with no JSON body: ${a.text.slice(0, 200)}`);
  return a.json as T;
}

export interface JudgeSession {
  sessionId: string;
  workspaceId: string;
  runSlug: string;
  runId: string;
  asTreasurer: Headers2;
  asJudge: Headers2;
  /** When the first press was sent (ms since the epoch). */
  pressedAt: number;
  answer: Answer;
}

/** The judge's first press: POST /v1/judge/sessions with no cookie. */
export async function firstPress(api: Api): Promise<JudgeSession> {
  const pressedAt = Date.now();
  const answer = await api.post("/v1/judge/sessions", {});
  if (answer.status !== 201) throw new Error(`first press: ${answer.status} ${answer.text.slice(0, 200)}`);
  const s = CreateJudgeSessionResponse.parse(answer.json);
  const cookie = /fs_js=([^;]+)/.exec(answer.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("first press: no judge cookie");
  return {
    sessionId: s.sessionId,
    workspaceId: s.workspaceId,
    runSlug: s.runSlug,
    runId: s.runId,
    asTreasurer: { authorization: `Bearer ${s.consoleToken}` },
    asJudge: { cookie: `fs_js=${cookie}` },
    pressedAt,
    answer,
  };
}

export interface RunProbe {
  run: { state: string; version: number; provenance: string };
  invoice: { status: string | null; provenance: string } | null;
  holds: { open: number; blocking: number; total: number };
  lines: Record<string, number>;
  approvals: { role: string; voidedAt: string | null }[];
  rail: string;
}

/** Polls GET /v1/runs/:slug until `want` holds or `ms` pass; returns the last reading. */
export async function waitForRun(
  api: Api,
  s: JudgeSession,
  want: (run: RunProbe) => boolean,
  ms: number,
): Promise<RunProbe | null> {
  const until = Date.now() + ms;
  let last: RunProbe | null = null;
  while (Date.now() < until) {
    const r = await api.get(`/v1/runs/${s.runSlug}`, s.asTreasurer);
    if (r.status === 200) {
      last = r.json as RunProbe;
      if (want(last)) return last;
    }
    await sleep(400);
  }
  return last;
}

/** What the frame signs to register its key (fs-api's judge/keys.ts `demoKeyStatement`; the wire contract). */
function demoKeyStatement(o: { workspaceId: string; approverId: string; publicKeyHex: string }) {
  return {
    v: 1,
    purpose: "fs.register-demo-key",
    ws: o.workspaceId,
    approverId: o.approverId,
    publicKeyHex: o.publicKeyHex,
  };
}

export interface Signer {
  role: "treasurer" | "chair";
  keyId: string;
  privateKey: KeyObject;
  headers: Headers2;
}

/** Registers a browser demo key for `persona` through its own credential (proof of possession). */
export async function registerSigner(
  api: Api,
  s: JudgeSession,
  role: "treasurer" | "chair",
  headers: Headers2,
): Promise<Signer> {
  const approverId = role === "treasurer" ? "treasurer:analyn" : "board:ernesto";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString(
    "hex",
  );
  const statement = jcs(demoKeyStatement({ workspaceId: s.workspaceId, approverId, publicKeyHex }));
  const r = await api.post(
    "/v1/judge/keys",
    { publicKeyHex, signatureHex: ed25519Sign(privateKey, statement) },
    headers,
  );
  if (r.status !== 201) throw new Error(`register ${role} key: ${r.status} ${r.text.slice(0, 200)}`);
  return { role, keyId: body<{ keyId: string }>(r, "register key").keyId, privateKey, headers };
}

/** The Chair's frame token for this session (POST /v1/judge/sessions/:sid/frames, board:ernesto). */
export async function chairFrame(api: Api, s: JudgeSession): Promise<Headers2> {
  const r = await api.post(
    `/v1/judge/sessions/${s.sessionId}/frames`,
    { persona: "board:ernesto" },
    s.asJudge,
  );
  if (r.status !== 201) throw new Error(`chair frame: ${r.status} ${r.text.slice(0, 200)}`);
  return { authorization: `Bearer ${body<{ token: string }>(r, "chair frame").token}` };
}

/** One key: reads the approval payload for the signer's role and signs it (IC-02 approval bytes). */
export async function sign(api: Api, s: JudgeSession, signer: Signer): Promise<Answer> {
  const p = await api.get(`/v1/runs/${s.runSlug}/approval-payload?role=${signer.role}`, signer.headers);
  if (p.status !== 200)
    throw new Error(`approval payload (${signer.role}): ${p.status} ${p.text.slice(0, 200)}`);
  const payload = ApprovalPayload.parse(body<{ payload: unknown }>(p, "approval payload").payload);
  return api.post(
    `/v1/runs/${s.runSlug}/approvals`,
    {
      role: signer.role,
      keyId: signer.keyId,
      signature: ed25519Sign(signer.privateKey, approvalBytes(payload)),
      payload,
    },
    signer.headers,
  );
}

export interface RunEvent {
  id: string | null;
  type: string;
  provenance: string;
  payload: Record<string, unknown>;
}

/** A stream replays at most this many events after its Last-Event-ID (fs-api sse/hub.ts). */
const REPLAY_PAGE = 500;

/** The run's whole event history over its SSE replay, page after page. */
export async function readAllEvents(api: Api, s: JudgeSession): Promise<RunEvent[]> {
  const all: RunEvent[] = [];
  let from = "0";
  for (let page = 0; page < 20; page++) {
    const got = await readEvents(`${api.base}/v1/runs/${s.runSlug}/events`, s.asTreasurer, from);
    all.push(...got);
    const last = got.at(-1)?.id;
    if (got.length < REPLAY_PAGE || !last || last === from) break;
    from = last;
  }
  return all;
}

async function readEvents(url: string, headers: Headers2, from: string): Promise<RunEvent[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2_500);
  const out: RunEvent[] = [];
  try {
    const res = await fetch(url, { headers: { ...headers, "last-event-id": from }, signal: ac.signal });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trimEnd();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) {
          try {
            const e = JSON.parse(line.slice(5).trim()) as Partial<RunEvent> & { id?: string | number };
            if (typeof e.type === "string") {
              out.push({
                id: e.id === undefined ? null : String(e.id),
                type: e.type,
                provenance: String(e.provenance),
                payload: (e.payload ?? {}) as Record<string, unknown>,
              });
            }
          } catch {
            // a keep-alive or a partial line
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  } catch {
    // aborted after the read window: what arrived is the history so far
  } finally {
    clearTimeout(timer);
  }
  return out;
}
