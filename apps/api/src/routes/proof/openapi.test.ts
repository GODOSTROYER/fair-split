// The slice's routes are in the OpenAPI document (IC-08): every JSON route from its zod spec, and the raw
// ones (the public stream, the brand CSV, the archived-photo tile) with their media types.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { must } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

type Json = Record<string, unknown>;
let t: TestApp;
let paths: Record<string, Record<string, Json>>;

beforeAll(async () => {
  t = await createTestApp();
  paths = ((await t.json("/openapi.json")).body as { paths: typeof paths }).paths;
});
afterAll(async () => t.close());

describe("the proof slice in /openapi.json", () => {
  it("documents every route it serves, each with a unique operation id", () => {
    const expected: [string, string, string][] = [
      ["/v1/proof/{runSlug}", "get", "proof"],
      ["/v1/proof/{runSlug}.json", "get", "proofJson"],
      ["/v1/proof/{runSlug}/export", "get", "proofExport"],
      ["/v1/proof/{runSlug}/metrics", "get", "proof.metrics"],
      ["/v1/proof/{runSlug}/verification", "get", "proof.verification"],
      ["/v1/proof/{runSlug}/events", "get", "proof.events"],
      ["/.well-known/fairsplit-keys.json", "get", "wellknown.keys"],
      ["/v1/brand/{runSlug}", "get", "brand.view"],
      ["/v1/brand/{runSlug}/export.csv", "get", "brand.exportCsv"],
      ["/v1/review-requests", "post", "createReviewRequest"],
      ["/v1/statements/{lineId}", "get", "statements.statement"],
      ["/v1/statements/{lineId}/review-requests", "get", "statements.reviewRequests"],
      ["/v1/print/{runSlug}/members/{memberNo}", "get", "print.memberPrint"],
      ["/v1/ops/overview", "get", "ops.overview"],
      ["/v1/ops/metrics", "get", "ops.metrics"],
      ["/v1/ops/keys", "get", "ops.keys"],
      ["/v1/ops/keys", "post", "ops.registerKey"],
      ["/v1/ops/keys/revoke", "post", "ops.revokeKey"],
      ["/v1/media/audio/{lineId}", "get", "media.statementAudio"],
      ["/media/archived/{file}", "get", "media.archivedTile"],
    ];
    for (const [path, method, id] of expected) {
      expect(paths[path]?.[method]?.operationId, `${method} ${path}`).toBe(id);
    }
  });

  it("gives the raw routes their media types and their errors", () => {
    const op = (path: string, method = "get") => must(paths[path]?.[method], `${method} ${path}`);
    const content = (path: string) =>
      Object.keys(must((op(path).responses as Json)["200"] as { content: Json } | undefined).content);
    expect(content("/v1/proof/{runSlug}/events")).toEqual(["text/event-stream"]);
    expect(content("/v1/brand/{runSlug}/export.csv")).toEqual(["text/csv"]);
    expect(content("/media/archived/{file}")).toEqual(["image/svg+xml"]);
    const stream = op("/v1/proof/{runSlug}/events");
    expect(Object.keys(stream.responses as Json).sort()).toEqual(["200", "404", "429"]);
    const schema = ((stream.responses as Json)["200"] as { content: Record<string, { schema: Json }> })
      .content["text/event-stream"]?.schema;
    expect(Object.keys((schema?.properties as Json) ?? {}).sort()).toEqual([
      "display",
      "items",
      "provenance",
      "runSlug",
      "runState",
    ]);
    expect(op("/v1/ops/keys", "post").security).toEqual([{ operatorCookie: [] }]);
  });
});
