import { type RouteSpec as ClientRoute, STATEMENT_ROUTES } from "@fairsplit/api-client";
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

describe("api-client member statement routes match the server", () => {
  for (const [name, client] of Object.entries(STATEMENT_ROUTES) as [string, ClientRoute][]) {
    it(`${name}: ${client.method} ${client.path}`, () => {
      const server = t.app.registry.routes.find(
        (r: RouteSpec) => r.method === client.method && r.path === client.path,
      );
      expect(server).toBeDefined();
      if (!server) return;
      expect(server.name).toBe(`statements.${name}`);
      expect(server.auth).toBe(client.auth);
      expect([...server.success].sort()).toEqual([...client.success].sort());
      expect(json(client.request, "input")).toEqual(json(server.request, "input"));
      expect(json(client.response, "output")).toEqual(json(server.response, "output"));
    });
  }

  it("covers both phone reads explicitly", () => {
    expect(Object.keys(STATEMENT_ROUTES).sort()).toEqual(["memberStatementLine", "statement"]);
  });
});
