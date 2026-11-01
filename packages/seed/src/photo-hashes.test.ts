import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attestedEntries, verifyChain } from "@fairsplit/domain";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./build.js";
import { getPhotos, getSnapshot } from "./index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("composed replay photo evidence", () => {
  it("pins all twelve A–L hashes to the served WebP bytes", () => {
    const photos = getPhotos("REPLAY");
    expect(photos.map((p) => p.photoId)).toEqual("ABCDEFGHIJKL".split(""));
    for (const photo of photos) {
      const bytes = readFileSync(resolve(repoRoot, photo.file));
      // RIFF/WEBP identifies the actual served file, rather than a JSON slip manifest.
      expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
      expect(photo.manifestSha256, photo.file).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("carries those file hashes into regenerated Proof plate 3 and its signed chain", () => {
    const { snapshot } = buildSnapshot();
    const committed = getSnapshot();
    const replay = snapshot.photos.filter((p) => p.set === "REPLAY");
    expect(replay).toEqual(getPhotos("REPLAY"));
    expect(snapshot.figures).toEqual(committed.figures);
    const accepted = attestedEntries(snapshot.proof.ledger, "rows.accepted");
    for (const photo of replay) {
      const fileSha256 = createHash("sha256")
        .update(readFileSync(resolve(repoRoot, photo.file)))
        .digest("hex");
      expect(snapshot.proof.documents).toContainEqual({
        documentId: photo.documentId,
        sha256: fileSha256,
      });
      expect(accepted.find((e) => e.payload.documentId === photo.documentId)?.payload.sha256).toBe(
        fileSha256,
      );
    }
    const verified = verifyChain(snapshot.proof, snapshot.publishedKeys, { demoMode: true });
    expect(verified).toMatchObject({ ok: false, status: "sample" });
    expect(verified.chain.ok).toBe(true);
    expect(verified.checkpoint.ok).toBe(true);
    expect(verified.plates.read.ok).toBe(true);
  }, 60_000);
});
