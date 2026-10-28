// The webhook route's per-IP certificate-fetch budget (WS-PPCORE's verifier) is keyed on the address fs-api's
// trust rule derives, never on a header a sender can set: a forged True-Client-IP buys no fresh budget.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { TrustedEdge } from "../env.js";
import { createFakeClock } from "../lib/clock.js";
import type { AppEnv } from "../lib/context.js";
import { requestContext } from "../middleware/request.js";
import { createTestDeps } from "../test/deps.js";
import type { PayPalWebhookHandler } from "../webhooks/paypal.js";
import { mountPayPalWebhooks, WEBHOOK_PATH } from "./webhooks.js";

function webhookApp(edge: TrustedEdge) {
  const { deps } = createTestDeps({ clock: createFakeClock(), env: { FS_TRUSTED_EDGE: edge } });
  const seen: (string | null | undefined)[] = [];
  const handler: PayPalWebhookHandler = Object.assign(
    async (req: Parameters<PayPalWebhookHandler>[0]) => {
      seen.push(req.clientIp);
      return { status: 200 as const, outcome: "accepted" as const, paypalEventId: null, reason: null };
    },
    { health: () => ({}) as ReturnType<PayPalWebhookHandler["health"]> },
  );
  const app = new Hono<AppEnv>();
  app.use("*", requestContext(deps));
  mountPayPalWebhooks(app, handler);
  /** A delivery as the Node server hands it over: headers plus the socket's peer. */
  const deliver = (headers: Record<string, string>, peer?: string) =>
    app.request(
      WEBHOOK_PATH,
      { method: "POST", body: "{}", headers: { "content-type": "application/json", ...headers } },
      peer ? { incoming: { socket: { remoteAddress: peer } } } : undefined,
    );
  return { deliver, seen };
}

const FORGED = { "true-client-ip": "203.0.113.66", "x-forwarded-for": "203.0.113.88, 198.51.100.9" };

describe("/webhooks/paypal: the client address comes from the trusted hop", () => {
  it("none: the socket's peer, whatever the delivery claims", async () => {
    const w = webhookApp("none");
    expect((await w.deliver(FORGED, "192.0.2.10")).status).toBe(200);
    expect((await w.deliver({ ...FORGED, "cf-connecting-ip": "203.0.113.77" }, "192.0.2.10")).status).toBe(
      200,
    );
    expect(w.seen).toEqual(["192.0.2.10", "192.0.2.10"]);
  });

  it("render: the edge's CF-Connecting-IP, else the hop Render's proxy appended; never True-Client-IP", async () => {
    const w = webhookApp("render");
    await w.deliver({ ...FORGED, "cf-connecting-ip": "203.0.113.77" }, "10.0.0.5");
    await w.deliver(FORGED, "10.0.0.5");
    await w.deliver({ "true-client-ip": "203.0.113.66" }, "10.0.0.5");
    expect(w.seen).toEqual(["203.0.113.77", "198.51.100.9", "10.0.0.5"]);
  });
});
