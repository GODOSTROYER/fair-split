import { ApiError, RateCardRatifiedError } from "@fairsplit/contracts";
import { FairSplitDbError, NotFoundError } from "@fairsplit/db";
import { PayPalHttpError } from "@fairsplit/paypal-core";
import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiProblem, problem } from "../lib/problem.js";
import { defineRouteFolder } from "../lib/slice.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { toApiProblem } from "./errors.js";
import { loggablePath } from "./request.js";
import { API_CSP, HTML_CSP } from "./security.js";

describe("error mapping to IC-01 codes", () => {
  it("maps SQL integrity errors (MM-4's 409 cites the hash)", () => {
    const pg = (code: string, message: string) => Object.assign(new Error(message), { code });
    const ratified = toApiProblem({ cause: pg("FS409", `RATE_CARD_RATIFIED:${"7f3a".repeat(16)}`) });
    expect(ratified).toMatchObject({ code: "RATE_CARD_RATIFIED", status: 409 });
    expect(ratified.toBody().details).toEqual({ hash: "7f3a".repeat(16) });
    expect(toApiProblem(pg("FS422", "RULES_BEFORE_FACTS:slip 0300"))).toMatchObject({
      code: "RULES_BEFORE_FACTS",
      status: 422,
    });
    expect(toApiProblem(pg("FS409", "ITEM_STATUS_REGRESSION:SUCCESS->PENDING"))).toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(toApiProblem(pg("FS409", "APPEND_ONLY:run_events"))).toMatchObject({
      code: "INTERNAL",
      status: 500,
    });
    expect(toApiProblem(pg("40001", "could not serialize"))).toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(new FairSplitDbError("RATE_CARD_RATIFIED", "x", "FS409", undefined).httpStatus).toBe(409);
    // the trigger's hash is also top-level, where RateCardRatifiedError carries it
    expect(ratified.toBody()).toMatchObject({ hash: "7f3a".repeat(16) });
  });

  it("MM-4: problem.rateCardRatified() is exactly the IC-01 RateCardRatifiedError", () => {
    const body = problem
      .rateCardRatified({ hash: "f2d7".repeat(16), rateCard: "BR 2026-04", ratifiedOn: "2026-03-14" })
      .toBody("req-1");
    expect(RateCardRatifiedError.parse(body)).toMatchObject({
      code: "RATE_CARD_RATIFIED",
      status: 409,
      hash: "f2d7".repeat(16),
      rateCard: "BR 2026-04",
      ratifiedOn: "2026-03-14",
      requestId: "req-1",
    });
  });

  it("access logs never carry a link token from the path", () => {
    expect(loggablePath("/s/fsm_abc.def")).toBe("/s/[REDACTED]");
    expect(loggablePath("/app/s/fsm_abc.def")).toBe("/app/s/[REDACTED]");
    expect(loggablePath("/b/fsb_abc.def/extra")).toBe("/b/[REDACTED]/extra");
    expect(loggablePath("/v1/holds/abc/resolve")).toBe("/v1/holds/abc/resolve");
    expect(loggablePath("/season/2026-A")).toBe("/season/2026-A");
  });

  it("maps a scoped repository miss to 404 and PayPal failures with their debug_id", () => {
    expect(toApiProblem(new NotFoundError("holds", "h1"))).toMatchObject({ code: "NOT_FOUND", status: 404 });
    const failure = (status: number, name = "INTERNAL_SERVER_ERROR") =>
      new PayPalHttpError({
        kind: status >= 500 ? "server" : "client",
        status,
        name,
        debugId: "dbg-1",
      } as never);
    expect(toApiProblem(failure(422, "UNPROCESSABLE_ENTITY")).toBody()).toMatchObject({
      code: "PAYPAL_REJECTED",
      status: 502,
      paypalDebugId: "dbg-1",
    });
    expect(toApiProblem(failure(503))).toMatchObject({ code: "PAYPAL_UNAVAILABLE", status: 502 });
    expect(toApiProblem(failure(429, "RATE_LIMIT_REACHED")).toBody()).toMatchObject({
      code: "CIRCUIT_OPEN",
      status: 503,
      retryAfterMs: 360_000,
    });
  });

  it("maps Hono exceptions by status and hides everything else", () => {
    expect(toApiProblem(new HTTPException(413))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(toApiProblem(new HTTPException(401))).toMatchObject({ code: "UNAUTHENTICATED" });
    const secret = toApiProblem(new Error("password=hunter2 at db.internal:5432"));
    expect(secret).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(JSON.stringify(secret.toBody())).not.toContain("hunter2");
  });
});

describe("middleware over HTTP", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: { PUBLIC_ORIGIN: "https://fs-api.example.test" },
      folders: [
        defineRouteFolder({
          folder: "ops",
          commands: {},
          routes: (r) => {
            r.app.get("/v1/ops/boom", () => {
              throw new Error("db password leaked?");
            });
            r.app.get("/v1/ops/teapot", () => {
              throw new ApiProblem("KILL_SWITCH_ON", "Refused: kill switch on.");
            });
            r.app.get("/ops/page", (c) => c.html("<h1>ops</h1>"));
          },
        }),
      ],
    });
  });
  afterAll(async () => t.close());

  it("API responses: no-store, nosniff, no-referrer, frame-ancestors 'self', HSTS on https, X-FS-Rail", async () => {
    const r = await t.request("/v1/ops/teapot");
    expect(r.status).toBe(423);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("content-security-policy")).toBe(API_CSP);
    expect(r.headers.get("strict-transport-security")).toMatch(/max-age=/);
    expect(r.headers.get("x-fs-rail")).toBe("simulated");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(ApiError.parse(await r.json())).toMatchObject({ code: "KILL_SWITCH_ON", status: 423 });
  });

  it("HTML gets the same-origin CSP whose frame-ancestors lets the stage frame its phones", async () => {
    const r = await t.request("/ops/page");
    expect(r.headers.get("content-security-policy")).toBe(HTML_CSP);
    expect(HTML_CSP).toContain("frame-ancestors 'self'");
    expect(HTML_CSP).not.toContain("unsafe-eval");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("an unhandled error is a 500 ApiError carrying the request id, never the message", async () => {
    const r = await t.request("/v1/ops/boom", { headers: { "x-request-id": "judge-trace-0001" } });
    expect(r.status).toBe(500);
    expect(r.headers.get("x-request-id")).toBe("judge-trace-0001");
    const body = ApiError.parse(await r.json());
    expect(body).toMatchObject({ code: "INTERNAL", requestId: "judge-trace-0001" });
    expect(body.message).not.toContain("password");
  });

  it("a hostile X-Request-Id is replaced", async () => {
    const r = await t.request("/v1/ops/teapot", { headers: { "x-request-id": "<script>" } });
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
