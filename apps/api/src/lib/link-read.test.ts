import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { credentialResult } from "../middleware/credential.js";
import { onError } from "../middleware/errors.js";
import { requestContext } from "../middleware/request.js";
import { createTestApp, type TestApp, type TestAuth } from "../test/index.js";
import type { AppEnv } from "./context.js";

let t: TestApp;
afterEach(async () => t?.close());

function reads() {
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(t.deps));
  app.onError(onError);
  app.get("/v1/credential", async (c) => c.json(await credentialResult(c)));
  return (as: TestAuth, headers: Record<string, string> = {}, method = "GET") =>
    app.request("/v1/credential", { method, headers: { ...as, ...headers } });
}

it("HD6-11 refuses a link's 61st read in a minute before checking revocation", async () => {
  t = await createTestApp();
  const read = reads();
  const ws = t.credentials.workspace();
  const as = t.credentials.bearer(t.credentials.memberLink({ workspaceId: ws, lineId: randomUUID() }));
  let revocationChecks = 0;
  const store = t.deps.credentials.store;
  const original = store.isLinkRevoked;
  store.isLinkRevoked = async (...args) => {
    revocationChecks++;
    return original(...args);
  };
  for (let i = 0; i < 60; i++) expect((await read(as)).status).toBe(200);
  expect((await read(as)).status).toBe(429);
  expect((await read(as, {}, "HEAD")).status).toBe(429);
  expect(revocationChecks).toBe(60);
  t.clock.advance(60_000);
  expect((await read(as)).status).toBe(200);
});

it("HD6-11 limits link reads across minted links on one network", async () => {
  t = await createTestApp();
  const read = reads();
  const ws = t.credentials.workspace();
  for (let n = 0; n < 5; n++) {
    const as = t.credentials.bearer(t.credentials.memberLink({ workspaceId: ws, lineId: randomUUID() }));
    for (let i = 0; i < 60; i++) expect((await read(as)).status).toBe(200);
  }
  const as = t.credentials.bearer(t.credentials.memberLink({ workspaceId: ws, lineId: randomUUID() }));
  expect((await read(as)).status).toBe(429);
  expect((await read(as, { "cf-connecting-ip": "192.0.2.50" })).status).toBe(200);
});
