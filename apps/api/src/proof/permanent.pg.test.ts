import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import { loadShowcase, type ShowcaseWorld } from "./testing/world.js";

let t: TestApp;
let world: ShowcaseWorld;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
  world = await loadShowcase(t.deps.db, { kind: "judge" });
});
afterAll(async () => t?.close());

it("inv.i8.permanent-proof: a permanent seeded workspace has no expiring judge claim to end", async () => {
  for (const suffix of ["", "/verification", "/metrics"]) {
    const r = await t.json(`/v1/proof/${world.runSlug}${suffix}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
});
