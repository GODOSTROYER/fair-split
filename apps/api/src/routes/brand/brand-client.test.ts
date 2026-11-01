import { BRAND_ROUTES, type RouteSpec as ClientRoute } from "@fairsplit/api-client";
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

describe("api-client BRAND_ROUTES match the server's brand routes", () => {
  for (const [name, client] of Object.entries(BRAND_ROUTES) as [string, ClientRoute][]) {
    it(`${name}: ${client.method} ${client.path}`, () => {
      const server = t.app.registry.routes.find(
        (r: RouteSpec) => r.method === client.method && r.path === client.path,
      );
      expect(server, `the server mounts ${client.method} ${client.path}`).toBeDefined();
      if (!server) return;
      expect(server.name).toBe(`brand.${name}`);
      expect(server.auth).toBe(client.auth);
      expect([...server.success].sort()).toEqual([...client.success].sort());
      expect(json(client.request, "input")).toEqual(json(server.request, "input"));
      expect(json(client.response, "output")).toEqual(json(server.response, "output"));
    });
  }

  it("every JSON brand route has a typed client call", () => {
    const covered = new Set(Object.values(BRAND_ROUTES).map((r) => `${r.method} ${r.path}`));
    const mounted = t.app.registry.routes
      .filter((r) => r.name.startsWith("brand."))
      .map((r) => `${r.method} ${r.path}`);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.filter((r) => !covered.has(r))).toEqual([]);
  });
});
