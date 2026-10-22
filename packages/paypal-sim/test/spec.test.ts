// The vendored specs are PayPal's files, unmodified: their checksums must match PROVENANCE.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSpecDir, SPEC_FILES } from "../src/contract/openapi.js";

const dir = defaultSpecDir();
const provenance = JSON.parse(readFileSync(join(dir, "PROVENANCE.json"), "utf8")) as {
  source: string;
  commit: string;
  license: string;
  files: Record<string, { sha256: string; version?: string }>;
};

describe("vendored PayPal OpenAPI specifications", () => {
  it("come from PayPal's Apache-2.0 repository at a pinned commit", () => {
    expect(provenance.source).toBe("https://github.com/paypal/paypal-rest-api-specifications");
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.license).toBe("Apache-2.0");
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toContain("Apache License");
  });

  for (const [name, info] of Object.entries(provenance.files)) {
    it(`${name} is byte-identical to the recorded upstream file`, () => {
      const sha = createHash("sha256")
        .update(readFileSync(join(dir, name)))
        .digest("hex");
      expect(sha).toBe(info.sha256);
    });
  }

  it("covers every PayPal spec the contract loads (supplements are ours and listed separately)", () => {
    const vendored = Object.values(SPEC_FILES).filter((f) => !f.startsWith("supplements/"));
    for (const f of vendored) expect(Object.keys(provenance.files)).toContain(f);
  });
});
