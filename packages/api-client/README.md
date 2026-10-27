# @fairsplit/api-client

The typed client for fs-api, shared by the console (`apps/console`) and the app (`apps/mobile`, web export at
`/app`). It is derived from IC-01 `API_COMMANDS` at the type level, so a renamed field or a new error code is a
compile error in the UI, never a runtime surprise. UI code imports only this package for the API (and formats
cents only through it).

| Entry                          | What                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@fairsplit/api-client`        | `createApiClient`, typed errors, SSE `subscribe`, `format`, byte helpers, the HTTP contract                                              |
| `@fairsplit/api-client/http`   | The HTTP contract shared with the server and the mocks: success statuses, error codes per command, headers, paths, SSE paths and backoff |
| `@fairsplit/api-client/format` | Deterministic cents, pesos, kilos, dates and hashes (C-22); never `Intl`                                                                 |
| `@fairsplit/api-client/verify` | "Verify in your browser": the Proof verifier with portable SHA-256 and Ed25519 (`@noble/curves`)                                         |
| `@fairsplit/api-client/msw`    | A seeded, stateful mock of fs-api (msw 3) for UI development and tests                                                                   |

## Calling the API

```ts
import { createApiClient, isApiClientError, format } from "@fairsplit/api-client";

const api = createApiClient({
  // baseUrl: "" (default) = same origin: the console and /app are served by fs-api itself.
  // Native: baseUrl: process.env.EXPO_PUBLIC_API_ORIGIN, fetch: expo/fetch (it streams SSE).
  token: () => frameToken, // fst_ console/frame token, fsd_ device token, fsm_/fsb_ link
});

const session = await api.createJudgeSession(); // 201 (200 when resumed)
api.setToken(session.consoleToken); // treasurer:analyn, 2 h, never in a URL
await api.markPaid({ params: { runSlug: session.runSlug } });
const { hold, needsChair } = await api.resolveHold({
  params: { holdId },
  body: { resolution: "COUNT_ONCE" },
});
const { payload, jcs } = await api.approvalPayload({ params: { runSlug }, query: { role: "treasurer" } });
await api.submitApproval({ params: { runSlug }, body: { role: "treasurer", keyId, signature, payload } });
format.money(payload.totalCents); // "US$368.39": both keys sign this batch
```

- One method per JSON command (`api.<commandName>(args)`), or `api.call(name, args)`. `args` has `params` for
  path params, `body` (POST) or `query` (GET), and call options: `signal`, `headers`, `idempotencyKey`, `token`.
- Responses are parsed with the command's zod schema: you get the schema's output type, and drift is an error.
- `api.result(name, args)` never throws: `{ ok: true, data, meta }` or `{ ok: false, error }`.
- `meta` / `api.rail`: the `X-FS-Rail` of the answer (`simulated` or `sandbox`): label every PayPal-derived
  value with it (I8). `meta.replayed` is true when an `Idempotency-Key` replayed a stored response.
- Captures (`api.capture`) get `Content-Digest` computed over the exact body and `Idempotency-Key` defaulted to the
  `captureId`, so the clerk outbox can retry blindly.
- `api.request({ path, method, params, query, body, schema })` reaches routes outside IC-01 with the same auth,
  errors and rail handling; `api.url(name, params, query)` builds links (e.g. `/v1/proof/2026A-r37.json`).
- Cookies: `credentials: "same-origin"` by default, so the judge cookie (`fs_js`) rides along.

## Failures are typed

| Class               | When                                                                                    | Useful fields                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiClientError<C>` | The server answered an IC-01 `ApiError`                                                 | `code` (narrowed to what that command can answer), `status`, `message`, `requestId`, `retryAfterMs`, `paypalDebugId`, `details`, `body`, `rail`, `notImplemented` |
| `NetworkError`      | No HTTP answer (offline, reset, aborted)                                                | `aborted`                                                                                                                                                         |
| `ContractError`     | Unparsable JSON, a body that breaks the schema, an undocumented status, an unknown code | `issues`, `status`                                                                                                                                                |

```ts
const r = await api.result("resolveHold", { params: { holdId }, body });
if (!r.ok && isApiClientError(r.error, "HOLD_NOT_OPEN", "VERSION_CONFLICT")) refetch();
const refusal = asRateCardRatified(e); // MM-4: { hash, rateCard, ratifiedOn } on a 409 RATE_CARD_RATIFIED
if (isNotImplemented(e)) showComingSoon(); // 501 while the API slice that owns the command is being built
```

The codes each command may answer are `errorCodesOf(name)`: its own list from `API_COMMANDS`, the boundary codes
every command shares (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FRAME_TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`,
`RATE_LIMITED`, `INTERNAL`) and, for credentialed POSTs, `IDEMPOTENCY_KEY_REUSED` and `VERSION_CONFLICT`.

## Live updates (SSE)

```ts
const sub = api.subscribe(
  { kind: "run", runSlug },                  // or { kind: "workspace", ws }, { kind: "line", lineId }, { kind: "proof", runSlug }
  {
    onEvent: (e) => queryClient.setQueryData(…),        // every IC-01 RunEvent, in id order, validated
    onState: (state) => setLive(state === "open"),      // connecting | open | reconnecting | closed
    onError: (failure, willRetry) => { if (!willRetry) signInAgain(); },
    onMessage: (m) => setProgress(m.data),              // the public Proof stream's aggregates ("3 of 8")
  },
  { lastEventId: cachedLastId },
);
sub.close();
```

It runs over `fetch` (a bearer token works, unlike `EventSource`), sends `Last-Event-ID` on every reconnect so the
server replays what was missed (no gap, no duplicate), backs off from 0.5 s to 8 s with jitter (raised by the
server's `retry:` and `retryAfterMs`), reopens a stream silent for 45 s (the server pings every 15 s), and stops
for good on 401, 403, 404 or 410. The public Proof stream never sends a token.

## The mock API (`/msw`)

A stateful copy of the seeded season (`@fairsplit/seed`, IC-03) that answers every command the way fs-api does at
the boundary: the same paths, auth classes (401 without a credential), request validation (400 with located
issues), `Content-Digest` and `Idempotency-Key` checks, IC-01 error bodies with the right statuses,
`Retry-After`, `X-Request-Id`, `X-FS-Rail: simulated` and SSE with `Last-Event-ID` replay. Parity with
`API_COMMANDS` is tested (`src/msw/parity.test.ts`): every command is served at its exact method and path, every
success body passes the client's schema check, and every code a command may answer comes back with its status.

```ts
// Vite dev (console or /app): src/mocks.ts, started only when VITE_PUBLIC_MOCK_API=1
import { setupWorker } from "msw/browser";
import { createMockApi } from "@fairsplit/api-client/msw";
export const mock = createMockApi({ stage: "invoiced" }); // pace "auto": async steps play on timers
await setupWorker(...mock.handlers).start({ onUnhandledFrame: "bypass" });
// (run `npx msw init public/` once in the app that serves the worker)

// Vitest
import { setupServer } from "msw/node";
const mock = createMockApi({ stage: "review", pace: "manual", baseUrl: "http://localhost:8787" });
const server = setupServer(...mock.handlers);
server.listen({ onUnhandledFrame: "error" });
```

**Stages** (`stage`, default `review`): `invoiced` (Judge stage before the first press), `review` (H1, H2, H3 and
slip 0462 open), `approve` (all resolved, ready for key 1), `posted` (both keys signed, items pending), `settled`
(the seeded end: 7 paid by PayPal, Rhea moved to cash, 57 cash lines due).

**The hero path it plays** (each step appends RunEvents, streamed over SSE):
`markPaid` → FUNDED → reading replay → IN_REVIEW with four holds → `enterField` (slip 0462 gross `64.80`; net
derives to `64.50`, the logbook agrees) → the mass-balance dial opens → `resolveHold(H1, COUNT_ONCE)` clears it →
H2 `REGISTER_PLOT`, H3 `RETURN_AS_CREDIT` → `approvalPayload` + `submitApproval` (treasurer) → AWAITING_BOARD →
the Chair signs → APPROVED → POSTING → POSTED → `item.updated` × 8 (seven SUCCESS, Rhea UNCLAIMED) →
NEEDS_FOLLOW_UP → `payCash(Rhea)` cancels her item (RETURNED) → OFF_RAIL_DUE → SETTLED.

Rules mirrored because screens depend on them: blocking holds gate the approval payload, allowed resolutions per
hold kind (parity-tested against the engine), two roles in order with their own keys (`fs-analyn-*`,
`fs-ernesto-*`), digest, season, nonce and 30-minute expiry checks, the kill switch (halts a signed run, refuses
signing and cancels), single-use pairing (10 minutes), presence at most 1 Hz, capture retries and exact twins,
`addDeduction` always 409 `RATE_CARD_RATIFIED` citing the card hash. Signatures are accepted unless you pass
`verifySignature` (e.g. `@noble/curves` against your test keys).

**Controls**: `world.failNext(command, code)` makes the next call fail with any code that command may answer (for
hard-to-reach states: `KILL_SWITCH_ON`, `CIRCUIT_OPEN`, `PAYPAL_REJECTED`…); `pace: "manual"` with
`world.advance(n)` / `world.settle()` steps the asynchronous parts; `stepMs` sets the auto pace; `latency` adds
delay; `auth: "lenient"` accepts anonymous calls; `now` injects a clock; `world.reset(stage)`; `world.dispose()`.
Read state with `world.run`, `holds()`, `hold(idOrLabel)`, `lines()`, `line(idOrMemberNo)`, `fields()`,
`approvals()`, `flags()`, `events()`. IDs are deterministic (`mockId("hold:DUPLICATE_SLIP:0457")`), and
`MOCK_CONSOLE_TOKEN` / `MOCK_WORKSPACE_ID` are fixed, so URLs survive a reload.

Everything the mock returns is synthetic and labelled: provenance `seeded`, PayPal-derived values
`simulated_rail`.

## Tests

`corepack pnpm --filter @fairsplit/api-client test`: the client against a scripted fetch, the SSE client (resume,
backoff, final refusals, aggregates), the byte helpers against `node:crypto` (property-based), the msw parity suite
and the hero path end to end through the client.
