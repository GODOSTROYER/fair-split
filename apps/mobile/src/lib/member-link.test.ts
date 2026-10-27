import { describe, expect, it } from "vitest";
import { base64 } from "../_shims/api-client";
import { readMemberLink } from "./member-link";

describe("member link /s/:token", () => {
  const b64url = (s: string) =>
    base64(new TextEncoder().encode(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = base64(new Uint8Array(64).fill(1)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = new Date("2026-10-30T00:00:00Z");

  it("reads the line and the 30-day expiry", () => {
    const token = `${b64url('{"exp":"2026-11-29T00:00:00Z","lineId":"line_M-014"}')}.${sig}`;
    expect(readMemberLink(token, now)).toEqual({
      ok: true,
      lineId: "line_M-014",
      exp: "2026-11-29T00:00:00Z",
    });
  });

  it("reads the dot-free form some static hosts need", () => {
    const token = `${b64url('{"exp":"2026-11-29T00:00:00Z","lineId":"line_M-014"}')}~${sig}`;
    expect(readMemberLink(token, now)).toMatchObject({ ok: true, lineId: "line_M-014" });
    expect(readMemberLink(`${token}~${sig}`, now)).toEqual({ ok: false, reason: "malformed" });
  });

  it("explains an expired or broken link without a round trip", () => {
    const old = `${b64url('{"exp":"2026-10-01T00:00:00Z","lineId":"line_M-014"}')}.${sig}`;
    expect(readMemberLink(old, now)).toEqual({ ok: false, reason: "expired" });
    expect(readMemberLink("nonsense", now)).toEqual({ ok: false, reason: "malformed" });
    expect(readMemberLink(`${b64url("[]")}.${sig}`, now)).toEqual({ ok: false, reason: "malformed" });
    expect(readMemberLink(`${b64url('{"exp":"2026-11-29T00:00:00Z","lineId":"x"}')}.AAAA`, now)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
