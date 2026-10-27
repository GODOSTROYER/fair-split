// Officer key IDs on the prototype's screens come from the fixture, which copies core's seed (S3.8 deviation
// 7): the treasurer signs with her non-extractable WebCrypto key fs-analyn-w1 (kind web), the Chair with his
// app key fs-ernesto-a1.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BATCH_SHA256 } from "./fixture.js";
import { hashPrefix } from "./format.js";
import { CompositionPage } from "./pages/Compositions.js";

/** Officer, ledger and demo key IDs: `fs-{persona}-{a|w|s|k}{n}` and `fs-{persona}-demo-{6 hex}`. */
const KEY_ID = /fs-[a-z]+-(?:[a-z]\d+|demo-[0-9a-f]{6})/g;

describe("officer keys on the prototype's screens", () => {
  it("the Proof's Two keys plate names fs-analyn-w1 and fs-ernesto-a1 over the batch hash", () => {
    render(<CompositionPage id="proof" />);
    const plate = screen.getByText("Two keys").closest("li");
    expect(plate?.textContent).toContain(`fs-analyn-w1, fs-ernesto-a1, batch ${hashPrefix(BATCH_SHA256, 4)}`);
    expect(document.body.textContent).not.toMatch(/fs-analyn-a\d/);
  });

  it("no screen spells a key ID itself: every one comes from the fixture", () => {
    // Paths, not URL objects: under jsdom the global URL is jsdom's, which node:fs does not accept.
    const here = dirname(fileURLToPath(import.meta.url));
    const spelled: string[] = [];
    for (const entry of readdirSync(here, { recursive: true, encoding: "utf8" })) {
      const file = entry.replaceAll("\\", "/");
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file) || file === "fixture.ts") continue;
      for (const [id] of readFileSync(join(here, file), "utf8").matchAll(KEY_ID))
        spelled.push(`${file}: ${id}`);
    }
    expect(spelled).toEqual([]);
  });
});
