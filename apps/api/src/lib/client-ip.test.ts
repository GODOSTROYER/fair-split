// The client address behind every per-IP throttle (S3.9): only the hop fs-api is configured to sit behind
// (FS_TRUSTED_EDGE) is believed. A header any client can send (True-Client-IP, CF-Connecting-IP off Cloudflare,
// the leftmost X-Forwarded-For entries) never buys a fresh budget.

import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createCredentialKeys } from "../credentials/verify/keys.js";
import { TRUSTED_EDGES, type TrustedEdge } from "../env.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { clientIp, hashedClientIp, resolveClientIp } from "./client-ip.js";
import { defineRouteFolder } from "./slice.js";

const headers = (h: Record<string, string>) => new Headers(h);

it("HD6-6: throttle IPv6 by /64, canonicalize mapped addresses, preserve IPv4 hashes", () => {
  const keys = createCredentialKeys({});
  const now = new Date("2026-11-04T00:00:00Z");
  const hash = (ip: string) => hashedClientIp(keys, ip, now);
  expect(hash("2001:db8::1")).toBe(hash("2001:db8::ffff:1"));
  expect(hash("2001:db8::1")).toBe(hash("2001:0db8:0000:0000:0:0:0:2"));
  expect(hash("2001:db8::1")).not.toBe(hash("2001:db8:0:1::1"));
  expect(hash("::ffff:192.0.2.1")).toBe(hash("192.0.2.1"));
  expect(hash("::ffff:c000:201")).toBe(hash("192.0.2.1"));
  expect(hash("192.0.2.1")).toBe(
    createHmac("sha256", keys.hmacKey("ip-hash")).update("192.0.2.1|2026-11-04").digest("hex").slice(0, 32),
  );
});

/** Everything a client can put on the wire, all at once. */
const SPOOFED = {
  "true-client-ip": "203.0.113.66",
  "cf-connecting-ip": "203.0.113.77",
  "x-forwarded-for": "203.0.113.88, 198.51.100.9",
};

describe("resolveClientIp: one trusted hop per deployment", () => {
  it("none: the socket's peer only; every forwarding header is ignored", () => {
    expect(resolveClientIp("none", headers(SPOOFED), "192.0.2.10")).toBe("192.0.2.10");
    expect(resolveClientIp("none", headers(SPOOFED), null)).toBeNull();
  });

  it("render: CF-Connecting-IP (set by the edge on every request), never True-Client-IP", () => {
    expect(resolveClientIp("render", headers(SPOOFED), "10.0.0.5")).toBe("203.0.113.77");
    // Cloudflare adds True-Client-IP only on Enterprise zones with the transform on; otherwise it is the client's
    const { "cf-connecting-ip": _cf, ...noEdgeHeader } = SPOOFED;
    expect(resolveClientIp("render", headers(noEdgeHeader), "10.0.0.5")).toBe("198.51.100.9");
    expect(resolveClientIp("render", headers({ "true-client-ip": "203.0.113.66" }), "10.0.0.5")).toBe(
      "10.0.0.5",
    );
  });

  it("render: without the edge header, the rightmost X-Forwarded-For entry (what Render's proxy saw), never the leftmost", () => {
    const h = headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 198.51.100.20" });
    expect(resolveClientIp("render", h, "10.0.0.5")).toBe("198.51.100.20");
    // a private-network caller (fs-cron) has neither header: its own address
    expect(resolveClientIp("render", headers({}), "10.0.0.7")).toBe("10.0.0.7");
    // a rightmost entry that is not an address falls back to the peer, never to a client-written entry
    expect(resolveClientIp("render", headers({ "x-forwarded-for": "6.6.6.6, unknown" }), "10.0.0.5")).toBe(
      "10.0.0.5",
    );
  });

  it("cloudflare: CF-Connecting-IP, else the peer (X-Forwarded-For and True-Client-IP ignored)", () => {
    expect(resolveClientIp("cloudflare", headers(SPOOFED), "172.64.0.1")).toBe("203.0.113.77");
    const { "cf-connecting-ip": _cf, ...rest } = SPOOFED;
    expect(resolveClientIp("cloudflare", headers(rest), "172.64.0.1")).toBe("172.64.0.1");
  });

  it("proxy: the rightmost X-Forwarded-For entry, else the peer (edge headers ignored)", () => {
    expect(resolveClientIp("proxy", headers(SPOOFED), "127.0.0.1")).toBe("198.51.100.9");
    expect(resolveClientIp("proxy", headers({ "cf-connecting-ip": "203.0.113.77" }), "127.0.0.1")).toBe(
      "127.0.0.1",
    );
  });

  it("normalises what it trusts: brackets, ports and IPv4-mapped IPv6; anything else is no address", () => {
    expect(resolveClientIp("none", headers({}), "::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(resolveClientIp("render", headers({ "cf-connecting-ip": "[2001:db8::1]:443" }), null)).toBe(
      "2001:db8::1",
    );
    expect(resolveClientIp("proxy", headers({ "x-forwarded-for": "192.0.2.4:51000" }), null)).toBe(
      "192.0.2.4",
    );
    expect(resolveClientIp("render", headers({ "cf-connecting-ip": "evil<script>" }), "10.0.0.5")).toBe(
      "10.0.0.5",
    );
  });

  it("covers every FS_TRUSTED_EDGE value", () => {
    for (const edge of TRUSTED_EDGES) {
      expect(resolveClientIp(edge, headers({}), "192.0.2.1"), edge).toBe("192.0.2.1");
    }
  });
});

// ---------------------------------------------------------------- over a real socket

const probe = defineRouteFolder({
  folder: "season",
  commands: {},
  routes: (r) => {
    r.route(
      {
        method: "GET",
        path: "/v1/test/client-ip",
        auth: "none",
        name: "clientIp",
        response: z.strictObject({ ip: z.string().nullable() }),
      },
      (ctx) => ({ ip: clientIp(ctx.c) }),
    );
  },
});

function get(url: string, h: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "GET", headers: h, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

let t: TestApp | undefined;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
  await t?.close();
  t = undefined;
});

/** The fs-api app (the very `FairSplitApp.fetch` server.ts serves) listening on an ephemeral loopback port. */
async function listening(edge: TrustedEdge): Promise<string> {
  t = await createTestApp({ folders: [probe], env: { FS_TRUSTED_EDGE: edge } });
  const app = t.app;
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      stop = () => new Promise<void>((done) => server.close(() => done()));
      resolve(`http://127.0.0.1:${info.port}/v1/test/client-ip`);
    });
  });
}

describe("clientIp(c) over a real socket (Node server bindings reach the handler)", () => {
  it("none: a spoofed True-Client-IP, CF-Connecting-IP or X-Forwarded-For never replaces the socket's peer", async () => {
    const url = await listening("none");
    const claims: Record<string, string>[] = [
      SPOOFED,
      { "true-client-ip": "203.0.113.66" },
      { "x-forwarded-for": "203.0.113.88" },
      {},
    ];
    for (const h of claims) {
      const r = await get(url, h);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ip: "127.0.0.1" });
    }
  });

  it("render: the edge's CF-Connecting-IP is believed; a client's True-Client-IP is not", async () => {
    const url = await listening("render");
    expect(JSON.parse((await get(url, SPOOFED)).body)).toEqual({ ip: "203.0.113.77" });
    expect(JSON.parse((await get(url, { "true-client-ip": "203.0.113.66" })).body)).toEqual({
      ip: "127.0.0.1",
    });
  });

  it("in-process requests (no socket) have no address under none", async () => {
    t = await createTestApp({ folders: [probe], env: { FS_TRUSTED_EDGE: "none" } });
    const r = await t.json<{ ip: string | null }>("/v1/test/client-ip", { headers: SPOOFED });
    expect(r.body).toEqual({ ip: null });
  });
});
