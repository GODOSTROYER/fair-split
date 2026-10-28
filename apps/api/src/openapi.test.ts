// IC-08: the OpenAPI document is generated from API_COMMANDS and must be valid and complete.
import { API_COMMANDS, type ApiCommandName, ERROR_HTTP_STATUS } from "@fairsplit/contracts";
import { getProof } from "@fairsplit/seed";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notImplemented } from "./lib/command.js";
import { errorCodesOf, pathParamNames, SUCCESS_STATUS } from "./lib/commands.js";
import { defineRouteFolder } from "./lib/slice.js";
import { DOCS_CSP, SCALAR, toOpenApiPath } from "./openapi.js";
import { createTestApp, type TestApp } from "./test/index.js";

type Json = Record<string, unknown>;

let t: TestApp;
let doc: Json & {
  paths: Record<string, Record<string, Json>>;
  components: { schemas: Record<string, Json> };
};

beforeAll(async () => {
  t = await createTestApp();
  doc = (await t.json("/openapi.json")).body as typeof doc;
});
afterAll(async () => t.close());

function refsIn(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) refsIn(n, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refsIn(v, out);
    }
  }
  return out;
}

function ajv() {
  const a = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  a.addSchema({ $id: "fs://openapi", components: doc.components } as Json);
  return a;
}

const schemaOf = (name: string) => ({ $ref: `fs://openapi#/components/schemas/${name}` });

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 with info, server and security schemes", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect((doc.info as Json).title).toBe("Fair Split API");
    expect(doc.servers).toEqual([{ url: "http://localhost:8787" }]);
    expect(Object.keys((doc.components as Json).securitySchemes as Json).sort()).toEqual([
      "bearerToken",
      "judgeCookie",
      "operatorCookie",
    ]);
  });

  it("documents every IC-01 command exactly as declared", () => {
    for (const name of Object.keys(API_COMMANDS) as ApiCommandName[]) {
      const cmd = API_COMMANDS[name];
      const op = doc.paths[toOpenApiPath(cmd.path)]?.[cmd.method.toLowerCase()] as Json | undefined;
      expect(op, name).toBeDefined();
      if (!op) continue;
      expect(op.operationId).toBe(name);
      const params = (op.parameters as Json[]).filter((p) => p.in === "path").map((p) => p.name);
      expect(params.sort(), name).toEqual(pathParamNames(cmd.path).sort());
      const responses = op.responses as Record<string, Json>;
      const codes = Object.values(responses).flatMap(
        (r) => (r["x-error-codes"] as string[] | undefined) ?? [],
      );
      expect(codes.sort(), name).toEqual(errorCodesOf(name).sort());
      for (const code of errorCodesOf(name))
        expect(responses[String(ERROR_HTTP_STATUS[code])], `${name} ${code}`).toBeDefined();
      if ("sse" in cmd && cmd.sse) {
        expect(Object.keys((responses["200"] as Json).content as Json)).toEqual(["text/event-stream"]);
      } else {
        for (const s of SUCCESS_STATUS[name]) expect(responses[String(s)], `${name} ${s}`).toBeDefined();
      }
      if (cmd.method === "POST" && cmd.request) expect(op.requestBody, name).toBeDefined();
      expect(op.security).toBeDefined();
    }
    const ids = Object.values(doc.paths).flatMap((p) =>
      Object.values(p).map((op) => (op as Json).operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("documents 501 NOT_IMPLEMENTED only on a command still answered by the shell's placeholder", async () => {
    const with501 = (d: typeof doc) =>
      Object.values(d.paths).flatMap((p) =>
        Object.values(p)
          .filter((op) => "501" in ((op as Json).responses as Json))
          .map((op) => (op as Json).operationId),
      );
    // every slice has filled in its commands: none of them documents the placeholder's 501
    expect(with501(doc)).toEqual([]);
    const stub = await createTestApp({
      folders: [
        defineRouteFolder({
          folder: "runs",
          commands: { markPaid: notImplemented, setFlag: notImplemented },
        }),
      ],
    });
    try {
      const stubDoc = (await stub.json("/openapi.json")).body as typeof doc;
      expect(with501(stubDoc).sort()).toEqual(["markPaid", "setFlag"]);
    } finally {
      await stub.close();
    }
  });

  it("resolves every $ref and every component is a valid JSON Schema 2020-12", () => {
    const names = new Set(Object.keys(doc.components.schemas));
    for (const ref of refsIn(doc)) {
      expect(ref.startsWith("#/components/schemas/"), ref).toBe(true);
      expect(names.has(ref.replace("#/components/schemas/", "")), ref).toBe(true);
    }
    const a = ajv();
    for (const name of names) expect(() => a.compile(schemaOf(name)), name).not.toThrow();
  });

  it("the JSON Schemas agree with the zod contracts on real data", () => {
    const a = ajv();
    const proof = a.compile(schemaOf("ProofResponse"));
    expect(
      proof({ bundle: getProof(), provenance: "seeded", redacted: true }),
      JSON.stringify(proof.errors),
    ).toBe(true);
    expect(proof({ bundle: getProof(), provenance: "seeded" })).toBe(false);
    const resolve = a.compile(schemaOf("ResolveHoldRequest"));
    expect(resolve({ resolution: "COUNT_ONCE" })).toBe(true);
    expect(resolve({ resolution: "TWO_DELIVERIES" })).toBe(false);
    expect(resolve({ resolution: "NOPE" })).toBe(false);
    const err = a.compile(schemaOf("ApiError"));
    expect(err({ code: "RATE_CARD_RATIFIED", status: 409, message: "bolted" })).toBe(true);
    expect(err({ code: "NOT_A_CODE", status: 409, message: "x" })).toBe(false);
    expect(
      a.compile(schemaOf("RunEvent"))({
        id: "1",
        ws: "w",
        runId: null,
        at: "2026-10-28T02:00:00.000Z",
        actor: { kind: "paypal", id: "paypal:webhook", impersonatedBy: null },
        provenance: "live",
        type: "flag.changed",
        payload: { flag: "kill_payouts", on: true, by: "treasurer:analyn" },
      }),
    ).toBe(true);
  });

  it("is served identically at /openapi.json and /v1/openapi.json", async () => {
    const v1 = await t.json("/v1/openapi.json");
    expect(v1.body).toEqual(doc);
  });

  it("serves Scalar at /docs in a sandbox: pinned, integrity-checked, no inline script, document inline", async () => {
    for (const path of ["/docs", "/v1/docs"]) {
      const r = await t.request(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toBe(DOCS_CSP);
      expect(DOCS_CSP).toMatch(/^sandbox allow-scripts;/);
      expect(DOCS_CSP).toContain("connect-src 'none'");
      const html = await r.text();
      expect(html).toContain(`src="${SCALAR.src}"`);
      expect(html).toContain(`integrity="${SCALAR.integrity}"`);
      expect(html).toContain('crossorigin="anonymous"');
      expect(SCALAR.src).toMatch(/@\d+\.\d+\.\d+\//);
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1] ?? "");
      expect(
        scripts.every((attrs) => attrs.includes("src=") || attrs.includes('type="application/json"')),
      ).toBe(true);
      expect(html).not.toMatch(/<\/script>\s*<script>/);
      expect(html).toContain('"openapi":"3.1.0"');
    }
  });
});
