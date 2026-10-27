// The smoke checks: one pass over a running fs-api through real HTTP, the way the console, the app and a judge
// reach it. Every IC-01 command goes through the typed client (`@fairsplit/api-client`), so each answer is
// checked against the contract on the way in: a success body must parse with the command's response schema,
// and a refusal must be an IC-01 ApiError carrying a code that command may answer. A 501 (a placeholder left
// in) or a 500 INTERNAL fails the smoke; so does contract drift. The SSE streams are read and every event is
// parsed as an IC-01 RunEvent. Nothing here prints a token, a cookie, a link or a password.
import { createHash, randomUUID } from "node:crypto";
import {
  type ApiClient,
  type ApiResult,
  type CallArgs,
  type ClientFailure,
  type CommandData,
  createApiClient,
  isApiClientError,
  isContractError,
  type JsonCommandName,
  uuidv7,
} from "@fairsplit/api-client";
import {
  API_COMMANDS,
  type ApiCommandName,
  ApiError,
  CreateJudgeSessionResponse,
  RunEvent,
} from "@fairsplit/contracts";
import { z } from "zod";

export interface SmokeTarget {
  /** e.g. http://127.0.0.1:8787 */
  baseUrl: string;
  /** The operator password, when known: enables the /ops and brand-link checks. */
  operatorPassword?: string | undefined;
  /** The judge code, when known: enables the judge-code check. */
  judgeCode?: string | undefined;
  /** Progress lines (one per check). */
  log?: (line: string) => void;
}

export interface SmokeCheck {
  /** An IC-01 command name, or a short label for the other routes. */
  name: string;
  /** `METHOD /path` as sent (ids and slugs, never a credential). */
  target: string;
  status: number | null;
  /** `ok`, the IC-01 error code, `drift: …`, `network: …`, or a short note. */
  outcome: string;
  ok: boolean;
}

export interface SmokeReport {
  ok: boolean;
  checks: SmokeCheck[];
  /** API_COMMANDS exercised (every one must be). */
  covered: ApiCommandName[];
  missing: ApiCommandName[];
  /** What the run looked like after the session's first outbox steps. */
  run: { slug: string; state: string | null; invoiceStatus: string | null } | null;
}

const RunProbe = z.object({
  run: z.object({ state: z.string(), seasonId: z.string(), rateCardSha256: z.string() }),
  invoice: z.object({ status: z.string().nullable() }).nullable(),
});
const SeasonProbe = z.object({ rateCard: z.object({ id: z.string() }).nullable() });
const HoldsProbe = z.object({ holds: z.array(z.object({ id: z.string() })) });
const LinesProbe = z.object({ lines: z.array(z.object({ id: z.string() })) });
const LinkProbe = z.object({ url: z.string(), jti: z.string() });
const JudgeStatusProbe = z.object({ rail: z.object({ mode: z.string(), reason: z.string().nullable() }) });
const OutboxProbe = z.object({
  outbox: z.object({
    byState: z.record(z.string(), z.number()),
    dead: z.array(z.object({ name: z.string(), lastError: z.string().nullable() })),
  }),
});

/** Commands whose success the smoke requires (the rest may also answer with one of their listed refusals). */
const MUST_SUCCEED: ReadonlySet<ApiCommandName> = new Set([
  "createJudgeSession",
  "presence",
  "setFlag",
  "capture",
  "createPairing",
  "claimPairing",
]);

export async function runSmoke(target: SmokeTarget): Promise<SmokeReport> {
  const base = target.baseUrl.replace(/\/+$/, "");
  const log = target.log ?? (() => undefined);
  const checks: SmokeCheck[] = [];
  const covered = new Set<ApiCommandName>();

  const record = (c: SmokeCheck) => {
    checks.push(c);
    log(
      `${c.ok ? "PASS" : "FAIL"}  ${String(c.status ?? "---").padEnd(3)}  ${c.name.padEnd(22)} ${c.target}  ${c.outcome}`,
    );
  };

  /** A raw request (routes outside IC-01, health, documents). */
  const raw = async (
    name: string,
    method: string,
    path: string,
    o: { headers?: Record<string, string>; body?: unknown; expect: readonly number[] },
  ): Promise<Response | null> => {
    const init: RequestInit = {
      method,
      headers: {
        ...(o.body === undefined ? {} : { "content-type": "application/json" }),
        ...(o.headers ?? {}),
      },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      redirect: "manual",
    };
    try {
      const res = await fetch(`${base}${path}`, init);
      const ok = o.expect.includes(res.status);
      let outcome = ok ? "ok" : `unexpected status (want ${o.expect.join("|")})`;
      if (res.status >= 400) {
        const parsed = ApiError.safeParse(
          await res
            .clone()
            .json()
            .catch(() => null),
        );
        outcome = parsed.success
          ? `${parsed.data.code}${ok ? "" : ` (want ${o.expect.join("|")})`}`
          : outcome;
      }
      record({ name, target: `${method} ${path}`, status: res.status, outcome, ok });
      return res;
    } catch (err) {
      record({
        name,
        target: `${method} ${path}`,
        status: null,
        outcome: `network: ${message(err)}`,
        ok: false,
      });
      return null;
    }
  };

  /** An IC-01 command through the typed client: the answer is checked against the contract either way. */
  const command = async <N extends JsonCommandName>(
    api: ApiClient,
    name: N,
    args: CallArgs<N>,
    shown: string,
  ): Promise<CommandData<N> | null> => {
    covered.add(name);
    const cmd = API_COMMANDS[name];
    const r = await (api.result as unknown as (n: N, a: CallArgs<N>) => Promise<ApiResult<N>>)(name, args);
    const t = `${cmd.method} ${shown}`;
    if (r.ok) {
      record({
        name,
        target: t,
        status: r.meta.status,
        outcome: `ok (rail ${r.meta.rail ?? "?"})`,
        ok: true,
      });
      return r.data;
    }
    record({ name, target: t, ...judgeFailure(name, r.error) });
    return null;
  };

  // ------------------------------------------------------------ health, documents, published keys
  await raw("healthz", "GET", "/healthz", { expect: [200] });
  const ready = await raw("readyz", "GET", "/readyz", { expect: [200] });
  if (ready && ready.status !== 200)
    log(`      readyz: ${JSON.stringify(await ready.json().catch(() => null))}`);
  const openapi = await raw("openapi", "GET", "/v1/openapi.json", { expect: [200] });
  if (openapi?.status === 200) {
    const doc = (await openapi.json()) as {
      openapi?: string;
      paths?: Record<string, Record<string, { operationId?: string }>>;
    };
    const ids = new Set(
      Object.values(doc.paths ?? {}).flatMap((p) => Object.values(p).map((op) => op.operationId)),
    );
    const absent = Object.keys(API_COMMANDS).filter((n) => !ids.has(n));
    const with501 = Object.values(doc.paths ?? {}).flatMap((p) =>
      Object.values(p).filter((op) => "501" in ((op as { responses?: object }).responses ?? {})),
    );
    record({
      name: "openapi.commands",
      target: "GET /v1/openapi.json",
      status: 200,
      outcome:
        doc.openapi === "3.1.0" && absent.length === 0 && with501.length === 0
          ? `3.1.0, ${ids.size} operations, every IC-01 command, no 501 placeholder`
          : `version ${doc.openapi}; missing ${absent.join(",") || "none"}; ${with501.length} documented 501`,
      ok: doc.openapi === "3.1.0" && absent.length === 0 && with501.length === 0,
    });
  }
  const docs = await raw("docs", "GET", "/v1/docs", { expect: [200] });
  if (docs?.status === 200) {
    const html = await docs.text();
    const csp = docs.headers.get("content-security-policy") ?? "";
    const ok = html.includes('"openapi":"3.1.0"') && csp.startsWith("sandbox");
    record({
      name: "docs.scalar",
      target: "GET /v1/docs",
      status: 200,
      outcome: ok ? "Scalar, sandboxed CSP" : "no document or no sandbox CSP",
      ok,
    });
  }
  const keys = await raw("wellknown.keys", "GET", "/.well-known/fairsplit-keys.json", { expect: [200] });
  if (keys?.status === 200) {
    const body = (await keys.json()) as Record<string, unknown>;
    record({
      name: "wellknown.shape",
      target: "GET /.well-known/fairsplit-keys.json",
      status: 200,
      outcome: `keys: ${Object.keys(body).join(", ")}`,
      ok: Object.keys(body).length > 0,
    });
  }
  await raw("judge.lane", "GET", "/v1/judge/lane", { expect: [200] });

  // ------------------------------------------------------------ the judge's first press
  covered.add("createJudgeSession");
  let started: z.infer<typeof CreateJudgeSessionResponse> | null = null;
  let cookie = "";
  try {
    const res = await fetch(`${base}${API_COMMANDS.createJudgeSession.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await res.json().catch(() => null);
    const parsed = CreateJudgeSessionResponse.safeParse(body);
    const set = res.headers.get("set-cookie") ?? "";
    cookie = /(?:^|,\s*)(fs_js=[^;]+)/.exec(set)?.[1] ?? "";
    started = res.status === 201 && parsed.success ? parsed.data : null;
    record({
      name: "createJudgeSession",
      target: "POST /v1/judge/sessions",
      status: res.status,
      outcome: started
        ? `ok: run ${started.runSlug}, judge cookie ${cookie ? "set (HttpOnly)" : "MISSING"}`
        : `${ApiError.safeParse(body).data?.code ?? "unparsable"}`,
      ok: !!started && cookie !== "" && /HttpOnly/i.test(set),
    });
  } catch (err) {
    record({
      name: "createJudgeSession",
      target: "POST /v1/judge/sessions",
      status: null,
      outcome: `network: ${message(err)}`,
      ok: false,
    });
  }
  if (!started) return finish(checks, covered, null);
  const s = started;

  const asTreasurer = createApiClient({ baseUrl: base, token: s.consoleToken });
  const asJudge = createApiClient({ baseUrl: base, headers: { cookie } });
  const anonymous = createApiClient({ baseUrl: base });
  const bearer = { authorization: `Bearer ${s.consoleToken}` };

  await command(asJudge, "createJudgeSession", { body: {} }, "/v1/judge/sessions (resume with the cookie)");
  const status = await raw("judge.session", "GET", "/v1/judge/session", { headers: bearer, expect: [200] });
  const rail = JudgeStatusProbe.safeParse(await status?.json().catch(() => null));
  if (rail.success) {
    log(
      `      judge rail: ${rail.data.rail.mode}${rail.data.rail.reason ? ` (${rail.data.rail.reason})` : ""}`,
    );
  }

  // ------------------------------------------------------------ live streams
  covered.add("runEvents");
  covered.add("workspaceEvents");
  record(
    await sse(base, "runEvents", `/v1/runs/${s.runSlug}/events`, { ...bearer, "last-event-id": "0" }, [200]),
  );
  record(await sse(base, "workspaceEvents", `/v1/workspaces/${s.workspaceId}/events`, bearer, [200]));

  // the session's first outbox steps (Claude's invoice turn) run inline; give them a moment, then look
  const probe = await waitForRun(base, s.runSlug, bearer);
  const runInfo = {
    slug: s.runSlug,
    state: probe?.run.state ?? null,
    invoiceStatus: probe?.invoice?.status ?? null,
  };
  record({
    name: "run.read",
    target: `GET /v1/runs/${s.runSlug}`,
    status: probe ? 200 : null,
    outcome: probe ? `state ${runInfo.state}, invoice ${runInfo.invoiceStatus ?? "none"}` : "unreadable",
    ok: !!probe,
  });
  const seasonCode = s.runSlug.split("-r")[0] as string;
  const season = SeasonProbe.safeParse(
    await fetch(`${base}/v1/seasons/${seasonCode}`, { headers: bearer })
      .then((r) => r.json())
      .catch(() => null),
  );
  const holds = HoldsProbe.safeParse(
    await fetch(`${base}/v1/runs/${s.runSlug}/holds`, { headers: bearer })
      .then((r) => r.json())
      .catch(() => null),
  );
  const lines = LinesProbe.safeParse(
    await fetch(`${base}/v1/runs/${s.runSlug}/lines`, { headers: bearer })
      .then((r) => r.json())
      .catch(() => null),
  );
  const holdId = (holds.success && holds.data.holds[0]?.id) || randomUUID();
  const lineId = (lines.success && lines.data.lines[0]?.id) || randomUUID();
  const rateCardId = (season.success && season.data.rateCard?.id) || randomUUID();

  // ------------------------------------------------------------ every IC-01 command
  const runSlug = s.runSlug;
  await command(asTreasurer, "presence", { body: { view: "W-TR-07" } }, "/v1/presence");
  await command(
    asTreasurer,
    "setFlag",
    { body: { flag: "kill_ai_live", on: true } },
    "/v1/flags (kill_ai_live on)",
  );
  await command(
    asTreasurer,
    "setFlag",
    { body: { flag: "kill_ai_live", on: false } },
    "/v1/flags (kill_ai_live off)",
  );
  await command(asTreasurer, "markPaid", { params: { runSlug } }, `/v1/runs/${runSlug}/mark-paid`);
  await command(
    asTreasurer,
    "resolveHold",
    { params: { holdId }, body: { resolution: "COUNT_ONCE" } },
    `/v1/holds/${holdId}/resolve`,
  );
  const fieldId = randomUUID();
  await command(
    asTreasurer,
    "enterField",
    { params: { fieldId }, body: { value: "64.80" } },
    `/v1/fields/${fieldId}/enter`,
  );
  await command(
    asTreasurer,
    "addDeduction",
    { params: { id: rateCardId }, body: { label: "Multa", amountText: "₱200" } },
    `/v1/rate-cards/${rateCardId}/deductions`,
  );
  await command(
    asTreasurer,
    "approvalPayload",
    { params: { runSlug }, query: { role: "treasurer" } },
    `/v1/runs/${runSlug}/approval-payload?role=treasurer`,
  );
  const payload = {
    v: 1 as const,
    runId: s.runId,
    seasonId: probe?.run.seasonId ?? randomUUID(),
    rateCardSha256: probe?.run.rateCardSha256 ?? "0".repeat(64),
    batchSha256: "0".repeat(64),
    itemCount: 1,
    totalCents: 1,
    currency: "USD" as const,
    role: "treasurer" as const,
    approverId: "treasurer:analyn",
    nonce: `smoke-${randomUUID()}`,
    exp: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  await command(
    asTreasurer,
    "submitApproval",
    {
      params: { runSlug },
      body: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload },
    },
    `/v1/runs/${runSlug}/approvals (unsigned payload)`,
  );
  await command(
    asTreasurer,
    "declineApproval",
    { params: { runSlug }, body: { role: "chair", reason: "smoke test" } },
    `/v1/runs/${runSlug}/approvals/decline`,
  );
  await command(asTreasurer, "payCash", { params: { lineId } }, `/v1/lines/${lineId}/pay-cash`);
  await command(
    asTreasurer,
    "resend",
    {
      params: { lineId },
      body: { newReceiver: "smoke@example.com", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload },
    },
    `/v1/lines/${lineId}/resend (unsigned payload)`,
  );
  const photo = Buffer.from(`smoke slip ${randomUUID()}`);
  await command(
    asTreasurer,
    "capture",
    {
      body: {
        captureId: uuidv7(),
        sha256: createHash("sha256").update(photo).digest("hex"),
        mime: "image/jpeg",
        bytes: photo.length,
        station: "BODEGA",
        capturedAt: new Date().toISOString(),
      },
    },
    "/v1/captures (Content-Digest + Idempotency-Key)",
  );
  const pairing = await command(
    asTreasurer,
    "createPairing",
    { body: { persona: "jessie", role: "clerk" } },
    "/v1/pairing (clerk jessie)",
  );
  const claimed = pairing
    ? await command(
        anonymous,
        "claimPairing",
        { body: { code6: pairing.code6 } },
        "/v1/pairing/claim (code6)",
      )
    : null;
  if (!pairing) covered.add("claimPairing");
  if (claimed) {
    const device = createApiClient({ baseUrl: base, token: claimed.token });
    await command(device, "presence", { body: { view: "M-CL-01" } }, "/v1/presence (paired clerk device)");
  }
  await command(
    asTreasurer,
    "createReviewRequest",
    { body: { lineId } },
    "/v1/review-requests (as the treasurer)",
  );
  await command(anonymous, "proof", { params: { runSlug } }, `/v1/proof/${runSlug}`);
  await command(anonymous, "proofJson", { params: { runSlug } }, `/v1/proof/${runSlug}.json`);
  await command(asTreasurer, "proofExport", { params: { runSlug } }, `/v1/proof/${runSlug}/export`);

  // ------------------------------------------------------------ the other streams
  record(
    await sse(
      base,
      "lineEvents",
      `/v1/lines/${lineId}/events`,
      bearer,
      lines.success && lines.data.lines.length > 0 ? [200] : [404],
    ),
  );
  record(await sse(base, "proofEvents", `/v1/proof/${runSlug}/events`, {}, [200, 404]));

  // ------------------------------------------------------------ reads the console and the stage use
  await raw("runs.flags", "GET", "/v1/flags", { headers: bearer, expect: [200] });
  await raw("runs.batch", "GET", `/v1/runs/${runSlug}/batch`, { headers: bearer, expect: [200, 409] });
  await raw("runs.approvals", "GET", `/v1/runs/${runSlug}/approvals`, { headers: bearer, expect: [200] });
  await raw("proof.verification", "GET", `/v1/proof/${runSlug}/verification`, { expect: [200, 404] });
  await raw("credential.whoami", "GET", "/v1/credential", { headers: bearer, expect: [200] });

  // ------------------------------------------------------------ operator, brand link, judge code
  if (target.operatorPassword) {
    const login = await raw("ops.login", "POST", "/v1/ops/login", {
      body: { password: target.operatorPassword },
      expect: [200],
    });
    const ops = /(?:^|,\s*)(fs_ops=[^;]+)/.exec(login?.headers.get("set-cookie") ?? "")?.[1];
    if (ops) {
      const opsHeaders = { cookie: ops };
      const overview = await raw("ops.overview", "GET", "/v1/ops/overview", {
        headers: opsHeaders,
        expect: [200],
      });
      const outbox = OutboxProbe.safeParse(await overview?.json().catch(() => null));
      if (outbox.success) {
        const states = Object.entries(outbox.data.outbox.byState).map(([k, v]) => `${k} ${v}`);
        const dead = outbox.data.outbox.dead.map((d) => d.name).join(", ") || "none";
        log(`      outbox: ${states.join(", ") || "empty"}; dead: ${dead}`);
      }
      await raw("ops.metrics", "GET", "/v1/ops/metrics", { headers: opsHeaders, expect: [200] });
      await raw("ops.keys", "GET", `/v1/ops/keys?ws=${s.workspaceId}`, {
        headers: opsHeaders,
        expect: [200],
      });
      const brand = await raw("links.brand", "POST", "/v1/links/brand", {
        headers: opsHeaders,
        body: { workspaceId: s.workspaceId },
        expect: [201],
      });
      const link = brand?.status === 201 ? LinkProbe.safeParse(await brand.json()) : null;
      if (link?.success) {
        const token = link.data.url.split("/b/")[1] ?? "";
        await raw("brand.credential", "GET", "/v1/credential", {
          headers: { authorization: `Bearer ${token}` },
          expect: [200],
        });
        await raw("brand.view", "GET", `/v1/brand/${runSlug}`, {
          headers: { authorization: `Bearer ${token}` },
          expect: [200, 404, 409],
        });
      }
      await raw("ops.logout", "POST", "/v1/ops/logout", { headers: opsHeaders, body: {}, expect: [200] });
    }
  } else {
    log("SKIP  operator checks (no operator password for this target)");
  }
  if (target.judgeCode) {
    await raw("judge.code", "POST", "/v1/judge/code", {
      headers: { cookie },
      body: { code: target.judgeCode },
      expect: [200],
    });
  }

  // ------------------------------------------------------------ Reset ends the workspace and its tokens
  // only the judge stage (the cookie that started the session) may press Reset; the console token may not
  await raw("judge.reset.token", "POST", `/v1/judge/sessions/${s.sessionId}/reset`, {
    headers: bearer,
    body: {},
    expect: [403],
  });
  await raw("judge.reset", "POST", `/v1/judge/sessions/${s.sessionId}/reset`, {
    headers: { cookie },
    body: {},
    expect: [200],
  });
  await raw("judge.after-reset", "GET", "/v1/judge/session", { headers: bearer, expect: [401, 410] });

  return finish(checks, covered, runInfo);
}

function finish(checks: SmokeCheck[], covered: Set<ApiCommandName>, run: SmokeReport["run"]): SmokeReport {
  const all = Object.keys(API_COMMANDS) as ApiCommandName[];
  const missing = all.filter((n) => !covered.has(n));
  return {
    ok: missing.length === 0 && checks.every((c) => c.ok),
    checks,
    covered: [...covered],
    missing,
    run,
  };
}

/** A refusal passes when it is a listed IC-01 code; a placeholder 501, a 500, drift or no answer fails. */
function judgeFailure(name: ApiCommandName, e: ClientFailure): Omit<SmokeCheck, "name" | "target"> {
  if (isApiClientError(e)) {
    const bad = e.status === 501 || e.code === "INTERNAL" || (MUST_SUCCEED.has(name) && e.status < 500);
    return {
      status: e.status,
      outcome: `${e.code}${bad ? " (not accepted here)" : " (a listed refusal)"}`,
      ok: !bad,
    };
  }
  if (isContractError(e)) {
    return {
      status: e.status,
      outcome: `drift: ${e.issues
        .map((i) => `${i.path} ${i.message}`)
        .join("; ")
        .slice(0, 160)}`,
      ok: false,
    };
  }
  return { status: null, outcome: `network: ${message(e)}`, ok: false };
}

async function waitForRun(
  base: string,
  runSlug: string,
  headers: Record<string, string>,
): Promise<z.infer<typeof RunProbe> | null> {
  let last: z.infer<typeof RunProbe> | null = null;
  for (let i = 0; i < 20; i++) {
    const body = await fetch(`${base}/v1/runs/${runSlug}`, { headers })
      .then((r) => r.json())
      .catch(() => null);
    const parsed = RunProbe.safeParse(body);
    if (parsed.success) {
      last = parsed.data;
      if (parsed.data.invoice) return last;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

/** Opens a stream, reads it for a moment, and parses every event as an IC-01 RunEvent (or the Proof aggregate). */
async function sse(
  base: string,
  name: string,
  path: string,
  headers: Record<string, string>,
  expect: readonly number[],
  readMs = 1_500,
): Promise<SmokeCheck> {
  const ac = new AbortController();
  const target = `GET ${path} (SSE)`;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { accept: "text/event-stream", ...headers },
      signal: ac.signal,
    });
    if (res.status !== 200) {
      const body = ApiError.safeParse(await res.json().catch(() => null));
      return {
        name,
        target,
        status: res.status,
        outcome: body.success ? body.data.code : "not an ApiError",
        ok: expect.includes(res.status) && body.success,
      };
    }
    const type = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    let text = "";
    const until = Date.now() + readMs;
    if (reader) {
      const decoder = new TextDecoder();
      while (Date.now() < until) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, until - Date.now()))),
        ]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
    }
    ac.abort();
    const frames = text.split("\n\n").filter((f) => /^data: /m.test(f));
    let invalid = 0;
    for (const f of frames) {
      const data = /^data: (.*)$/m.exec(f)?.[1] ?? "";
      const event = /^event: (.*)$/m.exec(f)?.[1];
      if (event === "aggregate") continue;
      if (!RunEvent.safeParse(JSON.parse(data)).success) invalid++;
    }
    const connected = text.includes(": connected");
    const ok = expect.includes(200) && type.startsWith("text/event-stream") && connected && invalid === 0;
    return {
      name,
      target,
      status: 200,
      outcome: `${type.split(";")[0]}, ${frames.length} event(s)${invalid ? `, ${invalid} not a RunEvent` : ""}${connected ? "" : ", no preamble"}`,
      ok,
    };
  } catch (err) {
    ac.abort();
    return { name, target, status: null, outcome: `network: ${message(err)}`, ok: false };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
