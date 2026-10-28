// The typed client's judge and auth routes (`@fairsplit/api-client` JUDGE_ROUTES) against the routes this server
// mounts: the same method, path, auth class and success statuses, and the same request and response schemas
// (compared as JSON Schema), so the console's typed calls can never drift from the handlers they reach.
import { type RouteSpec as ClientRoute, JUDGE_ROUTES } from "@fairsplit/api-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RouteSpec } from "../lib/command.js";
import { createTestApp, type TestApp } from "../test/index.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const json = (schema: z.ZodType | null, io: "input" | "output") =>
  schema === null ? null : z.toJSONSchema(schema, { io, unrepresentable: "any" });

describe("api-client JUDGE_ROUTES match the server's judge and auth routes", () => {
  for (const [name, client] of Object.entries(JUDGE_ROUTES) as [string, ClientRoute][]) {
    it(`${name}: ${client.method} ${client.path}`, () => {
      const server = t.app.registry.routes.find(
        (r: RouteSpec) => r.method === client.method && r.path === client.path,
      );
      expect(server, `the server mounts ${client.method} ${client.path}`).toBeDefined();
      if (!server) return;
      expect(server.name.split(".")[0], "a judge or auth folder route").toMatch(/^(judge|auth)$/);
      expect(server.auth).toBe(client.auth);
      expect([...server.success].sort()).toEqual([...client.success].sort());
      expect(json(client.request, "input")).toEqual(json(server.request, "input"));
      expect(json(client.response, "output")).toEqual(json(server.response, "output"));
    });
  }

  it("every judge and auth route the server mounts has a typed client call", () => {
    const covered = new Set(Object.values(JUDGE_ROUTES).map((r) => `${r.method} ${r.path}`));
    const mounted = t.app.registry.routes
      .filter((r) => /^(judge|auth)\./.test(r.name))
      .map((r) => `${r.method} ${r.path}`);
    expect(mounted.filter((r) => !covered.has(r))).toEqual([]);
  });
});
