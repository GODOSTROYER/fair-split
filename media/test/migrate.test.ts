import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAsset } from "../src/content/spike.js";
import { emptyManifest, ManifestStore } from "../src/imagegen/manifest.js";
import { applyMigration, planMigration } from "../src/imagegen/migrate.js";
import { sha256 } from "../src/util/hash.js";
import { entry } from "./support.js";

describe("migrate: entries made before 23 Oct follow today's rules without a new exec", () => {
  it("moves a spike photo out of photos/ and points the prompt at the master's history copy", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-migrate-"));
    const prompt = "the prompt that made the master";
    const promptSha = sha256(prompt);
    mkdirSync(join(root, "prompts", "history"), { recursive: true });
    mkdirSync(join(root, "photos"), { recursive: true });
    mkdirSync(join(root, "fixtures"), { recursive: true });
    writeFileSync(join(root, "prompts", "history", "spike-4up.12345678.md"), prompt);
    writeFileSync(join(root, "photos", "spike-4up.webp"), "webp bytes");
    writeFileSync(
      join(root, "fixtures", "spike-4up.json"),
      JSON.stringify({ id: "spike-4up", image: { display: "photos/spike-4up.webp" } }),
    );
    const m = emptyManifest();
    const e = entry("spike-4up");
    e.kind = "slip_photo";
    e.display = { file: "photos/spike-4up.webp", sha256: "b".repeat(64), width: 1, height: 1, bytes: 1 };
    e.prompt = { file: "prompts/spike-4up.md", sha256: promptSha };
    const accepted = e.attempts[0];
    if (accepted)
      Object.assign(accepted, {
        promptFile: "prompts/history/spike-4up.12345678.md",
        promptSha256: promptSha,
      });
    m.assets["spike-4up"] = e;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    const store = new ManifestStore(join(root, "manifest.json"));

    const steps = planMigration(await store.read(), [findAsset("spike-4up")]);
    expect(steps).toEqual([
      {
        id: "spike-4up",
        display: { from: "photos/spike-4up.webp", to: "photos/spike/spike-4up.webp" },
        prompt: {
          from: "prompts/spike-4up.md",
          to: "prompts/history/spike-4up.12345678.md",
          sha256: promptSha,
        },
      },
    ]);
    await applyMigration(root, store, steps);
    expect(existsSync(join(root, "photos", "spike-4up.webp"))).toBe(false);
    expect(readFileSync(join(root, "photos", "spike", "spike-4up.webp"), "utf8")).toBe("webp bytes");
    const after = (await store.read()).assets["spike-4up"];
    expect(after?.display?.file).toBe("photos/spike/spike-4up.webp");
    expect(after?.prompt).toEqual({ file: "prompts/history/spike-4up.12345678.md", sha256: promptSha });
    expect(JSON.parse(readFileSync(join(root, "fixtures", "spike-4up.json"), "utf8")).image.display).toBe(
      "photos/spike/spike-4up.webp",
    );
    // A second run has nothing left to do.
    expect(planMigration(await store.read(), [findAsset("spike-4up")])).toEqual([]);
  });

  it("refuses a history prompt whose bytes do not hash to the attempt's prompt", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-migrate-"));
    mkdirSync(join(root, "prompts", "history"), { recursive: true });
    writeFileSync(join(root, "prompts", "history", "x.md"), "edited later");
    const store = new ManifestStore(join(root, "manifest.json"));
    await expect(
      applyMigration(root, store, [
        { id: "x", prompt: { from: "prompts/x.md", to: "prompts/history/x.md", sha256: "0".repeat(64) } },
      ]),
    ).rejects.toThrow(/does not hash/);
  });
});
