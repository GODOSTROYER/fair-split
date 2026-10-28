import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHttpApi, type PairClaimRequest } from "../_shims/api-client";
import { claimPairing, displayCode, normalizeCode, parsePairingInput, pushRoute } from "./pairing";

describe("pairing code", () => {
  it("keeps six digits of whatever is typed or pasted", () => {
    expect(normalizeCode("418 207")).toBe("418207");
    expect(normalizeCode("418-2079999")).toBe("418207");
    expect(normalizeCode("a1b2")).toBe("12");
    expect(displayCode("418207")).toBe("418 207");
    expect(displayCode("41")).toBe("41");
  });
});

describe("pushRoute (a tapped notification)", () => {
  it.each([
    ["/pirma/2026A-r37", "/pirma/2026A-r37"],
    ["/(board)/pirma/2026A-r1230001/sign", "/pirma/2026A-r1230001/sign"],
    ["/pirma", "/pirma"],
    ["/bayad", "/bayad"],
    [{ url: "/(member)/(tabs)/bayad" }, "/bayad"],
  ])("opens %j as %s", (data, route) => {
    expect(pushRoute(data)).toBe(route);
  });

  it.each([
    "https://evil.example/pirma/2026A-r37",
    "//evil.example/pirma",
    "/\\evil.example",
    "javascript:alert(1)",
    "/pirma/../../etc",
    "/pirma/2026A-r37?next=https://evil.example",
    "/pirma/%2e%2e",
    "/pirma/not-a-slug",
    "/pirma/2026A-r37/approve",
    "/settings",
    "/bayad/extra",
    "",
    null,
    42,
    { url: 7 },
  ])("refuses %j", (data) => {
    expect(pushRoute(data)).toBeNull();
  });
});

const TOKEN = "pt_8fJ2kQ9xVb3mN7pL1sR4";

describe("parsePairingInput", () => {
  it.each([
    [`https://fs-api.onrender.com/app/pair?t=${TOKEN}`, TOKEN],
    [`https://fs-api.onrender.com/app/pair/?t=${TOKEN}&x=1`, TOKEN],
    [`https://fs-api.onrender.com/app/pair#t=${TOKEN}`, TOKEN],
    [`fairsplit://pair?t=${TOKEN}`, TOKEN],
    [`/app/pair?t=${TOKEN}`, TOKEN],
    [`/pair?t=${TOKEN}`, TOKEN],
    [`  ${TOKEN}  `, TOKEN],
  ])("reads the token from %s", (raw, token) => {
    expect(parsePairingInput(raw)).toEqual({ kind: "token", token });
  });

  it("reads a 6-digit code, with or without a space", () => {
    expect(parsePairingInput("418 207")).toEqual({ kind: "code", code: "418207" });
    expect(parsePairingInput("418207")).toEqual({ kind: "code", code: "418207" });
    expect(parsePairingInput("41820")).toEqual({ kind: "invalid", reason: "bad-code" });
  });

  it.each([
    ["", "empty"],
    ["https://example.com/login?t=abcdefghijklmnopqrst", "not-fair-split"],
    ["javascript://pair?t=abcdefghijklmnopqrst", "not-fair-split"],
    ["https://fs-api.onrender.com/app/pair?t=short", "bad-token"],
    [`https://fs-api.onrender.com/app/pair?t=${"x".repeat(300)}`, "bad-token"],
    ["https://fs-api.onrender.com/app/pair?t=has%20space%20in%20it%20ok", "bad-token"],
  ])("rejects %j as %s", (raw, reason) => {
    expect(parsePairingInput(raw)).toEqual({ kind: "invalid", reason });
  });
});

const ORIGIN = "https://fs-api.test";
const requests: PairClaimRequest[] = [];
let reply: "ok" | "expired" | "used" | "unknown" | "bare410" = "ok";

const server = setupServer(
  http.post(`${ORIGIN}/v1/pairing/claim`, async ({ request }) => {
    requests.push((await request.json()) as PairClaimRequest);
    if (reply === "expired")
      return HttpResponse.json({ error: { code: "PAIRING_EXPIRED" } }, { status: 410 });
    if (reply === "used") return HttpResponse.json({ error: { code: "PAIRING_USED" } }, { status: 409 });
    if (reply === "unknown")
      return HttpResponse.json({ error: { code: "PAIRING_INVALID" } }, { status: 404 });
    if (reply === "bare410") return new HttpResponse("gone", { status: 410 });
    return HttpResponse.json({
      kind: "device",
      bearer: "dbt_device_bearer_for_tests",
      expiresAt: "2026-11-30T00:00:00Z",
      workspaceId: "ws_showcase",
      persona: "board:ernesto",
      role: "board",
      displayName: "Ernesto P. Cabahug",
      lang: "ceb",
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
  reply = "ok";
});
afterAll(() => server.close());

const api = createHttpApi({ origin: ORIGIN, getBearer: () => null });
const deps = {
  claim: api.claimPairing,
  device: { platform: "android" as const, appVersion: "0.1.0" },
  now: () => new Date("2026-10-29T02:00:00Z"),
};

describe("claimPairing (msw)", () => {
  it("binds the phone to the role the QR carries", async () => {
    const r = await claimPairing(parsePairingInput(`fairsplit://pair?t=${TOKEN}`), deps);
    expect(r).toMatchObject({
      ok: true,
      session: {
        role: "board",
        persona: "board:ernesto",
        bearer: "dbt_device_bearer_for_tests",
        kind: "device",
      },
    });
    expect(requests).toEqual([{ token: TOKEN, device: { platform: "android", appVersion: "0.1.0" } }]);
  });

  it("sends the 6-digit code when the camera is denied", async () => {
    await claimPairing(parsePairingInput("418207"), deps);
    expect(requests[0]).toEqual({ code6: "418207", device: { platform: "android", appVersion: "0.1.0" } });
  });

  it.each([
    ["expired", "expired"],
    ["bare410", "expired"],
    ["used", "used"],
    ["unknown", "invalid"],
  ] as const)("maps a %s reply to the %s state", async (kind, state) => {
    reply = kind;
    const r = await claimPairing(parsePairingInput(TOKEN), deps);
    expect(r).toMatchObject({ ok: false, state });
  });

  it("reports offline when the request never reaches the server", async () => {
    const offline = createHttpApi({ origin: "http://127.0.0.1:9", getBearer: () => null });
    const r = await claimPairing(parsePairingInput(TOKEN), { ...deps, claim: offline.claimPairing });
    expect(r).toMatchObject({ ok: false, state: "offline", code: "NETWORK" });
  });

  it("never calls the server for input that is not a Fair Split QR", async () => {
    const r = await claimPairing(parsePairingInput("https://example.com/"), deps);
    expect(r).toMatchObject({ ok: false, state: "invalid" });
    expect(requests).toHaveLength(0);
  });
});
