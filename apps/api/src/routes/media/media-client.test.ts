// IC-11 (ADR-0011): the typed client's media route (`@fairsplit/api-client` MEDIA_ROUTES) against the route this
// server mounts: the same method, path, auth class and success statuses, and the same request and response schemas
// (compared as JSON Schema), so the app and the console read exactly the shape the handler returns.
import { type RouteSpec as ClientRoute, MEDIA_ROUTES } from "@fairsplit/api-client";
import { StatementAudio, StatementAudioQuery } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RouteSpec } from "../../lib/command.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const json = (schema: z.ZodType | null, io: "input" | "output") =>
  schema === null ? null : z.toJSONSchema(schema, { io, unrepresentable: "any" });

describe("api-client MEDIA_ROUTES match the server's media routes", () => {
  for (const [name, client] of Object.entries(MEDIA_ROUTES) as [string, ClientRoute][]) {
    it(`${name}: ${client.method} ${client.path}`, () => {
      const server = t.app.registry.routes.find(
        (r: RouteSpec) => r.method === client.method && r.path === client.path,
      );
      expect(server, `the server mounts ${client.method} ${client.path}`).toBeDefined();
      if (!server) return;
      expect(server.name).toBe(`media.${name}`);
      expect(server.auth).toBe(client.auth);
      expect([...server.success].sort()).toEqual([...client.success].sort());
      expect(json(client.request, "input")).toEqual(json(server.request, "input"));
      expect(json(client.response, "output")).toEqual(json(server.response, "output"));
    });
  }

  it("the route answers with the contract's own schemas, the ones the app's types come from", () => {
    const server = t.app.registry.routes.find((r: RouteSpec) => r.name === "media.statementAudio");
    expect(server?.response).toBe(StatementAudio);
    expect(server?.request).toBe(StatementAudioQuery);
  });

  it("every JSON route of the media folder has a typed client call", () => {
    const covered = new Set(Object.values(MEDIA_ROUTES).map((r) => `${r.method} ${r.path}`));
    const mounted = t.app.registry.routes
      .filter((r) => r.name.startsWith("media.") && r.path.startsWith("/v1/"))
      .map((r) => `${r.method} ${r.path}`);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.filter((r) => !covered.has(r))).toEqual([]);
  });
});
