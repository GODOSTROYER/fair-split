import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import { loadShowcase, type ShowcaseWorld } from "./testing/world.js";

let t: TestApp;
let world: ShowcaseWorld;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  if (!t.pg) throw new Error("database required");
  world = await loadShowcase(t.pg.owner.db, {
    kind: "judge",
    expiresAt: new Date(t.clock.nowMs() + 86_400_000),
  });
});
afterAll(async () => t?.close());

it("HD6-O1 Reset ends public Proof, metrics, verification, streams and keys immediately", async () => {
  const sid = randomUUID();
  const as = t.credentials.judge(
    t.credentials.judgeCookie({ workspaceId: world.workspaceId, sessionId: sid }),
  );
  expect((await t.json(`/v1/proof/${world.runSlug}/metrics`)).status).toBe(200);
  expect((await t.json(`/v1/judge/sessions/${sid}/reset`, { method: "POST", body: {}, as })).status).toBe(
    200,
  );
  const paths = [
    `/v1/proof/${world.runSlug}`,
    `/v1/proof/${world.runSlug}/metrics`,
    `/v1/proof/${world.runSlug}/verification`,
    `/v1/proof/${world.runSlug}/events`,
    `/.well-known/fairsplit-keys.json?run=${world.runSlug}`,
  ];
  const statuses = [];
  for (const path of paths) {
    const response = await t.request(path);
    statuses.push([path, response.status]);
    await response.body?.cancel();
  }
  expect(statuses).toEqual(paths.map((path) => [path, 404]));
});
