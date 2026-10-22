import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  FixtureFormatError,
  listFixtureFiles,
  loadFixture,
  parseFixture,
  type RecordedFixture,
  writeFixture,
} from "../src/fixtures.js";
import { REDACTED, UnscrubbedFixtureError } from "../src/scrub.js";

const tmp = mkdtempSync(join(tmpdir(), "fs-test-kit-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fakePayPalToken = `A21${"AA"}${"k".repeat(60)}`;

const raw: RecordedFixture = {
  name: "paypal/get-payout-item",
  recordedAt: "2026-10-23T09:00:00.000Z",
  provenance: "live",
  request: {
    method: "GET",
    url: "https://api-m.sandbox.paypal.com/v1/payments/payouts-item/ITEM1",
    headers: { authorization: `Bearer ${fakePayPalToken}` },
  },
  response: {
    status: 200,
    body: { transaction_status: "UNCLAIMED", payout_item: { receiver: "rhea@nowhere.example.net" } },
  },
};

describe("committed fixtures", () => {
  const files = listFixtureFiles();

  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is well-formed and scrubbed", (file) => {
    expect(() => loadFixture(file)).not.toThrow();
  });
});

describe("loadFixture", () => {
  it("loads a fixture by name", () => {
    const f = loadFixture("paypal/oauth-token");
    expect(f.response.status).toBe(200);
    expect((f.response.body as { access_token: string }).access_token).toBe(REDACTED);
  });

  it("refuses a fixture that still holds a token or a real email", () => {
    const file = join(tmp, "leaky.json");
    writeFileSync(file, JSON.stringify(raw));
    expect(() => loadFixture(file)).toThrow(UnscrubbedFixtureError);
  });

  it("refuses a malformed fixture", () => {
    expect(() => parseFixture({ name: "x" })).toThrow(FixtureFormatError);
    expect(() => parseFixture({ ...raw, provenance: "made-up" })).toThrow(/provenance/);
    expect(() => parseFixture({ ...raw, recordedAt: "yesterday" })).toThrow(/recordedAt/);
  });
});

describe("writeFixture", () => {
  it("scrubs before writing, so the file on disk has no secret", () => {
    const file = join(tmp, "written.json");
    const written = writeFixture(file, raw);
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain(fakePayPalToken);
    expect(onDisk).not.toContain("rhea@nowhere.example.net");
    expect(onDisk).toContain(`Bearer ${REDACTED}`);
    expect(onDisk).toContain("@sandbox.fairsplit.invalid");
    expect(loadFixture(file)).toEqual(written);
  });
});
