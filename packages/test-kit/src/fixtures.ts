// Recorded-fixture loader. A fixture is one recorded HTTP exchange (PayPal, Claude), stored as JSON
// under packages/test-kit/fixtures/** after passing through the scrubber. Loading re-checks it, so an
// unscrubbed file fails the test that uses it as well as the CI fixture scan.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertScrubbed, type ScrubOptions, scrub } from "./scrub.js";

export type Provenance = "live" | "replay" | "simulated_rail" | "seeded";

export interface RecordedRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface RecordedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface RecordedFixture {
  /** Stable name, e.g. `paypal/oauth-token`. */
  name: string;
  /** ISO date of the real run it was recorded from; replays are labelled with it (I8). */
  recordedAt: string;
  provenance: Provenance;
  request: RecordedRequest;
  response: RecordedResponse;
}

/** packages/test-kit/fixtures */
export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export class FixtureFormatError extends Error {
  override name = "FixtureFormatError";
}

const PROVENANCES: readonly string[] = ["live", "replay", "simulated_rail", "seeded"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Validates the shape of a parsed fixture and returns it typed. */
export function parseFixture(raw: unknown, source = "fixture"): RecordedFixture {
  const fail = (why: string): never => {
    throw new FixtureFormatError(`${source}: ${why}`);
  };
  if (!isRecord(raw)) return fail("not an object");
  if (typeof raw.name !== "string" || raw.name === "") fail("missing name");
  if (typeof raw.recordedAt !== "string" || Number.isNaN(Date.parse(raw.recordedAt))) fail("bad recordedAt");
  if (typeof raw.provenance !== "string" || !PROVENANCES.includes(raw.provenance)) fail("bad provenance");
  const req = raw.request;
  const res = raw.response;
  if (!isRecord(req) || typeof req.method !== "string" || typeof req.url !== "string") fail("bad request");
  if (!isRecord(res) || typeof res.status !== "number") fail("bad response");
  return raw as unknown as RecordedFixture;
}

/**
 * Loads a fixture by name (`paypal/oauth-token`) or by path, checks its shape and that it is scrubbed.
 * Throws `UnscrubbedFixtureError` when a token or a real email address is still in it.
 */
export function loadFixture(nameOrPath: string, dir = FIXTURES_DIR): RecordedFixture {
  const file = nameOrPath.endsWith(".json") ? resolve(nameOrPath) : join(dir, `${nameOrPath}.json`);
  const source = relative(process.cwd(), file) || file;
  const fixture = parseFixture(JSON.parse(readFileSync(file, "utf8")), source);
  assertScrubbed(fixture, source);
  return fixture;
}

/** Scrubs a freshly recorded exchange and writes it as a fixture file. Returns what was written. */
export function writeFixture(
  file: string,
  fixture: RecordedFixture,
  options: ScrubOptions = {},
): RecordedFixture {
  const clean = scrub(parseFixture(fixture, file), options);
  assertScrubbed(clean, file);
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return clean;
}

/** Every *.json fixture path under `dir`, sorted. */
export function listFixtureFiles(dir = FIXTURES_DIR): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) visit(p);
      else if (entry.endsWith(".json")) out.push(p);
    }
  };
  visit(dir);
  return out.sort();
}
