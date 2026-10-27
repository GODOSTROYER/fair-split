/**
 * `contracts.ts` re-exports WS-CORE's types (type-only, so the package adds nothing to the bundle) and writes the few
 * runtime values the app needs. This test holds each of those values to the package's own, and the phone's check of
 * the approval payload to the package's schema: whatever the package accepts, the phone accepts, and nothing else.
 * Vitest runs in Node, where the package itself is imported.
 */
import { readdirSync, readFileSync } from "node:fs";
import * as real from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { approvalPayloadShape } from "../lib/signing";
import {
  APPROVAL_PAYLOAD_KEYS,
  APPROVAL_ROLES,
  type ApiErrorCode,
  DEVICE_KEY_KINDS,
  deviceKeyIdFitsKind,
  HOLD_KINDS,
  ITEM_EVENT_TO_STATUS,
  ITEM_STATUS_RANK,
  type ItemStatus,
  KEY_ID_PATTERNS,
  LANGS,
  LINE_STATES,
  type LineState,
  RUN_STATES,
  type RunState,
} from "./contracts";

describe("app code imports @fairsplit/contracts for its types only", () => {
  it("never imports a runtime value, which would bundle zod and every schema into each phone frame", () => {
    const src = new URL("../", import.meta.url);
    const files = (readdirSync(src, { recursive: true }) as string[])
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("test/"));
    expect(files.length).toBeGreaterThan(100);
    // A statement (comments stripped) that imports or re-exports anything but types from the package.
    const runtime = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']@fairsplit\/contracts["']/m;
    const code = (f: string) =>
      readFileSync(new URL(f, src), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const offenders = files.filter((f) => runtime.test(code(f)));
    expect(offenders).toEqual([]);
    // The check has teeth: a value import is caught, a type import is not.
    expect(runtime.test('import { LANGS } from "@fairsplit/contracts";')).toBe(true);
    expect(runtime.test('export * from "@fairsplit/contracts";')).toBe(true);
    expect(runtime.test('import type { Lang } from "@fairsplit/contracts";')).toBe(false);
    expect(runtime.test('export type { Lang } from "@fairsplit/contracts";')).toBe(false);
  });
});

describe("the shim's runtime values are @fairsplit/contracts' values", () => {
  it("lists the languages, run, line and hold states, roles and key kinds in the package's order", () => {
    expect([...LANGS]).toEqual(real.LANGS);
    expect([...RUN_STATES]).toEqual(real.PAY_RUN_STATES);
    expect([...LINE_STATES]).toEqual(real.MEMBER_LINE_STATES);
    expect([...HOLD_KINDS]).toEqual(real.HOLD_KINDS);
    expect([...APPROVAL_ROLES]).toEqual(real.ApprovalRole.options);
    expect([...DEVICE_KEY_KINDS]).toEqual(real.DeviceKeyKind.options);
  });

  it("ranks payout items as the package does, leaving out only SUBMITTED (the server's own pre-POST row)", () => {
    const { SUBMITTED, ...phone } = real.PAYOUT_ITEM_RANK;
    expect(ITEM_STATUS_RANK).toEqual(phone);
    expect(SUBMITTED).toBeLessThan(Math.min(...Object.values(ITEM_STATUS_RANK)));
    expect(ITEM_EVENT_TO_STATUS).toEqual(real.ITEM_EVENT_TO_STATUS);
  });

  it("names exactly the approval payload's fields", () => {
    expect([...APPROVAL_PAYLOAD_KEYS].sort()).toEqual(Object.keys(real.ApprovalPayload.shape).sort());
  });

  it("draws each key ID shape from the package's parts, and fits kinds to IDs as the package does", () => {
    expect(KEY_ID_PATTERNS.app.source).toBe(real.KEY_ID_PATTERNS.app.source);
    expect(KEY_ID_PATTERNS.web.source).toBe(real.KEY_ID_PATTERNS.web.source);
    expect(KEY_ID_PATTERNS.demo.source).toBe(real.KEY_ID_PATTERNS.demo.source);
    const ids = [
      "fs-ernesto-a1",
      "fs-analyn-w1",
      "fs-ernesto-demo-k3x9pq",
      "fs-ernesto-s1",
      "fs-ledger-k1",
      "fs-demo-a1",
      "fs-ledger-w1",
      "fs-ernesto-a0",
      "fs-ernesto-a10000",
      "fs-ernesto-demo-K3X9PQ",
      "fs-Ernesto-a1",
      "fs-ernesto2-a1",
    ];
    const kinds: unknown[] = [...real.DeviceKeyKind.options, "seeded", "server", "nope", null, 1];
    for (const kind of kinds) {
      for (const id of ids) {
        expect(deviceKeyIdFitsKind(kind, id), `${String(kind)} ${id}`).toBe(
          real.deviceKeyIdFitsKind(kind, id),
        );
      }
    }
    fc.assert(
      fc.property(
        fc.constantFrom(...real.DeviceKeyKind.options),
        fc.stringMatching(/^fs-[a-z0-9-]{0,30}$/),
        (kind, id) => {
          expect(deviceKeyIdFitsKind(kind, id)).toBe(real.deviceKeyIdFitsKind(kind, id));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("the shim's types are @fairsplit/contracts' types", () => {
  it("keeps every runtime list and map exactly as wide as the package's type", () => {
    expectTypeOf<(typeof LANGS)[number]>().toEqualTypeOf<real.Lang>();
    expectTypeOf<RunState>().toEqualTypeOf<real.PayRunState>();
    expectTypeOf<(typeof RUN_STATES)[number]>().toEqualTypeOf<real.PayRunState>();
    expectTypeOf<LineState>().toEqualTypeOf<real.MemberLineState>();
    expectTypeOf<(typeof LINE_STATES)[number]>().toEqualTypeOf<real.MemberLineState>();
    expectTypeOf<(typeof HOLD_KINDS)[number]>().toEqualTypeOf<real.HoldKind>();
    expectTypeOf<ItemStatus>().toEqualTypeOf<Exclude<real.PayoutItemStatus, "SUBMITTED">>();
    expectTypeOf<keyof typeof ITEM_STATUS_RANK>().toEqualTypeOf<ItemStatus>();
    expectTypeOf<(typeof APPROVAL_ROLES)[number]>().toEqualTypeOf<real.ApprovalRole>();
    expectTypeOf<(typeof DEVICE_KEY_KINDS)[number]>().toEqualTypeOf<real.DeviceKeyKind>();
    expectTypeOf<(typeof APPROVAL_PAYLOAD_KEYS)[number]>().toEqualTypeOf<keyof real.ApprovalPayload>();
    expectTypeOf<real.ErrorCode>().toExtend<ApiErrorCode>();
  });
});

describe("the phone reads an approval payload exactly as contracts' ApprovalPayload does", () => {
  const valid: real.ApprovalPayload = {
    v: 1,
    runId: "01a1852b-c280-792f-8540-bc7919b9823f",
    seasonId: "019ca6b1-dc00-7c73-8b2b-9661129af6b4",
    rateCardSha256: "f2d7026d4602b8dd66e999f9cf4435511d40ded2dc8e55c8de937bd26ba4e12b",
    batchSha256: "0f839be7c2c7751364a49064f305f96bb1a190dfe44711358426366a2d7ae6f3",
    linesDigest: "ad94cc7fa665c005eb36f0dd05bf537be597151c121f27be3b3f1f3d5289e177",
    itemCount: 8,
    totalCents: 36839,
    currency: "USD",
    role: "chair",
    approverId: "board:ernesto",
    nonce: "64270e822e054bdde38a2fcdf5710952",
    exp: "2026-10-29T02:40:31.000Z",
  };
  const agree = (candidate: unknown) => {
    const pkg = real.ApprovalPayload.safeParse(candidate).success;
    expect(approvalPayloadShape(candidate) !== null, JSON.stringify(candidate)).toBe(pkg);
  };

  it("accepts the seed's own Chair payload and refuses what the package refuses", () => {
    expect(real.ApprovalPayload.safeParse(valid).success).toBe(true);
    agree(valid);
    for (const bad of [
      null,
      [],
      "x",
      { ...valid, role: "CHAIR" },
      { ...valid, exp: "2026-10-29T10:40:31+08:00" },
      { ...valid, exp: "2026-02-29T10:00:00Z" },
      { ...valid, exp: "2028-02-29T10:00:00Z" },
      { ...valid, exp: "2026-10-29T10:40Z" },
      { ...valid, itemCount: 0 },
      { ...valid, totalCents: 368.39 },
      { ...valid, nonce: "1234567" },
      { ...valid, linesDigest: valid.linesDigest.toUpperCase() },
      { ...valid, memo: "x" },
    ]) {
      agree(bad);
    }
  });

  it("agrees with the package on any single change to a payload (property)", () => {
    const field = fc.constantFrom(...APPROVAL_PAYLOAD_KEYS);
    const value = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.stringMatching(/^[0-9a-f]{64}$/),
      fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
      fc.constantFrom<unknown>(
        "chair",
        "treasurer",
        "TREASURER",
        "USD",
        "usd",
        1,
        2,
        0,
        -1,
        2 ** 53,
        "2026-10-29T10:30:00Z",
        "2026-10-29T10:30:00.5Z",
        "2026-10-29T10:30:60Z",
        "2026-10-29T24:00:00Z",
        "2026-10-29 10:30:00Z",
        "n_1234567",
        "n_12345678",
        "",
      ),
    );
    const change = fc.oneof(
      fc.record({ kind: fc.constant("set" as const), field, value }),
      fc.record({ kind: fc.constant("drop" as const), field }),
      fc.record({ kind: fc.constant("extra" as const), key: fc.string({ minLength: 1 }), value }),
    );
    fc.assert(
      fc.property(change, (c) => {
        const p: Record<string, unknown> = { ...valid };
        if (c.kind === "set") p[c.field] = c.value;
        else if (c.kind === "drop") delete p[c.field];
        else p[c.key] = c.value;
        agree(p);
      }),
      { numRuns: 2000 },
    );
  });
});
