// The typed client against a scripted fetch: what it sends, what it returns, and how each failure is typed.
import { describe, expect, it } from "vitest";
import { contentDigest } from "./bytes.js";
import { createApiClient, type FetchLike } from "./client.js";
import { ApiClientError, ContractError, isApiClientError, isNotImplemented, NetworkError } from "./errors.js";
import { HEADER } from "./http.js";

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
  credentials: string | undefined;
}

function scripted(answer: (req: Seen) => Response | Promise<Response>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const req: Seen = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      credentials: init?.credentials,
    };
    seen.push(req);
    return answer(req);
  };
  return { fetch, seen };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      [HEADER.rail]: "simulated",
      [HEADER.requestId]: "req-1",
      ...headers,
    },
  });

const HOLD_ID = "0192f8a0-0000-7000-8000-000000000001";

describe("typed client", () => {
  it("fills the path, sends the bearer and the same-origin cookie policy, and returns the parsed body", async () => {
    const { fetch, seen } = scripted(() => json(200, { ok: true }));
    const api = createApiClient({ baseUrl: "https://fs.example/", fetch, token: () => "fst_tok" });
    expect(await api.presence({ body: { view: "W-TR-05" } })).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({
      url: "https://fs.example/v1/presence",
      method: "POST",
      credentials: "same-origin",
    });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer fst_tok");
    expect(seen[0]?.headers.get("content-type")).toBe("application/json");
    expect(api.rail).toBe("simulated");
  });

  it("GET commands send the query; url() builds links without calling", async () => {
    const { fetch, seen } = scripted(() =>
      json(409, { code: "BLOCKING_HOLDS_OPEN", status: 409, message: "H1" }),
    );
    const api = createApiClient({ fetch });
    await api
      .approvalPayload({ params: { runSlug: "2026A-r37" }, query: { role: "chair" } })
      .catch(() => undefined);
    expect(seen[0]?.url).toBe("/v1/runs/2026A-r37/approval-payload?role=chair");
    expect(api.url("proofJson", { runSlug: "2026A-r37" })).toBe("/v1/proof/2026A-r37.json");
    expect(() => api.url("resolveHold", {})).toThrow(/missing path param :holdId/);
  });

  it("captures carry Content-Digest over the exact body and default Idempotency-Key to the captureId", async () => {
    const { fetch, seen } = scripted(() =>
      json(201, { documentId: HOLD_ID, status: "accepted", exactDuplicateOf: null }),
    );
    const api = createApiClient({ fetch });
    const body = {
      captureId: "0192f8a0-0000-7000-8000-000000000042",
      sha256: "a".repeat(64),
      mime: "image/jpeg" as const,
      bytes: 10,
      station: "BODEGA" as const,
      capturedAt: "2026-10-28T01:59:00.000Z",
    };
    await api.capture({ body });
    expect(seen[0]?.headers.get(HEADER.contentDigest)).toBe(contentDigest(seen[0]?.body ?? ""));
    expect(seen[0]?.headers.get(HEADER.idempotencyKey)).toBe(body.captureId);
    await api.capture({ body, idempotencyKey: "explicit-key-1" });
    expect(seen[1]?.headers.get(HEADER.idempotencyKey)).toBe("explicit-key-1");
  });

  it("an ApiError becomes an ApiClientError narrowed to the command's codes", async () => {
    const { fetch } = scripted(() =>
      json(409, {
        code: "HOLD_NOT_OPEN",
        status: 409,
        message: "H1 is resolved.",
        details: { holdId: HOLD_ID },
      }),
    );
    const api = createApiClient({ fetch });
    const r = await api.result("resolveHold", {
      params: { holdId: HOLD_ID },
      body: { resolution: "COUNT_ONCE" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(isApiClientError(r.error, "HOLD_NOT_OPEN")).toBe(true);
    if (r.error instanceof ApiClientError) {
      // compile-time: `code` is CommandErrorCode<"resolveHold">
      const code: "HOLD_NOT_OPEN" | "RESOLUTION_NOT_ALLOWED" | "VERSION_CONFLICT" | "FORBIDDEN" | string =
        r.error.code;
      expect(code).toBe("HOLD_NOT_OPEN");
      expect(r.error.requestId).toBe("req-1");
      expect(r.error.rail).toBe("simulated");
      expect(r.error.details).toEqual({ holdId: HOLD_ID });
    }
  });

  it("a 501 from a command whose slice has not landed is recognisable", async () => {
    const { fetch } = scripted(() =>
      json(501, {
        code: "INTERNAL",
        status: 501,
        message: "markPaid is not implemented yet",
        details: { reason: "NOT_IMPLEMENTED", command: "markPaid", slice: "runs" },
      }),
    );
    const e = await createApiClient({ fetch })
      .markPaid({ params: { runSlug: "2026A-r37" } })
      .catch((x: unknown) => x);
    expect(isNotImplemented(e)).toBe(true);
  });

  it("drift, unknown codes, undocumented statuses and junk are ContractErrors; no answer is a NetworkError", async () => {
    const cases: Response[] = [
      json(200, { ok: "yes" }),
      json(418, { code: "TEAPOT", status: 418, message: "no" }),
      json(202, { ok: true }),
      new Response("<html>", { status: 502 }),
    ];
    let i = 0;
    const { fetch } = scripted(() => cases[i++] as Response);
    const api = createApiClient({ fetch });
    for (let n = 0; n < cases.length; n++) {
      const e = await api.presence({ body: { view: "x" } }).catch((x: unknown) => x);
      expect(e, String(n)).toBeInstanceOf(ContractError);
    }
    const offline = createApiClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const e = await offline.presence({ body: { view: "x" } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NetworkError);
    expect((e as NetworkError).aborted).toBe(false);
  });

  it("result() never throws, onError observes every failure, setToken swaps the credential", async () => {
    const failures: unknown[] = [];
    const { fetch, seen } = scripted(() =>
      json(401, { code: "FRAME_TOKEN_EXPIRED", status: 401, message: "expired" }),
    );
    const api = createApiClient({ fetch, token: "fst_old", onError: (f) => failures.push(f) });
    const r = await api.result("presence", { body: { view: "x" } });
    expect(r.ok).toBe(false);
    expect(failures).toHaveLength(1);
    api.setToken("fst_new");
    await api.result("presence", { body: { view: "x" } });
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer fst_new");
    await api.result("presence", { body: { view: "x" }, token: null });
    expect(seen[2]?.headers.has("authorization")).toBe(false);
  });

  it("exposes Idempotent-Replayed and the rail on results", async () => {
    const { fetch } = scripted(() =>
      json(200, { ok: true }, { [HEADER.replayed]: "true", [HEADER.rail]: "sandbox" }),
    );
    const r = await createApiClient({ fetch }).result("presence", { body: { view: "x" } });
    expect(r.ok && r.meta).toMatchObject({
      replayed: true,
      rail: "sandbox",
      status: 200,
      requestId: "req-1",
    });
  });

  it("request() reaches non-contract routes with the same auth and errors", async () => {
    const { fetch, seen } = scripted(() => json(200, { keys: [] }));
    const api = createApiClient({ fetch, token: "fst_tok" });
    const out = await api.request({ path: "/.well-known/fairsplit-keys.json" });
    expect(out).toEqual({ keys: [] });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer fst_tok");
  });
});
