// The smoke's money path on the simulator rail (ADR-0010): one judge session walked from the first press to a settled
// run over real HTTP, the way the console and the Chair's frame do it, with every PayPal step on fs-api's in-process
// simulator. It checks the simulator's public mount (pages served; REST API and admin closed), that the judge rail is
// live, then: the invoice (Agent Toolkit on the simulator), Mark paid, the reading, slip 0462 by hand and H1–H3, both
// keys (browser demo keys with proof of possession, the Chair's through its own frame token), the POST, the settle
// GETs (7 SUCCESS, Rhea UNCLAIMED), Rhea's cash move (cancel → RETURNED), a verified simulator-signed webhook in the
// run's events, X-FS-Rail `simulated` on the way, and the Proof chain. Nothing here prints a token or a cookie.
import { generateKeyPairSync } from "node:crypto";
import { ApprovalPayload } from "@fairsplit/contracts";
import { approvalBytes, ed25519Sign, jcs } from "@fairsplit/domain";
import { z } from "zod";
import { demoKeyStatement } from "../judge/keys.js";
import type { SmokeCheck } from "./checks.js";

export interface MoneyTarget {
  baseUrl: string;
  log?: (line: string) => void;
  /** How long the run may take to read, settle and so on (default: generous for a loaded machine). */
  timeouts?: { readingMs?: number; settleMs?: number };
}

const Session = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  runSlug: z.string(),
  consoleToken: z.string(),
});
const RunProbe = z.object({
  run: z.object({ state: z.string(), seasonCode: z.string().optional() }),
  lines: z.record(z.string(), z.number()).optional(),
  holds: z.object({ open: z.number(), blocking: z.number() }).optional(),
});
const Holds = z.object({
  holds: z.array(z.object({ id: z.string(), label: z.string(), state: z.string() })),
});
const Lines = z.object({
  lines: z.array(z.object({ id: z.string(), memberNo: z.string(), state: z.string() })),
});
const Slips = z.object({
  slips: z.array(
    z.object({
      copy: z.string().nullable(),
      fields: z.array(z.object({ id: z.string(), field: z.string() })),
    }),
  ),
});
const Key = z.object({ keyId: z.string() });
const Payload = z.object({ payload: ApprovalPayload });
const Verification = z.object({
  verification: z.object({ status: z.string(), chain: z.object({ ok: z.boolean(), entries: z.number() }) }),
});

const ADMIN_PATHS: readonly [string, string][] = [
  ["GET", "/paypal-sim/sim/admin/state"],
  ["POST", "/paypal-sim/sim/admin/reset"],
  ["POST", "/paypal-sim/sim/admin/delivery"],
  ["POST", "/paypal-sim/v1/oauth2/token"],
  ["GET", "/paypal-sim/v1/payments/payouts/SIMX"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMoneyPath(target: MoneyTarget): Promise<SmokeCheck[]> {
  const base = target.baseUrl.replace(/\/+$/, "");
  const log = target.log ?? (() => undefined);
  const checks: SmokeCheck[] = [];
  const record = (c: SmokeCheck) => {
    checks.push(c);
    log(
      `${c.ok ? "PASS" : "FAIL"}  ${String(c.status ?? "---").padEnd(4)} ${c.name.padEnd(22)} ${c.target}  ${c.outcome}`,
    );
    return c.ok;
  };
  const call = async (
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const res = await fetch(`${base}${path}`, {
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
    return { status: res.status, headers: res.headers, json, text };
  };
  const fail = (name: string, t: string, status: number | null, outcome: string) =>
    record({ name, target: t, status, outcome, ok: false });

  // ------------------------------------------------------------ the simulator's public mount
  const health = await call("GET", "/paypal-sim/sim/health");
  const healthBody = z.object({ simulated: z.literal(true), cert_url: z.string() }).safeParse(health.json);
  record({
    name: "paypal-sim.pages",
    target: "GET /paypal-sim/sim/health",
    status: health.status,
    outcome: healthBody.success ? "simulated, cert published" : `unexpected: ${health.text.slice(0, 80)}`,
    ok: health.status === 200 && healthBody.success,
  });
  // no in-process simulator: the rest would only repeat the failure
  if (health.status !== 200 || !healthBody.success) return checks;
  const certPath = new URL(healthBody.data.cert_url).pathname;
  const cert = await call("GET", certPath);
  record({
    name: "paypal-sim.cert",
    target: `GET ${certPath}`,
    status: cert.status,
    outcome: cert.text.includes("BEGIN CERTIFICATE") ? "the chain every delivery names" : "no PEM",
    ok: cert.status === 200 && cert.text.includes("BEGIN CERTIFICATE"),
  });
  for (const [method, path] of ADMIN_PATHS) {
    const r = await call(method, path, method === "POST" ? { body: {} } : {});
    record({
      name: "paypal-sim.closed",
      target: `${method} ${path}`,
      status: r.status,
      outcome: r.status === 404 || r.status === 403 ? "closed" : "OPEN",
      ok: r.status === 404 || r.status === 403,
    });
  }

  // ------------------------------------------------------------ a fresh judge session on the simulated rail
  const started = await call("POST", "/v1/judge/sessions", { body: {} });
  const session = Session.safeParse(started.json);
  const cookie = /fs_js=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")?.[1];
  if (!session.success || !cookie) {
    fail("money.session", "POST /v1/judge/sessions", started.status, "no session");
    return checks;
  }
  const s = session.data;
  const asTreasurer = { authorization: `Bearer ${s.consoleToken}` };
  const asJudge = { cookie: `fs_js=${cookie}` };
  const rail = started.headers.get("x-fs-rail");
  record({
    name: "money.session",
    target: "POST /v1/judge/sessions",
    status: started.status,
    outcome: `run ${s.runSlug}, X-FS-Rail ${rail}`,
    ok: started.status === 201 && rail === "simulated",
  });
  const judge = await call("GET", "/v1/judge/session", { headers: asTreasurer });
  const mode = z
    .object({ rail: z.object({ mode: z.string(), reason: z.string().nullable() }) })
    .safeParse(judge.json);
  record({
    name: "money.rail",
    target: "GET /v1/judge/session",
    status: judge.status,
    outcome: mode.success
      ? `${mode.data.rail.mode}${mode.data.rail.reason ? ` (${mode.data.rail.reason})` : ""}`
      : "?",
    ok: mode.success && mode.data.rail.mode === "live",
  });

  const runPath = `/v1/runs/${s.runSlug}`;
  const waitForState = async (want: (state: string) => boolean, ms: number) => {
    const until = Date.now() + ms;
    let last: z.infer<typeof RunProbe> | null = null;
    while (Date.now() < until) {
      const p = RunProbe.safeParse((await call("GET", runPath, { headers: asTreasurer })).json);
      if (p.success) {
        last = p.data;
        if (want(p.data.run.state)) return last;
      }
      await sleep(500);
    }
    return last;
  };
  const step = (name: string, t: string, run: z.infer<typeof RunProbe> | null, ok: boolean, extra = "") =>
    record({
      name,
      target: t,
      status: run ? 200 : null,
      outcome: `state ${run?.run.state ?? "?"}${extra}`,
      ok,
    });

  const invoiced = await waitForState((st) => st !== "DRAFT" && st !== "QUOTED", 30_000);
  if (!step("money.invoiced", `GET ${runPath}`, invoiced, invoiced?.run.state === "INVOICED")) return checks;

  const paid = await call("POST", `${runPath}/mark-paid`, { body: {}, headers: asTreasurer });
  if (
    !record({
      name: "money.markPaid",
      target: `POST ${runPath}/mark-paid`,
      status: paid.status,
      outcome: `${JSON.stringify(paid.json).slice(0, 120)}; X-FS-Rail ${paid.headers.get("x-fs-rail")}`,
      ok: paid.status === 200 && paid.headers.get("x-fs-rail") === "simulated",
    })
  ) {
    return checks;
  }
  const reviewed = await waitForState(
    (st) => !["INVOICED", "FUNDED", "EXTRACTING", "COMPUTED"].includes(st),
    target.timeouts?.readingMs ?? 90_000,
  );
  const holdsOk = reviewed?.holds?.open === 4 && reviewed.holds.blocking === 3;
  if (
    !step(
      "money.reading",
      `GET ${runPath}`,
      reviewed,
      reviewed?.run.state === "IN_REVIEW" && holdsOk,
      reviewed?.holds ? `, holds ${reviewed.holds.open} open / ${reviewed.holds.blocking} blocking` : "",
    )
  ) {
    return checks;
  }

  // ------------------------------------------------------------ the review: 0462 by hand, H1–H3
  const season = (reviewed?.run.seasonCode ?? "2026-A").replace("-", "");
  const slip = Slips.safeParse(
    (await call("GET", `/v1/seasons/${season}/slips/0462`, { headers: asTreasurer })).json,
  );
  const gross = slip.success
    ? slip.data.slips.flatMap((x) => x.fields).find((f) => f.field === "gross_kg")
    : undefined;
  const entered = gross
    ? await call("POST", `/v1/fields/${gross.id}/enter`, { body: { value: "64.80" }, headers: asTreasurer })
    : null;
  record({
    name: "money.byHand",
    target: "POST /v1/fields/:id/enter (0462 gross 64.80)",
    status: entered?.status ?? null,
    outcome: entered ? (entered.status === 200 ? "ok" : entered.text.slice(0, 100)) : "no 0462 field",
    ok: entered?.status === 200,
  });
  const holds = Holds.safeParse((await call("GET", `${runPath}/holds`, { headers: asTreasurer })).json);
  const resolutions: Record<string, unknown> = {
    H1: { resolution: "COUNT_ONCE" },
    H2: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
    H3: { resolution: "RETURN_AS_CREDIT" },
  };
  for (const [label, body] of Object.entries(resolutions)) {
    const hold = holds.success ? holds.data.holds.find((h) => h.label === label) : undefined;
    const r = hold
      ? await call("POST", `/v1/holds/${hold.id}/resolve`, { body, headers: asTreasurer })
      : null;
    record({
      name: "money.hold",
      target: `POST /v1/holds/:id/resolve (${label})`,
      status: r?.status ?? null,
      outcome: r ? (r.status === 200 ? "resolved" : r.text.slice(0, 100)) : `no ${label}`,
      ok: r?.status === 200,
    });
  }

  // ------------------------------------------------------------ both keys: browser demo keys, proof of possession
  const signer = async (persona: string, headers: Record<string, string>) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyHex = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString(
      "hex",
    );
    const statement = jcs(
      demoKeyStatement({ workspaceId: s.workspaceId, approverId: persona, publicKeyHex }),
    );
    const r = await call("POST", "/v1/judge/keys", {
      body: { publicKeyHex, signatureHex: ed25519Sign(privateKey, statement) },
      headers,
    });
    const key = Key.safeParse(r.json);
    record({
      name: "money.key",
      target: `POST /v1/judge/keys (${persona})`,
      status: r.status,
      outcome: key.success ? "registered (web_demo)" : r.text.slice(0, 100),
      ok: r.status === 201 && key.success,
    });
    return key.success ? { keyId: key.data.keyId, privateKey } : null;
  };
  const frame = await call("POST", `/v1/judge/sessions/${s.sessionId}/frames`, {
    body: { persona: "board:ernesto" },
    headers: asJudge,
  });
  const chairToken = z.object({ token: z.string() }).safeParse(frame.json);
  record({
    name: "money.chairFrame",
    target: `POST /v1/judge/sessions/:sid/frames (board:ernesto)`,
    status: frame.status,
    outcome: chairToken.success ? "minted" : frame.text.slice(0, 100),
    ok: frame.status === 201 && chairToken.success,
  });
  const asChair = chairToken.success ? { authorization: `Bearer ${chairToken.data.token}` } : null;
  const treasurerKey = await signer("treasurer:analyn", asTreasurer);
  const chairKey = asChair ? await signer("board:ernesto", asChair) : null;
  for (const [role, headers, key] of [
    ["treasurer", asTreasurer, treasurerKey],
    ["chair", asChair, chairKey],
  ] as const) {
    if (!headers || !key) {
      fail("money.approval", `POST ${runPath}/approvals (${role})`, null, "no key");
      return checks;
    }
    const p = Payload.safeParse(
      (await call("GET", `${runPath}/approval-payload?role=${role}`, { headers })).json,
    );
    if (!p.success) {
      fail("money.approval", `GET ${runPath}/approval-payload?role=${role}`, null, "no payload");
      return checks;
    }
    const r = await call("POST", `${runPath}/approvals`, {
      body: {
        role,
        keyId: key.keyId,
        signature: ed25519Sign(key.privateKey, approvalBytes(p.data.payload)),
        payload: p.data.payload,
      },
      headers,
    });
    record({
      name: "money.approval",
      target: `POST ${runPath}/approvals (${role})`,
      status: r.status,
      outcome: r.status === 200 || r.status === 201 ? "signed" : r.text.slice(0, 120),
      ok: r.status === 200 || r.status === 201,
    });
  }

  // ------------------------------------------------------------ the POST, the settle GETs, Rhea to cash
  const settleMs = target.timeouts?.settleMs ?? 180_000;
  const posted = await waitForState(
    (st) => ["POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"].includes(st),
    60_000,
  );
  step("money.posted", `GET ${runPath}`, posted, posted !== null && posted.run.state !== "APPROVED");
  const settled = await waitForState((st) => st === "NEEDS_FOLLOW_UP" || st === "SETTLED", settleMs);
  const paidLines = settled?.lines?.PAID ?? 0;
  const unclaimed = settled?.lines?.UNCLAIMED ?? 0;
  step(
    "money.settled",
    `GET ${runPath}`,
    settled,
    settled?.run.state === "NEEDS_FOLLOW_UP" && paidLines === 7 && unclaimed === 1,
    `, ${paidLines} SUCCESS, ${unclaimed} UNCLAIMED`,
  );
  const lines = Lines.safeParse((await call("GET", `${runPath}/lines`, { headers: asTreasurer })).json);
  const rhea = lines.success ? lines.data.lines.find((l) => l.state === "UNCLAIMED") : undefined;
  const cash = rhea
    ? await call("POST", `/v1/lines/${rhea.id}/pay-cash`, { body: {}, headers: asTreasurer })
    : null;
  const cashBody = z
    .object({ cancelled: z.boolean(), line: z.object({ memberNo: z.string(), state: z.string() }) })
    .safeParse(cash?.json);
  record({
    name: "money.cash",
    target: "POST /v1/lines/:id/pay-cash (Rhea, M-031)",
    status: cash?.status ?? null,
    outcome: cashBody.success
      ? `cancelled ${cashBody.data.cancelled}, ${cashBody.data.line.memberNo} ${cashBody.data.line.state}`
      : rhea
        ? (cash?.text.slice(0, 100) ?? "?")
        : "no UNCLAIMED line",
    ok:
      cash?.status === 200 &&
      cashBody.success &&
      cashBody.data.cancelled &&
      cashBody.data.line.memberNo === "M-031" &&
      cashBody.data.line.state === "OFF_RAIL_DUE",
  });
  const done = await waitForState((st) => st === "SETTLED", 30_000);
  step("money.done", `GET ${runPath}`, done, done?.run.state === "SETTLED");
  const batch = await call("GET", `${runPath}/batch`, { headers: asTreasurer });
  const returned = batch.text.includes('"RETURNED"');
  record({
    name: "money.returned",
    target: `GET ${runPath}/batch`,
    status: batch.status,
    outcome: returned ? "Rhea's item RETURNED" : "no RETURNED item",
    ok: batch.status === 200 && returned,
  });

  // ------------------------------------------------------------ a verified simulator-signed webhook; the chain
  const events = await readEvents(`${base}${runPath}/events`, asTreasurer);
  const verified = events.filter(
    (e) => e.type === "webhook.received" && (e.payload as { verified?: string }).verified === "self",
  );
  record({
    name: "money.webhooks",
    target: `GET ${runPath}/events (webhook.received)`,
    status: 200,
    outcome: `${verified.length} verified (self), ${events.length} events read`,
    ok: verified.length > 0 && verified.every((e) => e.provenance === "simulated_rail"),
  });
  const proof = await call("GET", `/v1/proof/${s.runSlug}/verification`);
  const v = Verification.safeParse(proof.json);
  record({
    name: "money.ledger",
    target: `GET /v1/proof/${s.runSlug}/verification`,
    status: proof.status,
    outcome: v.success
      ? `chain ${v.data.verification.chain.ok ? "verifies" : "BROKEN"} (${v.data.verification.chain.entries} entries), ${v.data.verification.status}`
      : proof.text.slice(0, 100),
    ok: proof.status === 200 && v.success && v.data.verification.chain.ok,
  });
  return checks;
}

/** Reads a run's SSE history for a moment (`Last-Event-ID: 0` replays it) and parses each `data:` line. */
async function readEvents(
  url: string,
  headers: Record<string, string>,
): Promise<{ type: string; provenance: string; payload: unknown }[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2_500);
  const out: { type: string; provenance: string; payload: unknown }[] = [];
  try {
    const res = await fetch(url, { headers: { ...headers, "last-event-id": "0" }, signal: ac.signal });
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
            const e = JSON.parse(line.slice(5).trim()) as {
              type?: string;
              provenance?: string;
              payload?: unknown;
            };
            if (typeof e.type === "string") {
              out.push({ type: e.type, provenance: String(e.provenance), payload: e.payload ?? null });
            }
          } catch {
            // a keep-alive or a partial line
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  } catch {
    // aborted after the read window: what arrived is what the history holds
  } finally {
    clearTimeout(timer);
  }
  return out;
}
